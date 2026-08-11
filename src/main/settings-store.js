'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const defaults = Object.freeze({
  outputDirectory: '',
  preset: 'mp4-1080',
  concurrentDownloads: 2,
  writeThumbnail: false,
  embedMetadata: true,
  downloadSubtitles: false,
  autoSubtitles: false,
  subtitleLanguages: 'uk,en',
  authMode: 'none',
  cookiesFile: ''
});

class SettingsStore {
  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'settings.json');
    this.data = { ...defaults };
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.data = { ...defaults, ...parsed };
    } catch {
      this.data = { ...defaults };
    }
    if (!this.data.outputDirectory) this.data.outputDirectory = path.join(app.getPath('downloads'), 'AstraFetch');
    if (!['none', 'browser', 'file'].includes(this.data.authMode)) this.data.authMode = 'none';
  }

  get() { return { ...this.data }; }

  set(patch) {
    const safe = {};
    if (typeof patch.outputDirectory === 'string') safe.outputDirectory = patch.outputDirectory.slice(0, 1024);
    if (typeof patch.preset === 'string') safe.preset = patch.preset.slice(0, 32);
    if (Number.isInteger(patch.concurrentDownloads)) safe.concurrentDownloads = Math.max(1, Math.min(3, patch.concurrentDownloads));
    for (const key of ['writeThumbnail', 'embedMetadata', 'downloadSubtitles', 'autoSubtitles']) {
      if (typeof patch[key] === 'boolean') safe[key] = patch[key];
    }
    if (typeof patch.subtitleLanguages === 'string') safe.subtitleLanguages = patch.subtitleLanguages.slice(0, 128);
    if (typeof patch.authMode === 'string' && ['none', 'browser', 'file'].includes(patch.authMode)) safe.authMode = patch.authMode;
    if (typeof patch.cookiesFile === 'string') safe.cookiesFile = patch.cookiesFile.slice(0, 1024);
    this.data = { ...this.data, ...safe };
    this.save();
    return this.get();
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(temp, this.filePath);
  }
}

module.exports = { SettingsStore };
