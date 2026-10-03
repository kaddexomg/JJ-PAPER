// Preload script seguro para JJ Paper Desktop
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('JJ_DESKTOP', {
  platform: process.platform,
  version: '2.0.0',
  isDesktopApp: true
});
