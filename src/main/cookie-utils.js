'use strict';

function sanitizeCookieField(value) {
  return String(value ?? '').replace(/[\t\r\n\0]/g, '');
}

function cookieToNetscape(cookie) {
  const domain = sanitizeCookieField(cookie?.domain || '');
  if (!domain) return '';
  const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
  const cookiePath = sanitizeCookieField(cookie.path || '/');
  const secure = cookie.secure ? 'TRUE' : 'FALSE';
  const expires = Number.isFinite(cookie.expirationDate) ? Math.max(0, Math.floor(cookie.expirationDate)) : 0;
  const name = sanitizeCookieField(cookie.name);
  const value = sanitizeCookieField(cookie.value);
  return [domain, includeSubdomains, cookiePath, secure, expires, name, value].join('\t');
}

function serializeNetscapeCookies(cookies) {
  const rows = Array.isArray(cookies) ? cookies.map(cookieToNetscape).filter(Boolean) : [];
  return [
    '# Netscape HTTP Cookie File',
    '# Temporary file created by AstraFetch. It is deleted after use.',
    ...rows,
    ''
  ].join('\r\n');
}

module.exports = { sanitizeCookieField, cookieToNetscape, serializeNetscapeCookies };
