const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexusBridge', {
  getServerPort: () => ipcRenderer.invoke('get-server-port'),
  updates: {
    getStatus: () => ipcRenderer.invoke('update:get-status'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    restart: () => ipcRenderer.invoke('update:restart'),
    onEvent: (listener) => {
      if (typeof listener !== 'function') return () => {};
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('update:event', handler);
      return () => ipcRenderer.removeListener('update:event', handler);
    },
  },
});
