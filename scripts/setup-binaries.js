'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Readable, Transform } = require('node:stream');

const ROOT = path.resolve(__dirname, '..');
const BIN_DIR = path.join(ROOT, 'vendor', 'bin');
const FORCE = process.argv.includes('--force');
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const YTDLP_SUMS_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS';
const FFMPEG_ZIP_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
const FFMPEG_SUM_URL = `${FFMPEG_ZIP_URL}.sha256`;

function log(message) {
  process.stdout.write(`[setup] ${message}\n`);
}

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
  const response = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'AstraFetch-Setup/1.0' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

async function download(url, destination, label = path.basename(destination)) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temp = `${destination}.download`;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    fs.rmSync(temp, { force: true });
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'AstraFetch-Setup/1.0.1' }
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${url}`);

      const total = Number(response.headers.get('content-length')) || 0;
      let received = 0;
      let lastPercent = -10;
      let lastMegabytes = 0;
      const progress = new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length;
          if (total > 0) {
            const percent = Math.floor((received / total) * 100);
            if (percent >= lastPercent + 10 || percent === 100) {
              lastPercent = percent;
              log(`${label}: ${Math.min(percent, 100)}%`);
            }
          } else {
            const megabytes = Math.floor(received / (25 * 1024 * 1024)) * 25;
            if (megabytes >= lastMegabytes + 25) {
              lastMegabytes = megabytes;
              log(`${label}: ${megabytes} MB downloaded`);
            }
          }
          callback(null, chunk);
        }
      });

      await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(temp));
      fs.rmSync(destination, { force: true });
      fs.renameSync(temp, destination);
      return;
    } catch (error) {
      fs.rmSync(temp, { force: true });
      if (attempt >= 3) throw error;
      log(`${label} download attempt ${attempt} failed. Retrying...`);
      await new Promise(resolve => setTimeout(resolve, attempt * 2000));
    }
  }
}

function expectedHash(text, fileName) {
  const lines = String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const target = lines.find(line => line.toLowerCase().endsWith(fileName.toLowerCase()));
  const source = target || lines[0] || '';
  const match = source.match(/\b([a-f0-9]{64})\b/i);
  if (!match) throw new Error(`SHA-256 not found for ${fileName}`);
  return match[1].toLowerCase();
}

async function verify(filePath, expected) {
  const actual = await sha256File(filePath);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    fs.rmSync(filePath, { force: true });
    throw new Error(`SHA-256 mismatch for ${path.basename(filePath)}\nExpected: ${expected}\nActual:   ${actual}`);
  }
  log(`Verified ${path.basename(filePath)}: ${actual}`);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true, shell: false });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

function findFile(root, fileName) {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase() === fileName.toLowerCase()) return full;
    }
  }
  return '';
}

async function setupYtDlp() {
  const destination = path.join(BIN_DIR, 'yt-dlp.exe');
  if (!FORCE && fs.existsSync(destination) && fs.statSync(destination).size > 5_000_000) {
    log('yt-dlp already exists.');
    return;
  }
  log('Downloading yt-dlp...');
  const sums = await fetchText(YTDLP_SUMS_URL);
  const expected = expectedHash(sums, 'yt-dlp.exe');
  await download(YTDLP_URL, destination, 'yt-dlp');
  await verify(destination, expected);
}

async function setupFfmpeg() {
  const ffmpegDestination = path.join(BIN_DIR, 'ffmpeg.exe');
  const ffprobeDestination = path.join(BIN_DIR, 'ffprobe.exe');
  if (!FORCE && fs.existsSync(ffmpegDestination) && fs.existsSync(ffprobeDestination)) {
    log('FFmpeg and FFprobe already exist.');
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'astrafetch-ffmpeg-'));
  const zipPath = path.join(tempRoot, 'ffmpeg-release-essentials.zip');
  const extractPath = path.join(tempRoot, 'extracted');
  try {
    log('Downloading FFmpeg stable essentials build...');
    const sumText = await fetchText(FFMPEG_SUM_URL);
    const expected = expectedHash(sumText, 'ffmpeg-release-essentials.zip');
    await download(FFMPEG_ZIP_URL, zipPath, 'FFmpeg archive');
    await verify(zipPath, expected);

    fs.mkdirSync(extractPath, { recursive: true });
    if (process.platform === 'win32') {
      const escapedZip = zipPath.replace(/'/g, "''");
      const escapedOut = extractPath.replace(/'/g, "''");
      await run('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-Command', `Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedOut}' -Force`
      ]);
    } else {
      await run('unzip', ['-q', zipPath, '-d', extractPath]);
    }

    const ffmpegSource = findFile(extractPath, 'ffmpeg.exe');
    const ffprobeSource = findFile(extractPath, 'ffprobe.exe');
    if (!ffmpegSource || !ffprobeSource) throw new Error('FFmpeg executables were not found in the archive');
    fs.copyFileSync(ffmpegSource, ffmpegDestination);
    fs.copyFileSync(ffprobeSource, ffprobeDestination);
    log('FFmpeg and FFprobe installed.');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  if (process.platform !== 'win32') {
    log('This project packages Windows binaries. Run setup on Windows for final distribution.');
    return;
  }
  fs.mkdirSync(BIN_DIR, { recursive: true });
  await setupYtDlp();
  await setupFfmpeg();
  log('Binary setup completed successfully.');
}

main().catch(error => {
  console.error(`\nBinary setup failed:\n${error.stack || error.message || error}`);
  process.exitCode = 1;
});
