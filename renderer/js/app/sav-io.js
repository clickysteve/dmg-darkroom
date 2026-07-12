/**
 * sav-io.js — Raw .sav export, image → .sav import (dithering), photo blending
 *
 * Split from app.js. Classic script: shares the global scope with the other
 * app/ files; load order (see index.html) preserves the original execution
 * order and must be kept.
 */

// ── Export: raw .sav file ──────────────────────────────────────────────────

async function exportSav() {
  if (!state.sav) return;
  const defaultName = state.filename || 'GBCAMERA.sav';
  const result = await window.api.exportSav(state.sav.buffer, defaultName);
  if (result) showToast(`Saved: ${result}`);
}

// ── Import: image → .sav slot ───────────────────────────────────────────────
//
// Takes any image, cover-crops it to 128×112, converts to 4 grey levels with
// the chosen dither algorithm (Bayer ordered / Floyd–Steinberg / Atkinson),
// and writes it into a free photo slot — tiles, thumbnail, fresh checksummed
// metadata, and the bank-0 album vector. Export .sav afterwards to keep it.

const _BAYER4 = [
  [ 0,  8,  2, 10],
  [12,  4, 14,  6],
  [ 3, 11,  1,  9],
  [15,  7, 13,  5],
];

const IMPORT_DITHER_KEY = 'gbcam_import_dither';
const IMPORT_DITHERS = [
  ['bayer',    'Bayer (ordered)'],
  ['floyd',    'Floyd–Steinberg'],
  ['atkinson', 'Atkinson'],
];

function getImportDither() {
  try {
    const v = localStorage.getItem(IMPORT_DITHER_KEY);
    return IMPORT_DITHERS.some(([id]) => id === v) ? v : 'bayer';
  } catch (_) { return 'bayer'; }
}

/** Normalised luminance (0..1) with 2–98 percentile auto-contrast stretch. */
function _imageDataToLum01(imageData) {
  const { data, width, height } = imageData;
  const n = width * height;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lum[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
  }
  const sorted = Float32Array.from(lum).sort();
  const lo = sorted[Math.floor(n * 0.02)];
  const hi = sorted[Math.min(n - 1, Math.floor(n * 0.98))];
  const range = Math.max(1e-6, hi - lo);
  for (let i = 0; i < n; i++) {
    lum[i] = Math.min(1, Math.max(0, (lum[i] - lo) / range));
  }
  return lum;
}

/** Error-diffusion to 4 levels. kernel: [dx, dy, weight] entries. */
function _errorDiffuseToIndices(lum, width, height, kernel) {
  const buf = Float32Array.from(lum);
  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const v = Math.min(1, Math.max(0, buf[i]));
      const level = Math.round(v * 3);
      const err = v - level / 3;
      indices[i] = 3 - level; // level 3 = lightest → colour index 0
      for (const [dx, dy, w] of kernel) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < width && ny < height) buf[ny * width + nx] += err * w;
      }
    }
  }
  return indices;
}

/** Convert an ImageData (128×112) to GB Camera pixel indices (0 = lightest … 3 = darkest). */
function ditherImageDataToIndices(imageData, algo = 'bayer') {
  const { width, height } = imageData;
  const lum = _imageDataToLum01(imageData);

  if (algo === 'floyd') {
    return _errorDiffuseToIndices(lum, width, height, [
      [1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16],
    ]);
  }
  if (algo === 'atkinson') {
    // Only 6/8 of the error diffused — the classic Mac look
    return _errorDiffuseToIndices(lum, width, height, [
      [1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8],
    ]);
  }

  // Bayer ordered dithering (default)
  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const t = (_BAYER4[y & 3][x & 3] + 0.5) / 16;
      const q = lum[i] * 3;
      const base = Math.floor(q);
      const level = Math.min(3, base + ((q - base) > t ? 1 : 0));
      indices[i] = 3 - level;
    }
  }
  return indices;
}

/** Draw an image cover-cropped into a 128×112 canvas and return its ImageData. */
function imageToPhotoImageData(img) {
  const W = GBCam.PHOTO_WIDTH, H = GBCam.PHOTO_HEIGHT;
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const scale = Math.max(W / srcW, H / srcH);
  const dw = srcW * scale, dh = srcH * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  return ctx.getImageData(0, 0, W, H);
}

// ── Slot commit helpers (shared by import and blend) ────────────────────────

/**
 * Pick a writable slot: prefer a truly empty one; fall back to a deleted slot
 * (the camera itself would overwrite those) after confirming with the user.
 * Returns the slot index or null when nothing is writable / user declined.
 */
function findWritableSlot() {
  const empty = state.photos.find(p => p.index < GBCam.PHOTO_COUNT && p.isEmpty)?.index;
  if (empty !== undefined) return empty;
  const deleted = state.photos.find(p => p.index < GBCam.PHOTO_COUNT && p.isDeleted)?.index;
  if (deleted === undefined) {
    showToast('No free slots — this save is full');
    return null;
  }
  const ok = window.confirm(
    `No empty slots. Overwrite slot ${String(deleted + 1).padStart(2, '0')}?\n\n` +
    'That slot holds a photo deleted in-camera (currently shown as "recovered"). ' +
    'Writing over it will destroy that photo permanently.'
  );
  return ok ? deleted : null;
}

/** Write pixel indices into a slot (undoable), update state, repaint, toast. */
function commitPixelsToSlot(slot, indices, label) {
  // Snapshot the SRAM so the operation is undoable (Cmd/Ctrl+Z)
  pushUndo({ includeSav: true });

  // Next free album position; writePhotoToSlot maintains metadata + vector checksums
  const usedPositions = state.photos.filter(p => p.index !== slot).map(p => p.albumPos).filter(v => v !== null && v !== undefined);
  const albumPos = usedPositions.length ? Math.max(...usedPositions) + 1 : 0;

  GBCam.writePhotoToSlot(state.sav, slot, indices, { albumPos });

  const photo = state.photos.find(p => p.index === slot);
  photo.pixels    = indices;
  photo.isEmpty   = false;
  photo.isDeleted = false;
  photo.albumPos  = albumPos;
  state.activeCount++;
  clearThumbCache(slot);
  renderGrid();
  showToast(`${label} slot ${String(slot + 1).padStart(2, '0')} — use Export .sav to keep it`);
}

async function importImageToSlot(file, algo = getImportDither()) {
  if (!state.sav) { showToast('Load a .sav first'); return; }
  const slot = findWritableSlot();
  if (slot === null) return;

  let img;
  const url = URL.createObjectURL(file);
  try {
    img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload  = () => resolve(image);
      image.onerror = () => reject(new Error('Could not read image'));
      image.src = url;
    });
  } catch (e) {
    URL.revokeObjectURL(url);
    showToast(`⚠ ${e.message}`);
    return;
  }
  URL.revokeObjectURL(url);

  const indices = ditherImageDataToIndices(imageToPhotoImageData(img), algo);
  commitPixelsToSlot(slot, indices, 'Imported into');
}

// ── Anchored action popover (shared by import-dither and blend menus) ───────

function openActionPopover(anchorEl, items, onPick) {
  document.querySelector('.action-popover')?.remove();
  const pop = document.createElement('div');
  // NOTE: deliberately NOT .overflow-dropdown — setupOverflowMenus() force-hides
  // that class on any document click. .action-popover carries its own styling.
  pop.className = 'action-popover';
  for (const [id, label, note] of items) {
    const b = document.createElement('button');
    b.className = 'overflow-item';
    b.textContent = label + (note ? ` ${note}` : '');
    b.addEventListener('click', () => { pop.remove(); onPick(id); });
    pop.appendChild(b);
  }
  document.body.appendChild(pop);
  // Anchor near the trigger; fall back to top-right if it's collapsed/hidden
  const r = anchorEl?.offsetParent ? anchorEl.getBoundingClientRect() : null;
  pop.style.top  = `${r ? r.bottom + 4 : 96}px`;
  pop.style.left = `${r ? Math.min(r.left, window.innerWidth - pop.offsetWidth - 8) : window.innerWidth - pop.offsetWidth - 16}px`;
  const dismiss = (e) => {
    if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', dismiss); }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}

function setupImageImport() {
  const btn = document.getElementById('btn-import-image');
  if (!btn) return;
  const input = Object.assign(document.createElement('input'), {
    type: 'file',
    accept: 'image/*',
  });
  let chosenAlgo = getImportDither();
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (file) await importImageToSlot(file, chosenAlgo);
  });
  btn.addEventListener('click', () => {
    const current = getImportDither();
    openActionPopover(btn,
      IMPORT_DITHERS.map(([id, label]) => [id, label, id === current ? '✓' : '']),
      (algo) => {
        try { localStorage.setItem(IMPORT_DITHER_KEY, algo); } catch (_) {}
        chosenAlgo = algo;
        input.click();
      });
  });
}

// ── Blend: double exposure of two photos into a new slot ────────────────────
//
// Like the camera's own montage tricks: combine two photos' 2-bit indices.
// Indices are darkness (0 = lightest, 3 = darkest), so darken = max.

const BLEND_MODES = [
  ['average',    'Average (double exposure)'],
  ['darken',     'Darken'],
  ['lighten',    'Lighten'],
  ['difference', 'Difference'],
];

function blendIndices(a, b, mode, width) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    if (mode === 'darken')          out[i] = Math.max(a[i], b[i]);
    else if (mode === 'lighten')    out[i] = Math.min(a[i], b[i]);
    else if (mode === 'difference') out[i] = Math.abs(a[i] - b[i]);
    else {
      // Average with checkerboard dithering on the half-steps
      const v = a[i] + b[i];
      const x = i % width, y = (i - x) / width;
      out[i] = (v >> 1) + ((v & 1) && ((x + y) & 1) ? 1 : 0);
    }
  }
  return out;
}

function blendSelectedPhotos(mode) {
  const sel = [...state.selectedPhotos];
  const a = state.photos[sel[0]], b = state.photos[sel[1]];
  if (!a?.pixels || !b?.pixels) { showToast('Both photos must contain an image'); return; }
  const slot = findWritableSlot();
  if (slot === null) return;
  const indices = blendIndices(a.pixels, b.pixels, mode, GBCam.PHOTO_WIDTH);
  commitPixelsToSlot(slot, indices, 'Blended into');
}

function setupBlend() {
  const btn = document.getElementById('btn-blend');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!state.sav) { showToast('Load a .sav first'); return; }
    if (state.selectedPhotos.size !== 2) {
      showToast('Select exactly 2 photos to blend (Cmd/Ctrl-click)');
      return;
    }
    openActionPopover(btn, BLEND_MODES, (mode) => blendSelectedPhotos(mode));
  });
}
