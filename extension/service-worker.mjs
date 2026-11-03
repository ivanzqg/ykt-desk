import { ExtensionBrowser, recoverOwnedTabs } from './browser.mjs';
import { SPEEDS, PLATFORMS, validatePlatform, loginUrl, taskUrl } from '../app/browser-core.mjs';
import { PlaybackPool, MAX_CONCURRENCY } from '../app/pool.mjs';
import { mapCourse, mergeCourse } from '../app/data.mjs';

const bridge = new ExtensionBrowser();
const clients = new Set();
let courses = [], syncing = false, syncMessage = '', lastSync = null, cacheOnly = true;
let restoredPlan = null, saveChain = Promise.resolve(), exiting = false, connecting = false;
let connection = {connected:false, endpoint:'', browser:'Chrome 插件', message:'在 Chrome 中手动登录清华雨课堂，然后点击连接', loginRequired:false};
function findTask(id) {
  for (const course of courses) { const task = course.tasks.find(t => t.id === id); if (task) return {course, task}; }
  return null;
}
function state() {
  return {connection:{...connection, connected:bridge.connected}, platform:bridge.platform, maxConcurrency:MAX_CONCURRENCY, courses, syncing, syncMessage, lastSync, cacheOnly, queue:queue.state, supportedSpeeds:SPEEDS, restoredPlan};
}
function broadcast() {
  const value = state();
  for (const port of clients) { try { port.postMessage(value); } catch { clients.delete(port); } }
}
function save(values) {
  const snapshot = structuredClone(values);
  saveChain = saveChain.catch(() => {}).then(() => chrome.storage.local.set(snapshot));
  saveChain.catch(() => {});
  return saveChain;
}
const queue = new PlaybackPool(bridge, findTask, broadcast, id => refreshCourse(id), {
  planChanged:plan => { restoredPlan = plan; save({restoredPlan}).catch(() => {}); }
});
const ready = (async () => {
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  await chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  const recovered = await recoverOwnedTabs();
  const stored = await chrome.storage.local.get(['courses', 'lastSync', 'restoredPlan', 'platform']);
  courses = stored.courses || [];
  lastSync = stored.lastSync || null;
  restoredPlan = stored.restoredPlan || null;
  if (Object.hasOwn(PLATFORMS, stored.platform)) bridge.platform = stored.platform;
  if (recovered) connection.message = '已关闭上次中断的播放标签。请重新连接、同步后开始';
})();
// Register listeners synchronously so MV3 events can wake the service worker.
chrome.action.onClicked.addListener(() => { openDashboard().catch(console.error); });
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'study-desk-state' || !trusted(port.sender)) { port.disconnect(); return; }
  clients.add(port);
  port.onDisconnect.addListener(() => clients.delete(port));
  ready.then(() => port.postMessage(state())).catch(error => port.postMessage({error:error.message}));
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!trusted(sender) || message?.kind !== 'study-desk-action') return false;
  ready.then(() => dispatch(message.route, message.input || {}))
    .then(value => respond({ok:true, value}), error => respond({ok:false, error:error.message}));
  return true;
});
function trusted(sender) {
  return sender?.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('index.html');
}
async function openDashboard() {
  const url = chrome.runtime.getURL('index.html');
  const contexts = await chrome.runtime.getContexts({contextTypes:['TAB'], documentUrls:[url]});
  if (contexts[0]) {
    const tab = await chrome.tabs.update(contexts[0].tabId, {active:true});
    await chrome.windows.update(tab.windowId, {focused:true});
  } else await chrome.tabs.create({url, active:true});
}
async function lostConnection(tabId, reason) {
  if (exiting) return;
  exiting = true;
  connection.message = reason === 'tab_closed' ? '受控标签已关闭，请重新连接' : 'Chrome 已取消调试连接，请重新连接';
  broadcast();
  try { await queue.stop(); await bridge.close(); }
  finally { exiting = false; broadcast(); }
}
async function refreshCourse(id, detailed = false) {
  const course = courses.find(c => c.id === Number(id));
  if (!course) throw new Error('未找到课程');
  const fresh = mergeCourse(course, await bridge.courseData(course, detailed));
  for (const task of fresh.tasks) {
    const old = course.tasks.find(t => t.id === task.id);
    if (!task.section && old?.section) { task.section = old.section; task.chapterId = old.chapterId; }
  }
  if (!detailed) for (const task of course.tasks.filter(t => t.status === 'completed')) if (!fresh.tasks.some(t => t.id === task.id)) fresh.tasks.push(task);
  courses = courses.map(c => c.id === fresh.id ? fresh : c);
  lastSync = new Date().toISOString();
  cacheOnly = false;
  await save({courses, lastSync});
  broadcast();
  return fresh;
}
async function syncAll() {
  if (syncing || exiting || connecting) throw new Error('正在同步或连接，请稍候');
  syncing = true; syncMessage = '正在读取课程列表'; broadcast();
  try {
    const rows = await bridge.courses();
    const old = new Map(courses.map(c => [c.id,c]));
    courses = rows.map(row => ({...mapCourse(row), tasks:old.get(Number(row.classroom_id))?.tasks || []}));
    let done = 0, cursor = 0, failed = 0;
    async function worker() {
      while (cursor < courses.length) {
        const course = courses[cursor++];
        try { await refreshCourse(course.id); }
        catch (error) { failed++; course.error = error.message; }
        done++; syncMessage = `已同步 ${done} / ${courses.length} 门课程`; broadcast();
      }
    }
    await Promise.all([worker(), worker()]);
    lastSync = new Date().toISOString(); cacheOnly = false;
    connection.loginRequired = false; connection.message = '已连接清华雨课堂';
    syncMessage = failed ? `${failed} 门课程未同步成功，可单独重试` : '课程与待办已更新';
    await save({courses, lastSync});
  } catch (error) { connection.loginRequired = true; connection.message = error.message; throw error; }
  finally { syncing = false; broadcast(); }
}
async function dispatch(route, input) {
  if (route === '/api/state') return state();
  if (route === '/api/platform') {
    const platform = validatePlatform(input.platform);
    if (queue.runner || queue.starting || syncing || exiting || connecting) throw new Error('请先停止播放并等待同步结束，再切换页面版本');
    bridge.platform = platform;
    await save({platform});
    broadcast();
    return state();
  }
  if (route === '/api/browser/open') {
    await chrome.tabs.create({url:loginUrl(input.platform ?? bridge.platform), active:true});
    return {endpoint:''};
  }
  if (route === '/api/connect') {
    if (queue.runner || queue.starting || syncing || exiting || connecting) throw new Error('请先停止播放并等待同步结束');
    connecting = true;
    cacheOnly = true;
    try {
      await bridge.connect((tabId, reason) => { lostConnection(tabId, reason).catch(console.error); });
      connection = {...connection, connected:true, loginRequired:false, message:'已连接，请同步课程'};
    } catch (error) { connection.message = error.message; throw error; }
    finally { connecting = false; broadcast(); }
    return state();
  }
  if (route === '/api/sync') { await syncAll(); return state(); }
  if (route === '/api/course/refresh') return refreshCourse(input.id, true);
  if (route === '/api/task/open') {
    const found = findTask(input.id); if (!found) throw new Error('未找到任务');
    await bridge.openTask(taskUrl(found.course, found.task, bridge.platform));
    return {ok:true};
  }
  if (route === '/api/queue/start') {
    if (!bridge.connected || cacheOnly || exiting) throw new Error('请连接并同步最新课程后开始');
    if (syncing) throw new Error('请等待课程同步完成');
    await queue.start(input.ids, Number(input.speed), {mode:input.mode || 'background', concurrency:Number(input.concurrency ?? 2), muted:input.muted ?? false});
    return state();
  }
  if (route === '/api/queue/pause') await queue.pause();
  else if (route === '/api/queue/resume') queue.resume(input.id);
  else if (route === '/api/queue/stop') await queue.stop();
  else if (route === '/api/queue/skip') await queue.skip(input.id);
  else if (route === '/api/queue/speed') await queue.setSpeed(Number(input.speed));
  else if (route === '/api/queue/mute') await queue.setMuted(input.muted);
  else if (route === '/api/player/focus') await queue.focusPlayer(input.id);
  else if (route === '/api/service/stop') {
    if (syncing || queue.starting || exiting || connecting) throw new Error('请等待当前同步或启动操作结束，再断开连接');
    exiting = true;
    try { await queue.stop(); await bridge.close(); await saveChain; connection.message = '已断开连接，工具创建的视频标签已关闭'; }
    finally { exiting = false; broadcast(); }
  } else throw new Error('不支持的插件操作');
  return state();
}
