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
      playerState:async()=>({exists:true,duration:100,currentTime:lane.position++,paused:lane.paused,ended:false,rate:1.5,muted:lane.muted,requiresForeground:true,visibilityState:'visible',focused:true}),
      setSpeed:async()=>{},play:async()=>{lane.paused=false;},pause:async()=>{lane.paused=true;},focusPlayer:async()=>{},
      setMuted:async muted=>{lane.muted=muted;},
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
  assert.doesNotThrow(()=>validatePlaybackOptions('background',16));
  assert.throws(()=>validatePlaybackOptions('foreground',2));
  assert.throws(()=>validatePlaybackOptions('background',0));
  assert.throws(()=>validatePlaybackOptions('background',17));
  assert.throws(()=>validatePlaybackOptions('background',1.5));
});
test('sixteen workers keep the seventeenth video queued and stop every player',async t=>{
  const f=fixture(17);
  t.after(()=>f.pool.stop());
  await f.pool.start(f.tasks.map(t=>t.id),1.5,{mode:'background',concurrency:16});
  await until(()=>f.pool.state.items.filter(i=>i.status==='playing').length===16);
  assert.equal(f.lanes.length,16);assert.equal(f.pool.state.items[16].status,'queued');
  f.lanes[0].done=true;
  await until(()=>f.lanes.length===17&&f.pool.state.items[16].status==='playing');
  assert.equal(f.maxOpened(),16);
  await f.pool.stop();assert.equal(f.opened(),0);assert.ok(f.lanes.every(l=>l.paused&&l.closed));
});
test('mute applies to active and subsequent videos, survives pause, and persists in the plan',async t=>{
  const f=fixture(3);
  t.after(()=>f.pool.stop());
  await f.pool.start(f.tasks.map(t=>t.id),1.5,{concurrency:2,muted:true});
  await until(()=>f.pool.state.items.filter(i=>i.status==='playing').length===2);
  assert.ok(f.lanes.every(l=>l.muted));assert.equal(f.pool.plan().muted,true);
  await f.pool.pause();await f.pool.setMuted(false);
  assert.ok(f.lanes.every(l=>!l.muted));assert.equal(f.pool.state.items[2].muted,false);
  assert.equal(f.pool.plan().muted,false);
  f.pool.resume();await until(()=>f.lanes.every(l=>!l.paused));
  f.lanes[0].done=true;await until(()=>f.lanes.length===3&&f.pool.state.items[2].status==='playing');
  assert.equal(f.lanes[2].muted,false);
  await f.pool.setMuted(true);assert.ok([...f.pool.active.values()].every(x=>x.lane.muted));
  await assert.rejects(f.pool.setMuted('true'),/静音/);
  await f.pool.stop();
});
test('stop during policy loading cancels startup before a video is opened',async()=>{
  const f=fixture(2);let release;
  f.bridge.playbackPolicy=()=>new Promise(resolve=>{release=()=>resolve({multiplePlayAllowed:true});});
  const starting=f.pool.start(f.tasks.map(t=>t.id),1.5,{mode:'background',concurrency:2});
  await until(()=>!!release);await f.pool.stop();release();
  await assert.rejects(starting,/取消/);assert.equal(f.lanes.length,0);
});
test('adding after a one-video start fills vacant slots without changing concurrency or mute',async t=>{
  const f=fixture(5);t.after(()=>f.pool.stop());
  await f.pool.start([f.tasks[0].id],1.5,{concurrency:3,muted:true});
  await until(()=>f.pool.state.items[0].status==='playing');
  assert.equal(await f.pool.enqueue(f.tasks.slice(1).map(t=>t.id),2,{concurrency:16,muted:false}),4);
  await until(()=>f.pool.state.items.filter(i=>i.status==='playing').length===3);
  assert.equal(f.lanes.length,3);assert.equal(f.pool.state.concurrency,3);assert.equal(f.pool.state.muted,true);
  assert.equal(f.pool.state.items.filter(i=>i.status==='queued').length,2);
  f.lanes[0].done=true;
  await until(()=>f.lanes.length===4);assert.equal(f.maxOpened(),3);assert.equal(f.lanes[3].leafId,4);
  assert.equal(f.lanes[3].muted,true);assert.equal(f.pool.plan().ids.length,4);
});
test('multi-select queue completes every task in order and ignores duplicate additions',async t=>{
  const f=fixture(5);t.after(()=>f.pool.stop());
  assert.equal(await f.pool.enqueue([f.tasks[0].id],1.5,{concurrency:2}),1);
  await until(()=>f.pool.state.items[0].status==='playing');
  assert.equal(await f.pool.enqueue([f.tasks[0].id,...f.tasks.slice(1).map(t=>t.id),f.tasks[1].id],1),4);
  assert.equal(await f.pool.enqueue([f.tasks[0].id],1),0);
  for(let i=0;i<f.tasks.length;i++){
    await until(()=>f.lanes.length>i&&f.lanes[i].leafId!==null);
    assert.equal(f.lanes[i].leafId,i+1);f.lanes[i].done=true;
  }
  await until(()=>f.pool.state.status==='finished');
  assert.ok(f.pool.state.items.every(i=>i.status==='completed'));assert.ok(f.maxOpened()<=2);assert.equal(f.opened(),0);
});
test('append while paused waits for resume and respects the initial serial limit',async t=>{
  const f=fixture(3);t.after(()=>f.pool.stop());
  await f.pool.start([f.tasks[0].id],1.5,{concurrency:1});
  await until(()=>f.pool.state.items[0].status==='playing');await f.pool.pause();
  await f.pool.enqueue(f.tasks.slice(1).map(t=>t.id),2,{concurrency:16});
  await new Promise(r=>setTimeout(r,20));assert.equal(f.lanes.length,1);assert.equal(f.pool.state.status,'paused');
  f.pool.resume();f.lanes[0].done=true;await until(()=>f.lanes.length===2);
  assert.equal(f.maxOpened(),1);assert.equal(f.lanes[1].leafId,2);
});
test('invalid or platform-blocked additions are atomic and cannot exceed 200 queue entries',async t=>{
  const f=fixture(201);t.after(()=>f.pool.stop());
  await f.pool.start([f.tasks[0].id],1.5,{concurrency:2});
  await assert.rejects(f.pool.enqueue([f.tasks[1].id,'missing'],1),/未完成/);assert.equal(f.pool.state.items.length,1);
  await assert.rejects(f.pool.enqueue(f.tasks.slice(1).map(t=>t.id),1),/200/);assert.equal(f.pool.state.items.length,1);
  f.bridge.playbackPolicy=async()=>({multiplePlayAllowed:false});
  await assert.rejects(f.pool.enqueue([f.tasks[1].id],1),/不允许/);assert.equal(f.pool.state.items.length,1);
});
test('stop during append-policy lookup prevents late additions from reopening playback',async t=>{
  const f=fixture(2);t.after(()=>f.pool.stop());
  await f.pool.start([f.tasks[0].id],1.5,{concurrency:2});
  await until(()=>f.pool.state.items[0].status==='playing');
  let release;f.bridge.playbackPolicy=()=>new Promise(resolve=>{release=()=>resolve({multiplePlayAllowed:true});});
  const adding=f.pool.enqueue([f.tasks[1].id],1.5);
  await until(()=>!!release);await f.pool.stop();release();
  await assert.rejects(adding,/已停止/);assert.equal(f.pool.state.items.length,1);assert.equal(f.opened(),0);
});
test('pending append keeps a draining queue alive until new tasks are admitted',async t=>{
  const f=fixture(2);t.after(()=>f.pool.stop());
  await f.pool.start([f.tasks[0].id],1.5,{concurrency:2});
  await until(()=>f.pool.state.items[0].status==='playing');
  let release;f.bridge.playbackPolicy=()=>new Promise(resolve=>{release=()=>resolve({multiplePlayAllowed:true});});
  const adding=f.pool.enqueue([f.tasks[1].id],1.5);await until(()=>!!release);
  f.lanes[0].done=true;await until(()=>f.opened()===0);
  assert.notEqual(f.pool.state.status,'finished');release();await adding;
  await until(()=>f.lanes.length===2);assert.equal(f.lanes[1].leafId,2);
});
