import { PlaybackQueue } from './queue.mjs';
import { SPEEDS } from './browser-core.mjs';

export const PLAYBACK_MODES = ['background','foreground'];
export const MAX_CONCURRENCY = 16;
export function validatePlaybackOptions(mode,concurrency) {
  if (!PLAYBACK_MODES.includes(mode)) throw new Error('无效的播放方式');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) throw new Error(`并发数请选择 1–${MAX_CONCURRENCY}`);
  if (mode === 'foreground' && concurrency !== 1) throw new Error('前台模式仅支持同时播放一个视频');
}
const sleep = (ms,signal) => new Promise(resolve=>{
  if(signal.aborted)return resolve();
  const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};
  const timer=setTimeout(finish,ms);signal.addEventListener('abort',finish,{once:true});
});

export class PlaybackPool {
  constructor(bridge,findTask,update,refresh,{timing = {}, planChanged = ()=>{}} = {}) {
    this.bridge=bridge;this.findTask=findTask;this.update=update;this.refresh=refresh;
    this.timing=timing;this.planChanged=planChanged;
    this.active=new Map();this.controller=null;this.runner=null;this.starting=false;
    this.state={status:'idle',items:[],activeId:null,activeIds:[],mode:'background',concurrency:2,speed:1.5,muted:false,requiresForeground:null,message:'选择视频，开始后台播放',updatedAt:null};
  }
  emit() {
    const live=[...this.active.values()];
    this.state.activeIds=live.filter(x=>!['completed','skipped','stopped'].includes(x.item.status)).map(x=>x.item.id);
    this.state.activeId=this.state.activeIds[0] || null;
    this.state.requiresForeground=live.some(x=>x.queue.state.requiresForeground===true);
    if(!['paused','stopping','stopped','finished'].includes(this.state.status) && live.length){
      const playing=live.filter(x=>['running'].includes(x.queue.state.status));
      this.state.status=playing.length?'running':live.some(x=>x.queue.state.status==='needs_attention')?'needs_attention':live.some(x=>x.queue.state.status==='waiting_focus')?'waiting_focus':'running';
      this.state.message=this.state.status==='needs_attention'?'部分任务需要处理，请查看各视频状态':this.state.status==='waiting_focus'?'请返回前台播放页':`同时播放 ${playing.length} / ${this.state.concurrency} 个视频`;
    }
    this.state.updatedAt=new Date().toISOString();this.update();
  }
  async start(ids,speed,{mode='background',concurrency=2,muted=false}={}) {
    if(this.runner || this.starting)throw new Error('请先停止当前队列');
    validatePlaybackOptions(mode,concurrency);
    if(typeof muted!=='boolean')throw new Error('无效的静音选项');
    if(!SPEEDS.includes(speed))throw new Error('无效倍速');
    if(!Array.isArray(ids) || !ids.every(id=>typeof id==='string'))throw new Error('无效的任务列表');
    const unique=[...new Set(ids)];
    if(!unique.length || unique.length>200)throw new Error('请选择 1–200 个视频');
    const items=unique.map(id=>{
      const found=this.findTask(id);
      if(!found || found.task.type!==0 || found.task.expired || ['completed','unknown'].includes(found.task.status))throw new Error('请选择当前课程中未完成且未超时的视频');
      return {id,courseId:found.course.id,name:found.task.name,courseName:found.course.name,status:'queued',position:0,duration:0,coverage:null,speed,muted,message:''};
    });
    this.starting=true;
    this.controller=new AbortController();
    try {
      if(concurrency>1 && items.length>1){
        const courseCounts=new Map();
        for(const item of items)courseCounts.set(item.courseId,(courseCounts.get(item.courseId)||0)+1);
        for(const [courseId,count]of courseCounts){
          if(count>1 && !(await this.bridge.playbackPolicy(courseId)).multiplePlayAllowed)throw new Error('课程设置不允许同时播放多视频，请将并发数设为 1');
        }
      }
      if(this.controller.signal.aborted)throw new Error('队列启动已取消');
      this.state={status:'running',items,activeId:null,activeIds:[],mode,concurrency,speed,muted,requiresForeground:null,message:'正在启动播放会话',updatedAt:null};
      this.emit();this.planChanged(this.plan());
      this.runner=this.run(this.controller.signal).finally(()=>{this.runner=null;});
    } finally {this.starting=false;}
  }
  plan() { return {ids:this.state.items.filter(i=>!['completed','skipped'].includes(i.status)).map(i=>i.id),mode:this.state.mode,concurrency:this.state.concurrency,speed:this.state.speed,muted:this.state.muted}; }
  async run(signal) {
    let cursor=0;
    const worker=async()=>{
      while(!signal.aborted && cursor<this.state.items.length){
        while(this.state.status==='paused'&&!signal.aborted)await sleep(200,signal);
        if(signal.aborted)break;
        const item=this.state.items[cursor++];
        if(item.status==='skipped')continue;
        let queue,lane;
        try {lane=this.bridge.createPlaybackLane(this.state.mode);}
        catch(error){item.status='failed';item.message=error.message;this.emit();continue;}
        queue=new PlaybackQueue(lane,this.findTask,()=>{
          const inner=queue.state.items[0];
          if(inner)Object.assign(item,inner);
          this.emit();
        },async()=>{},this.timing);
        this.active.set(item.id,{item,queue,lane});
        try {
          await queue.start([item.id],this.state.speed,{muted:this.state.muted});
          if(this.state.status==='paused')await queue.pause();
          if(signal.aborted)await queue.stop();
          await queue.runner;
          if(item.status==='completed')await this.refresh(item.courseId).catch(()=>{});
        } catch(error) {item.status='failed';item.message=error.message;}
        finally {
          await lane.close().catch(()=>{});this.bridge.lanes?.delete(lane);
          this.active.delete(item.id);this.planChanged(this.plan());this.emit();
        }
      }
    };
    try { await Promise.all(Array.from({length:Math.min(this.state.concurrency,this.state.items.length)},worker)); }
    finally {
      for(const item of this.state.items)if(['queued','loading','playing','verifying','needs_attention','waiting_focus'].includes(item.status))item.status='stopped';
      this.state.activeIds=[];this.state.activeId=null;this.state.status=signal.aborted?'stopped':'finished';
      this.state.message=signal.aborted?'已停止，所有播放会话已暂停':'队列已结束';this.planChanged(this.plan());this.emit();
    }
  }
  async pause() {
    if(!this.runner)return;
    this.state.status='paused';this.state.message='所有视频已暂停';this.emit();
    await Promise.all([...this.active.values()].map(x=>x.queue.pause()));
  }
  resume(id) {
    if(!this.runner)return;
    this.state.status='running';
    for(const [taskId,x]of this.active)if(!id||id===taskId)x.queue.resume();
    this.emit();
  }
  async stop() {
    if(this.starting)this.controller?.abort();
    if(this.runner){
      this.state.status='stopping';this.controller.abort();this.emit();
      await Promise.all([...this.active.values()].map(x=>x.queue.stop()));
      await this.runner;
    }else{this.state.status='stopped';this.state.message='已停止';this.emit();}
  }
  async skip(id=this.state.activeId) {
    const entry=this.active.get(id);
    if(entry)await entry.queue.skip();
    else{const item=this.state.items.find(x=>x.id===id);if(item?.status==='queued')item.status='skipped';}
    this.emit();
  }
  async setSpeed(speed) {
    if(!SPEEDS.includes(speed))throw new Error('无效倍速');
    const outcomes=await Promise.allSettled([...this.active.values()].map(x=>x.queue.setSpeed(speed)));
    this.state.speed=speed;this.emit();
    const error=outcomes.find(x=>x.status==='rejected');if(error)throw error.reason;
  }
  async setMuted(muted) {
    if(typeof muted!=='boolean')throw new Error('无效的静音选项');
    this.state.muted=muted;
    for(const item of this.state.items)if(item.status==='queued')item.muted=muted;
    const outcomes=await Promise.allSettled([...this.active.values()].map(x=>x.queue.setMuted(muted)));
    this.planChanged(this.plan());this.emit();
    const error=outcomes.find(x=>x.status==='rejected');if(error)throw error.reason;
  }
  async focusPlayer(id=this.state.activeId) {const entry=this.active.get(id);if(entry)await entry.lane.focusPlayer();}
}
