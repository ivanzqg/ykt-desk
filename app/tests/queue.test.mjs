import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackQueue, isServerCompleted, needsForeground } from '../queue.mjs';
import { validateEndpoint, validatePageUrl, videoUrl } from '../browser.mjs';
import { mergeCourse } from '../data.mjs';

const fixture = () => {
  const course = {id:3203824,courseId:1359324,skuId:907830,name:'会计学'};
  const task = {id:'3203824:6067660',leafId:6067660,name:'视频',type:0,status:'pending',expired:false};
  let pauses = 0;
  const bridge = {progress:async()=>({completed:0,rate:1}),navigateVideo:async()=>{},playerState:async()=>({exists:true,duration:10,currentTime:10,ended:true,paused:true,rate:1.5}),setSpeed:async()=>{},play:async()=>{},pause:async()=>{pauses++;}};
  const queue = new PlaybackQueue(bridge,id=>id===task.id?{course,task}:null,()=>{},async()=>{},{pollMs:5,verifyMs:5,verifyAttempts:2,loadAttempts:2});
  return {course,task,bridge,queue,pauses:()=>pauses};
};
async function until(fn) {
  for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,5));}
  throw new Error('Timed out waiting for test condition');
}
test('a video at 100% coverage still needs explicit server completion',async()=>{
  const f=fixture(); await f.queue.start([f.task.id],1.5);
  await until(()=>f.queue.state.status==='needs_attention');
  assert.equal(f.queue.state.items[0].status,'needs_attention');
  assert.equal(isServerCompleted({rate:1,completed:0}),false);
  await f.queue.stop(); assert.equal(f.queue.state.status,'stopped'); assert.ok(f.pauses()>0);
});
test('server confirmation completes video and refreshes course',async()=>{
  const f=fixture();let calls=0,refreshes=0;
  f.bridge.progress=async()=>({completed:++calls>1?1:0,rate:0.96});
  f.queue.refresh=async()=>{refreshes++;};
  await f.queue.start([f.task.id],1.5);await until(()=>f.queue.state.status==='finished');
  assert.equal(f.queue.state.items[0].status,'completed');assert.equal(refreshes,1);
});
test('stop during page navigation pauses again after navigation settles',async()=>{
  const f=fixture();let resolveNav,playing=0;
  f.bridge.navigateVideo=()=>new Promise(resolve=>{resolveNav=resolve;});
  f.bridge.play=async()=>{playing++;};
  await f.queue.start([f.task.id],1.5);await until(()=>!!resolveNav);
  const stopping=f.queue.stop();resolveNav();await stopping;
  assert.equal(playing,0);assert.equal(f.queue.state.items[0].status,'stopped');assert.ok(f.pauses()>=2);
});
test('skip during navigation leaves a skipped task and stops its playback',async()=>{
  const f=fixture();let resolveNav,playing=0;
  f.bridge.navigateVideo=()=>new Promise(resolve=>{resolveNav=resolve;});
  f.bridge.play=async()=>{playing++;};
  await f.queue.start([f.task.id],1.5);await until(()=>!!resolveNav);
  await f.queue.skip();resolveNav();await until(()=>f.queue.state.status==='finished');
  assert.equal(playing,0);assert.equal(f.queue.state.items[0].status,'skipped');
});
test('pause then resume continues the same video',async()=>{
  const f=fixture();let playing=0,paused=false;
  f.bridge.play=async()=>{playing++;paused=false;};
  f.bridge.pause=async()=>{paused=true;};
  f.bridge.progress=async()=>({completed:0,rate:0.1});
  f.bridge.playerState=async()=>({exists:true,duration:100,currentTime:playing,ended:false,paused,rate:1.5});
  await f.queue.start([f.task.id],1.5);await until(()=>f.queue.state.items[0].status==='playing');
  await f.queue.pause();await new Promise(r=>setTimeout(r,15));f.queue.resume();await until(()=>playing>=2);
  assert.equal(f.queue.state.status,'running');await f.queue.stop();
});
test('loss of window focus waits and returns to the same playback position without navigating',async()=>{
  const f=fixture();let focused=true,paused=false,navigations=0,plays=0;
  f.bridge.navigateVideo=async()=>{navigations++;};
  f.bridge.play=async()=>{plays++;paused=false;};
  f.bridge.pause=async()=>{paused=true;};
  f.bridge.progress=async()=>({completed:0,rate:0.1});
  f.bridge.playerState=async()=>({exists:true,duration:100,currentTime:10,ended:false,paused,rate:1.5,requiresForeground:true,visibilityState:'visible',focused});
  await f.queue.start([f.task.id],1.5);await until(()=>f.queue.state.items[0].status==='playing');
  focused=false;paused=true;await until(()=>f.queue.state.status==='waiting_focus');
  const playsWhileWaiting=plays;await new Promise(r=>setTimeout(r,15));
  assert.equal(plays,playsWhileWaiting);assert.equal(navigations,1);
  focused=true;await until(()=>f.queue.state.status==='running'&&plays>playsWhileWaiting);
  assert.equal(navigations,1);assert.equal(f.queue.state.items[0].position,10);
  await f.queue.stop();
});
test('manual queue pause while waiting for foreground does not resume merely on focus',async()=>{
  const f=fixture();let focused=false,plays=0;
  f.bridge.play=async()=>{plays++;};
  f.bridge.progress=async()=>({completed:0,rate:0.1});
  f.bridge.playerState=async()=>({exists:true,duration:100,currentTime:10,ended:false,paused:false,rate:1.5,requiresForeground:true,visibilityState:'visible',focused});
  await f.queue.start([f.task.id],1.5);await until(()=>f.queue.state.status==='waiting_focus');
  await f.queue.pause();focused=true;await new Promise(r=>setTimeout(r,20));
  assert.equal(f.queue.state.status,'paused');assert.equal(plays,0);
  await f.queue.stop();assert.equal(f.queue.state.status,'stopped');
});
test('native player pause resumes in place after explicit continue',async()=>{
  const f=fixture();let paused=false,navigations=0,plays=0;
  f.bridge.navigateVideo=async()=>{navigations++;};
  f.bridge.play=async()=>{plays++;paused=false;};
  f.bridge.pause=async()=>{paused=true;};
  f.bridge.progress=async()=>({completed:0,rate:0.1});
  f.bridge.playerState=async()=>({exists:true,duration:100,currentTime:10,ended:false,paused,rate:1.5});
  await f.queue.start([f.task.id],1.5);await until(()=>f.queue.state.items[0].status==='playing');
  paused=true;await until(()=>f.queue.state.status==='needs_attention');
  f.queue.resume();await until(()=>f.queue.state.status==='running'&&plays===2);
  assert.equal(navigations,1);await f.queue.stop();
});
test('visible but unfocused pages are restricted only when the course requires it',()=>{
  assert.equal(needsForeground({requiresForeground:true,visibilityState:'visible',focused:false}),true);
  assert.equal(needsForeground({requiresForeground:true,visibilityState:'hidden',focused:true}),true);
  assert.equal(needsForeground({requiresForeground:false,visibilityState:'hidden',focused:false}),false);
});
test('unsupported speed and expired/non-video tasks cannot start',async()=>{
  const f=fixture();await assert.rejects(f.queue.start([f.task.id],8));
  f.task.expired=true;await assert.rejects(f.queue.start([f.task.id],1));
  f.task.expired=false;f.task.type=6;await assert.rejects(f.queue.start([f.task.id],1));
});
test('only loopback CDP endpoints and exact Yuketang domains are accepted',()=>{
  assert.equal(validateEndpoint('http://[::1]:9222'),'http://[::1]:9222');
  for(const url of ['http://10.0.0.1:9222','http://evil.test:9222','http://localhost:9222/proxy','http://user:pass@localhost:9222'])assert.throws(()=>validateEndpoint(url));
  assert.throws(()=>validatePageUrl('https://tsinghua.yuketang.cn.evil.test/video'));
  assert.throws(()=>videoUrl({id:1},{leafId:1,type:6}));
});
test('chapter metadata labels identically named assignments without losing todo status',()=>{
  const c={id:1};
  const merged=mergeCourse(c,{stats:{study_progress:0,unit_progress:{completed:0,total:2},unfinished:{total:1}},todos:[{leaf_id:2,name:'作业',type:6,is_expired:false}],chapters:{course_progress:[{id:5,section_leaf_list:[{name:'金融资产',leaf_list:[{id:2,name:'作业',leaf_type:6,progress:0},{id:3,name:'视频',leaf_type:0,progress:1}]}]}]}});
  assert.equal(merged.tasks[0].status,'pending');assert.equal(merged.tasks[0].section,'金融资产');assert.equal(merged.tasks[1].status,'completed');
});
