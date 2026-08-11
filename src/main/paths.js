'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

function appRoot() {
  return app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..', '..');
}

function bundledBin() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'vendor', 'bin')
    : path.join(appRoot(), 'vendor', 'bin');
}

function vendorBin() {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'bin')
    : bundledBin();
}

function binaryName(base) {
  return process.platform === 'win32' ? `${base}.exe` : base;
}

function ytDlpPath() { return path.join(vendorBin(), binaryName('yt-dlp')); }
function ffmpegPath() { return path.join(vendorBin(), binaryName('ffmpeg')); }
function ffprobePath() { return path.join(vendorBin(), binaryName('ffprobe')); }

function ensureRuntimeBinaries() {
  if (!app.isPackaged) return;
  fs.mkdirSync(vendorBin(), { recursive: true });
  for (const name of [binaryName('yt-dlp'), binaryName('ffmpeg'), binaryName('ffprobe')]) {
    const source = path.join(bundledBin(), name);
    const destination = path.join(vendorBin(), name);
    if (!fs.existsSync(destination) && fs.existsSync(source)) {
      fs.copyFileSync(source, destination);
    }
  }
}

module.exports = {
  appRoot,
  bundledBin,
  vendorBin,
  ytDlpPath,
  ffmpegPath,
  ffprobePath,
  ensureRuntimeBinaries
};
