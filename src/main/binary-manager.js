'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const dns = require('node:dns').promises;
const { ipcMain, dialog, shell, clipboard, app } = require('electron');
const {
  validateHttpUrl,
  validateDirectory,
  validateAuthOptions,
  validateDownloadOptions,
  validateJobId
} = require('./validation');
const { getBinaryStatus, updateYtDlp } = require('./binary-manager');

function validateSender(event) {
  const frameUrl = event.senderFrame?.url || event.sender?.getURL?.() || '';
  if (!frameUrl.startsWith('file://')) throw new Error('Blocked IPC sender');
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    validateSender(event);
    try {
      return { ok: true, value: await fn(event, ...args) };
    } catch (error) {
      return {
        ok: false,
        error: {
          name: error?.name || 'Error',
          message: String(error?.message || error || 'Unknown error').slice(0, 4000)
        }
      };
    }
  });
}

function isPrivateIp(address) {
  const value = String(address || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIP(value) === 4) {
    const parts = value.split('.').map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] >= 224) return true;
    return false;
  }
  if (net.isIP(value) === 6) {
    return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/.test(value);
  }
  return false;
}

async function assertPublicHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || isPrivateIp(host)) throw new Error('Private thumbnail host is blocked');
  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isPrivateIp(item.address))) throw new Error('Private thumbnail address is blocked');
}

async function fetchThumbnailDataUrl(rawUrl) {
  if (!rawUrl) return '';
  let currentUrl = new URL(validateHttpUrl(rawUrl));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    let response;
    for (let redirects = 0; redirects <= 4; redirects += 1) {
      await assertPublicHost(currentUrl.hostname);
      response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'AstraFetch/1.0' }
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error('Thumbnail redirect is missing a location');
        currentUrl = new URL(validateHttpUrl(new URL(location, currentUrl).toString()));
        continue;
      }
      break;
    }
    if (!response || response.status >= 300 && response.status < 400) throw new Error('Too many thumbnail redirects');
    if (!response.ok) throw new Error(`Thumbnail HTTP ${response.status}`);
    const type = (response.headers.get('content-type') || '').split(';')[0].trim();
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(type)) throw new Error('Unsupported thumbnail type');
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > 8 * 1024 * 1024) throw new Error('Thumbnail is too large');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 8 * 1024 * 1024) throw new Error('Thumbnail is too large');
    return `data:${type};base64,${buffer.toString('base64')}`;
  } finally {
    clearTimeout(timeout);
  }
}

function registerIpc({ settings, downloads, browserManager, browserSession }) {
  handle('app:get-info', async () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node
  }));

  handle('settings:get', async () => settings.get());
  handle('settings:set', async (_event, patch) => settings.set(patch || {}));

  handle('dialog:select-output', async (_event, initialPath) => {
    const defaultPath = typeof initialPath === 'string' ? initialPath : app.getPath('downloads');
    const result = await dialog.showOpenDialog({
      title: 'Select download folder',
      defaultPath,
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? '' : validateDirectory(result.filePaths[0]);
  });

  handle('dialog:select-cookies', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Netscape cookies.txt',
      properties: ['openFile'],
      filters: [{ name: 'Cookies text file', extensions: ['txt'] }, { name: 'All files', extensions: ['*'] }]
    });
    return result.canceled ? '' : result.filePaths[0];
  });

  handle('video:analyze', async (_event, rawUrl, rawAuth) => {
    return downloads.analyze(validateHttpUrl(rawUrl), validateAuthOptions(rawAuth));
  });
  handle('thumbnail:fetch', async (_event, rawUrl) => fetchThumbnailDataUrl(rawUrl));
  handle('download:add', async (_event, rawOptions, metadata) => downloads.add(validateDownloadOptions(rawOptions), metadata));
  handle('download:list', async () => downloads.list());
  handle('download:cancel', async (_event, id) => downloads.cancel(validateJobId(id)));
  handle('download:retry', async (_event, id) => downloads.retry(validateJobId(id)));
  handle('history:list', async (_event, limit) => downloads.readHistory(Number(limit) || 100));

  handle('browser:open', async (_event, initialUrl) => {
    browserManager.open(typeof initialUrl === 'string' ? initialUrl : undefined);
    return true;
  });
  handle('browser:navigate', async (_event, value) => { browserManager.navigate(value); return true; });
  handle('browser:back', async () => { browserManager.back(); return true; });
  handle('browser:forward', async () => { browserManager.forward(); return true; });
  handle('browser:reload', async () => { browserManager.reload(); return true; });
  handle('browser:stop', async () => { browserManager.stop(); return true; });
  handle('browser:home', async () => { browserManager.home(); return true; });
  handle('browser:state-get', async () => browserManager.state());
  handle('browser:use-current', async () => browserManager.useCurrentUrl());
  handle('browser:open-external', async () => { browserManager.openExternal(); return true; });
  handle('browser:clear-data', async () => browserManager.clearData());
  handle('browser:cookie-status', async () => browserSession.status());

  handle('binary:status', async () => getBinaryStatus());
  handle('binary:update-ytdlp', async () => {
    if (downloads.hasActiveJobs()) throw new Error('Finish or cancel active downloads before updating yt-dlp.');
    return updateYtDlp();
  });

  handle('system:open-path', async (_event, targetPath) => {
    if (typeof targetPath !== 'string || targetPath.length > 2048) throw new Error('Invalid path');
    const normalized = path.resolve(targetPath);
    if (!fs.existsSync(normalized)) throw new Error('Path does not exist');
    if (fs.statSync(normalized).isFile()) {
      shell.showItemInFolder(normalized);
      return '';
    }
    return shell.openPath(normalized);
  });
  handle('system:read-clipboard', async () => clipboard.readText().slice(0, 4096));
  handle('system:copy-text', async (_event, text) => {
    clipboard.writeText(String(text || '').slice(0, 200000));
    return true;
  });
}

module.exports = { registerIpc };
