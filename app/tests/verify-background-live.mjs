import {writeFile} from 'node:fs/promises';
import {BrowserBridge} from '../browser.mjs';
import {PlaybackPool} from '../pool.mjs';

const bridge=new BrowserBridge();
const course={id:3203824,courseId:1359324,skuId:907830,name:'会计学'};
const tasks=[6067660,6067661].map(leafId=>({id:`3203824:${leafId}`,leafId,chapterId:375676,type:0,name:`视频${leafId}`,expired:false,status:'pending'}));
const pool=new PlaybackPool(bridge,id=>{const task=tasks.find(t=>t.id===id);return task?{course,task}:null;},()=>{},async()=>{});
async function until(fn,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,300));}throw new Error('Live playback timed out: '+JSON.stringify(pool.state.items.map(i=>({status:i.status,message:i.message}))));}
try{
  await bridge.connect(process.env.YKT_CDP||'http://[::1]:9222');
  const initial=await Promise.all(tasks.map(t=>bridge.progress(course,t)));
  if(initial.some(p=>Number(p.completed)===1))throw new Error('Test video already completed; no playback started');
  await pool.start(tasks.map(t=>t.id),2,{mode:'background',concurrency:2});
  await until(()=>pool.state.items.every(i=>i.status==='playing'));
  await bridge.cdp.call('Page.bringToFront',{},bridge.dataPage.sessionId);
  const entries=[...pool.active.values()];
  const independentTargets=entries[0].lane.playerPage.targetId!==entries[1].lane.playerPage.targetId;
  const first=await Promise.all(entries.map(x=>x.lane.playerState()));
  await new Promise(r=>setTimeout(r,3000));
  const later=await Promise.all(entries.map(x=>x.lane.playerState()));
  if(later.some((v,i)=>v.paused||v.currentTime<=first[i].currentTime+2||v.rate!==2))throw new Error('A background video stopped advancing');
  await pool.pause();
  const paused=await Promise.all(entries.map(x=>x.lane.playerState()));
  if(paused.some(v=>!v.paused))throw new Error('Group pause failed');
  await new Promise(r=>setTimeout(r,2500));pool.resume();
  await until(async()=>(await Promise.all(entries.map(x=>x.lane.playerState()))).every(v=>!v.paused));
  await new Promise(r=>setTimeout(r,20000));
  // The original player flushes buffered viewing events when it pauses/unloads.
  await pool.stop();
  let progress;
  for(let attempt=0;attempt<8;attempt++){
    progress=await Promise.all(tasks.map(t=>bridge.progress(course,t)));
    if(progress.every((p,i)=>p.rate>initial[i].rate))break;
    await new Promise(r=>setTimeout(r,1500));
  }
  const result={time:new Date().toISOString(),mode:'background',concurrency:2,independentTargets,first:first.map(v=>({position:v.currentTime,paused:v.paused,rate:v.rate})),afterTabSwitch:later.map(v=>({position:v.currentTime,paused:v.paused,rate:v.rate})),groupPause:paused.every(v=>v.paused),serverProgress:progress.map((p,i)=>({leafId:tasks[i].leafId,beforeRate:initial[i].rate,afterRate:p.rate,completed:p.completed}))};
  result.stopped=pool.state.status;
  await writeFile('.local/background-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  if(progress.some((p,i)=>p.rate<=initial[i].rate))throw new Error('Server did not record increased coverage for both test videos');
}finally{await pool.stop().catch(()=>{});await bridge.close();}
