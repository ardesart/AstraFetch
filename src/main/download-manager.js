'use strict';

const path = require('node:path');
const { BrowserWindow, WebContentsView, shell } = require('electron');
const { validateHttpUrl } = require('./validation');

const TOOLBAR_HEIGHT = 74;
const HOME_URL = 'https://www.google.com/';

function normalizeAddress(value) {
  const raw = String(value || '').trim();
  if (!raw) return HOME_URL;
  try { return validateHttpUrl(raw); } catch {}
  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(raw)) return validateHttpUrl(`https://${raw}`);
  return `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
}

class BrowserManager {
  constructor({ browserSession, onUseUrl }) {
    this.browserSession = browserSession;
    this.onUseUrl = onUseUrl;
    this.window = null;
    this.view = null;
  }

  open(initialUrl = HOME_URL) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      if (initialUrl) this.navigate(initialUrl);
      return;
    }

    this.window = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 920,
      minHeight: 620,
      show: false,
      backgroundColor: '#080b12',
      autoHideMenuBar: true,
      title: 'AstraFetch Browser',
      icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'browser-preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
        devTools: false
      }
    });

    this.view = new WebContentsView({
      webPreferences: {
        session: this.browserSession.session,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: true,
        devTools: false
      }
    });
    this.window.contentView.addChildView(this.view);
    this.resizeView();
    this.window.on('resize', () => this.resizeView());
    this.window.on('maximize', () => this.resizeView());
    this.window.on('unmaximize', () => this.resizeView());

    const wc = this.view.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      try {
        this.navigate(url);
      } catch {}
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event, url) => {
      try { validateHttpUrl(url); } catch { event.preventDefault(); }
    });
    wc.on('will-redirect', (event, url) => {
      try { validateHttpUrl(url); } catch { event.preventDefault(); }
    });
    wc.on('did-start-loading', () => this.sendState());
    wc.on('did-stop-loading', () => this.sendState());
    wc.on('did-navigate', () => this.sendState());
    wc.on('did-navigate-in-page', () => this.sendState());
    wc.on('page-title-updated', () => this.sendState());
    wc.on('render-process-gone', () => this.sendState({ crashed: true }));

    this.window.loadFile(path.join(__dirname, '..', 'browser', 'index.html'));
    this.window.once('ready-to-show', () => this.window?.show());
    this.window.on('closed', () => {
      try { this.view?.webContents?.close(); } catch {}
      this.view = null;
      this.window = null;
    });

    this.navigate(initialUrl || HOME_URL);
  }

  resizeView() {
    if (!this.window || !this.view) return;
    const [width, height] = this.window.getContentSize();
    this.view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) });
  }

  navigate(value) {
    if (!this.view) return;
    const url = normalizeAddress(value);
    this.view.webContents.loadURL(url).catch(error => {
      this.sendState({ error: error.message });
    });
  }

  back() { if (this.view?.webContents.canGoBack()) this.view.webContents.goBack(); }
  forward() { if (this.view?.webContents.canGoForward()) this.view.webContents.goForward(); }
  reload() { this.view?.webContents.reload(); }
  stop() { this.view?.webContents.stop(); }
  home() { this.navigate(HOME_URL); }

  currentUrl() {
    return this.view?.webContents.getURL() || '';
  }

  useCurrentUrl() {
    const url = this.currentUrl();
    if (url && this.onUseUrl) this.onUseUrl(url);
    return url;
  }

  openExternal() {
    const url = this.currentUrl();
    if (url) shell.openExternal(url);
  }

  async clearData() {
    const result = await this.browserSession.clearAll();
    this.home();
    this.sendState();
    return result;
  }

  state(extra = {}) {
    const wc = this.view?.webContents;
    return {
      url: wc?.getURL() || '',
      title: wc?.getTitle() || 'AstraFetch Browser',
      loading: Boolean(wc?.isLoading()),
      canGoBack: Boolean(wc?.canGoBack()),
      canGoForward: Boolean(wc?.canGoForward()),
      ...extra
    };
  }

  sendState(extra = {}) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('browser:state', this.state(extra));
    }
  }

  close() {
    if (this.window && !this.window.isDestroyed()) this.window.close();
  }
}

module.exports = { BrowserManager, HOME_URL, normalizeAddress };
