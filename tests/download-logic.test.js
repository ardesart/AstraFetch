'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { presetArgs, classifyError } = require('../src/main/download-logic');

 test('1080p preset limits height and requests MP4', () => {
  const args = presetArgs('mp4-1080').join(' ');
  assert.match(args, /height<=1080/);
  assert.match(args, /--merge-output-format mp4/);
});

test('audio MP3 preset extracts audio', () => {
  const args = presetArgs('audio-mp3');
  assert.deepEqual(args.slice(-4), ['--audio-format', 'mp3', '--audio-quality', '0']);
});

test('common errors are classified', () => {
  assert.equal(classifyError('Sign in to confirm you are not a bot'), 'AUTH_REQUIRED');
  assert.equal(classifyError('No space left on device'), 'DISK_FULL');
  assert.equal(classifyError('Unsupported URL'), 'UNSUPPORTED_URL');
  assert.equal(classifyError('Something unexpected'), 'DOWNLOAD_FAILED');
});
