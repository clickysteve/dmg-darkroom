/**
 * presentation.js — Fullscreen presentation, contact sheet, frame duplication
 *
 * Split from app.js. Classic script: shares the global scope with the other
 * app/ files; load order (see index.html) preserves the original execution
 * order and must be kept.
 */

// ── Fullscreen presentation mode ──────────────────────────────────────────────

let _presIndex = null;

function openPresentation(index) {
  const filled = state.photos.map((p, i) => ({ p, i })).filter(x => !x.p.isEmpty);
  if (filled.length === 0) return;

  _presIndex = filled.find(x => x.i === index)?.i ?? filled[0].i;
  state.presentationMode = true;
  dom.presentationOverlay?.classList.remove('hidden');
  renderPresentation();
}

function closePresentation() {
  state.presentationMode = false;
  dom.presentationOverlay?.classList.add('hidden');
  _presIndex = null;
}

function presentationStep(dir) {
  const filled = state.photos.map((p, i) => i).filter(i => !state.photos[i].isEmpty);
  if (filled.length === 0) return;
  const cur = filled.indexOf(_presIndex);
  const next = (cur + dir + filled.length) % filled.length;
  _presIndex = filled[next];
  renderPresentation();
}

function renderPresentation() {
  if (_presIndex === null || !dom.presCanvas) return;
  const photo = state.photos[_presIndex];
  if (!photo || photo.isEmpty) return;

  // Fit photo to the viewport (with generous padding)
  const vw = window.innerWidth  - 160;
  const vh = window.innerHeight - 120;
  const t  = getTransform(_presIndex);
  const rotated = (t.rotate === 90 || t.rotate === 270);
  const srcW = rotated ? GBCam.PHOTO_HEIGHT : GBCam.PHOTO_WIDTH;
  const srcH = rotated ? GBCam.PHOTO_WIDTH  : GBCam.PHOTO_HEIGHT;
  const scale = Math.max(1, Math.floor(Math.min(vw / srcW, vh / srcH)));

  const ctx = dom.presCanvas.getContext('2d');
  const effPres = getEffectiveSettings(_presIndex);
  renderPhotoComplete(ctx, photo, effPres, scale, _presIndex);

  const filled = state.photos.filter(p => !p.isEmpty).length;
  const pos    = state.photos.slice(0, _presIndex + 1).filter(p => !p.isEmpty).length;
  if (dom.presLabel) dom.presLabel.textContent = `Photo ${_presIndex + 1}  ·  ${pos} / ${filled}`;
}

// ── Contact sheet export ──────────────────────────────────────────────────────

async function exportContactSheet() {
  const filled = state.photos.filter(p => !p.isEmpty);
  if (filled.length === 0) { showToast('No photos to export'); return; }

  // Use 160×144 cells so bordered and non-bordered photos share the same grid.
  // Non-bordered photos are centred (black fill fills the border area).
  const SHEET_SCALE = 4;
  const cols  = Math.min(filled.length, 5);
  const rows  = Math.ceil(filled.length / cols);
  const CELL  = 160 * SHEET_SCALE;   // 640 px wide per cell
  const CELLH = 144 * SHEET_SCALE;   // 576 px tall
  const GAP   = 8;
  const PAD   = 16;
  const LABEL = 18; // px for photo number below each cell

  const sheetW = PAD * 2 + cols * CELL + (cols - 1) * GAP;
  const sheetH = PAD * 2 + rows * (CELLH + LABEL + GAP) - GAP;

  const sheet  = document.createElement('canvas');
  sheet.width  = sheetW;
  sheet.height = sheetH;
  const sc     = sheet.getContext('2d');

  // Background
  sc.fillStyle = '#111113';
  sc.fillRect(0, 0, sheetW, sheetH);

  for (let i = 0; i < filled.length; i++) {
    const photo = filled[i];
    const col   = i % cols;
    const row   = Math.floor(i / cols);
    const x     = PAD + col * (CELL + GAP);
    const y     = PAD + row * (CELLH + LABEL + GAP);

    // Render photo (with border if any) + filters + tone
    const tmp  = document.createElement('canvas');
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    const effSheet = getEffectiveSettings(photo.index);
    renderPhotoComplete(tctx, photo, effSheet, SHEET_SCALE, photo.index, { forExport: true });

    // Black fill for cell, then centre the rendered photo (non-bordered = centred in 160×144 slot)
    sc.fillStyle = '#000';
    sc.fillRect(x, y, CELL, CELLH);
    const offX = Math.floor((CELL  - tmp.width)  / 2);
    const offY = Math.floor((CELLH - tmp.height) / 2);
    sc.drawImage(tmp, x + offX, y + offY);

    // Photo number label
    sc.fillStyle = 'rgba(255,255,255,0.45)';
    sc.font      = '11px ui-monospace, monospace';
    sc.textAlign = 'center';
    sc.fillText(`${photo.index + 1}`, x + CELL / 2, y + CELLH + 13);
  }

  const dataUrl = sheet.toDataURL('image/png');
  const name    = `gbcam_contact_${state.palette.id}.png`;

  if (window.api?.savePng) {
    const saved = await window.api.savePng(dataUrl, name);
    if (saved) showToast(`Contact sheet saved`);
  } else {
    const a = Object.assign(document.createElement('a'), { href: dataUrl, download: name });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    showToast('Contact sheet downloaded');
  }
}

// ── Frame duplication ─────────────────────────────────────────────────────────

function duplicateGifFrame(orderIdx) {
  const frame = state.gifFrameOrder[orderIdx];
  if (!frame) return;
  // Insert a copy immediately after
  state.gifFrameOrder.splice(orderIdx + 1, 0, { ...frame });
  updateGifFrameNumbers();
  renderGifFrameStrip();
  updateGifPreview();
}

// Repaint all views after a transform action
function _repaintAfterTransform(index) {
  repaintGridSlot(index);
  if (state.viewMode === 'solo') renderSoloView(index);
  if (state.lightboxOpen) renderLightbox(index);
}

