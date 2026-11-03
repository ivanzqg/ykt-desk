import { BrowserCore, loginUrl, validatePageUrl } from '../app/browser-core.mjs';

// Chrome 118+ keeps an MV3 service worker alive while a debugger session is active.
// All debug targets are tabs created by this extension; login tabs remain ordinary tabs.
export class ChromeTransport {
  constructor(api = globalThis.chrome, onLost = () => {}) {
    this.api = api;
    this.onLost = onLost;
    this.owned = new Map();
    this.attached = new Set();
    this.lostTabs = new Set();
    this.connected = true;
    this.saveChain = Promise.resolve();
    this.detachListener = ({tabId}, reason) => this.lost(tabId, reason);
    this.removeListener = tabId => this.lost(tabId, 'tab_closed');
    api.debugger.onDetach.addListener(this.detachListener);
    api.tabs.onRemoved.addListener(this.removeListener);
  }
  save() {
    const ownedTabs = [...this.owned.values()];
    this.saveChain = this.saveChain.catch(() => {}).then(() => this.api.storage.session.set({ownedTabs}));
    return this.saveChain;
  }
  lost(tabId, reason) {
    if (!this.owned.has(tabId) || this.lostTabs.has(tabId)) return;
    this.lostTabs.add(tabId);
    this.attached.delete(tabId);
    this.onLost(tabId, reason);
  }
  async create(url, background, muted = false) {
    validatePageUrl(url);
    const tab = await this.api.tabs.create({url, active:!background});
    this.owned.set(tab.id, {tabId:tab.id, url});
    try {
      await this.save();
      await this.api.tabs.update(tab.id, {autoDiscardable:false, muted});
      await this.api.debugger.attach({tabId:tab.id}, '1.3');
      this.attached.add(tab.id);
      await this.call('Runtime.enable', {}, tab.id);
      if (background) {
        try { await this.call('Emulation.setFocusEmulationEnabled', {enabled:true}, tab.id); }
        catch { throw new Error('当前 Chrome 不支持插件后台焦点仿真，请升级 Chrome 或选择前台播放'); }
      }
      return {targetId:String(tab.id), sessionId:tab.id};
    } catch (error) {
      await this.closeTab(tab.id);
      throw error;
    }
  }
  async call(method, params = {}, tabId) {
    if (!this.connected || !this.attached.has(tabId)) throw new Error('插件与雨课堂标签的连接已断开，请重新连接');
    const tab = await this.api.tabs.get(tabId);
    validatePageUrl(tab.pendingUrl || tab.url);
    if (method === 'Page.bringToFront') {
      await this.api.tabs.update(tabId, {active:true});
      await this.api.windows.update(tab.windowId, {focused:true});
      return {};
    }
    if (method === 'Page.navigate') {
      validatePageUrl(params.url);
      this.owned.set(tabId, {tabId, url:params.url});
      await this.save();
    }
    return this.api.debugger.sendCommand({tabId}, method, params);
  }
  async closeTab(tabId) {
    const owned = this.owned.has(tabId);
    const attached = this.attached.delete(tabId);
    this.owned.delete(tabId);
    this.lostTabs.delete(tabId);
    if (attached) await this.api.debugger.detach({tabId}).catch(() => {});
    if (owned) {
      // If the user navigated an owned tab to another site, leave that tab alone.
      try { const tab = await this.api.tabs.get(tabId); validatePageUrl(tab.pendingUrl || tab.url); await this.api.tabs.remove(tabId); } catch {}
    }
    await this.save();
  }
  async close() {
    for (const tabId of [...this.owned.keys()]) await this.closeTab(tabId);
    this.connected = false;
    this.api.debugger.onDetach.removeListener(this.detachListener);
    this.api.tabs.onRemoved.removeListener(this.removeListener);
    await this.saveChain;
  }
}

export class ExtensionBrowser extends BrowserCore {
  get connected() { return this.cdp?.connected === true && this.cdp.attached.has(this.dataPage?.sessionId); }
  async connect(onLost = () => {}) {
    await this.close();
    this.cdp = new ChromeTransport(globalThis.chrome, onLost);
    this.background = true;
    this.studentIds.clear();
    try {
      const url = loginUrl(this.platform);
      this.dataPage = await this.newPage(url);
      await this.waitForPage(this.dataPage, new URL(url).origin);
      return 'Chrome 插件';
    } catch (error) { await this.close(); throw error; }
  }
  async newPage(url) {
    const page = await this.cdp.create(url, this.background, this.muted);
    // The user may toggle mute while the debugger is attaching to the new tab.
    try { await this.cdp.api.tabs.update(page.sessionId, {muted:this.muted}); }
    catch (error) { await this.cdp.closeTab(page.sessionId); throw error; }
    return page;
  }
  async setMuted(muted) {
    if (typeof muted !== 'boolean') throw new Error('无效的静音选项');
    if (this.playerPage && this.connected) {
      const tab = await this.cdp.api.tabs.get(this.playerPage.sessionId);
      validatePageUrl(tab.pendingUrl || tab.url);
      await this.cdp.api.tabs.update(this.playerPage.sessionId, {muted});
    }
    await super.setMuted(muted);
  }
  async openTask(url) { return chrome.tabs.create({url:validatePageUrl(url), active:true}); }
  async close() {
    for (const lane of this.lanes) await lane.close().catch(() => {});
    this.lanes.clear();
    await this.pause().catch(() => {});
    if (this.playerPage) await this.cdp?.closeTab(this.playerPage.sessionId);
    if (this.ownsConnection) await this.cdp?.close();
    this.cdp = null;
    this.dataPage = null;
    this.playerPage = null;
  }
}

export async function recoverOwnedTabs(api = globalThis.chrome) {
  // session storage survives service-worker suspension, but not a browser restart.
  const {ownedTabs = []} = await api.storage.session.get('ownedTabs');
  let recovered = 0;
  for (const entry of ownedTabs) {
    if (!Number.isInteger(entry.tabId)) continue;
    try {
      validatePageUrl(entry.url);
      const tab = await api.tabs.get(entry.tabId);
      if (tab.url !== entry.url) continue;
      await api.debugger.detach({tabId:entry.tabId}).catch(() => {});
      await api.tabs.remove(entry.tabId);
      recovered++;
    } catch {}
  }
  await api.storage.session.set({ownedTabs:[]});
  return recovered;
}
