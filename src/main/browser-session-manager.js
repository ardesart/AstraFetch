'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, session } = require('electron');

const PARTITION = 'persist:astrafetch-browser';

const { serializeNetscapeCookies } = require('./cookie-utils');

class BrowserSessionManager {
  constructor() {
    this.partition = PARTITION;
    this.session = session.fromPartition(PARTITION, { cache: true });
    this.tempRoot = path.join(app.getPath('temp'), 'AstraFetch', 'cookies');
    this.configureSecurity();
    this.cleanupStaleCookieFiles();
  }

  configureSecurity() {
    this.session.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === 'clipboard-sanitized-write' || permission === 'fullscreen');
    });
    this.session.setPermissionCheckHandler((_webContents, permission) => {
      return permission === 'clipboard-sanitized-write' || permission === 'fullscreen';
    });
    this.session.setDevicePermissionHandler(() => false);
    this.session.on('will-download', event => event.preventDefault());
  }

  async status() {
    const cookies = await this.session.cookies.get({});
    const domains = [...new Set(cookies.map(cookie => cookie.domain).filter(Boolean))].sort();
    return {
      partition: this.partition,
      cookieCount: cookies.length,
      domainCount: domains.length,
      domains: domains.slice(0, 40),
      hasSession: cookies.length > 0
    };
  }

  async clearAll() {
    await this.session.clearData({
      dataTypes: ['cache', 'cookies', 'downloads', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL']
    });
    await this.session.flushStorageData();
    return this.status();
  }

  async createCookiesFile() {
    await this.session.flushStorageData();
    await this.session.cookies.flushStore();
    const cookies = await this.session.cookies.get({});
    if (!cookies.length) {
      throw new Error('The built-in browser has no cookies. Sign in to the website first or use No cookies mode.');
    }

    fs.mkdirSync(this.tempRoot, { recursive: true });
    const filePath = path.join(this.tempRoot, `${crypto.randomUUID()}.txt`);
    const body = serializeNetscapeCookies(cookies);
    fs.writeFileSync(filePath, body, { encoding: 'utf8', mode: 0o600 });
    return filePath;
  }

  cleanupCookieFile(filePath) {
    if (!filePath) return;
    try {
      const resolved = path.resolve(filePath);
      const root = path.resolve(this.tempRoot) + path.sep;
      if (resolved.startsWith(root) && fs.existsSync(resolved)) fs.unlinkSync(resolved);
    } catch {}
  }

  cleanupStaleCookieFiles() {
    try {
      if (!fs.existsSync(this.tempRoot)) return;
      for (const name of fs.readdirSync(this.tempRoot)) {
        const filePath = path.join(this.tempRoot, name);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile() && Date.now() - stat.mtimeMs > 60 * 60 * 1000) fs.unlinkSync(filePath);
        } catch {}
      }
    } catch {}
  }
}

module.exports = { BrowserSessionManager, PARTITION };
