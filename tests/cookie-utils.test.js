'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cookieToNetscape, serializeNetscapeCookies } = require('../src/main/cookie-utils');

test('Electron cookies are serialized to Netscape format', () => {
  const line = cookieToNetscape({
    domain: '.example.com',
    path: '/',
    secure: true,
    expirationDate: 2000000000.9,
    name: 'sessionid',
    value: 'safe-value'
  });
  assert.equal(line, '.example.com\tTRUE\t/\tTRUE\t2000000000\tsessionid\tsafe-value');
  const body = serializeNetscapeCookies([{ domain: 'example.com', name: 'a', value: 'b' }]);
  assert.match(body, /^# Netscape HTTP Cookie File\r\n/);
  assert.match(body, /example\.com\tFALSE\t\/\tFALSE\t0\ta\tb/);
});

test('cookie fields cannot inject extra Netscape rows', () => {
  const line = cookieToNetscape({ domain: '.example.com', name: 'a\nmalicious', value: 'b\tvalue' });
  assert.equal(line.split('\n').length, 1);
  assert.equal(line.split('\t').length, 7);
});
