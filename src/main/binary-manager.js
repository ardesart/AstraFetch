'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { ytDlpPath, ffmpegPath, ffprobePath, vendorBin } = require('./paths');
const { spawnCaptured } = require('./process-utils');

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const YTDLP_SUMS_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS';
const USER_AGENT = 'AstraFetch/1.0.2';

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': USER_AGENT }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} while reading update metadata`);
  return response.text();
}

function expectedHash(text, fileName) {
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(text).match(new RegExp(`^([a-f0-9]{64})\\s+\\*?${escaped}\\s*$`, 'im'));
  if (!match) throw new Error(`SHA-256 entry was not found for ${fileName}`);
  return match[1].toLowerCase();
}

async function downloadFile(url, destination) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': USER_AGENT }
  });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} while downloading yt-dlp`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination, { flags: 'wx' }));
}

async function readVersion(filePath, args, parser) {
  if (!fs.existsSync(filePath)) return { exists: false, version: '' };
  try {
    const result = await spawnCaptured(filePath, args, { cwd: vendorBin() });
    if (result.code !== 0) return { exists: true, version: 'unavailable' };
    const text = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    return { exists: true, version: parser(text) || 'unknown' };
  } catch {
    return { exists: true, version: 'unavailable' };
  }
}

function firstVersionLine(text, toolName) {
  const first = String(text).split(/\r?\n/).find(Boolean) || '';
  const pattern = new RegExp(`^${toolName} version\\s+([^\\s]+)`, 'i');
  return first.match(pattern)?.[1] || first.slice(0, 120);
}

async function getBinaryStatus() {
  const [ytDlp, ffmpeg, ffprobe] = await Promise.all([
    readVersion(ytDlpPath(), ['--version'], text => String(text).split(/\r?\n/).find(Boolean)?.trim() || ''),
    readVersion(ffmpegPath(), ['-version'], text => firstVersionLine(text, 'ffmpeg')),
    readVersion(ffprobePath(), ['-version'], text => firstVersionLine(text, 'ffprobe'))
  ]);
  return { ytDlp, ffmpeg, ffprobe };
}

async function verifyDownloadedYtDlp(filePath, expected) {
  const actual = (await sha256File(filePath)).toLowerCase();
  if (actual !== expected) {
    throw new Error(`yt-dlp SHA-256 verification failed. Expected ${expected}, got ${actual}`);
  }
  const result = await spawnCaptured(filePath, ['--version'], { cwd: vendorBin() });
  if (result.code !== 0) throw new Error('Downloaded yt-dlp failed its version check');
  const version = String(result.stdout || result.stderr || '').split(/\r?\n/).find(Boolean)?.trim() || '';
  if (!version) throw new Error('Downloaded yt-dlp did not report a version');
  return version;
}

async function updateYtDlp() {
  if (process.platform !== 'win32') throw new Error('The built-in yt-dlp updater currently supports Windows only');

  fs.mkdirSync(vendorBin(), { recursive: true });
  const destination = ytDlpPath();
  const sums = await fetchText(YTDLP_SUMS_URL);
  const expected = expectedHash(sums, 'yt-dlp.exe');

  if (fs.existsSync(destination)) {
    try {
      const current = (await sha256File(destination)).toLowerCase();
      if (current === expected) {
        const status = await getBinaryStatus();
        return { changed: false, version: status.ytDlp.version };
      }
    } catch {
      // A damaged existing binary is replaced below.
    }
  }

  const temp = path.join(vendorBin(), `.yt-dlp-${process.pid}-${Date.now()}.download`);
  const backup = `${destination}.bak`;
  fs.rmSync(temp, { force: true });
  fs.rmSync(backup, { force: true });

  let movedOld = false;
  try {
    await downloadFile(YTDLP_URL, temp);
    const version = await verifyDownloadedYtDlp(temp, expected);

    if (fs.existsSync(destination)) {
      fs.renameSync(destination, backup);
      movedOld = true;
    }
    fs.renameSync(temp, destination);

    const installed = await verifyDownloadedYtDlp(destination, expected);
    fs.rmSync(backup, { force: true });
    return { changed: true, version: installed || version };
  } catch (error) {
    fs.rmSync(temp, { force: true });
    if (movedOld && !fs.existsSync(destination) && fs.existsSync(backup)) {
      try { fs.renameSync(backup, destination); } catch {}
    }
    throw error;
  } finally {
    if (fs.existsSync(destination)) fs.rmSync(backup, { force: true });
  }
}

module.exports = { getBinaryStatus, updateYtDlp };
