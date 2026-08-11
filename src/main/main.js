'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, session } = require('electron');
const { SettingsStore } = require('./settings-store');
const { DownloadManager } = require('./download-manager');
const { BrowserSessionManager } = require('./browser-session-manager');
const { BrowserManager } = require('./browser-manager');
const { registerIpc } = require('./ipc');
const { ensureRuntimeBinaries } = require('./paths');

let mainWindow = null;
let downloads = null;
let browserManager = null;
let browserSession = null;

app.setName('AstraFetch');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#080b12',
    autoHideMenuBar: true,
    title: 'AstraFetch',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !app.isPackaged || process.env.ASTRAFETCH_DEV === '1'
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.whenReady().then(() => {
  if (!gotLock) return;

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    callback({ cancel: details.webContentsId !== -1 });
  });

  ensureRuntimeBinaries();
  const settings = new SettingsStore();
  browserSession = new BrowserSessionManager();

  downloads = new DownloadManager({
    sendUpdate: job => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('download:update', job);
    },
    getConcurrency: () => settings.get().concurrentDownloads,
    browserSession
  });

  browserManager = new BrowserManager({
    browserSession,
    onUseUrl: url => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('browser:use-url', url);
    }
  });

  registerIpc({ settings, downloads, browserManager, browserSession });
  createWindow();

  app.on('activate', () => {
    if (!mainWindow) createWindow();
  });
});

app.on('before-quit', () => {
  downloads?.shutdown();
  browserManager?.close();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', error => {
  try {
    const logDir = app.getPath('userData');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'crash.log'), `${new Date().toISOString()} ${error.stack || error}\n`);
  } catch {}
});
