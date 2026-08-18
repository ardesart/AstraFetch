'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { app } = require('electron');
const { ytDlpPath, vendorBin, ffmpegPath, denoPath } = require('./paths');
const { spawnCaptured, killProcessTree } = require('./process-utils');

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

function clampProgress(value) {
  const n = Number.parseFloat(String(value).replace('%', '').trim());
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

function safeText(value, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max);
}

function jsRuntimeArgs() {
  const runtime = denoPath();
  return fs.existsSync(runtime) ? ['--js-runtimes', `deno:${runtime}`] : [];
}

const { presetArgs, classifyError } = require('./download-logic');

class DownloadManager {
  constructor({ sendUpdate, getConcurrency, browserSession }) {
    this.jobs = new Map();
    this.queue = [];
    this.running = new Map();
    this.sendUpdate = sendUpdate;
    this.getConcurrency = getConcurrency;
    this.browserSession = browserSession;
    this.archiveRoot = path.join(app.getPath('userData'), 'archives');
    this.historyPath = path.join(app.getPath('userData'), 'history.jsonl');
  }

  snapshot(job) {
    const { process: _process, logs: _logs, cookieRef: _cookieRef, titleLocked: _titleLocked, ...safe } = job;
    return { ...safe, logs: job.logs.slice(-80) };
  }

  emit(job) {
    this.sendUpdate(this.snapshot(job));
  }

  archivePathFor(preset) {
    return path.join(this.archiveRoot, `${preset}.txt`);
  }

  async resolveCookies(authMode, cookiesFile) {
    if (authMode === 'file') return { path: cookiesFile, temporary: false };
    if (authMode === 'browser') {
      const filePath = await this.browserSession.createCookiesFile();
      return { path: filePath, temporary: true };
    }
    return { path: '', temporary: false };
  }

  cleanupCookies(cookieRef) {
    if (cookieRef?.temporary && cookieRef.path) this.browserSession.cleanupCookieFile(cookieRef.path);
  }

  async analyze(url, auth = { authMode: 'none', cookiesFile: '' }) {
    if (!fs.existsSync(ytDlpPath())) throw new Error('yt-dlp is missing. Run RUN.bat first.');
    const cookieRef = await this.resolveCookies(auth.authMode, auth.cookiesFile);
    const args = [
      '--ignore-config',
      '--no-restrict-filenames',
      '--encoding', 'utf-8',
      '--dump-single-json',
      '--no-warnings',
      '--no-color',
      ...jsRuntimeArgs(),
      '--no-playlist',
      '--skip-download',
      '--ffmpeg-location', vendorBin()
    ];
    if (cookieRef.path) args.push('--cookies', cookieRef.path);
    args.push(url);
    let result;
    try {
      result = await spawnCaptured(ytDlpPath(), args, { maxBuffer: 64 * 1024 * 1024 });
    } finally {
      this.cleanupCookies(cookieRef);
    }
    if (result.code !== 0) throw new Error((result.stderr || result.stdout || 'Analysis failed').trim());
    let data;
    try { data = JSON.parse(result.stdout); } catch { throw new Error('yt-dlp returned invalid metadata'); }
    return {
      id: safeText(data.id, 100),
      title: safeText(data.title || data.fulltitle || 'Untitled', 500),
      uploader: safeText(data.uploader || data.channel || '', 300),
      duration: Number.isFinite(data.duration) ? data.duration : 0,
      webpageUrl: safeText(data.webpage_url || url, 4096),
      thumbnail: typeof data.thumbnail === 'string' ? data.thumbnail : '',
      extractor: safeText(data.extractor_key || data.extractor || '', 100),
      liveStatus: safeText(data.live_status || '', 50),
      availability: safeText(data.availability || '', 50),
      formatCount: Array.isArray(data.formats) ? data.formats.length : 0,
      subtitles: Object.keys(data.subtitles || {}),
      automaticCaptions: Object.keys(data.automatic_captions || {})
    };
  }

  add(options, metadata = null) {
    const id = crypto.randomUUID();
    const job = {
      id,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      status: 'queued',
      stage: 'queued',
      title: safeText(metadata?.title || options.url, 500),
      titleLocked: Boolean(metadata?.title),
      uploader: safeText(metadata?.uploader || '', 300),
      url: options.url,
      outputDirectory: options.outputDirectory,
      outputPath: '',
      preset: options.preset,
      options,
      progress: 0,
      speed: '',
      eta: '',
      downloadedBytes: 0,
      totalBytes: 0,
      errorCode: '',
      errorMessage: '',
      logs: []
    };
    this.jobs.set(id, job);
    this.queue.push(id);
    this.emit(job);
    this.pump();
    return this.snapshot(job);
  }

  hasActiveJobs() {
    return this.running.size > 0 || this.queue.some(id => this.jobs.get(id)?.status === 'queued');
  }

  list() {
    return [...this.jobs.values()].map(job => this.snapshot(job));
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job || TERMINAL.has(job.status)) return false;
    if (job.status === 'queued') {
      this.queue = this.queue.filter(value => value !== id);
      job.status = 'cancelled';
      job.stage = 'cancelled';
      job.completedAt = new Date().toISOString();
      this.emit(job);
      return true;
    }
    job.status = 'cancelling';
    job.stage = 'cancelling';
    this.emit(job);
    const child = this.running.get(id);
    killProcessTree(child);
    return true;
  }

  retry(id) {
    const previous = this.jobs.get(id);
    if (!previous || !TERMINAL.has(previous.status)) throw new Error('Job cannot be retried');
    return this.add(previous.options, { title: previous.title, uploader: previous.uploader });
  }

  async pump() {
    const concurrency = Math.max(1, Math.min(3, Number(this.getConcurrency()) || 2));
    while (this.running.size < concurrency && this.queue.length > 0) {
      const id = this.queue.shift();
      const job = this.jobs.get(id);
      if (!job || job.status !== 'queued') continue;
      this.run(job).catch(() => {});
    }
  }

  buildArgs(job, cookiePath = '') {
    const o = job.options;
    fs.mkdirSync(o.outputDirectory, { recursive: true });
    fs.mkdirSync(this.archiveRoot, { recursive: true });

    const args = [
      '--ignore-config',
      '--no-restrict-filenames',
      '--encoding', 'utf-8',
      '--no-color',
      ...jsRuntimeArgs(),
      '--newline',
      '--continue',
      '--part',
      '--windows-filenames',
      '--trim-filenames', '180',
      '--ffmpeg-location', vendorBin(),
      '--download-archive', this.archivePathFor(o.preset),
      '--retries', '8',
      '--fragment-retries', '8',
      '--retry-sleep', 'http:linear=1::5',
      '--retry-sleep', 'fragment:linear=1::5',
      '--socket-timeout', '30',
      '--progress-template', 'download:PROGRESS|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s',
      '--print', 'before_dl:TITLE|%(title)s',
      '--print', 'after_move:FINAL|%(filepath)s',
      '-P', o.outputDirectory,
      '-o', o.includePlaylist
        ? '%(playlist|Playlist)s/%(playlist_index|0)03d - %(title)s [%(id)s].%(ext)s'
        : '%(title)s [%(id)s].%(ext)s',
      ...presetArgs(o.preset)
    ];

    if (!o.includePlaylist) args.push('--no-playlist');
    if (o.writeThumbnail) args.push('--write-thumbnail');
    if (o.embedMetadata) args.push('--embed-metadata', '--embed-chapters');
    if (o.downloadSubtitles) {
      args.push('--write-subs', '--sub-langs', o.subtitleLanguages || 'uk,en');
      if (o.autoSubtitles) args.push('--write-auto-subs');
    }
    if (cookiePath) args.push('--cookies', cookiePath);
    args.push(o.url);
    return args;
  }

  handleLine(job, line, isError = false) {
    const clean = safeText(line, 4000).trim();
    if (!clean) return;
    job.logs.push(`${isError ? 'ERR' : 'OUT'} ${clean}`);
    if (job.logs.length > 200) job.logs.splice(0, job.logs.length - 200);

    if (clean.startsWith('PROGRESS|')) {
      const [, percent, speed, eta, downloaded, total] = clean.split('|');
      job.status = 'downloading';
      job.stage = 'downloading';
      job.progress = clampProgress(percent);
      job.speed = safeText(speed, 50).trim();
      job.eta = safeText(eta, 50).trim();
      job.downloadedBytes = Number.parseInt(downloaded, 10) || 0;
      job.totalBytes = Number.parseInt(total, 10) || 0;
      this.emit(job);
      return;
    }
    if (clean.startsWith('TITLE|')) {
      const printedTitle = safeText(clean.slice(6), 500).trim();
      if (!job.titleLocked && printedTitle && !printedTitle.includes('\uFFFD')) {
        job.title = printedTitle;
      }
      this.emit(job);
      return;
    }
    if (clean.startsWith('FINAL|')) {
      job.outputPath = clean.slice(6).trim();
      job.stage = 'finalizing';
      job.progress = Math.max(job.progress, 99);
      this.emit(job);
      return;
    }
    if (/merg|remux|extractaudio|embed|post-process/i.test(clean)) {
      job.stage = 'processing';
      job.status = 'processing';
      this.emit(job);
    }
  }

  async run(job) {
    job.status = 'starting';
    job.stage = 'starting';
    job.startedAt = new Date().toISOString();
    this.emit(job);

    if (!fs.existsSync(ytDlpPath())) {
      this.fail(job, 'BINARY_MISSING', 'yt-dlp is missing. Run RUN.bat.');
      return;
    }
    if (!fs.existsSync(ffmpegPath())) {
      this.fail(job, 'FFMPEG_MISSING', 'FFmpeg is missing. Run RUN.bat.');
      return;
    }

    let cookieRef;
    try {
      cookieRef = await this.resolveCookies(job.options.authMode, job.options.cookiesFile);
    } catch (error) {
      this.fail(job, 'AUTH_REQUIRED', error.message);
      return;
    }
    job.cookieRef = cookieRef;

    const child = spawn(ytDlpPath(), this.buildArgs(job, cookieRef.path), {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    job.process = child;
    this.running.set(job.id, child);

    const outputLines = readline.createInterface({ input: child.stdout });
    const errorLines = readline.createInterface({ input: child.stderr });
    outputLines.on('line', line => this.handleLine(job, line, false));
    errorLines.on('line', line => this.handleLine(job, line, true));

    let settled = false;
    child.once('error', error => {
      if (settled) return;
      settled = true;
      this.running.delete(job.id);
      this.cleanupCookies(job.cookieRef);
      delete job.cookieRef;
      this.fail(job, 'PROCESS_ERROR', error.message);
      this.pump();
    });

    child.once('close', code => {
      if (settled) return;
      settled = true;
      this.running.delete(job.id);
      delete job.process;
      this.cleanupCookies(job.cookieRef);
      delete job.cookieRef;
      if (job.status === 'cancelling') {
        job.status = 'cancelled';
        job.stage = 'cancelled';
        job.completedAt = new Date().toISOString();
        this.emit(job);
      } else if (code === 0) {
        job.status = 'completed';
        job.stage = 'completed';
        job.progress = 100;
        job.completedAt = new Date().toISOString();
        this.appendHistory(job);
        this.emit(job);
      } else {
        const raw = job.logs.slice(-30).join('\n');
        this.fail(job, classifyError(raw), raw.split('\n').slice(-8).join('\n') || `yt-dlp exited with code ${code}`);
      }
      this.pump();
    });
  }

  fail(job, code, message) {
    job.status = 'failed';
    job.stage = 'failed';
    job.errorCode = code;
    job.errorMessage = safeText(message, 4000);
    job.completedAt = new Date().toISOString();
    this.emit(job);
  }

  appendHistory(job) {
    try {
      fs.mkdirSync(path.dirname(this.historyPath), { recursive: true });
      const entry = {
        id: job.id,
        completedAt: job.completedAt,
        title: job.title,
        uploader: job.uploader,
        url: job.url,
        outputPath: job.outputPath,
        preset: job.preset
      };
      fs.appendFileSync(this.historyPath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {}
  }

  readHistory(limit = 100) {
    try {
      const lines = fs.readFileSync(this.historyPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
      return lines.slice(-Math.max(1, Math.min(500, limit))).reverse().map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  shutdown() {
    for (const child of this.running.values()) killProcessTree(child);
    for (const job of this.jobs.values()) {
      this.cleanupCookies(job.cookieRef);
      delete job.cookieRef;
    }
    this.running.clear();
  }
}

module.exports = { DownloadManager };
