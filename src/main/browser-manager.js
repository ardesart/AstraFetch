'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { ytDlpPath, ffmpegPath, ffprobePath } = require('./paths');
const { spawnCaptured } = require('./process-utils');

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const YTDLP_SUMS_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS';

function sha256File(filePath) {
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
    headers: { 'User-Agent': 'AstraFetch/1.0' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function downloadFile(url, destination) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'AstraFetch/1.0' }
  });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
}

function parseExpectedHash(text, fileName) {
  const lines = String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const line = lines.find(value => value.toLowerCase().endsWith(fileName.toLowerCase()));
  const match = line?.match(/\b([a-f0-9]{64})\b/i);
  if (!match) throw new Error('Official yt-dlp checksum was not found');
  return match[1].toLowerCase();
}

async function getBinaryStatus() {
  const status = {
    ytDlp: { exists: fs.existsSync(ytDlpPath()), version: '', sha256: '' },
    ffmpeg: { exists: fs.existsSync(ffmpegPath()), version: '' },
    ffprobe: { exists: fs.existsSync(ffprobePath()), version: '' }
  };

  if (status.ytDlp.exists) {
    const result = await spawnCaptured(ytDlpPath(), ['--version']);
    status.ytDlp.version = result.code === 0 ? result.stdout.trim() : 'error';
    status.ytDlp.sha256 = await sha256File(ytDlpPath());
  }
  if (status.ffmpeg.exists) {
    const result = await spawnCaptured(ffmpegPath(), ['-version']);
    status.ffmpeg.version = result.code === 0 ? result.stdout.split(/\r?\n/)[0] : 'error';
  }
  if (status.ffprobe.exists) {
    const result = await spawnCaptured(ffprobePath(), ['-version']);
    status.ffprobe.version = result.code === 0 ? result.stdout.split(/\r?\n/)[0] : 'error';
  }
  return status;
}

async function updateYtDlp() {
  const destination = ytDlpPath();
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.download.exe`;
  const backup = `${destination}.backup.exe`;
  fs.rmSync(temporary, { force: true });
  fs.rmSync(backup, { force: true });

  const sums = await fetchText(YTDLP_SUMS_URL);
  const expected = parseExpectedHash(sums, 'yt-dlp.exe');
  await downloadFile(YTDLP_URL, temporary);
  const actual = await sha256File(temporary);
  if (actual !== expected) {
    fs.rmSync(temporary, { force: true });
    throw new Error(`yt-dlp SHA-256 mismatch. Expected ${expected}, received ${actual}`);
  }

  const validation = await spawnCaptured(temporary, ['--version']);
  if (validation.code !== 0 || !/^\d{4}\.\d{2}\.\d{2}/.test(validation.stdout.trim())) {
    fs.rmSync(temporary, { force: true });
    throw new Error('Downloaded yt-dlp executable failed validation');
  }

  const before = fs.existsSync(destination) ? await sha256File(destination) : '';
  try {
    if (fs.existsSync(destination)) fs.renameSync(destination, backup);
    fs.renameSync(temporary, destination);
    fs.rmSync(backup, { force: true });
  } catch (error) {
    fs.rmSync(destination, { force: true });
    if (fs.existsSync(backup)) fs.renameSync(backup, destination);
    fs.rmSync(temporary, { force: true });
    throw error;
  }

  return {
    changed: before !== actual,
    version: validation.stdout.trim(),
    sha256: actual
  };
}

module.exports = { getBinaryStatus, updateYtDlp, sha256File };
