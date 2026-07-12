/**
 * export-png.js — Export scale/format controls, single + batch PNG export
 *
 * Split from app.js. Classic script: shares the global scope with the other
 * app/ files; load order (see index.html) preserves the original execution
 * order and must be kept.
 */

// ── Export scale / format controls ──────────────────────────────────────────

function getExportDimensions() {
  // Returns { width, height } for the current export scale setting
  if (state.exportScale === 'custom') {
    const w = parseInt(document.getElementById('custom-width')?.value) || 512;
    const h = Math.round(w * (GBCam.PHOTO_HEIGHT / GBCam.PHOTO_WIDTH));
    return { width: w, height: h };
  }
  return {
    width:  GBCam.PHOTO_WIDTH  * state.exportScale,
    height: GBCam.PHOTO_HEIGHT * state.exportScale,
  };
}

function setExportScale(scale) {
  state.exportScale = scale;
  const isCustom = scale === 'custom';

  document.querySelectorAll('.scale-btn').forEach(btn => {
    const val = btn.dataset.scale === 'custom' ? 'custom' : parseInt(btn.dataset.scale);
    btn.classList.toggle('active', val === scale);
  });

  const wrap = document.getElementById('custom-size-wrap');
  if (wrap) wrap.style.display = isCustom ? 'block' : 'none';

  if (isCustom) {
    // Trigger initial display update
    updateCustomSizeDisplay();
  }
}

function updateCustomSizeDisplay() {
  const input = document.getElementById('custom-width');
  const display = document.getElementById('custom-size-display');
  if (!input || !display) return;
  const w = parseInt(input.value) || 512;
  const h = Math.round(w * (GBCam.PHOTO_HEIGHT / GBCam.PHOTO_WIDTH));
  display.textContent = `${w}×${h}`;
}

function setExportFormat(fmt) {
  state.exportFormat = fmt;
  document.querySelectorAll('.fmt-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.fmt === fmt);
  });
  if (fmt === 'gif') {
    enterGifMode();
  } else {
    exitGifMode();
  }
}

// ── Export: single PNG ───────────────────────────────────────────────────────

async function exportSinglePng() {
  const index = state.selectedIndex;
  if (index === null) return;
  const photo = state.photos[index];
  if (!photo || photo.isEmpty) return;

  const scale = state.exportScale === 'custom'
    ? Math.max(1, Math.round((parseInt(document.getElementById('custom-width')?.value) || 512) / GBCam.PHOTO_WIDTH))
    : state.exportScale;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const effExp = getEffectiveSettings(index);
  renderPhotoComplete(ctx, photo, effExp, scale, index, { forExport: true });

  const dataUrl = canvas.toDataURL('image/png');
  const filterTag = effExp.activeFilters.size > 0 ? `_${[...effExp.activeFilters].join('+')}` : '';
  const scaleTag = state.exportScale === 'custom' ? `${getExportDimensions().width}px` : `${state.exportScale}x`;
  const defaultName = `gbcam_${String(index + 1).padStart(2, '0')}_${effExp.palette.id}_${scaleTag}${filterTag}.png`;

  const saved = await window.api.savePng(dataUrl, defaultName);
  if (saved) showToast(`Saved: ${typeof saved === 'string' ? saved.split('/').pop() : saved}`);
}

// ── Export: batch PNG ────────────────────────────────────────────────────────

async function exportBatchPng() {
  const photos = state.photos.filter(p => !p.isEmpty);
  if (photos.length === 0) { showToast('No photos to export'); return; }

  const { width, height } = getExportDimensions();
  const scaleTag = state.exportScale === 'custom' ? `${width}px` : `${state.exportScale}x`;
  const batch = [];

  const batchScale = state.exportScale === 'custom' ? Math.max(1, Math.round(width / GBCam.PHOTO_WIDTH)) : state.exportScale;

  for (const photo of photos) {
    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d', { willReadFrequently: true });
    const effBatch = getEffectiveSettings(photo.index);
    renderPhotoComplete(ctx, photo, effBatch, batchScale, photo.index, { forExport: true });
    const dataUrl = canvas.toDataURL('image/png');
    const batchFilterTag = effBatch.activeFilters.size > 0 ? `_${[...effBatch.activeFilters].join('+')}` : '';
    const name = `gbcam_${String(photo.index + 1).padStart(2, '0')}_${effBatch.palette.id}_${scaleTag}${batchFilterTag}.png`;
    batch.push({ dataUrl, name });
  }

  const result = await window.api.savePngBatch(batch);
  if (result) showToast(`Exported ${result.count} photos`);
}

