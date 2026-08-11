'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateHttpUrl, validateAuthOptions, validateDownloadOptions } = require('../src/main/validation');

test('HTTP URL validation blocks dangerous schemes', () => {
  assert.equal(validateHttpUrl('https://example.com/video'), 'https://example.com/video');
  assert.throws(() => validateHttpUrl('file:///C:/secret.txt'));
  assert.throws(() => validateHttpUrl('javascript:alert(1)'));
});

test('download options use allowlisted presets', () => {
  const options = validateDownloadOptions({
    url: 'https://example.com/video',
    outputDirectory: process.cwd(),
    preset: 'mp4-1080'
  });
  assert.equal(options.preset, 'mp4-1080');
  assert.equal(options.authMode, 'none');
  assert.throws(() => validateDownloadOptions({
    url: 'https://example.com/video',
    outputDirectory: process.cwd(),
    preset: '--exec'
  }));
});

test('authentication modes are explicit and browser mode needs no file', () => {
  assert.deepEqual(validateAuthOptions({ authMode: 'none' }), { authMode: 'none', cookiesFile: '' });
  assert.deepEqual(validateAuthOptions({ authMode: 'browser' }), { authMode: 'browser', cookiesFile: '' });
  assert.throws(() => validateAuthOptions({ authMode: 'file', cookiesFile: '' }));
  assert.throws(() => validateAuthOptions({ authMode: 'unsafe-command' }));
});
