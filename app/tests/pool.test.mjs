import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PlaybackPool,validatePlaybackOptions} from '../pool.mjs';

function fixture(count=3){
  const course={id:1,name:'课程'};
  const tasks=Array.from({length:count},(_,i)=>({id:`1:${i+1}`,leafId:i+1,name:`视频${i+1}`,type:0,expired:false,status:'pending'}));
  const lanes=[];let opened=0,maxOpened=0,rootClosed=false;
  const bridge={lanes:new Set(),playbackPolicy:async()=>({multiplePlayAllowed:true}),createPlaybackLane:mode=>{
    opened++;maxOpened=Math.max(opened,maxOpened);
    const lane={mode,leafId:null,paused:false,position:0,done:false,closed:false,
      progress:async()=>({completed:lane.done?1:0,rate:lane.done?1:0.1}),
      navigateVideo:async(_c,t)=>{lane.leafId=t.leafId;},
      playerState:async()=>({exists:true,duration:100,currentTime:lane.position++,paused:lane.paused,ended:false,rate:1.5,requiresForeground:true,visibilityState:'visible',focused:true}),
      setSpeed:async()=>{},play:async()=>{lane.paused=false;},pause:async()=>{lane.paused=true;},focusPlayer:async()=>{},
      close:async()=>{if(!lane.closed){lane.closed=true;opened--;}}
    };
    lanes.push(lane);bridge.lanes.add(lane);return lane;
  },close:async()=>{rootClosed=true;}};
  const pool=new PlaybackPool(bridge,id=>{const task=tasks.find(t=>t.id===id);return task?{course,task}:null;},()=>{},async()=>{},{timing:{pollMs:5,verifyMs:5,verifyAttempts:2}});
  return {pool,bridge,tasks,lanes,maxOpened:()=>maxOpened,opened:()=>opened,rootClosed:()=>rootClosed};
}
async function until(fn){for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw new Error('Pool test timed out');}
test('background workers honor concurrency and use separate playback sessions',async()=>{
  const f=fixture();await f.pool.start(f.tasks.map(t=>t.id),1.5,{mode:'background',concurrency:2});
  await until(()=>f.lanes.length===2&&f.pool.state.activeIds.length===2);
  assert.equal(f.lanes[0].mode,'background');assert.notEqual(f.lanes[0],f.lanes[1]);
  f.lanes[0].done=true;f.lanes[1].done=true;
  await until(()=>f.lanes.length===3);f.lanes[2].done=true;
  await until(()=>f.pool.state.status==='finished');
  assert.equal(f.maxOpened(),2);assert.equal(f.opened(),0);assert.equal(f.rootClosed(),false);
  assert.ok(f.pool.state.items.every(i=>i.status==='completed'));
});
test('pause, resume and stop affect every active worker',async()=>{
  const f=fixture(2);await f.pool.start(f.tasks.map(t=>t.id),1.5,{mode:'background',concurrency:2});
  await until(()=>f.pool.state.items.every(i=>i.status==='playing'));
  await f.pool.pause();assert.equal(f.pool.state.status,'paused');assert.ok(f.lanes.every(l=>l.paused));
  await new Promise(r=>setTimeout(r,15));f.pool.resume();await until(()=>f.lanes.every(l=>!l.paused));
  await f.pool.stop();assert.equal(f.pool.state.status,'stopped');assert.ok(f.lanes.every(l=>l.paused&&l.closed));
});
test('skip one video leaves another running and moves that worker to the next task',async()=>{
  const f=fixture();await f.pool.start(f.tasks.map(t=>t.id),1.5,{mode:'background',concurrency:2});
  await until(()=>f.pool.state.items.filter(i=>i.status==='playing').length===2);
  await f.pool.skip(f.tasks[0].id);await until(()=>f.lanes.length===3);
  assert.equal(f.pool.state.items[0].status,'skipped');assert.equal(f.lanes[1].closed,false);
  await f.pool.stop();
});
test('a course disabling simultaneous playback blocks parallel startup',async()=>{
  const f=fixture(2);f.bridge.playbackPolicy=async()=>({multiplePlayAllowed:false});
  await assert.rejects(f.pool.start(f.tasks.map(t=>t.id),1.5,{mode:'background',concurrency:2}),/不允许/);
  assert.equal(f.lanes.length,0);
});
test('front mode stays serial and invalid concurrency is rejected',()=>{
  assert.doesNotThrow(()=>validatePlaybackOptions('background',4));
  assert.throws(()=>validatePlaybackOptions('foreground',2));
  assert.throws(()=>validatePlaybackOptions('background',0));
  assert.throws(()=>validatePlaybackOptions('background',5));
});
test('stop during policy loading cancels startup before a video is opened',async()=>{
  const f=fixture(2);let release;
  f.bridge.playbackPolicy=()=>new Promise(resolve=>{release=()=>resolve({multiplePlayAllowed:true});});
  const starting=f.pool.start(f.tasks.map(t=>t.id),1.5,{mode:'background',concurrency:2});
  await until(()=>!!release);await f.pool.stop();release();
  await assert.rejects(starting,/取消/);assert.equal(f.lanes.length,0);
});
