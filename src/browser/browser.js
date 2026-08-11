'use strict';

const $ = selector => document.querySelector(selector);
let state = { url: '', loading: false, canGoBack: false, canGoForward: false };

function render(next) {
  state = { ...state, ...next };
  if (document.activeElement !== $('#addressInput')) $('#addressInput').value = state.url || '';
  $('#backButton').disabled = !state.canGoBack;
  $('#forwardButton').disabled = !state.canGoForward;
  $('#loadingIndicator').classList.toggle('hidden', !state.loading);
  $('#reloadButton').textContent = state.loading ? '×' : '↻';
  $('#securityIndicator').style.color = state.url.startsWith('https://') ? '#72e4c2' : '#ffb86b';
  if (state.title) document.title = `${state.title} — AstraFetch Browser`;
}

async function refreshCookieStatus() {
  try {
    const status = await window.astraBrowser.cookieStatus();
    $('#cookieStatus').textContent = status.cookieCount
      ? `${status.cookieCount} cookies у ${status.domainCount} доменах`
      : 'Сесія порожня — ви ще не авторизувалися';
  } catch (error) {
    $('#cookieStatus').textContent = error.message;
  }
}

$('#addressForm').addEventListener('submit', async event => {
  event.preventDefault();
  await window.astraBrowser.navigate($('#addressInput').value);
});
$('#backButton').addEventListener('click', () => window.astraBrowser.back());
$('#forwardButton').addEventListener('click', () => window.astraBrowser.forward());
$('#reloadButton').addEventListener('click', () => state.loading ? window.astraBrowser.stop() : window.astraBrowser.reload());
$('#homeButton').addEventListener('click', () => window.astraBrowser.home());
$('#externalButton').addEventListener('click', () => window.astraBrowser.openExternal());
$('#useButton').addEventListener('click', async () => {
  const url = await window.astraBrowser.useCurrentPage();
  if (url) $('#useButton').textContent = 'Передано в AstraFetch';
  setTimeout(() => { $('#useButton').textContent = 'Завантажити сторінку'; }, 1600);
});
$('#menuButton').addEventListener('click', async () => {
  $('#sessionMenu').classList.toggle('hidden');
  if (!$('#sessionMenu').classList.contains('hidden')) await refreshCookieStatus();
});
$('#clearButton').addEventListener('click', async () => {
  if (!confirm('Очистити cookies, локальні дані та всі авторизації в AstraFetch Browser?')) return;
  await window.astraBrowser.clearData();
  await refreshCookieStatus();
  $('#sessionMenu').classList.add('hidden');
});
window.astraBrowser.onState(render);
window.astraBrowser.state().then(render).catch(() => {});
