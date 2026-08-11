'use strict';

const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result?.ok) throw new Error(result?.error?.message || 'Browser command failed');
  return result.value;
}

contextBridge.exposeInMainWorld('astraBrowser', Object.freeze({
  navigate: value => invoke('browser:navigate', value),
  back: () => invoke('browser:back'),
  forward: () => invoke('browser:forward'),
  reload: () => invoke('browser:reload'),
  stop: () => invoke('browser:stop'),
  home: () => invoke('browser:home'),
  state: () => invoke('browser:state-get'),
  useCurrentPage: () => invoke('browser:use-current'),
  openExternal: () => invoke('browser:open-external'),
  clearData: () => invoke('browser:clear-data'),
  cookieStatus: () => invoke('browser:cookie-status'),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('browser:state', listener);
    return () => ipcRenderer.removeListener('browser:state', listener);
  }
}));
