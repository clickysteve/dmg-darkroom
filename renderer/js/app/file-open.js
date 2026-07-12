/**
 * file-open.js — Analogue Pocket modal, drag & drop
 *
 * Split from app.js. Classic script: shares the global scope with the other
 * app/ files; load order (see index.html) preserves the original execution
 * order and must be kept.
 */

// ── Analogue Pocket modal ────────────────────────────────────────────────────

let selectedPocketSave = null;

async function openPocketModal() {
  dom.pocketModal.classList.remove('hidden');
  dom.pocketSaveList.innerHTML = '<p style="color:var(--text-3);font-size:12px;">Scanning for Analogue Pocket SD card…</p>';
  dom.pocketConfirm.disabled = true;
  selectedPocketSave = null;

  const { saves } = await window.api.detectPocket();
  dom.pocketSaveList.innerHTML = '';

  if (saves.length === 0) {
    dom.pocketSaveList.innerHTML =
      '<p style="color:var(--text-3);font-size:12px;line-height:1.5;">' +
      'No camera saves found. Make sure your Analogue Pocket SD card is inserted, ' +
      'and that you have run the camera app at least once.</p>';
    return;
  }

  // Web version: file handles but no previewPixels — decode client-side via GBCam
  for (const save of saves) {
    if (!save.previewPixels && save.handle) {
      try {
        const file = await save.handle.getFile();
        const buf  = new Uint8Array(await file.arrayBuffer());
        save.previewPixels = GBCam.decodeFirstPhoto(buf);
      } catch (_) {}
    }
  }

  const previewPalette = PALETTES.dmg;

  for (const save of saves) {
    const item = document.createElement('div');
    item.className = 'save-item';

    // Left: preview thumbnail
    const previewWrap = document.createElement('div');
    previewWrap.className = 'save-preview-wrap';

    if (save.previewPixels) {
      const canvas = document.createElement('canvas');
      canvas.width  = GBCam.PHOTO_WIDTH;
      canvas.height = GBCam.PHOTO_HEIGHT;
      canvas.className = 'save-preview';
      const ctx = canvas.getContext('2d');
      const pixels = save.previewPixels instanceof Uint8Array
        ? save.previewPixels
        : new Uint8Array(save.previewPixels);
      GBCam.renderToCanvas(ctx, pixels, previewPalette, 1);
      previewWrap.appendChild(canvas);
    } else {
      const ph = document.createElement('div');
      ph.className = 'save-preview-empty';
      ph.textContent = '?';
      previewWrap.appendChild(ph);
    }

    // Right: filename + path
    const info = document.createElement('div');
    info.className = 'save-info';
    info.innerHTML =
      `<span class="save-name">${save.name}</span>` +
      `<span class="save-path">📼 ${save.volume} › ${save.path.split('/').slice(-2).join('/')}</span>`;

    item.appendChild(previewWrap);
    item.appendChild(info);

    item.addEventListener('click', () => {
      dom.pocketSaveList.querySelectorAll('.save-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      selectedPocketSave = save;
      dom.pocketConfirm.disabled = false;
    });
    dom.pocketSaveList.appendChild(item);
  }
}

function closePocketModal() {
  dom.pocketModal.classList.add('hidden');
}

async function confirmPocketOpen() {
  if (!selectedPocketSave) return;
  closePocketModal();
  // Pass the whole save object — Electron uses .path, web uses .handle
  const result = await window.api.readFile(selectedPocketSave);
  await loadSavFile(result);
}

// ── Drag & drop ─────────────────────────────────────────────────────────────

function setupDragDrop() {
  const overlay = dom.dropOverlay;

  document.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    overlay?.classList.remove('hidden');
  });

  document.addEventListener('dragleave', e => {
    if (!e.relatedTarget) overlay?.classList.add('hidden');
  });

  document.addEventListener('drop', async e => {
    e.preventDefault();
    overlay?.classList.add('hidden');
    const file = e.dataTransfer.files[0];
    if (!file) return;

    // Electron: resolve the dropped File to a native path (File.path was
    // removed in Electron 32; webUtils.getPathForFile is the supported API).
    const nativePath = window.api?.getPathForFile ? window.api.getPathForFile(file) : (file.path || null);
    if (window.api?.readFile && nativePath) {
      // Electron: use native path for proper size validation in main process
      const result = await window.api.readFile(nativePath);
      await loadSavFile(result);
    } else {
      // Web / fallback
      const buffer = await file.arrayBuffer();
      await loadSavFile({
        buffer,
        name: file.name,
        path: null,
        error: buffer.byteLength !== 131072
          ? `Unexpected file size: ${buffer.byteLength} bytes (expected 131072 for this save format).`
          : null,
      });
    }
  });
}

