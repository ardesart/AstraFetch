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
const USER_AGENT = 'AstraFetch-Setup/1.0.5';
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const YTDLP_SUMS_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS';
const FFMPEG_ZIP_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
const FFMPEG_SUM_URL = `${FFMPEG_ZIP_URL}.sha256`;
const DENO_ZIP_NAME = 'deno-x86_64-pc-windows-msvc.zip';
const DENO_RELEASE_API = 'https://api.github.com/repos/denoland/deno/releases/latest';

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
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': USER_AGENT }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function download(url, destination, label = path.basename(destination)) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temp = `${destination}.download`;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    fs.rmSync(temp, { force: true });
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT }
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
  const sourceText = String(text);
  const lines = sourceText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const target = lines.find(line => line.toLowerCase().includes(fileName.toLowerCase()));
  const targetMatch = target?.match(/\b([a-f0-9]{64})\b/i);
  if (targetMatch) return targetMatch[1].toLowerCase();

  const matches = [...sourceText.matchAll(/\b([a-f0-9]{64})\b/ig)].map(match => match[1].toLowerCase());
  const unique = [...new Set(matches)];
  if (unique.length === 1) return unique[0];
  if (!unique.length) throw new Error(`SHA-256 not found for ${fileName}`);
  throw new Error(`Ambiguous SHA-256 data for ${fileName}`);
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

async function expandZip(zipPath, extractPath) {
  fs.mkdirSync(extractPath, { recursive: true });
  if (process.platform === 'win32') {
    const escapedZip = zipPath.replace(/'/g, "''");
    const escapedOut = extractPath.replace(/'/g, "''");
    await run('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command', `Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedOut}' -Force`
    ]);
    return;
  }
  await run('unzip', ['-q', zipPath, '-d', extractPath]);
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

    await expandZip(zipPath, extractPath);
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

async function resolveDenoRelease() {
  const release = await fetchJson(DENO_RELEASE_API);
  const asset = Array.isArray(release.assets)
    ? release.assets.find(item => item?.name === DENO_ZIP_NAME)
    : null;
  if (!asset) throw new Error(`Deno release asset not found: ${DENO_ZIP_NAME}`);

  const url = String(asset.browser_download_url || '');
  const allowedPrefix = 'https://github.com/denoland/deno/releases/download/';
  if (!url.startsWith(allowedPrefix)) throw new Error('Unexpected Deno release download URL');

  const digest = String(asset.digest || '');
  const digestMatch = digest.match(/^sha256:([a-f0-9]{64})$/i);
  if (digestMatch) {
    return {
      url,
      expected: digestMatch[1].toLowerCase(),
      version: String(release.tag_name || 'latest')
    };
  }

  log('GitHub release digest is unavailable; falling back to the Deno checksum sidecar.');
  const sumText = await fetchText(`${url}.sha256sum`);
  return {
    url,
    expected: expectedHash(sumText, DENO_ZIP_NAME),
    version: String(release.tag_name || 'latest')
  };
}

async function setupDeno() {
  const destination = path.join(BIN_DIR, 'deno.exe');
  if (!FORCE && fs.existsSync(destination) && fs.statSync(destination).size > 10_000_000) {
    log('Deno already exists.');
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'astrafetch-deno-'));
  const zipPath = path.join(tempRoot, DENO_ZIP_NAME);
  const extractPath = path.join(tempRoot, 'extracted');
  try {
    log('Resolving latest Deno release and GitHub SHA-256 digest...');
    const release = await resolveDenoRelease();
    log(`Downloading Deno ${release.version} JavaScript runtime for yt-dlp...`);
    await download(release.url, zipPath, 'Deno archive');
    await verify(zipPath, release.expected);
    await expandZip(zipPath, extractPath);

    const source = findFile(extractPath, 'deno.exe');
    if (!source) throw new Error('deno.exe was not found in the Deno archive');
    fs.copyFileSync(source, destination);
    await run(destination, ['--version']);
    log('Deno installed.');
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
  await setupDeno();
  log('Binary setup completed successfully.');
}

main().catch(error => {
  console.error(`\nBinary setup failed:\n${error.stack || error.message || error}`);
  process.exitCode = 1;
});
