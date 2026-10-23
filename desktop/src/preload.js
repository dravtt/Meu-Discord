const { contextBridge, ipcRenderer } = require('electron');

/**
 * The only native surface the web app sees. Every call goes through a fixed channel name that
 * the main process validates, so the page cannot reach arbitrary IPC.
 */
contextBridge.exposeInMainWorld('nexoNative', {
  apiBase: '',
  platform: process.platform,
  notify: (n) => ipcRenderer.send('nexo:notify', { title: String(n.title), body: String(n.body), channelId: String(n.channelId) }),
  setBadge: (count) => ipcRenderer.send('nexo:badge', Number(count) || 0),
  onNotificationClick: (cb) => ipcRenderer.on('nexo:notification-click', (_e, channelId) => cb(channelId)),
  getSettings: () => ipcRenderer.invoke('nexo:get-settings'),
  setSetting: (key, value) => ipcRenderer.invoke('nexo:set-setting', key, value),
  getScreenSources: () => ipcRenderer.invoke('nexo:screen-sources'),
  pickScreenSource: (id, audio) => ipcRenderer.invoke('nexo:screen-pick', String(id), !!audio),
});
