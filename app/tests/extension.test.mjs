import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {ChromeTransport, recoverOwnedTabs} from '../../extension/browser.mjs';
import {validateManifest} from '../../scripts/extension-package.mjs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

class Event {
  listeners = new Set();
  addListener(fn) { this.listeners.add(fn); }
  removeListener(fn) { this.listeners.delete(fn); }
  fire(...args) { return [...this.listeners].map(fn => fn(...args)); }
}
function fakeChrome() {
  const tabs = new Map(), attached = new Set(), calls = [], local = {}, session = {};
  const onDetach = new Event(), onRemoved = new Event();
  let sequence = 0, focusSupported = true;
  const storageArea = store => ({
    async get(keys) { return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k => k in store).map(k => [k, structuredClone(store[k])])); },
    async set(value) { Object.assign(store, structuredClone(value)); },
    async setAccessLevel(value) { calls.push(['access', value.accessLevel]); },
  });
  const api = {
    runtime:{
      id:'test-extension', getURL:name => 'chrome-extension://test-extension/'+name,
      onConnect:new Event(), onMessage:new Event(),
      async getContexts() { return [...tabs.values()].filter(t => t.url === api.runtime.getURL('index.html')).map(t => ({tabId:t.id})); },
    },
    action:{onClicked:new Event()},
    storage:{local:storageArea(local), session:storageArea(session)},
    tabs:{
      onRemoved,
      async create(options) { const tab = {...options,id:++sequence,windowId:1}; tabs.set(tab.id,tab); calls.push(['create',tab.id,options]); return tab; },
      async get(id) { if (!tabs.has(id)) throw new Error('Tab missing'); return tabs.get(id); },
      async update(id,options) { Object.assign(await this.get(id),options); calls.push(['update',id,options]); return tabs.get(id); },
      async remove(id) { tabs.delete(id); attached.delete(id); calls.push(['remove',id]); onRemoved.fire(id); },
    },
    windows:{async update(id,options) { calls.push(['window',id,options]); }},
    debugger:{
      onDetach,
      async attach(target, version) { attached.add(target.tabId); calls.push(['attach',target.tabId,version]); },
      async detach(target) { attached.delete(target.tabId); calls.push(['detach',target.tabId]); onDetach.fire(target,'canceled_by_user'); },
      async sendCommand(target, method, params) {
        calls.push(['command',target.tabId,method,params]);
        if (!attached.has(target.tabId)) throw new Error('Not attached');
        if (method === 'Emulation.setFocusEmulationEnabled' && !focusSupported) throw new Error('Unsupported command');
        if (method === 'Runtime.evaluate') {
          const tab = tabs.get(target.tabId);
          const value = await vm.runInNewContext(params.expression, {
            URL, AbortSignal, location:{origin:new URL(tab.url).origin},
            document:{readyState:'complete', querySelector:()=>null},
            fetch:async(route, options) => {
              calls.push(['fetch', route, options]);
              const response = api.responses.get(route);
              if (!response) throw new Error('No response fixture: '+route);
              return {ok:true,status:200,json:async()=>structuredClone(response)};
            },
          });
          return {result:{value}};
        }
        return {};
      },
    },
    responses:new Map(),
  };
  return {api,tabs,attached,calls,local,session,unsupportedFocus(){focusSupported=false;}};
}
async function until(fn) {
  for (let i=0;i<100;i++) { if (fn()) return; await new Promise(resolve=>setTimeout(resolve,5)); }
  throw new Error('Extension condition timed out');
}

test('extension uses independent Chrome debugger tabs and closes only owned tabs',async()=>{
  const f=fakeChrome(), transport=new ChromeTransport(f.api);
  const user=await f.api.tabs.create({url:'https://tsinghua.yuketang.cn/pro/',active:true});
  const first=await transport.create('https://tsinghua.yuketang.cn/ai-workspace/lms-graph/1/video/2',true);
  const second=await transport.create('https://pro.yuketang.cn/ai-workspace/lms-graph/1/video/3',true);
  assert.notEqual(first.sessionId,second.sessionId);
  assert.equal(f.tabs.get(first.sessionId).active,false);
  assert.equal(f.tabs.get(second.sessionId).autoDiscardable,false);
  assert.equal(f.calls.filter(c=>c[0]==='command'&&c[2]==='Emulation.setFocusEmulationEnabled').length,2);
  assert.equal(f.attached.has(user.id),false);
  await transport.close();
  assert.deepEqual([...f.tabs.keys()],[user.id]);
  assert.equal(f.api.debugger.onDetach.listeners.size,0);
  assert.deepEqual(f.session.ownedTabs,[]);
});
test('unsupported background focus cleans up its tab and reports a usable error',async()=>{
  const f=fakeChrome(),transport=new ChromeTransport(f.api);f.unsupportedFocus();
  await assert.rejects(transport.create('https://tsinghua.yuketang.cn/pro/',true),/前台播放/);
  assert.equal(f.tabs.size,0);assert.equal(f.attached.size,0);
  await transport.close();
});
test('debugger detach retains ownership until explicit cleanup and notifies once',async()=>{
  const f=fakeChrome();let notifications=0;
  const transport=new ChromeTransport(f.api,()=>{notifications++;});
  const page=await transport.create('https://tsinghua.yuketang.cn/pro/',false);
  f.api.debugger.onDetach.fire({tabId:page.sessionId},'canceled_by_user');
  f.api.debugger.onDetach.fire({tabId:page.sessionId},'canceled_by_user');
  assert.equal(notifications,1);assert.equal(transport.owned.size,1);
  await assert.rejects(transport.call('Runtime.enable',{},page.sessionId),/连接已断开/);
  await transport.close();assert.equal(f.tabs.size,0);assert.equal(notifications,1);
});
test('redirects to unrelated sites block debug actions and leave the user tab open',async()=>{
  const f=fakeChrome(),transport=new ChromeTransport(f.api);
  const page=await transport.create('https://tsinghua.yuketang.cn/pro/',false);
  const count=f.calls.filter(c=>c[0]==='command').length;
  f.tabs.get(page.sessionId).url='https://example.com/';
  await assert.rejects(transport.call('Runtime.evaluate',{expression:'document.title'},page.sessionId),/雨课堂/);
  assert.equal(f.calls.filter(c=>c[0]==='command').length,count);
  await transport.close();assert.equal(f.tabs.size,1);assert.equal(f.attached.size,0);
});
test('navigation validates the next destination and foreground mode activates the tab',async()=>{
  const f=fakeChrome(),transport=new ChromeTransport(f.api);
  const page=await transport.create('https://tsinghua.yuketang.cn/pro/',false);
  await assert.rejects(transport.call('Page.navigate',{url:'https://example.com'},page.sessionId),/雨课堂/);
  await transport.call('Page.bringToFront',{},page.sessionId);
  assert.ok(f.calls.some(c=>c[0]==='update'&&c[1]===page.sessionId&&c[2].active));
  assert.ok(f.calls.some(c=>c[0]==='window'&&c[2].focused));
  await transport.close();
});
test('service worker recovery closes matching owned tabs and ignores stale tab IDs',async()=>{
  const f=fakeChrome();
  const owned=await f.api.tabs.create({url:'https://tsinghua.yuketang.cn/pro/',active:false});
  const changed=await f.api.tabs.create({url:'https://example.com/',active:true});
  f.session.ownedTabs=[{tabId:owned.id,url:owned.url},{tabId:changed.id,url:owned.url},{tabId:999,url:owned.url}];
  assert.equal(await recoverOwnedTabs(f.api),1);
  assert.deepEqual([...f.tabs.keys()],[changed.id]);assert.deepEqual(f.session.ownedTabs,[]);
});
test('Manifest fails validation if extra domains or external messaging are enabled',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../../extension/manifest.json',import.meta.url),'utf8'));
  validateManifest(manifest);
  assert.throws(()=>validateManifest({...manifest,host_permissions:['<all_urls>']}),/域名/);
  assert.throws(()=>validateManifest({...manifest,externally_connectable:{matches:['https://example.com/*']}}),/外部入口/);
});

// Exercise the bundled MV3 entry point and the real serialized student API fetch.
const workerBundle=build({entryPoints:[fileURLToPath(new URL('../../extension/service-worker.mjs',import.meta.url))],write:false,bundle:true,format:'iife',platform:'browser',target:'chrome118',minify:false});
async function workerFixture() {
  const f=fakeChrome();
  const bundle=await workerBundle;
  vm.runInNewContext(bundle.outputFiles[0].text,{chrome:f.api,structuredClone,URL,AbortController,setTimeout,clearTimeout,console});
  const sender={id:f.api.runtime.id,url:f.api.runtime.getURL('index.html')};
  const action=(route,input={},givenSender=sender)=>new Promise((resolve,reject)=>{
    const accepted=f.api.runtime.onMessage.fire({kind:'study-desk-action',route,input},givenSender,response=>response.ok?resolve(response.value):reject(new Error(response.error)));
    if(!accepted.includes(true))resolve('ignored');
  });
  await action('/api/state');
  return {...f,action};
}
test('bundled worker rejects other senders, restores cache, and deduplicates the dashboard',async()=>{
  const f=await workerFixture();
  assert.equal(await f.action('/api/state',{}, {id:f.api.runtime.id,url:'https://tsinghua.yuketang.cn/pro/'}),'ignored');
  assert.equal(await f.action('/api/state',{}, {id:'other-extension',url:f.api.runtime.getURL('index.html')}),'ignored');
  const initial=await f.action('/api/state');assert.equal(initial.cacheOnly,true);assert.equal(initial.connection.connected,false);
  await assert.rejects(f.action('/api/queue/start',{ids:['1:2'],speed:1.5}),/同步最新/);
  f.api.action.onClicked.fire();await until(()=>f.tabs.size===1);
  f.api.action.onClicked.fire();await until(()=>f.calls.some(c=>c[0]==='window'));
  assert.equal(f.tabs.size,1);assert.equal(f.attached.size,0);
});
test('bundled worker connects, syncs course todos, and disconnects without a local server',async()=>{
  const f=await workerFixture();
  f.api.responses.set('/mooc-api/v1/lms/user/user-courses/?status=1&page=1&no_page=1&no_term=true&uv_id=2598', {data:{count:1,product_list:[{classroom_id:1,course_id:2,sku_id:3,course_sign:'sign',course_name:'测试课程',classroom_name:'测试班级',classroom_term:1}]}});
  f.api.responses.set('/c27/online_courseware/course/classroom/1/3/study_stat/?term=latest&uv_id=2598', {data:{study_progress:12,unit_progress:{total:2,completed:0},unfinished:{total:2}}});
  f.api.responses.set('/c27/online_courseware/course/classroom/1/3/todo_list/?client_type=web&term=latest&uv_id=2598', {data:{count:{total:2},result:[{leaf_id:4,name:'视频一',type:0},{leaf_id:5,name:'作业一',type:6}]}});
  await f.action('/api/browser/open');const loginId=[...f.tabs.keys()][0];
  assert.equal((await f.action('/api/connect')).connection.connected,true);
  const synced=await f.action('/api/sync');
  assert.equal(synced.courses[0].name,'测试课程');assert.equal(synced.courses[0].tasks.length,2);assert.equal(synced.cacheOnly,false);
  assert.equal(f.local.courses[0].tasks[1].type,6);
  const request=f.calls.find(c=>c[0]==='fetch');
  assert.equal(request[2].method,'GET');assert.equal(request[2].credentials,'same-origin');assert.equal(request[2].headers.xtbz,'cloud');
  assert.ok(!('cookie' in request[2].headers));
  const disconnected=await f.action('/api/service/stop');assert.equal(disconnected.connection.connected,false);
  assert.deepEqual([...f.tabs.keys()],[loginId]);assert.equal(f.attached.size,0);
});
