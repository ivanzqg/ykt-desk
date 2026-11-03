import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { BrowserBridge, launchLoginBrowser, SCHOOL, SPEEDS } from './browser.mjs';
import { PlaybackPool } from './pool.mjs';
import { mapCourse, mapTask, mergeCourse } from './data.mjs';
import { packaged, projectRoot, dataDirectory, readPublicAsset } from './runtime.mjs';
import { openDashboard } from './open-browser.mjs';

async function startServer() {
const root = projectRoot;
const local = dataDirectory;
const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1–65535 的整数');
const token = randomBytes(24).toString('hex');
const bridge = new BrowserBridge();
let courses = [], syncing = false, syncMessage = '', lastSync = null, cacheOnly = true;
let connection = { connected:false, endpoint:bridge.endpoint, browser:null, message:'请连接雨课堂浏览器', loginRequired:false };
let restoredPlan = null;
const clients = new Set();
await mkdir(local,{recursive:true});
try { restoredPlan=JSON.parse(await readFile(path.join(local,'playback-plan.json'),'utf8')); } catch {}
try {
  const cache = JSON.parse(await readFile(path.join(local,'dashboard.json'),'utf8'));
  courses = cache.courses || []; lastSync = cache.lastSync;
} catch {
  try {
    if (packaged) throw new Error('独立程序不加载开发期个人报告');
    const previous = JSON.parse(await readFile(path.join(root,'yuketang-analysis-2026-11-02.json'),'utf8'));
    courses = previous.courses.map(c => ({ id:c.classroom_id, courseId:c.course_id, skuId:c.sku_id, sign:c.course_sign, name:c.name, classroomName:c.classroom_name, term:c.term, auditor:c.auditor, progress:c.stats.study_progress, units:c.stats.unit_progress, counts:c.stats.unfinished, tasks:c.todos.map(t => mapTask(t,c.classroom_id)), error:null, lastSync:previous.observed_date }));
    lastSync = previous.observed_date;
  } catch {}
}
const findTask = id => {
  for (const course of courses) { const task = course.tasks.find(t => t.id === id); if (task) return { course,task }; }
  return null;
};
let saveChain = Promise.resolve();
function save() {
  const snapshot = JSON.stringify({ courses, lastSync },null,2);
  saveChain = saveChain.catch(() => {}).then(() => writeFile(path.join(local,'dashboard.json'),snapshot)).catch(error => console.error('Cannot save course cache:',error.message));
}
function state() {
  return { connection:{...connection, connected:bridge.connected}, courses, syncing, syncMessage, lastSync, cacheOnly, queue:queue.state, supportedSpeeds:SPEEDS, restoredPlan };
}
function broadcast() {
  const event = `data: ${JSON.stringify(state())}\n\n`;
  for (const response of clients) response.write(event);
}
async function refreshCourse(id, detailed = false) {
  const course = courses.find(c => c.id === Number(id));
  if (!course) throw new Error('未找到课程');
  const data = await bridge.courseData(course,detailed);
  const fresh = mergeCourse(course,data);
  // Preserve chapter labels learned from the full course outline on later todo refreshes.
  for (const task of fresh.tasks) {
    const old = course.tasks.find(t => t.id === task.id);
    if (!task.section && old?.section) { task.section = old.section; task.chapterId = old.chapterId; }
  }
  if (!detailed) for (const task of course.tasks.filter(t => t.status === 'completed')) if (!fresh.tasks.some(t=>t.id===task.id)) fresh.tasks.push(task);
  courses = courses.map(c => c.id === fresh.id ? fresh : c);
  lastSync = new Date().toISOString(); cacheOnly = false; save(); broadcast();
  return fresh;
}
const queue = new PlaybackPool(bridge,findTask,broadcast,id => refreshCourse(id),{planChanged:plan=>{
  restoredPlan=plan;
  saveChain=saveChain.catch(()=>{}).then(()=>writeFile(path.join(local,'playback-plan.json'),JSON.stringify(plan,null,2))).catch(error=>console.error('Cannot save playback plan:',error.message));
}});
async function syncAll() {
  if (syncing) throw new Error('正在同步，请稍候');
  syncing = true; syncMessage = '正在读取课程列表'; broadcast();
  try {
    const rows = await bridge.courses();
    const old = new Map(courses.map(c => [c.id,c]));
    courses = rows.map(row => ({...mapCourse(row), ...(old.get(Number(row.classroom_id)) || {}), ...mapCourse(row), tasks:old.get(Number(row.classroom_id))?.tasks || [] }));
    let done = 0, cursor = 0, failed = 0;
    async function worker() {
      while (cursor < courses.length) {
        const course = courses[cursor++];
        try { await refreshCourse(course.id); }
        catch (error) { failed++; course.error = error.message; }
        done++; syncMessage = `已同步 ${done} / ${courses.length} 门课程`; broadcast();
      }
    }
    await Promise.all([worker(),worker()]);
    lastSync = new Date().toISOString(); cacheOnly = false;
    connection.loginRequired = false; connection.message = '已连接雨课堂';
    syncMessage = failed ? `${failed} 门课程未同步成功，可单独重试` : '课程与待办已更新'; save();
  } catch (error) { connection.loginRequired = true; connection.message = error.message; throw error; }
  finally { syncing = false; broadcast(); }
}
async function body(request) {
  let bytes = 0, text = '';
  for await (const chunk of request) { bytes += chunk.length; if (bytes > 32768) throw new Error('请求内容过大'); text += chunk; }
  return text ? JSON.parse(text) : {};
}
function json(response,status,value) { response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); response.end(JSON.stringify(value)); }
const server = http.createServer(async (request,response) => {
  response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('Referrer-Policy','no-referrer');
  const host = request.headers.host;
  const allowedHosts = [`127.0.0.1:${port}`,`localhost:${port}`];
  if (!allowedHosts.includes(host)) return json(response,403,{error:'仅允许本机访问'});
  try {
    const url = new URL(request.url,`http://${host}`);
    if (request.method !== 'GET') {
      const given = String(request.headers['x-local-token'] || '');
      const allowedOrigins = allowedHosts.map(h => `http://${h}`);
      if (!allowedOrigins.includes(request.headers.origin) || given.length !== token.length || !timingSafeEqual(Buffer.from(given),Buffer.from(token))) return json(response,403,{error:'请从本地工具网页发起操作'});
    }
    if (request.method === 'GET' && url.pathname === '/api/health') return json(response,200,{ok:true,packaged});
    if (request.method === 'GET' && url.pathname === '/api/state') return json(response,200,state());
    if (request.method === 'GET' && url.pathname === '/api/events') {
      response.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache','Connection':'keep-alive'});
      clients.add(response); response.write(`data: ${JSON.stringify(state())}\n\n`);
      request.on('close',() => clients.delete(response)); return;
    }
    if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
      const input = await body(request);
      if (url.pathname === '/api/service/stop') {
        json(response,200,{ok:true}); setImmediate(shutdown); return;
      }
      if (url.pathname === '/api/connect') {
        if (queue.runner || queue.starting || syncing) throw new Error('请先停止播放并等待同步结束');
        const browser = await bridge.connect(input.endpoint || bridge.endpoint);
        connection = { connected:true, endpoint:bridge.endpoint, browser, loginRequired:false, message:'浏览器已连接，请同步课程' };
        broadcast(); return json(response,200,state());
      }
      if (url.pathname === '/api/browser/open') {
        if (queue.runner || queue.starting || syncing) throw new Error('请先停止当前任务');
        const endpoint = await launchLoginBrowser(path.join(local,'chrome-profile'));
        connection = {...connection,endpoint,message:'已打开 Chrome，请在雨课堂页手动登录后连接',loginRequired:true};
        broadcast(); return json(response,200,{endpoint});
      }
      if (url.pathname === '/api/sync') { await syncAll(); return json(response,200,state()); }
      if (url.pathname === '/api/course/refresh') { const course = await refreshCourse(input.id,true); return json(response,200,course); }
      if (url.pathname === '/api/task/open') {
        const found = findTask(input.id); if (!found) throw new Error('未找到任务');
        const url = found.task.url || `${SCHOOL}/pro/lms/${encodeURIComponent(found.course.sign)}/${found.course.id}/studycontent`;
        await bridge.openTask(url); return json(response,200,{ok:true});
      }
      if (url.pathname === '/api/queue/start') {
        if (!bridge.connected || cacheOnly) throw new Error('请连接浏览器并同步最新课程后开始');
        if (syncing) throw new Error('请等待课程同步完成');
        if (!Array.isArray(input.ids) || !input.ids.every(id=>typeof id==='string')) throw new Error('无效的任务列表');
        await queue.start(input.ids,Number(input.speed),{mode:input.mode || 'background',concurrency:Number(input.concurrency || 2)}); return json(response,200,state());
      }
      if (url.pathname === '/api/queue/pause') { await queue.pause(); return json(response,200,state()); }
      if (url.pathname === '/api/queue/resume') { queue.resume(input.id); return json(response,200,state()); }
      if (url.pathname === '/api/queue/stop') { await queue.stop(); return json(response,200,state()); }
      if (url.pathname === '/api/queue/skip') { await queue.skip(input.id); return json(response,200,state()); }
      if (url.pathname === '/api/queue/speed') { await queue.setSpeed(Number(input.speed)); return json(response,200,state()); }
      if (url.pathname === '/api/player/focus') { await queue.focusPlayer(input.id); return json(response,200,{ok:true}); }
      return json(response,404,{error:'接口不存在'});
    }
    if (request.method !== 'GET') return json(response,405,{error:'请求方式不支持'});
    const files = { '/':'index.html', '/app.js':'app.js', '/style.css':'style.css' };
    const filename = files[url.pathname]; if (!filename) return json(response,404,{error:'页面不存在'});
    let content = await readPublicAsset(filename);
    if (filename === 'index.html') content = Buffer.from(content.toString().replace('__LOCAL_TOKEN__',token));
    response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    response.writeHead(200,{'Content-Type':filename.endsWith('.html')?'text/html; charset=utf-8':filename.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
    response.end(content);
  } catch (error) { json(response,400,{error:error.message}); }
});
const heartbeat = setInterval(() => { for (const client of clients) client.write(': keepalive\n\n'); },20000);
server.listen(port,'127.0.0.1',() => {
  const dashboardUrl = `http://127.0.0.1:${port}`;
  console.log(`雨课堂学习台：${dashboardUrl}`);
  console.log(`数据目录：${local}`);
  if ((packaged || process.argv.includes('--open')) && !process.argv.includes('--no-open')) {
    openDashboard(dashboardUrl).catch(() => console.log('未能自动打开浏览器，请手动打开上述地址。'));
  }
});
server.on('error',error => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已占用，请设置 PORT 后重试` : error.message); clearInterval(heartbeat); process.exitCode=1; });
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return; shuttingDown = true;
  clearInterval(heartbeat); await queue.stop(); await bridge.close(); await saveChain;
  for (const client of clients) client.end();
  server.close(() => process.exit(0));
}
process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);
}

startServer().catch(error => { console.error(error.message); process.exitCode = 1; });
