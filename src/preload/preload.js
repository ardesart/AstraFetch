'use strict';

const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result?.ok) {
    const error = new Error(result?.error?.message || 'Operation failed');
    error.name = result?.error?.name || 'Error';
    throw error;
  }
  return result.value;
}

contextBridge.exposeInMainWorld('astra', Object.freeze({
  app: { info: () => invoke('app:get-info') },
  settings: { get: () => invoke('settings:get'), set: patch => invoke('settings:set', patch) },
  dialog: {
    selectOutput: initialPath => invoke('dialog:select-output', initialPath),
    selectCookies: () => invoke('dialog:select-cookies')
  },
  video: {
    analyze: (url, auth) => invoke('video:analyze', url, auth),
    thumbnail: url => invoke('thumbnail:fetch', url)
  },
  downloads: {
    add: (options, metadata) => invoke('download:add', options, metadata),
    list: () => invoke('download:list'),
    cancel: id => invoke('download:cancel', id),
    retry: id => invoke('download:retry', id),
    onUpdate: callback => {
      const listener = (_event, job) => callback(job);
      ipcRenderer.on('download:update', listener);
      return () => ipcRenderer.removeListener('download:update', listener);
    }
  },
  history: { list: limit => invoke('history:list', limit) },
  browser: {
    open: initialUrl => invoke('browser:open', initialUrl),
    status: () => invoke('browser:cookie-status'),
    clear: () => invoke('browser:clear-data'),
    onUseUrl: callback => {
      const listener = (_event, url) => callback(url);
      ipcRenderer.on('browser:use-url', listener);
      return () => ipcRenderer.removeListener('browser:use-url', listener);
    }
  },
  binaries: {
    status: () => invoke('binary:status'),
    updateYtDlp: () => invoke('binary:update-ytdlp')
  },
  system: {
    openPath: target => invoke('system:open-path', target),
    readClipboard: () => invoke('system:read-clipboard'),
    copyText: text => invoke('system:copy-text', text)
  }
}));
