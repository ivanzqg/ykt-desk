import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {BrowserCore, SCHOOL, OFFICIAL, loginUrl, taskUrl, videoUrl, validatePlatform} from '../browser-core.mjs';

const course={id:3203824,sign:'8NpUsaMXAnN'};
test('platform selection maps login, assignment and video URLs while retaining task identity',()=>{
  assert.equal(new URL(loginUrl('school')).origin,SCHOOL);
  assert.equal(new URL(loginUrl('official')).origin,OFFICIAL);
  const exercise={type:6,url:SCHOOL+'/ai-workspace/lms-graph/3203824/exercise/6067663?node_id=375676&fromProIframe=1&isyth=1&is_chapter=1'};
  const official=new URL(taskUrl(course,exercise,'official'));
  assert.equal(official.origin,OFFICIAL);assert.equal(official.pathname,'/ai-workspace/lms-graph/3203824/exercise/6067663');
  assert.equal(official.searchParams.get('node_id'),'375676');assert.equal(official.searchParams.has('fromProIframe'),false);
  assert.equal(new URL(taskUrl(course,exercise,'school')).origin,SCHOOL);
  const video={leafId:6067660,type:0,chapterId:375676};
  assert.equal(new URL(videoUrl(course,video,'official')).origin,OFFICIAL);
  assert.equal(new URL(taskUrl(course,{type:6},'official')).pathname,'/v2/web/studentLog/3203824');
  assert.throws(()=>validatePlatform('__proto__'));
  assert.throws(()=>taskUrl(course,{type:6,url:'https://example.com/exercise'},'official'));
});
test('playback lanes inherit the selected platform and its shared data page',async()=>{
  const root=new BrowserCore();root.cdp={connected:true};root.dataPage={sessionId:'official-data'};root.platform='official';
  const lane=root.createPlaybackLane();
  assert.equal(lane.platform,'official');assert.equal(lane.dataPage,root.dataPage);
  let opened;
  lane.playbackPolicy=async()=>({});lane.newPage=async url=>{opened=url;return {sessionId:1};};lane.waitForPage=async()=>{};
  await lane.navigateVideo(course,{type:0,leafId:6067660});
  assert.equal(new URL(opened).origin,OFFICIAL);assert.equal(root.dataPage.sessionId,'official-data');
});
test('HTML video is muted before play, can toggle without seeking, and keeps its volume',async()=>{
  const bridge=new BrowserCore();bridge.cdp={connected:true};bridge.playerPage={sessionId:1};
  const observations=[];
  const video={muted:false,volume:0.65,currentTime:45,paused:true,async play(){observations.push(this.muted);this.paused=false;}};
  bridge.evaluate=async(_page,expression)=>vm.runInNewContext(expression,{
    location:{origin:OFFICIAL},document:{querySelector:()=>video,visibilityState:'visible',hasFocus:()=>true},
  });
  await bridge.setMuted(true);await bridge.play();
  assert.deepEqual(observations,[true]);assert.equal(video.currentTime,45);assert.equal(video.volume,0.65);
  await bridge.setMuted(false);assert.equal(video.muted,false);assert.equal(video.paused,false);
  await bridge.setMuted(true);video.muted=false;await bridge.play();
  assert.deepEqual(observations,[true,true]);
  await assert.rejects(bridge.setMuted('false'),/静音/);
});
