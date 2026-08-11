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
