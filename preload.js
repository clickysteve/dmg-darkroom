const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // File I/O
  openSavFile: () => ipcRenderer.invoke('open-sav-file'),
  detectPocket: () => ipcRenderer.invoke('detect-pocket'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  // Resolve a dropped File object to its filesystem path.
  // (File.path was removed in Electron 32 — webUtils is the supported way.)
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || null; } catch (_) { return null; }
  },

  // Export
  savePng: (dataUrl, defaultName) => ipcRenderer.invoke('save-png', dataUrl, defaultName),
  savePngBatch: (photos) => ipcRenderer.invoke('save-png-batch', photos),
  saveGif: (options) => ipcRenderer.invoke('save-gif', options),
  exportSav: (buffer, defaultName) => ipcRenderer.invoke('export-sav', { buffer, defaultName }),
  saveProject: (json, defaultName) => ipcRenderer.invoke('save-project', { json, defaultName }),
  openProject: () => ipcRenderer.invoke('open-project'),

  // GIF encode progress (0–1, or null when finished)
  onGifProgress: (cb) => ipcRenderer.on('gif-progress', (_event, p) => cb(p)),

  // Shell
  revealInFinder: (filePath) => ipcRenderer.invoke('reveal-in-finder', filePath),

  // Network (bypasses renderer CSP/CORS — main process enforces a host allow-list)
  fetchJson: (url) => ipcRenderer.invoke('fetch-json', url),

  // Menu events (main → renderer) — wrap cb so the IpcRendererEvent isn't leaked
  onMenuOpenSav: (cb) => ipcRenderer.on('menu-open-sav', () => cb()),
  onMenuOpenPocket: (cb) => ipcRenderer.on('menu-open-pocket', () => cb()),
  onMenuExportAll: (cb) => ipcRenderer.on('menu-export-all', () => cb()),
});
