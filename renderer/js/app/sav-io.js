/**
 * sav-io.js — Raw .sav export, image → .sav import (dithering)
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
// ordered (Bayer 4×4) dithering, and writes it into the first empty photo slot
// — tiles, thumbnail, metadata (copied from a donor slot so checksums stay
// consistent) and the bank-0 album vector. Export .sav afterwards to keep it.

const _BAYER4 = [
  [ 0,  8,  2, 10],
  [12,  4, 14,  6],
  [ 3, 11,  1,  9],
  [15,  7, 13,  5],
];

/** Convert an ImageData (128×112) to GB Camera pixel indices (0 = lightest … 3 = darkest). */
function ditherImageDataToIndices(imageData) {
  const { data, width, height } = imageData;
  const n = width * height;

  // Luminance
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lum[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
  }

  // Auto-contrast: stretch 2nd–98th percentile to full range
  const sorted = Float32Array.from(lum).sort();
  const lo = sorted[Math.floor(n * 0.02)];
  const hi = sorted[Math.min(n - 1, Math.floor(n * 0.98))];
  const range = Math.max(1e-6, hi - lo);

  const indices = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const v = Math.min(1, Math.max(0, (lum[i] - lo) / range));
      // Ordered dithering between the two adjacent quantisation levels
      const t = (_BAYER4[y & 3][x & 3] + 0.5) / 16;
      const q = v * 3;
      const base = Math.floor(q);
      const level = Math.min(3, base + ((q - base) > t ? 1 : 0));
      indices[i] = 3 - level; // level 3 = lightest → colour index 0
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

async function importImageToSlot(file) {
  if (!state.sav) { showToast('Load a .sav first'); return; }

  // Real camera slots only (0–29); the last-seen pseudo-slot can't be written.
  // Prefer a truly empty slot; fall back to a deleted slot (the camera itself
  // would overwrite those) after confirming, since that data is recoverable.
  let slot = state.photos.find(p => p.index < GBCam.PHOTO_COUNT && p.isEmpty)?.index;
  if (slot === undefined) {
    const deleted = state.photos.find(p => p.index < GBCam.PHOTO_COUNT && p.isDeleted)?.index;
    if (deleted === undefined) {
      showToast('No free slots — this save is full');
      return;
    }
    const ok = window.confirm(
      `No empty slots. Overwrite slot ${String(deleted + 1).padStart(2, '0')}?\n\n` +
      'That slot holds a photo deleted in-camera (currently shown as "recovered"). ' +
      'Importing over it will destroy that photo permanently.'
    );
    if (!ok) return;
    slot = deleted;
  }

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

  const indices = ditherImageDataToIndices(imageToPhotoImageData(img));

  // Snapshot the SRAM so the import is undoable (Cmd/Ctrl+Z)
  pushUndo({ includeSav: true });

  // Next free album position; writePhotoToSlot maintains metadata + vector checksums
  const usedPositions = state.photos.filter(p => p.index !== slot).map(p => p.albumPos).filter(v => v !== null && v !== undefined);
  const albumPos = usedPositions.length ? Math.max(...usedPositions) + 1 : 0;

  GBCam.writePhotoToSlot(state.sav, slot, indices, { albumPos });

  // Update in-memory photo + repaint
  const photo = state.photos.find(p => p.index === slot);
  photo.pixels    = indices;
  photo.isEmpty   = false;
  photo.isDeleted = false;
  photo.albumPos  = albumPos;
  state.activeCount++;
  clearThumbCache(slot);
  renderGrid();
  showToast(`Imported into slot ${String(slot + 1).padStart(2, '0')} — use Export .sav to keep it`);
}

function setupImageImport() {
  const btn = document.getElementById('btn-import-image');
  if (!btn) return;
  const input = Object.assign(document.createElement('input'), {
    type: 'file',
    accept: 'image/*',
  });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (file) await importImageToSlot(file);
  });
  btn.addEventListener('click', () => input.click());
}

