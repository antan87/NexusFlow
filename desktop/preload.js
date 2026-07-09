const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexusBridge', {
  getServerPort: () => ipcRenderer.invoke('get-server-port')
});
