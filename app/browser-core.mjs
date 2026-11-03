export const SCHOOL = 'https://tsinghua.yuketang.cn';
export const OFFICIAL = 'https://pro.yuketang.cn';
const ORIGINS = new Set([SCHOOL, OFFICIAL]);
export const PLATFORMS = {school:{origin:SCHOOL,name:'校园版'},official:{origin:OFFICIAL,name:'雨课堂版'}};
export const SPEEDS = [0.5, 1, 1.25, 1.5, 2];
export function validatePlatform(platform) {
  if (!Object.hasOwn(PLATFORMS, platform)) throw new Error('请选择校园版或雨课堂版');
  return platform;
}
export function loginUrl(platform = 'school') {
  validatePlatform(platform);
  return platform === 'school' ? `${SCHOOL}/pro/` : `${OFFICIAL}/v2/web`;
}
export function validatePageUrl(value) {
  const url = new URL(value);
  if (!ORIGINS.has(url.origin) || url.username || url.password) throw new Error('只能打开雨课堂课程页面');
  return url.href;
}
export function platformPageUrl(value, platform = 'school') {
  validatePlatform(platform);
  const url = new URL(validatePageUrl(value));
  url.host = new URL(PLATFORMS[platform].origin).host;
  // School-only iframe flags are unnecessary in the official standalone workspace.
  if (platform === 'official') { url.searchParams.delete('fromProIframe'); url.searchParams.delete('isyth'); }
  return url.href;
}
export function courseUrl(course, platform = 'school') {
  validatePlatform(platform);
  return platform === 'school'
    ? `${SCHOOL}/pro/lms/${encodeURIComponent(course.sign)}/${course.id}/studycontent`
    : `${OFFICIAL}/v2/web/studentLog/${course.id}?university_id=2598&platform_id=3&classroom_id=${course.id}&content_url=`;
}
export function taskUrl(course, task, platform = 'school') {
  if (task.url) {
    const url = new URL(validatePageUrl(task.url));
    // LMS landing pages use different paths on the two platforms.
    if (url.pathname.startsWith('/pro/lms/') || url.pathname.startsWith('/v2/web/studentLog/')) return courseUrl(course, platform);
    return platformPageUrl(url.href, platform);
  }
  return task.type === 0 ? videoUrl(course, task, platform) : courseUrl(course, platform);
}
export function videoUrl(course, task, platform) {
  if (task.type !== 0 || !Number.isSafeInteger(Number(task.leafId))) throw new Error('此任务不是视频');
  const url = task.url ? validatePageUrl(task.url) : `${SCHOOL}/ai-workspace/lms-graph/${course.id}/video/${task.leafId}?node_id=${task.chapterId || 0}&fromProIframe=1&isyth=1&is_chapter=1`;
  return platform === undefined ? url : platformPageUrl(url, platform);
}

export class BrowserCore {
  constructor() { this.cdp = null; this.dataPage = null; this.playerPage = null; this.playerPolicy = null; this.studentIds = new Map(); this.endpoint = 'http://[::1]:9222'; this.platform = 'school'; this.muted = false; this.background = false; this.ownsConnection = true; this.lanes = new Set(); }
  get connected() { return this.cdp?.connected === true; }
  async newPage(url) {
    validatePageUrl(url);
    const { targetId } = await this.cdp.call('Target.createTarget', { url, background:this.background });
    const { sessionId } = await this.cdp.call('Target.attachToTarget', { targetId, flatten: true });
    await this.cdp.call('Runtime.enable', {}, sessionId);
    if (this.background) await this.cdp.call('Emulation.setFocusEmulationEnabled',{enabled:true},sessionId);
    return { targetId, sessionId };
  }
  createPlaybackLane(mode = 'background') {
    if (!this.connected) throw new Error('请先连接浏览器');
    const lane = new this.constructor();
    lane.cdp = this.cdp; lane.dataPage = this.dataPage; lane.studentIds = this.studentIds;
    lane.endpoint = this.endpoint; lane.background = mode === 'background'; lane.ownsConnection = false;
    lane.platform = this.platform;
    this.lanes.add(lane);
    return lane;
  }
  async playbackPolicy(courseId) {
    const policy = await this.api(`/c27/api/v1/platfrom/watermark?uv_id=2598&classroom_id=${courseId}`,courseId);
    return { requiresForeground:policy.anti_brushing === true, multiplePlayAllowed:policy.video_multiple_play_disabled !== true };
  }
  async evaluate(page, expression) {
    if (!this.connected || !page) throw new Error('请先连接已登录的浏览器');
    const result = await this.cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, page.sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description?.split('\n')[0] || '页面操作失败');
    return result.result.value;
  }
  async waitForPage(page, origin) {
    for (let i = 0; i < 30; i++) {
      try {
        const ready = await this.evaluate(page, '({origin:location.origin,ready:document.readyState})');
        if (ready.origin === origin && ready.ready !== 'loading') return;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    throw new Error('页面加载超时，请检查雨课堂浏览器');
  }
  async api(route, classroomId) {
    if (!route.startsWith('/') || route.startsWith('//') || !/^\/(mooc-api|c27|video-log)\//.test(route)) throw new Error('无效的课程请求');
    return this.evaluate(this.dataPage, `(${async function (route, classroomId) {
      if (location.origin !== 'https://tsinghua.yuketang.cn') throw new Error('请在新打开的雨课堂页完成登录，然后重新连接');
      const headers = { 'xtbz': 'cloud', 'university-id': '2598', 'uv-id': '2598', 'platform-id': '3', 'terminal-type': 'web', 'x-client': 'web' };
      if (classroomId) headers['classroom-id'] = String(classroomId);
      const response = await fetch(route, { method: 'GET', credentials: 'same-origin', headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '请在雨课堂浏览器中登录' : '课程请求失败：' + response.status);
      const json = await response.json();
      if (json.success === false || (json.errcode && json.errcode !== 0)) throw new Error(json.msg || json.errmsg || '读取课程失败，请检查登录');
      return json.data || json;
    }.toString()})(${JSON.stringify(route)},${JSON.stringify(classroomId || null)})`);
  }
  async courses() {
    const data = await this.api('/mooc-api/v1/lms/user/user-courses/?status=1&page=1&no_page=1&no_term=true&uv_id=2598');
    if (!Array.isArray(data.product_list) || data.count !== data.product_list.length) throw new Error('课程列表返回不完整，请重新登录或刷新');
    return data.product_list;
  }
  async courseData(course, detailed = false) {
    const prefix = `/c27/online_courseware/course/classroom/${course.id}/${course.skuId}`;
    const [stats, todos] = await Promise.all([
      this.api(`${prefix}/study_stat/?term=latest&uv_id=2598`, course.id),
      this.api(`${prefix}/todo_list/?client_type=web&term=latest&uv_id=2598`, course.id),
    ]);
    if (!Array.isArray(todos.result) || todos.count.total !== todos.result.length) throw new Error('待办列表返回不完整');
    let chapters = null;
    if (detailed) chapters = await this.api(`/c27/online_courseware/schedule/course/progress/?classroom_id=${course.id}`, course.id);
    return { stats, todos: todos.result, chapters };
  }
  async progress(course, task) {
    if (!this.studentIds.has(course.id)) {
      const leaf = await this.api(`/mooc-api/v1/lms/learn/leaf_info/${course.id}/${task.leafId}/`,course.id);
      if (!leaf.user_id) throw new Error('未能读取当前学生的视频身份，请检查登录');
      this.studentIds.set(course.id,leaf.user_id);
    }
    const data = await this.api(`/video-log/get_video_watch_progress/?cid=${course.courseId}&user_id=${this.studentIds.get(course.id)}&classroom_id=${course.id}&video_type=video&vtype=rate&video_id=${task.leafId}&snapshot=1&no_loading=true`, course.id);
    return data[String(task.leafId)] || { completed: 0, rate: 0, watch_length: 0, video_length: 0 };
  }
  async navigateVideo(course, task) {
    const url = videoUrl(course, task, this.platform);
    this.playerPolicy = await this.playbackPolicy(course.id);
    if (!this.playerPage) this.playerPage = await this.newPage(url);
    else await this.cdp.call('Page.navigate', { url }, this.playerPage.sessionId);
    await this.waitForPage(this.playerPage, new URL(url).origin);
    if (!this.background) await this.cdp.call('Page.bringToFront', {}, this.playerPage.sessionId);
  }
  async playerState() {
    const state = await this.evaluate(this.playerPage, `(${function () {
      if (!['https://tsinghua.yuketang.cn', 'https://pro.yuketang.cn'].includes(location.origin)) return { attention: '请在雨课堂页完成登录' };
      const view = { visibilityState:document.visibilityState, focused:document.hasFocus() };
      const video = document.querySelector('video.xt_video_player') || document.querySelector('video');
      const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
      const modal = [...document.querySelectorAll('.el-message-box__wrapper,.el-dialog__wrapper,[role="dialog"]')].find(el => visible(el) && /验证码|身份验证|继续观看|请.*验证|登录/.test(el.innerText));
      if (modal) return { ...view, attention: modal.innerText.slice(0, 120), exists: !!video };
      if (!video) return { ...view, exists: false };
      const speed = document.querySelector('.xt_video_player_speed');
      const availableSpeeds = visible(speed) ? [...speed.querySelectorAll('[data-speed]')].map(el => Number(el.dataset.speed)).filter(n => n > 0 && n <= 2) : [1];
      return { ...view, exists: true, currentTime: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : 0, paused: video.paused, ended: video.ended, readyState: video.readyState, rate: video.playbackRate, muted:video.muted, availableSpeeds, error: video.error ? '视频加载失败：' + video.error.code : null };
    }.toString()})()`);
    return { ...state, requiresForeground:this.playerPolicy?.requiresForeground ?? null, backgroundSession:this.background };
  }
  async setSpeed(speed) {
    if (!SPEEDS.includes(speed)) throw new Error('请选择播放器支持的倍速');
    const state = await this.playerState();
    if (!state.availableSpeeds?.includes(speed)) throw new Error(`此视频播放器不支持 ${speed}×，请改为可用倍速`);
    if (state.rate === speed) return;
    const menu = await this.elementPoint('.xt_video_player_speed');
    await this.cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...menu},this.playerPage.sessionId);
    await new Promise(resolve => setTimeout(resolve,300));
    const point = await this.elementPoint(`.xt_video_player_speed [data-speed="${speed}"]`);
    await this.cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point},this.playerPage.sessionId);
    // The stock player enables its menu click after movement within the hovered item.
    const clickPoint={x:point.x+2,y:point.y};
    await this.cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...clickPoint},this.playerPage.sessionId);
    await this.cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...clickPoint},this.playerPage.sessionId);
    await this.cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...clickPoint},this.playerPage.sessionId);
    for (let n=0;n<10;n++) {
      if ((await this.playerState()).rate === speed) return;
      await new Promise(resolve => setTimeout(resolve,200));
    }
    throw new Error('播放器未接受倍速设置，请在雨课堂页检查');
  }
  async elementPoint(selector) {
    return this.evaluate(this.playerPage, `(${function(selector){
      const el=document.querySelector(selector); const rect=el?.getBoundingClientRect();
      if(!rect||!rect.width||!rect.height||getComputedStyle(el).visibility==='hidden') throw new Error('播放器控件不可见，请打开播放页面');
      return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
    }.toString()})(${JSON.stringify(selector)})`);
  }
  async play() {
    return this.evaluate(this.playerPage, `(${async function (requiresForeground, muted) {
      if (!['https://tsinghua.yuketang.cn', 'https://pro.yuketang.cn'].includes(location.origin)) throw new Error('播放器已离开雨课堂');
      const video = document.querySelector('video.xt_video_player') || document.querySelector('video');
      if (!video) throw new Error('播放器尚未加载');
      video.muted = muted;
      if (requiresForeground && (document.visibilityState !== 'visible' || !document.hasFocus())) return false;
      await video.play();
      return true;
    }.toString()})(${this.playerPolicy?.requiresForeground === true},${this.muted})`);
  }
  async setMuted(muted) {
    if (typeof muted !== 'boolean') throw new Error('无效的静音选项');
    this.muted = muted;
    if (!this.playerPage || !this.connected) return;
    await this.evaluate(this.playerPage, `(${function (muted) {
      if (!['https://tsinghua.yuketang.cn','https://pro.yuketang.cn'].includes(location.origin)) throw new Error('播放器已离开雨课堂');
      const video = document.querySelector('video.xt_video_player') || document.querySelector('video');
      if (video) video.muted = muted;
    }.toString()})(${muted})`);
  }
  async pause() {
    if (!this.playerPage || !this.connected) return;
    await this.evaluate(this.playerPage, `if (['https://tsinghua.yuketang.cn','https://pro.yuketang.cn'].includes(location.origin)) { const v=document.querySelector('video.xt_video_player')||document.querySelector('video'); if(v) v.pause(); }`);
  }
  async focusPlayer() { if (this.playerPage) await this.cdp.call('Page.bringToFront', {}, this.playerPage.sessionId); }
  async openTask(url) { return this.newPage(validatePageUrl(url)); }
  async close() {
    for (const lane of this.lanes) await lane.close().catch(()=>{});
    this.lanes.clear();
    await this.pause().catch(() => {});
    for (const page of [this.ownsConnection ? this.dataPage : null, this.playerPage]) if (page && this.connected) await this.cdp.call('Target.closeTarget', { targetId: page.targetId }).catch(() => {});
    if (this.ownsConnection) this.cdp?.close();
    this.cdp = null; this.playerPage = null;
  }
}
