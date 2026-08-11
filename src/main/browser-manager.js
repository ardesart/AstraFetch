'use strict';

const path = require('node:path');
const { app, BrowserWindow, WebContentsView, shell } = require('electron');

const TOOLBAR_HEIGHT = 74;
const HOME_URL = 'https://www.google.com/';

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeNavigation(value) {
  const input = String(value || '').trim();
  if (!input) return HOME_URL;
  if (isHttpUrl(input)) return input;

  if (!/\s/.test(input) && (input.includes('.') || input === 'localhost')) {
    const candidate = `https://${input}`;
    if (isHttpUrl(candidate)) return candidate;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

function historyCan(webContents, direction) {
  const history = webContents?.navigationHistory;
  if (history) {
    const fn = direction === 'back' ? history.canGoBack : history.canGoForward;
    if (typeof fn === 'function') return fn.call(history);
  }
  const fallback = direction === 'back' ? webContents?.canGoBack : webContents?.canGoForward;
  return typeof fallback === 'function' ? fallback.call(webContents) : false;
}

function historyGo(webContents, direction) {
  const history = webContents?.navigationHistory;
  if (history) {
    const fn = direction === 'back' ? history.goBack : history.goForward;
    if (typeof fn === 'function') return fn.call(history);
  }
  const fallback = direction === 'back' ? webContents?.goBack : webContents?.goForward;
  if (typeof fallback === 'function') return fallback.call(webContents);
  return undefined;
}

class BrowserManager {
  constructor({ browserSession, onUseUrl }) {
    if (!browserSession?.session) throw new Error('BrowserManager requires a browser session');
    this.browserSession = browserSession;
    this.onUseUrl = typeof onUseUrl === 'function' ? onUseUrl : () => {};
    this.window = null;
    this.view = null;
    this.title = 'AstraFetch Browser';
  }

  createWindow(initialUrl) {
    if (this.window && !this.window.isDestroyed()) return;

    const win = new BrowserWindow({
      width: 1320,
      height: 860,
      minWidth: 900,
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
        devTools: !app.isPackaged || process.env.ASTRAFETCH_DEV === '1'
      }
    });

    const view = new WebContentsView({
      webPreferences: {
        session: this.browserSession.session,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: true,
        devTools: !app.isPackaged || process.env.ASTRAFETCH_DEV === '1'
      }
    });

    this.window = win;
    this.view = view;
    win.contentView.addChildView(view);

    const layout = () => {
      if (!this.window || this.window.isDestroyed() || !this.view) return;
      const bounds = this.window.getContentBounds();
      this.view.setBounds({
        x: 0,
        y: TOOLBAR_HEIGHT,
        width: Math.max(1, bounds.width),
        height: Math.max(1, bounds.height - TOOLBAR_HEIGHT)
      });
    };

    const remote = view.webContents;
    const sendState = () => this.sendState();

    remote.setWindowOpenHandler(details => {
      if (!isHttpUrl(details.url)) return { action: 'deny' };
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          backgroundColor: '#080b12',
          webPreferences: {
            session: this.browserSession.session,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            devTools: !app.isPackaged || process.env.ASTRAFETCH_DEV === '1'
          }
        }
      };
    });

    remote.on('will-navigate', (event, url) => {
      if (isHttpUrl(url)) return;
      event.preventDefault();
      if (/^(mailto:|tel:)/i.test(url)) shell.openExternal(url).catch(() => {});
    });
    remote.on('did-start-loading', sendState);
    remote.on('did-stop-loading', sendState);
    remote.on('did-navigate', sendState);
    remote.on('did-navigate-in-page', sendState);
    remote.on('page-title-updated', (_event, title) => {
      this.title = String(title || '').slice(0, 300) || 'AstraFetch Browser';
      sendState();
    });
    remote.on('did-fail-load', (_event, errorCode, _errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) sendState();
    });

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.on('resize', layout);
    win.on('maximize', layout);
    win.on('unmaximize', layout);
    win.on('enter-full-screen', layout);
    win.on('leave-full-screen', layout);
    win.on('closed', () => {
      this.window = null;
      this.view = null;
    });

    win.once('ready-to-show', () => {
      layout();
      win.show();
    });

    win.loadFile(path.join(__dirname, '..', 'browser', 'index.html'));
    layout();
    remote.loadURL(normalizeNavigation(initialUrl)).catch(() => {});
  }

  open(initialUrl) {
    if (!this.window || this.window.isDestroyed()) {
      this.createWindow(initialUrl);
      return;
    }

    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
    if (typeof initialUrl === 'string' && initialUrl.trim()) this.navigate(initialUrl);
  }

  navigate(value) {
    if (!this.view || this.view.webContents.isDestroyed()) {
      this.open(value);
      return;
    }
    this.view.webContents.loadURL(normalizeNavigation(value)).catch(() => {});
  }

  back() {
    const wc = this.view?.webContents;
    if (wc && !wc.isDestroyed() && historyCan(wc, 'back')) historyGo(wc, 'back');
  }

  forward() {
    const wc = this.view?.webContents;
    if (wc && !wc.isDestroyed() && historyCan(wc, 'forward')) historyGo(wc, 'forward');
  }

  reload() {
    const wc = this.view?.webContents;
    if (wc && !wc.isDestroyed()) wc.reload();
  }

  stop() {
    const wc = this.view?.webContents;
    if (wc && !wc.isDestroyed()) wc.stop();
  }

  home() {
    this.navigate(HOME_URL);
  }

  state() {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) {
      return { url: '', title: 'AstraFetch Browser', loading: false, canGoBack: false, canGoForward: false };
    }
    return {
      url: wc.getURL() || '',
      title: this.title || wc.getTitle() || 'AstraFetch Browser',
      loading: wc.isLoading(),
      canGoBack: historyCan(wc, 'back'),
      canGoForward: historyCan(wc, 'forward')
    };
  }

  sendState() {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send('browser:state', this.state());
  }

  useCurrentUrl() {
    const url = this.state().url;
    if (isHttpUrl(url)) this.onUseUrl(url);
    return isHttpUrl(url) ? url : '';
  }

  openExternal() {
    const url = this.state().url;
    if (isHttpUrl(url)) return shell.openExternal(url);
    return Promise.resolve();
  }

  async clearData() {
    const status = await this.browserSession.clearAll();
    this.home();
    return status;
  }

  close() {
    if (this.window && !this.window.isDestroyed()) this.window.close();
    this.window = null;
    this.view = null;
  }
}

module.exports = { BrowserManager, normalizeNavigation, isHttpUrl, HOME_URL };
