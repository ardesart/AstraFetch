'use strict';

const path = require('node:path');
const fs = require('node:fs');

const PRESETS = new Set(['best','mp4-2160','mp4-1440','mp4-1080','mp4-720','audio-mp3','audio-original']);
const AUTH_MODES = new Set(['none', 'browser', 'file']);

function assertPlainObject(value, name = 'value') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}

function validateHttpUrl(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 4096) throw new TypeError('Invalid URL');
  let parsed;
  try { parsed = new URL(value.trim()); } catch { throw new TypeError('Invalid URL'); }
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new TypeError('Only HTTP and HTTPS URLs are allowed');
  return parsed.toString();
}

function validateDirectory(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1024) throw new TypeError('Invalid directory');
  const normalized = path.resolve(value);
  if (!path.isAbsolute(normalized)) throw new TypeError('Directory must be absolute');
  return normalized;
}

function validateOptionalFile(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > 1024) throw new TypeError('Invalid file path');
  const normalized = path.resolve(value);
  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) throw new TypeError('File does not exist');
  return normalized;
}

function validateAuthOptions(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const authMode = String(input.authMode || 'none');
  if (!AUTH_MODES.has(authMode)) throw new TypeError('Unknown authentication mode');
  const cookiesFile = authMode === 'file' ? validateOptionalFile(input.cookiesFile) : '';
  if (authMode === 'file' && !cookiesFile) throw new TypeError('Select cookies.txt or choose another authentication mode');
  return { authMode, cookiesFile };
}

function validateDownloadOptions(value) {
  const input = assertPlainObject(value, 'download options');
  const preset = String(input.preset || 'best');
  if (!PRESETS.has(preset)) throw new TypeError('Unknown preset');
  const auth = validateAuthOptions(input);
  return {
    url: validateHttpUrl(input.url),
    outputDirectory: validateDirectory(input.outputDirectory),
    preset,
    includePlaylist: Boolean(input.includePlaylist),
    writeThumbnail: Boolean(input.writeThumbnail),
    embedMetadata: input.embedMetadata !== false,
    downloadSubtitles: Boolean(input.downloadSubtitles),
    autoSubtitles: Boolean(input.autoSubtitles),
    subtitleLanguages: typeof input.subtitleLanguages === 'string'
      ? input.subtitleLanguages.slice(0, 128).replace(/[^a-zA-Z0-9,_*.-]/g, '')
      : 'uk,en',
    ...auth
  };
}

function validateJobId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9-]{20,64}$/i.test(value)) throw new TypeError('Invalid job ID');
  return value;
}

module.exports = {
  PRESETS,
  AUTH_MODES,
  validateHttpUrl,
  validateDirectory,
  validateOptionalFile,
  validateAuthOptions,
  validateDownloadOptions,
  validateJobId
};
