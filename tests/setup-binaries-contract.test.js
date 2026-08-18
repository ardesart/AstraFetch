'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-binaries.js'), 'utf8');

test('Deno bootstrap resolves the official GitHub release asset digest', () => {
  assert.match(source, /DENO_RELEASE_API\s*=\s*'https:\/\/api\.github\.com\/repos\/denoland\/deno\/releases\/latest'/);
  assert.match(source, /asset\.digest/);
  assert.match(source, /\^sha256:\(\[a-f0-9\]\{64\}\)\$/i);
  assert.match(source, /browser_download_url/);
});

test('Deno checksum sidecar remains a guarded fallback only', () => {
  assert.match(source, /GitHub release digest is unavailable; falling back/);
  assert.match(source, /\.sha256sum/);
});
