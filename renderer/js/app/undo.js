/**
 * undo.js — Undo / redo
 *
 * Split from app.js. Classic script: shares the global scope with the other
 * app/ files; load order (see index.html) preserves the original execution
 * order and must be kept.
 *
 * Snapshot-based with a redo stack. Snapshots capture the complete editing
 * state (filters, tone, palette, per-photo overrides, transforms, borders,
 * scopes, GIF sequence) and — for destructive operations like image import —
 * optionally the raw .sav bytes, so even SRAM mutations are undoable.
 */

// ── Undo ─────────────────────────────────────────────────────────────────────

const MAX_UNDO = 30;
const undoStack = [];
const redoStack = [];

/** Deep-clone everything the editing session can change. */
function captureState(opts = {}) {
  return {
    activeFilters:   [...state.activeFilters],
    exportFilter:    state.exportFilter,
    filterParams:    JSON.parse(JSON.stringify(state.filterParams)),
    filterIntensity: state.filterIntensity,
    filterVariant:   state.filterVariant,
    filterOrder:     [...state.filterOrder],
    paletteId:       state.palette?.id ?? null,
    palette:         state.palette ? { ...state.palette } : null, // fallback if id no longer exists
    brightness:      state.brightness,
    contrast:        state.contrast,
    toneIntensity:   state.toneIntensity,
    shadowColor:     state.shadowColor,
    highlightColor:  state.highlightColor,
    toneBalance:     state.toneBalance,
    photoSettings:   JSON.parse(JSON.stringify(state.photoSettings)),
    photoTransforms: JSON.parse(JSON.stringify(state.photoTransforms)),
    sectionEnabled:  JSON.parse(JSON.stringify(state.sectionEnabled || {})),
    borderId:        state.borderId,
    borderEnabled:   state.borderEnabled,
    filterScope:     state.filterScope,
    gifFrameOrder:   JSON.parse(JSON.stringify(state.gifFrameOrder)),
    gifSelection:    [...state.gifSelection],
    gifDelay:        state.gifDelay,
    gifLoop:         state.gifLoop,
    gifBorders:      state.gifBorders,
    // Raw SRAM — only captured when the operation mutates it (e.g. import)
    sav:             (opts.includeSav && state.sav) ? new Uint8Array(state.sav) : null,
  };
}

/** Apply a snapshot to state and resync every dependent control. */
function applySnapshot(snap) {
  state.activeFilters   = new Set(snap.activeFilters);
  state.exportFilter    = snap.exportFilter ?? state.exportFilter;
  state.filterParams    = snap.filterParams;
  state.filterIntensity = snap.filterIntensity;
  state.filterVariant   = snap.filterVariant;
  if (Array.isArray(snap.filterOrder)) state.filterOrder = [...snap.filterOrder];
  state.palette = (snap.paletteId && PALETTES[snap.paletteId]) || snap.palette || state.palette;
  state.brightness     = snap.brightness;
  state.contrast       = snap.contrast;
  state.toneIntensity  = snap.toneIntensity;
  state.shadowColor    = snap.shadowColor;
  state.highlightColor = snap.highlightColor;
  state.toneBalance    = snap.toneBalance;
  state.photoSettings   = snap.photoSettings;
  state.photoTransforms = snap.photoTransforms;
  state.sectionEnabled  = snap.sectionEnabled;
  state.borderId        = snap.borderId;
  state.borderEnabled   = snap.borderEnabled;
  state.filterScope     = snap.filterScope ?? state.filterScope;
  state.gifFrameOrder   = JSON.parse(JSON.stringify(snap.gifFrameOrder || []));
  state.gifSelection    = new Set(snap.gifSelection || []);
  state.gifDelay        = snap.gifDelay   ?? state.gifDelay;
  state.gifLoop         = snap.gifLoop    ?? state.gifLoop;
  state.gifBorders      = snap.gifBorders ?? state.gifBorders;

  // Restore SRAM bytes and re-derive photos (import undo)
  if (snap.sav && state.sav) {
    state.sav.set(snap.sav);
    const parsed = GBCam.parseSav(state.sav.buffer.slice(0));
    // Keep the same sav reference; refresh photo objects in place
    state.photos = parsed.photos;
    if (parsed.lastSeen) {
      state.photos.push({ index: 30, pixels: parsed.lastSeen, isEmpty: false, isDeleted: false, albumPos: null, isLastSeen: true });
    }
    state.activeCount = parsed.activeCount;
    if (state.selectedIndex !== null && (!state.photos[state.selectedIndex] || state.photos[state.selectedIndex].isEmpty)) {
      state.selectedIndex = null;
      state.selectedPhotos.clear();
    }
  }

  clearThumbCache();
  syncUiFromState();
}

/** Bring every visible control back in line with state (global scope). */
function syncUiFromState() {
  updateFilterUI();
  if (state.selectedIndex !== null) {
    syncControlsToEffectiveSettings(state.selectedIndex);
  } else {
    updatePalettePickerBtn(state.palette);
    const borderCb = document.getElementById('border-enabled-check');
    if (borderCb) borderCb.checked = state.borderEnabled;
    document.querySelectorAll('.border-frame-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.frameId === state.borderId);
    });
  }
  document.querySelectorAll('.section-check[data-section]').forEach(cb => {
    if (cb.dataset.section in (state.sectionEnabled || {})) cb.checked = !!state.sectionEnabled[cb.dataset.section];
  });
  const scopeCb = document.getElementById('filter-scope-check');
  if (scopeCb) scopeCb.checked = state.filterScope === 'full';
  if (dom.gifDelay)    dom.gifDelay.value = state.gifDelay;
  if (dom.gifDelayVal) dom.gifDelayVal.textContent = `${state.gifDelay}ms`;
  if (state.gifMode) {
    updateGifCount();
    renderGifFrameStrip();
  }
  renderGrid();
  updateSidebarPreview();
}

/**
 * Push the current state onto the undo stack before a destructive action.
 * Pass { includeSav: true } for operations that mutate the raw save (import).
 * Any new action invalidates the redo stack, as in every standard editor.
 */
function pushUndo(opts = {}) {
  undoStack.push(captureState(opts));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
}

/** Undo the most recent action (Cmd/Ctrl+Z). */
function performUndo() {
  if (undoStack.length === 0) { showToast('Nothing to undo'); return; }
  const snap = undoStack.pop();
  redoStack.push(captureState({ includeSav: !!snap.sav }));
  applySnapshot(snap);
  showToast('Undo');
}

/** Redo the most recently undone action (Shift+Cmd/Ctrl+Z). */
function performRedo() {
  if (redoStack.length === 0) { showToast('Nothing to redo'); return; }
  const snap = redoStack.pop();
  undoStack.push(captureState({ includeSav: !!snap.sav }));
  applySnapshot(snap);
  showToast('Redo');
}
