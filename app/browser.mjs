import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { BrowserCore, loginUrl } from './browser-core.mjs';
export { SCHOOL, SPEEDS, validatePageUrl, videoUrl } from './browser-core.mjs';
const LOOPBACK = new Set(['127.0.0.1', '[::1]', 'localhost']);
export function validateEndpoint(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !LOOPBACK.has(url.hostname) || !url.port || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('请输入本机浏览器地址，例如 http://[::1]:9222');
  }
  return url.origin;
}
class Cdp {
  constructor(socket) {
    this.socket = socket; this.pending = new Map(); this.sequence = 0;
    socket.addEventListener('message', ({ data }) => {
      let message;
      try { message = JSON.parse(String(data)); } catch { return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    socket.addEventListener('close', () => this.failAll('浏览器连接已断开'));
    socket.addEventListener('error', () => this.failAll('浏览器连接发生错误'));
  }
  get connected() { return this.socket.readyState === WebSocket.OPEN; }
  static async open(url) {
    const parsed = new URL(url);
    if (!['ws:', 'wss:'].includes(parsed.protocol) || !LOOPBACK.has(parsed.hostname) || parsed.username || parsed.password) throw new Error('浏览器返回了无效的调试地址');
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('连接浏览器超时')); }, 8000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('无法连接浏览器')); }, { once: true });
    });
    return new Cdp(socket);
  }
  failAll(message) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(message)); }
    this.pending.clear();
  }
  call(method, params = {}, sessionId) {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('浏览器连接已断开'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`浏览器操作超时：${method}`)); }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  close() { this.failAll('浏览器连接已关闭'); this.socket.close(); }
}

export class BrowserBridge extends BrowserCore {
  async connect(endpoint) {
    const safe = validateEndpoint(endpoint);
    const response = await fetch(`${safe}/json/version`, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!response.ok) throw new Error('无法读取浏览器连接信息');
    const info = await response.json();
    if (!/^Chrome\//.test(info.Browser || '') || /Electron|UGit/.test(info['User-Agent'] || '')) throw new Error('这个端口不是 Chrome 浏览器，请检查连接地址');
    const next = await Cdp.open(info.webSocketDebuggerUrl);
    await this.close(); this.cdp = next; this.endpoint = safe; this.studentIds.clear();
    this.dataPage = null; this.playerPage = null;
    const url = loginUrl(this.platform);
    this.dataPage = await this.newPage(url);
    await this.waitForPage(this.dataPage, new URL(url).origin);
    return info.Browser;
  }
}

export async function launchLoginBrowser(profileRoot, platform = 'school') {
  const url = loginUrl(platform);
  if (process.platform !== 'win32') throw new Error('自动打开浏览器目前支持 Windows；其他系统请连接已启动的 Chrome');
  const candidates = [path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'), path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')];
  let executable;
  for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
  if (!executable) throw new Error('未找到 Chrome，请手动启动并填写连接地址');
  await mkdir(profileRoot, { recursive: true });
  const child = spawn(executable, ['--remote-debugging-port=9333', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profileRoot}`, url], { detached: true, stdio: 'ignore', windowsHide: false });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  return 'http://127.0.0.1:9333';
}
