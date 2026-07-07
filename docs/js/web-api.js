/**
 * web-api.js — Browser replacement for Electron's window.api (preload bridge)
 *
 * Loaded before app.js. Sets window.api so app.js works identically in both
 * the Electron desktop app and as a GitHub Pages web app.
 *
 * Browser feature notes:
 *  - File System Access API (showOpenFilePicker, showDirectoryPicker):
 *    Chrome 86+, Edge 86+. Falls back to <input type=file> on Firefox/Safari.
 *  - GIF export: encoded in a Web Worker (js/gif-worker.js), gifenc bundled locally.
 *  - Batch PNG export: zips via JSZip (bundled locally), or downloads sequentially.
 *  - Analogue Pocket detection: user picks the SD card folder via directory picker.
 *  - Installable PWA: service worker (sw.js) caches the app shell for offline use.
 */

// ── Service worker (PWA / offline support) ──────────────────────────────────

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// ── GIF encode progress listeners ────────────────────────────────────────────

const _gifProgressCbs = [];
function _emitGifProgress(p) {
  for (const cb of _gifProgressCbs) { try { cb(p); } catch (_) {} }
}

// ── Scale helper (shared with GIF encoding) ─────────────────────────────────

function scaleIndicesWeb(indices, w, h, scale) {
  if (scale === 1) return indices;
  const sw = w * scale, sh = h * scale;
  const out = new Uint8Array(sw * sh);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = indices[y * w + x];
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++)
          out[(y * scale + dy) * sw + (x * scale + dx)] = v;
    }
  return out;
}

// ── Directory scanner for Analogue Pocket detection ─────────────────────────

async function scanDirForSavFiles(dirHandle, volumeName, saves, depth = 0) {
  if (depth > 5) return; // don't recurse forever
  try {
    for await (const [name, handle] of dirHandle) {
      if (handle.kind === 'directory') {
        const lower = name.toLowerCase();
        // Recurse into known Analogue Pocket save directories:
        //  - memories/ + save states/ — AP built-in cores (Memories > Save States UI)
        //  - saves/, gb/, gbc/ etc.   — openFPGA cores
        const scanDirs = [
          'memories', 'save states', 'saves',
          'gb', 'gbc', 'game boy', 'gamegear',
          'analogue.gb', 'analogue.gbc',
        ];
        if (scanDirs.includes(lower)) {
          await scanDirForSavFiles(handle, volumeName, saves, depth + 1);
        }
      } else if (handle.kind === 'file' && ['sav','srm'].includes(name.toLowerCase().split('.').pop())) {
        try {
          const file = await handle.getFile();
          if (file.size === 131072) {
            saves.push({ name, handle, volume: volumeName, path: `${volumeName}/${name}` });
          }
        } catch (_) {}
      }
    }
  } catch (_) {}
}

// ── Download helper ─────────────────────────────────────────────────────────

function triggerDownload(url, filename) {
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── window.api ───────────────────────────────────────────────────────────────

window.api = {

  // ── Open .sav file ─────────────────────────────────────────────────────────
  openSavFile: async () => {
    if ('showOpenFilePicker' in window) {
      try {
        const [handle] = await showOpenFilePicker({
          types: [{ description: 'Game Boy Camera Save', accept: { 'application/octet-stream': ['.sav', '.SAV', '.srm', '.SRM'] } }],
          multiple: false,
        });
        const file = await handle.getFile();
        const buffer = await file.arrayBuffer();
        return {
          buffer,
          name: file.name,
          path: null,
          error: buffer.byteLength !== 131072 ? `Unexpected size: ${buffer.byteLength} bytes (expected 131072)` : null,
        };
      } catch (e) {
        return e.name === 'AbortError' ? null : { error: e.message };
      }
    }

    // Fallback: plain file input (Firefox, Safari)
    return new Promise(resolve => {
      const input = Object.assign(document.createElement('input'), {
        type: 'file', accept: '.sav,.SAV,.srm,.SRM',
      });
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return resolve(null);
        const buffer = await file.arrayBuffer();
        resolve({
          buffer,
          name: file.name,
          path: null,
          error: buffer.byteLength !== 131072 ? `Unexpected size: ${buffer.byteLength} bytes` : null,
        });
      };
      input.click();
    });
  },

  // ── Analogue Pocket SD card detection ──────────────────────────────────────
  // On web: user picks the SD card root via showDirectoryPicker
  detectPocket: async () => {
    if (!('showDirectoryPicker' in window)) {
      return { saves: [], unsupported: true };
    }
    try {
      const root = await showDirectoryPicker({ mode: 'read', startIn: 'desktop' });
      const saves = [];
      await scanDirForSavFiles(root, root.name, saves);
      return { saves };
    } catch (e) {
      return { saves: [] };
    }
  },

  // ── Read a specific file ────────────────────────────────────────────────────
  // saveObj may have a .handle (FileSystemFileHandle) on web, or .path on Electron
  readFile: async (saveObj) => {
    try {
      const file = await saveObj.handle.getFile();
      const buffer = await file.arrayBuffer();
      return { buffer, name: file.name, path: null };
    } catch (e) {
      return { error: e.message };
    }
  },

  // ── Save PNG (single) ───────────────────────────────────────────────────────
  savePng: async (dataUrl, filename) => {
    triggerDownload(dataUrl, filename);
    return filename;
  },

  // ── Save PNG batch (zip) ───────────────────────────────────────────────────
  savePngBatch: async (photos) => {
    try {
      // JSZip bundled locally — works offline
      const { default: JSZip } = await import('./jszip.esm.js');
      const zip = new JSZip();
      for (const { dataUrl, name } of photos) {
        zip.file(name, dataUrl.split(',')[1], { base64: true });
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, 'gbcam-photos.zip');
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return { dir: '.', count: photos.length };
    } catch (_) {
      // Fallback: one-by-one (browsers may block multiple downloads)
      for (const { dataUrl, name } of photos) {
        triggerDownload(dataUrl, name);
        await new Promise(r => setTimeout(r, 150));
      }
      return { dir: '.', count: photos.length };
    }
  },

  // ── Save animated GIF ──────────────────────────────────────────────────────
  // Encoded in a Web Worker so the UI thread stays responsive; falls back to
  // inline encoding if module workers aren't available.
  saveGif: async (options) => {
    const { frames, delay, scale, loop, defaultName } = options;

    let bytes;
    try {
      bytes = await new Promise((resolve, reject) => {
        let worker;
        try {
          worker = new Worker('./js/gif-worker.js', { type: 'module' });
        } catch (e) { return reject(e); }
        worker.onmessage = (e) => {
          const m = e.data || {};
          if (typeof m.progress === 'number') { _emitGifProgress(m.progress); return; }
          worker.terminate();
          if (m.done) resolve(new Uint8Array(m.buffer));
          else reject(new Error(m.error || 'GIF encoding failed'));
        };
        worker.onerror = (e) => {
          worker.terminate();
          reject(new Error(e.message || 'GIF worker failed'));
        };
        worker.postMessage(options);
      });
    } catch (_) {
      // Fallback: encode inline on the main thread
      const w = frames[0].width * scale;
      const h = frames[0].height * scale;
      const { GIFEncoder } = await import('./gifenc.esm.js');
      const gif = GIFEncoder();
      for (let fi = 0; fi < frames.length; fi++) {
        const frame = frames[fi];
        const scaled = scaleIndicesWeb(new Uint8Array(frame.indices), frame.width, frame.height, scale);
        const opts = { palette: frame.palette, delay }; // gifenc: delay in ms
        if (fi === 0 && loop !== 'once') opts.repeat = 0;
        gif.writeFrame(scaled, w, h, opts);
      }
      gif.finish();
      bytes = gif.bytes();
    } finally {
      _emitGifProgress(null);
    }

    const blob = new Blob([bytes], { type: 'image/gif' });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, defaultName || 'gbcam-animation.gif');
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return defaultName;
  },

  // ── GIF encode progress (0–1, or null when finished) ───────────────────────
  onGifProgress: (cb) => { _gifProgressCbs.push(cb); },

  // ── Dropped-file native path (Electron only — no paths on the web) ─────────
  getPathForFile: () => null,

  // ── Fetch JSON (for Lospec palette import) ─────────────────────────────────
  fetchJson: async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  // ── Export raw .sav ────────────────────────────────────────────────────────
  exportSav: async (buffer, defaultName) => {
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url  = URL.createObjectURL(blob);
    triggerDownload(url, defaultName);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return defaultName;
  },

  // ── Save project (.gbcp) ───────────────────────────────────────────────────
  saveProject: async (json, defaultName) => {
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    triggerDownload(url, defaultName);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return defaultName;
  },

  // ── Open project (.gbcp) ───────────────────────────────────────────────────
  openProject: async () => new Promise(resolve => {
    const input = Object.assign(document.createElement('input'), {
      type: 'file', accept: '.gbcp',
    });
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return resolve(null);
      try {
        const json = await file.text();
        resolve({ json, name: file.name });
      } catch (e) {
        resolve({ error: e.message });
      }
    };
    input.click();
  }),

  // ── Stubs for Electron-only features ───────────────────────────────────────
  revealInFinder: () => {},
  onMenuOpenSav:    (cb) => {}, // no native menu bar on web
  onMenuOpenPocket: (cb) => {},
  onMenuExportAll:  (cb) => {},
};
