import { writeFile } from 'node:fs/promises';
import { BrowserBridge } from '../browser.mjs';
import { PlaybackQueue } from '../queue.mjs';

const bridge = new BrowserBridge();
const course = {id:3203824,courseId:1359324,skuId:907830,name:'会计学'};
const task = {id:'3203824:6067660',leafId:6067660,chapterId:375676,name:'2.9.1 金融资产与金融负债的分类',type:0,expired:false,status:'pending'};
const queue = new PlaybackQueue(bridge,id=>id===task.id?{course,task}:null,()=>{},async()=>{});
async function until(condition,timeout=15000) {
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(await condition())return;await new Promise(resolve=>setTimeout(resolve,250));}
  throw new Error('Live focus verification timed out: '+queue.state.message);
}
try {
  await bridge.connect(process.env.YKT_CDP || 'http://[::1]:9222');
  const before=await bridge.progress(course,task);
  if(Number(before.completed)===1)throw new Error('Selected video is already completed; no playback was started');
  await queue.start([task.id],2);
  await until(()=>queue.state.items[0]?.status==='playing');
  const playerId=bridge.playerPage.targetId;
  const playing=await bridge.playerState();
  await bridge.cdp.call('Page.bringToFront',{},bridge.dataPage.sessionId);
  await until(()=>queue.state.status==='waiting_focus');
  const hidden=await bridge.playerState();
  await new Promise(resolve=>setTimeout(resolve,2500));
  const stillHidden=await bridge.playerState();
  if(!hidden.paused || stillHidden.currentTime>hidden.currentTime+0.2)throw new Error('Hidden player was not held paused');
  await bridge.focusPlayer();
  await until(()=>queue.state.status==='running'&&queue.state.items[0]?.status==='playing');
  await until(async()=>!(await bridge.playerState()).paused);
  const resumed=await bridge.playerState();
  if(bridge.playerPage.targetId!==playerId)throw new Error('Player tab was unexpectedly replaced');
  if(resumed.currentTime+0.2<hidden.currentTime)throw new Error('Playback rewound on focus return');
  await queue.stop();
  const stopped=await bridge.playerState();
  if(!stopped.paused)throw new Error('Player was not paused after stopping');
  const result={time:new Date().toISOString(),courseRequiresForeground:bridge.playerPolicy.requiresForeground,initialRate:playing.rate,hidden:{visibilityState:hidden.visibilityState,focused:hidden.focused,paused:hidden.paused,position:hidden.currentTime},stillHiddenPosition:stillHidden.currentTime,resumed:{focused:resumed.focused,paused:resumed.paused,position:resumed.currentTime,rate:resumed.rate},samePlayerTab:true,stoppedPaused:stopped.paused};
  await writeFile('.local/focus-verification.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {
  await queue.stop().catch(()=>{});
  await bridge.close();
}
