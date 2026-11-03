import { SPEEDS } from './browser-core.mjs';

const wait = (ms, signal) => new Promise(resolve => {
  if (signal.aborted) return resolve();
  const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, ms); signal.addEventListener('abort', done, { once: true });
});
export function isServerCompleted(progress) { return progress?.completed === true || Number(progress?.completed) === 1; }
export function needsForeground(video) { return video?.requiresForeground === true && (video.visibilityState !== 'visible' || video.focused !== true); }

export class PlaybackQueue {
  constructor(bridge, findTask, update, refresh, timing = {}) {
    this.bridge = bridge; this.findTask = findTask; this.update = update; this.refresh = refresh;
    this.pollMs = timing.pollMs || 2000; this.verifyMs = timing.verifyMs || 5000; this.verifyAttempts = timing.verifyAttempts || 6; this.loadAttempts = timing.loadAttempts || 30;
    this.state = { status:'idle', items:[], activeId:null, speed:1.5, requiresForeground:null, message:'选择视频，开始学习', updatedAt:null };
    this.runner = null; this.controller = null;
  }
  emit() { this.state.updatedAt = new Date().toISOString(); this.update(); }
  async start(ids, speed) {
    if (this.runner || ['running','paused','needs_attention'].includes(this.state.status)) throw new Error('请先停止当前队列');
    if (!SPEEDS.includes(speed)) throw new Error('无效倍速');
    const unique = [...new Set(ids)];
    if (!unique.length || unique.length > 200) throw new Error('请选择 1–200 个视频');
    const items = unique.map(id => {
      const found = this.findTask(id);
      if (!found || found.task.type !== 0) throw new Error('队列只能包含当前课程列表中的视频');
      if (found.task.expired || found.task.status === 'completed') throw new Error('请选择未完成且未超时的视频');
      return { id, courseId:found.course.id, name:found.task.name, courseName:found.course.name, status:'queued', position:0, duration:0, coverage:null, speed, message:'' };
    });
    this.state = { status:'running', items, activeId:null, speed, requiresForeground:null, message:'正在打开视频', updatedAt:null };
    this.controller = new AbortController();
    this.emit();
    this.runner = this.run(this.controller.signal).finally(() => { this.runner = null; });
  }
  async pause() {
    if (!['running','waiting_focus'].includes(this.state.status)) return;
    this.state.status = 'paused'; this.state.message = '已暂停'; this.emit();
    await this.bridge.pause();
  }
  resume() {
    if (!['paused','needs_attention'].includes(this.state.status)) return;
    this.state.status = 'running'; this.state.message = '继续学习'; this.emit();
  }
  async stop() {
    if (!this.runner) { this.state.status = 'stopped'; this.state.message = '已停止'; this.emit(); return; }
    this.state.status = 'stopping'; this.controller.abort(); this.emit();
    await this.bridge.pause().catch(() => {});
    await this.runner;
  }
  async skip() {
    const item = this.state.items.find(i => i.id === this.state.activeId);
    if (!item) return;
    item.skipRequested = true; item.status = 'skipped'; item.message = '已跳过';
    this.state.status = 'running'; await this.bridge.pause().catch(() => {}); this.emit();
  }
  async setSpeed(speed) {
    if (!SPEEDS.includes(speed)) throw new Error('无效倍速');
    if (this.state.activeId && ['running','paused'].includes(this.state.status)) await this.bridge.setSpeed(speed);
    this.state.speed = speed; this.emit();
  }
  async gate(signal, item) {
    while (!signal.aborted && !item.skipRequested && ['paused','needs_attention'].includes(this.state.status)) {
      await this.bridge.pause().catch(() => {}); await wait(this.pollMs,signal);
    }
    return !signal.aborted && !item.skipRequested;
  }
  async waitForForeground(signal,item) {
    while (!signal.aborted && !item.skipRequested) {
      if (!await this.gate(signal,item)) return false;
      const video = await this.bridge.playerState();
      if (signal.aborted || item.skipRequested) return false;
      if (video.attention || video.error) throw new Error(video.attention || video.error);
      this.state.requiresForeground = video.requiresForeground ?? null;
      if (!needsForeground(video)) {
        if (this.state.status === 'waiting_focus') {
          this.state.status = 'running'; item.status = 'playing';
          item.message = '播放页已回到前台，从原位置继续'; this.state.message = item.message; this.emit();
        }
        return true;
      }
      if (this.state.status !== 'waiting_focus') {
        await this.bridge.pause();
        if (signal.aborted || item.skipRequested) return false;
        if (this.state.status === 'paused') continue;
        this.state.status = 'waiting_focus'; item.status = 'waiting_focus';
        item.message = '此课程要求播放窗口保持焦点。切换标签或窗口会暂停，请点击“返回播放页”后继续观看。';
        this.state.message = item.message; this.emit();
      }
      await wait(this.pollMs,signal);
    }
    return false;
  }
  attention(item, message) {
    item.status = 'needs_attention'; item.message = message;
    this.state.status = 'needs_attention'; this.state.message = message; this.emit();
  }
  async run(signal) {
    try {
      for (const item of this.state.items) {
        if (signal.aborted) break;
        this.state.activeId = item.id;
        let finished = false, reusePlayer = false;
        while (!finished && !signal.aborted && !item.skipRequested) {
          if (!await this.gate(signal,item)) break;
          try {
            const { course, task } = this.findTask(item.id);
            item.status = 'loading'; item.message = '正在加载播放器'; this.emit();
            const before = await this.bridge.progress(course,task);
            if (signal.aborted || item.skipRequested) break;
            if (isServerCompleted(before)) { this.complete(item,before); finished = true; continue; }
            if (!reusePlayer) await this.bridge.navigateVideo(course,task);
            reusePlayer = false;
            if (!await this.gate(signal,item)) break;
            let ready;
            for (let n = 0; n < this.loadAttempts && !signal.aborted; n++) {
              if (!await this.gate(signal,item)) break;
              ready = await this.bridge.playerState();
              if (ready.attention) throw new Error(ready.attention);
              if (ready.error) throw new Error(ready.error);
              if (ready.exists && ready.duration > 0) break;
              await wait(this.pollMs,signal);
            }
            if (signal.aborted || item.skipRequested) break;
            if (!ready?.duration) throw new Error('播放器未就绪，请在雨课堂页检查登录或网络');
            this.state.requiresForeground = ready.requiresForeground ?? null; this.emit();
            if (!await this.waitForForeground(signal,item)) break;
            await this.bridge.setSpeed(this.state.speed);
            if (!await this.gate(signal,item)) break;
            await this.bridge.play();
            let lastPosition = -1, stalled = 0, checks = 0, failures = 0;
            while (!signal.aborted && !item.skipRequested) {
              const wasPaused = this.state.status === 'paused';
              if (!await this.gate(signal,item)) break;
              if (wasPaused) {
                if (!await this.waitForForeground(signal,item)) break;
                await this.bridge.setSpeed(this.state.speed); await this.bridge.play(); stalled = 0;
              }
              const video = await this.bridge.playerState();
              if (signal.aborted || item.skipRequested) break;
              if (video.attention || video.error) throw new Error(video.attention || video.error);
              if (!video.exists) throw new Error('播放器已关闭或离开视频页');
              if (!video.ended && needsForeground(video)) {
                if (!await this.waitForForeground(signal,item)) break;
                await this.bridge.setSpeed(this.state.speed); await this.bridge.play(); stalled = 0;
                continue;
              }
              item.position = video.currentTime; item.duration = video.duration; item.speed = video.rate;
              item.status = video.ended ? 'verifying' : 'playing';
              item.message = video.ended ? '正在核对服务器完成状态' : '正在正常播放';
              this.state.message = item.message; this.emit();
              if (checks++ % 5 === 0 || video.ended) {
                try {
                  const progress = await this.bridge.progress(course,task); failures = 0;
                  item.coverage = Number(progress.rate || 0);
                  if (isServerCompleted(progress)) { this.complete(item,progress); finished = true; await this.bridge.pause(); break; }
                } catch (error) { if (++failures >= 3) throw error; }
              }
              if (video.ended) {
                let verified = false;
                for (let n = 0; n < this.verifyAttempts && !signal.aborted && !item.skipRequested; n++) {
                  if (!await this.gate(signal,item)) break;
                  await wait(this.verifyMs,signal);
                  if (signal.aborted || item.skipRequested) break;
                  const progress = await this.bridge.progress(course,task);
                  item.coverage = Number(progress.rate || 0); this.emit();
                  if (isServerCompleted(progress)) { this.complete(item,progress); verified = true; finished = true; break; }
                }
                if (!verified && !signal.aborted && !item.skipRequested) throw new Error('视频已播放结束，服务器仍未确认完成。请检查观看日志；继续将从服务器记录的位置重播。');
                break;
              }
              if (video.paused && this.state.status !== 'paused') {
                const error = new Error(video.requiresForeground
                  ? '播放器已暂停。此课程要求播放窗口保持焦点，请返回播放页；点击继续将保留当前播放位置。'
                  : '雨课堂播放器已暂停，请检查是否有提示，再点击继续');
                error.resumeInPlace = true;
                throw error;
              }
              stalled = video.currentTime <= lastPosition + 0.05 ? stalled + 1 : 0;
              lastPosition = video.currentTime;
              if (stalled * this.pollMs >= 60000) throw new Error('视频一分钟没有推进，请检查网络或页面提示');
              await wait(this.pollMs,signal);
            }
          } catch (error) {
            if (signal.aborted || item.skipRequested) break;
            reusePlayer = error.resumeInPlace === true;
            await this.bridge.pause().catch(() => {});
            this.attention(item,error.message);
            if (!await this.gate(signal,item)) break;
          }
        }
        await this.bridge.pause().catch(() => {});
        if (item.skipRequested) { item.status = 'skipped'; item.message = '已跳过'; this.emit(); }
        if (finished) await this.refresh(item.courseId).catch(() => {});
      }
    } finally {
      await this.bridge.pause().catch(() => {});
      for (const item of this.state.items) if (['loading','playing','verifying','needs_attention','waiting_focus'].includes(item.status)) { item.status = 'stopped'; item.message = '已停止'; }
      this.state.activeId = null;
      this.state.status = signal.aborted ? 'stopped' : 'finished';
      this.state.message = signal.aborted ? '已停止，视频已暂停' : '队列已结束'; this.emit();
    }
  }
  complete(item, progress) { item.status = 'completed'; item.coverage = Number(progress.rate || 0); item.message = '服务器已确认完成'; this.emit(); }
}
