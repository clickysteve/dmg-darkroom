/**
 * grid-views.js — Save loading, transforms, thumbnail cache, grid, repaints, solo view, lightbox
 *
 * Split from app.js. Classic script: shares the global scope with the other
 * app/ files; load order (see index.html) preserves the original execution
 * order and must be kept.
 */

// ── Load SAV ───────────────────────────────────────────────────────────────

async function loadSavFile(result) {
  if (!result || result.error) {
    if (result?.error) showToast(`⚠ ${result.error}`);
    return;
  }

  const { buffer, name, path: filePath } = result;
  const { photos, activeCount, deletedCount, lastSeen, sav } = GBCam.parseSav(buffer);

  state.sav = sav;
  state.photos = photos;
  // Hidden "last seen" working image from bank 0 — shown as an extra pseudo-slot
  if (lastSeen) {
    state.photos.push({ index: 30, pixels: lastSeen, isEmpty: false, isDeleted: false, albumPos: null, isLastSeen: true });
  }
  state.activeCount = activeCount;
  state.filename = name;
  state.filePath = filePath || null;
  state.selectedIndex = null;
  state.gifMode = false;
  state.gifSelection.clear();
  state.photoTransforms = {}; // reset transforms on new file load
  state.photoSettings   = {}; // reset per-photo overrides on new file load
  clearThumbCache();
  if (filePath) saveLastSavPath(filePath);

  renderGrid();
  showMainView();
  updateExportSelectedBtn();
  const extras = [];
  if (deletedCount) extras.push(`${deletedCount} deleted recovered`);
  if (lastSeen)     extras.push('last-seen image');
  setStatus(`${name} — ${activeCount} photo${activeCount !== 1 ? 's' : ''} found${extras.length ? ` (+ ${extras.join(', ')})` : ''}`, true);
}

// ── Photo transforms ────────────────────────────────────────────────────────

/** Get (or default-initialise) the transform for a photo index */
function getTransform(idx) {
  if (!state.photoTransforms[idx]) {
    state.photoTransforms[idx] = { rotate: 0, flipH: false, flipV: false };
  }
  return state.photoTransforms[idx];
}

function hasTransform(idx) {
  const t = state.photoTransforms[idx];
  return t && (t.rotate !== 0 || t.flipH || t.flipV);
}

/**
 * Render a photo onto ctx with transform applied.
 * Adjusts ctx.canvas dimensions to match the post-rotation output size.
 */
function renderPhotoWithTransform(ctx, photo, palette, scale, idx) {
  const t  = getTransform(idx);
  const sw = GBCam.PHOTO_WIDTH  * scale;
  const sh = GBCam.PHOTO_HEIGHT * scale;

  if (!t.rotate && !t.flipH && !t.flipV) {
    ctx.canvas.width  = sw;
    ctx.canvas.height = sh;
    GBCam.renderToCanvas(ctx, photo.pixels, palette, scale);
    return;
  }

  const rotated = (t.rotate === 90 || t.rotate === 270);
  const dw = rotated ? sh : sw;
  const dh = rotated ? sw : sh;

  const tmp = Object.assign(document.createElement('canvas'), { width: sw, height: sh });
  GBCam.renderToCanvas(tmp.getContext('2d'), photo.pixels, palette, scale);

  ctx.canvas.width  = dw;
  ctx.canvas.height = dh;
  ctx.save();
  ctx.translate(dw / 2, dh / 2);
  if (t.flipH) ctx.scale(-1,  1);
  if (t.flipV) ctx.scale( 1, -1);
  ctx.rotate(t.rotate * Math.PI / 180);
  ctx.drawImage(tmp, -sw / 2, -sh / 2);
  ctx.restore();
}

function applyTransformAction(idx, action) {
  const t = getTransform(idx);
  if (action === 'rotate-cw')  { t.rotate = (t.rotate + 90)  % 360; }
  if (action === 'rotate-ccw') { t.rotate = (t.rotate + 270) % 360; }
  if (action === 'flip-h')     { t.flipH = !t.flipH; }
  if (action === 'flip-v')     { t.flipV = !t.flipV; }
  if (action === 'reset-transform') { t.rotate = 0; t.flipH = false; t.flipV = false; }
}

// ── Views ───────────────────────────────────────────────────────────────────

function showMainView() {
  dom.welcome.classList.add('hidden');
  dom.main.style.display = 'flex';
  // Reveal file-only titlebar buttons (Export .sav, Save Project)
  dom.app.classList.add('has-file');
}

function resetToWelcome() {
  // Clear loaded file state
  state.sav = null;
  state.photos = [];
  state.activeCount = 0;
  state.filename = null;
  state.filePath = null;
  state.selectedIndex = null;
  state.photoSettings = {};
  state.gifMode = false;
  state.gifSelection = new Set();
  state.gifFrameOrder = [];
  state.lightboxOpen = false;
  state.viewMode = 'grid';
  clearThumbCache();
  // Return to welcome screen
  dom.main.style.display = 'none';
  dom.welcome.classList.remove('hidden');
  dom.app.classList.remove('has-file');
  // Clear grid
  if (dom.photoGrid) dom.photoGrid.innerHTML = '';
}

// ── Thumbnail render cache ──────────────────────────────────────────────────
//
// Grid repaints used to re-run the full composite → filters → tone pipeline
// for all 30 thumbnails on every unrelated change. Cache the finished raster
// per photo, keyed by a signature of everything that affects the output, and
// only re-render when the signature changes.

const _thumbCache = new Map(); // index → { sig, canvas }

function clearThumbCache(index) {
  if (index === undefined) _thumbCache.clear();
  else _thumbCache.delete(index);
}

function _thumbSignature(eff, idx) {
  return JSON.stringify([
    THUMB_SCALE,
    eff.palette?.id, eff.palette?.colors,
    [...eff.activeFilters].sort(),
    eff.filterParams, eff.filterIntensity, eff.filterVariant,
    eff.brightness, eff.contrast, eff.toneIntensity,
    eff.shadowColor, eff.highlightColor, eff.toneBalance,
    eff.borderId, eff.borderEnabled, eff.filterScope,
    state.photoTransforms[idx] || null,
    state.filterOrder, state.sectionEnabled, state.effectsPreviewMode,
  ]);
}

/** Render a photo thumbnail into `canvas`, reusing the cached raster when nothing changed. */
function renderThumbCached(canvas, photo, eff, idx) {
  const sig = _thumbSignature(eff, idx);
  let entry = _thumbCache.get(idx);

  if (!entry || entry.sig !== sig) {
    const hasBorder = eff.borderEnabled && eff.borderId;
    const off = document.createElement('canvas');
    off.width  = (hasBorder ? 160 : GBCam.PHOTO_WIDTH)  * THUMB_SCALE;
    off.height = (hasBorder ? 144 : GBCam.PHOTO_HEIGHT) * THUMB_SCALE;
    const offCtx = off.getContext('2d', { willReadFrequently: true });
    renderPhotoComplete(offCtx, photo, eff, THUMB_SCALE, idx, { thumbMode: true });
    entry = { sig, canvas: off };
    _thumbCache.set(idx, entry);
  }

  const src = entry.canvas;
  if (canvas.width !== src.width || canvas.height !== src.height) {
    canvas.width  = src.width;
    canvas.height = src.height;
  }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0);
}

// ── Grid ────────────────────────────────────────────────────────────────────

/** Display ordering: album order (from the bank-0 vector) first, then
 *  recovered deleted photos, then the last-seen image, then empty slots. */
function gridDisplayRank(p) {
  if (p.isLastSeen) return 2000;
  if (p.isEmpty)    return 3000 + p.index;
  if (p.isDeleted)  return 1000 + p.index;
  return (p.albumPos !== null && p.albumPos !== undefined) ? p.albumPos : 500 + p.index;
}

function renderGrid() {
  dom.photoGrid.innerHTML = '';

  const displayPhotos = [...state.photos].sort((a, b) => gridDisplayRank(a) - gridDisplayRank(b));

  for (const photo of displayPhotos) {
    const slot = document.createElement('div');
    slot.className = 'photo-slot' + (photo.isEmpty ? ' empty' : '') + (photo.isDeleted ? ' deleted' : '');
    slot.dataset.index = photo.index;

    // Slot number badge
    const num = document.createElement('span');
    num.className = 'slot-num';
    if (photo.isLastSeen) {
      num.textContent = 'LS';
      num.title = 'Hidden "last seen" image recovered from the start of SRAM';
    } else {
      num.textContent = String(photo.index + 1).padStart(2, '0');
    }
    slot.appendChild(num);

    if (photo.isDeleted) {
      const flag = document.createElement('span');
      flag.className = 'slot-flag';
      flag.textContent = 'recovered';
      flag.title = 'Deleted in-camera, but the photo data is still intact';
      slot.appendChild(flag);
    }

    if (photo.isEmpty) {
      const placeholder = document.createElement('div');
      placeholder.className = 'empty-placeholder';
      placeholder.textContent = '—';
      slot.appendChild(placeholder);
    } else {
      // Canvas thumbnail — rendered at THUMB_SCALE (4×) for filter clarity
      const canvas = document.createElement('canvas');
      const effThumb = getEffectiveSettings(photo.index);
      renderThumbCached(canvas, photo, effThumb, photo.index);
      slot.appendChild(canvas);

      // GIF selection (invisible div for event delegation; frame number via data attr)
      const check = document.createElement('div');
      check.className = 'gif-check';
      check.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleGifSelection(photo.index, slot);
      });
      slot.appendChild(check);

      slot.addEventListener('click', (e) => selectPhoto(photo.index, e));
      slot.addEventListener('dblclick', (e) => {
        selectPhoto(photo.index, e);
        enterSoloMode();
      });
    }

    dom.photoGrid.appendChild(slot);
  }

  // Apply selected state
  if (state.selectedIndex !== null) {
    const el = dom.photoGrid.querySelector(`[data-index="${state.selectedIndex}"]`);
    if (el) el.classList.add('selected');
  }

  // Apply multi-selected state
  for (const idx of state.selectedPhotos) {
    if (state.selectedPhotos.size > 1) {
      const el = dom.photoGrid.querySelector(`[data-index="${idx}"]`);
      if (el) el.classList.add('multi-selected');
    }
  }

  // Apply GIF selections
  for (const idx of state.gifSelection) {
    const el = dom.photoGrid.querySelector(`[data-index="${idx}"]`);
    if (el) el.classList.add('selected-for-gif');
  }
  updateGifFrameNumbers();
}

// ── Slot metadata label (solo view / lightbox info strips) ──────────────────
//
// Decodes the in-camera metadata for the slot — photographer name, comment,
// copy flag — and formats it as an appendable " · …" string. The stock camera
// stores no exposure settings, so this is everything it knows.

function slotMetaLabel(index) {
  if (!state.sav || index === null || index >= GBCam.PHOTO_COUNT) return '';
  const m = GBCam.decodeSlotMeta(state.sav, index);
  if (!m) return '';
  const parts = [];
  if (m.userName) {
    let who = m.userName;
    if (m.gender === 'male')   who += ' ♂';
    if (m.gender === 'female') who += ' ♀';
    parts.push(`by ${who}`);
  }
  if (m.birthdate && /^\d{8}$/.test(m.birthdate)) {
    // Stored as YYYY DD MM (verified against real saves)
    parts.push(`b. ${m.birthdate.slice(0, 4)}-${m.birthdate.slice(6, 8)}-${m.birthdate.slice(4, 6)}`);
  }
  if (m.comment) parts.push(`“${m.comment}”`);
  if (m.isCopy) parts.push('link-cable copy');
  return parts.length ? ' · ' + parts.join(' · ') : '';
}

// ── Repaint helpers ──────────────────────────────────────────────────────────

// Repaint only the detail/preview canvases (solo, lightbox, sidebar).
// Fast — renders 1-3 canvases instead of the full 30-slot grid.
// Use during interactive slider drag so the UI stays responsive.
function repaintDetailOnly() {
  if (state.viewMode === 'solo' && state.selectedIndex !== null) {
    renderSoloView(state.selectedIndex);
  }
  if (state.lightboxOpen && state.selectedIndex !== null) {
    renderLightbox(state.selectedIndex);
  }
  updateSidebarPreview();
}

// ── Grid repaint ─────────────────────────────────────────────────────────────

function repaintGrid() {
  const slots = dom.photoGrid.querySelectorAll('.photo-slot:not(.empty)');
  for (const slot of slots) repaintGridSlot(parseInt(slot.dataset.index));
  if (state.gifMode && state.gifSelection.size > 0) updateGifPreview();
  if (state.viewMode === 'solo' && state.selectedIndex !== null) renderSoloView(state.selectedIndex);
  if (state.lightboxOpen       && state.selectedIndex !== null) renderLightbox(state.selectedIndex);
  updateSidebarPreview();
}

// Debounced grid repaint for global-scope slider changes — fires once after the
// user stops dragging so we don't re-render all 30 thumbnails on every tick.
let _gridDebounceTimer = null;
function scheduleGridRepaint() {
  clearTimeout(_gridDebounceTimer);
  _gridDebounceTimer = setTimeout(() => {
    _gridDebounceTimer = null;
    const slots = dom.photoGrid.querySelectorAll('.photo-slot:not(.empty)');
    for (const slot of slots) repaintGridSlot(parseInt(slot.dataset.index));
    if (state.gifMode && state.gifSelection.size > 0) updateGifPreview();
  }, 200);
}

// ── Interactive repaint (sliders, seg controls) ──────────────────────────────
//
// Gated to one repaint per animation frame — slider input events can fire faster
// than 60 fps on a trackpad, so we coalesce them to avoid queuing up work.
//
//   per-photo scope → detail view + selected thumbnail(s) immediately
//   global scope    → detail view immediately + all thumbnails after 200 ms pause

let _interactiveRAF = null;
function repaintInteractive() {
  if (_interactiveRAF !== null) return; // already a repaint queued this frame
  _interactiveRAF = requestAnimationFrame(() => {
    _interactiveRAF = null;
    repaintDetailOnly();
    if (state.selectedPhotos.size > 0) {
      // Per-photo edit — only repaint affected thumbnails immediately
      for (const idx of state.selectedPhotos) repaintGridSlot(idx);
    } else {
      // Global edit — repaint all thumbnails (debounced)
      scheduleGridRepaint();
    }
  });
}

// Re-render a single thumbnail slot (after palette or transform change)
function repaintGridSlot(index) {
  const photo = state.photos[index];
  if (!photo || photo.isEmpty) return;
  const slot   = dom.photoGrid.querySelector(`[data-index="${index}"]`);
  if (!slot) return;
  const canvas = slot.querySelector('canvas');
  if (!canvas) return;
  const eff = getEffectiveSettings(index);
  // Cached render — re-runs the filter pipeline only when settings changed
  renderThumbCached(canvas, photo, eff, index);
  // Slot badge — photo-specific settings override indicator
  slot.classList.toggle('has-photo-settings', hasPhotoOverride(index));
}

// ── Photo selection ─────────────────────────────────────────────────────────

function updateExportSelectedBtn() {
  const btn = document.getElementById('btn-export-single');
  if (!btn) return;
  const hasPhoto = state.selectedIndex !== null && state.photos[state.selectedIndex] && !state.photos[state.selectedIndex].isEmpty;
  btn.disabled = !hasPhoto;
  btn.style.opacity = hasPhoto ? '' : '0.4';
}

function selectPhoto(index, event) {
  if (state.gifMode) {
    const slot = dom.photoGrid.querySelector(`[data-index="${index}"]`);
    if (slot && !slot.classList.contains('empty')) toggleGifSelection(index, slot);
    return;
  }

  const photo = state.photos[index];
  if (!photo || photo.isEmpty) return;

  if (event?.shiftKey && state.lastSelectedIndex !== null) {
    // Range select: add all non-empty photos between lastSelectedIndex and index
    const lo = Math.min(state.lastSelectedIndex, index);
    const hi = Math.max(state.lastSelectedIndex, index);
    for (let i = lo; i <= hi; i++) {
      if (state.photos[i] && !state.photos[i].isEmpty) state.selectedPhotos.add(i);
    }
    state.selectedIndex = index;
  } else if (event?.metaKey || event?.ctrlKey) {
    // Cmd/Ctrl: toggle this photo in/out of selection
    if (state.selectedPhotos.has(index)) {
      state.selectedPhotos.delete(index);
    } else {
      state.selectedPhotos.add(index);
    }
    state.selectedIndex = index;
    state.lastSelectedIndex = index;
  } else {
    // Plain click: single select
    state.selectedPhotos.clear();
    state.selectedPhotos.add(index);
    state.selectedIndex = index;
    state.lastSelectedIndex = index;
  }

  // Update visual selection on all slots
  dom.photoGrid.querySelectorAll('.photo-slot').forEach(el => {
    const i = parseInt(el.dataset.index);
    const inSet = state.selectedPhotos.has(i);
    el.classList.toggle('selected', i === state.selectedIndex);
    el.classList.toggle('multi-selected', inSet && state.selectedPhotos.size > 1);
  });

  if (state.viewMode === 'solo') renderSoloView(index);
  syncControlsToEffectiveSettings(index);
  updateExportSelectedBtn();
  updateSidebarPreview();
}

// ── Detail / lightbox rendering ───────────────────────────────────────────────

// renderDetail: kept as a compatibility stub — callers expecting a "view update"
// will now refresh the lightbox if it's open.
function renderDetail(index) {
  if (state.lightboxOpen && index !== null && index === state.selectedIndex) {
    renderLightbox(index);
  }
}

// ── Solo view ─────────────────────────────────────────────────────────────────

function enterSoloMode() {
  state.viewMode = 'solo';
  dom.gridPanel.classList.add('solo-mode');
  document.getElementById('btn-view-grid')?.classList.remove('active');
  document.getElementById('btn-view-solo')?.classList.add('active');

  // Auto-select first non-empty photo if nothing selected
  if (state.selectedIndex === null) {
    const first = state.photos.findIndex(p => !p.isEmpty);
    if (first >= 0) {
      state.selectedIndex = first;
      dom.photoGrid.querySelector(`[data-index="${first}"]`)?.classList.add('selected');
    }
  }
  if (state.selectedIndex !== null) renderSoloView(state.selectedIndex);
}

function enterGridMode() {
  state.viewMode = 'grid';
  dom.gridPanel.classList.remove('solo-mode');
  document.getElementById('btn-view-grid')?.classList.add('active');
  document.getElementById('btn-view-solo')?.classList.remove('active');
  // Scroll selected photo into view
  if (state.selectedIndex !== null) {
    dom.photoGrid.querySelector(`[data-index="${state.selectedIndex}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function renderSoloView(index) {
  const photo = state.photos[index];
  if (!photo || photo.isEmpty) return;

  const wrap = dom.soloCanvas?.parentElement;
  if (!wrap || !dom.soloCanvas) return;

  // Calculate largest integer scale that fits the available canvas area
  const availW = wrap.clientWidth  - 8;  // minor padding
  const availH = wrap.clientHeight - 8;
  const effSolo = getEffectiveSettings(index);
  const hasBorderSolo = effSolo.borderEnabled && effSolo.borderId;
  const soloDisplayW = hasBorderSolo ? 160 : GBCam.PHOTO_WIDTH;
  const soloDisplayH = hasBorderSolo ? 144 : GBCam.PHOTO_HEIGHT;
  const scaleW = Math.max(1, Math.floor(availW / soloDisplayW));
  const scaleH = Math.max(1, Math.floor(availH / soloDisplayH));
  const SOLO_SCALE = Math.max(1, Math.min(scaleW, scaleH));

  const ctx = dom.soloCanvas.getContext('2d');
  renderPhotoComplete(ctx, photo, effSolo, SOLO_SCALE, index);

  // Update info strip
  if (dom.soloLabel) dom.soloLabel.textContent = `Photo ${index + 1}`;
  if (dom.soloMeta) {
    const t = getTransform(index);
    const rotLabel  = t.rotate ? ` · ${t.rotate}°` : '';
    const flipLabel = (t.flipH || t.flipV) ? ` · flipped` : '';
    dom.soloMeta.textContent = `${GBCam.PHOTO_WIDTH}×${GBCam.PHOTO_HEIGHT}px · slot ${index + 1}/30${rotLabel}${flipLabel}${slotMetaLabel(index)}`;
  }
  // Sync transform button active states
  document.querySelectorAll('#solo-transforms .transform-btn').forEach(btn => {
    const t2 = getTransform(index);
    if (btn.dataset.action === 'flip-h') btn.classList.toggle('active', t2.flipH);
    if (btn.dataset.action === 'flip-v') btn.classList.toggle('active', t2.flipV);
  });
  updateSidebarPreview();
}

function soloStep(dir) {
  const photos = state.photos;
  let idx = state.selectedIndex ?? 0;
  let tries = 0;
  while (tries < 30) {
    idx = ((idx + dir + photos.length) % photos.length);
    if (!photos[idx]?.isEmpty) break;
    tries++;
  }
  if (photos[idx]?.isEmpty) return;

  dom.photoGrid.querySelectorAll('.photo-slot').forEach(el => el.classList.remove('selected'));
  dom.photoGrid.querySelector(`[data-index="${idx}"]`)?.classList.add('selected');
  state.selectedIndex = idx;
  state.selectedPhotos = new Set([idx]);
  syncControlsToEffectiveSettings(idx);
  renderSoloView(idx);
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function openLightbox(index) {
  const photo = state.photos[index];
  if (!photo || photo.isEmpty) return;
  state.lightboxOpen = true;
  dom.lbOverlay.classList.remove('hidden');
  renderLightbox(index);
}

function closeLightbox() {
  state.lightboxOpen = false;
  dom.lbOverlay.classList.add('hidden');
}

function renderLightbox(index) {
  const photo = state.photos[index];
  if (!photo || photo.isEmpty) { closeLightbox(); return; }

  const PREVIEW_SCALE = 8;
  const ctx = dom.lbCanvas.getContext('2d');
  const effLb = getEffectiveSettings(index);
  renderPhotoComplete(ctx, photo, effLb, PREVIEW_SCALE, index);

  dom.lbLabel.textContent = `Photo ${index + 1}`;
  const t = getTransform(index);
  const rotLabel  = t.rotate ? ` · ${t.rotate}°` : '';
  const flipLabel = (t.flipH || t.flipV) ? ` · flipped` : '';
  dom.lbMeta.textContent = `${GBCam.PHOTO_WIDTH}×${GBCam.PHOTO_HEIGHT}px · 2bpp · slot ${index + 1}/30${rotLabel}${flipLabel}${slotMetaLabel(index)}`;

  // Sync transform button active states in lightbox footer
  document.querySelectorAll('#lb-transforms .transform-btn').forEach(btn => {
    const action = btn.dataset.action;
    if (action === 'flip-h') btn.classList.toggle('active', t.flipH);
    if (action === 'flip-v') btn.classList.toggle('active', t.flipV);
  });
}

function lightboxStep(dir) {
  if (!state.lightboxOpen) return;
  const photos = state.photos;
  let idx = state.selectedIndex ?? 0;
  let tries = 0;
  while (tries < 30) {
    idx = ((idx + dir + photos.length) % photos.length);
    if (!photos[idx]?.isEmpty) break;
    tries++;
  }
  if (photos[idx]?.isEmpty) return;

  dom.photoGrid.querySelectorAll('.photo-slot').forEach(el => el.classList.remove('selected'));
  const slot = dom.photoGrid.querySelector(`[data-index="${idx}"]`);
  if (slot) {
    slot.classList.add('selected');
    slot.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  state.selectedIndex = idx;
  state.selectedPhotos = new Set([idx]);
  syncControlsToEffectiveSettings(idx);
  renderLightbox(idx);
}

