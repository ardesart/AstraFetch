'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'download-manager.js'), 'utf8');

test('yt-dlp output is forced to UTF-8 for metadata and download streams', () => {
  const matches = source.match(/'--encoding', 'utf-8'/g) || [];
  assert.ok(matches.length >= 2, 'Expected UTF-8 encoding in both analyze and download arguments');
});

test('analyzed Unicode title is locked against progress-stream replacement', () => {
  assert.match(source, /titleLocked:\s*Boolean\(metadata\?\.title\)/);
  assert.match(source, /!job\.titleLocked\s*&&\s*printedTitle/);
  assert.match(source, /!printedTitle\.includes\('\\uFFFD'\)/);
});

test('yt-dlp uses the bundled Deno runtime for JavaScript challenges', () => {
  assert.match(source, /denoPath/);
  assert.match(source, /'--js-runtimes'/);
  assert.match(source, /`deno:\$\{runtime\}`/);
  const calls = source.match(/\.\.\.jsRuntimeArgs\(\)/g) || [];
  assert.ok(calls.length >= 2, 'Expected Deno runtime arguments in both analyze and download commands');
});

test('YouTube requests prefer IPv4 and retry 403 through web_safari HLS', () => {
  assert.match(source, /'--force-ipv4'/);
  assert.match(source, /youtube:player_client=web_safari/);
  assert.match(source, /isHttp403\(attemptRaw\)/);
  assert.match(source, /launchAttempt\(true\)/);
  assert.match(source, /YOUTUBE_403/);
});
