/**
 * state.js — Global state, DOM refs, per-photo settings helpers, toast, status bar
 *
 * Split from app.js. Classic script: shares the global scope with the other
 * app/ files; load order (see index.html) preserves the original execution
 * order and must be kept.
 */

// ── State ──────────────────────────────────────────────────────────────────

const state = {
  sav: null,            // raw Uint8Array of the loaded .sav
  photos: [],           // parsed photo objects from GBCam.parseSav
  activeCount: 0,
  filename: null,
  filePath: null,
  selectedIndex: null,  // currently selected photo index (0–29)
  palette: PALETTES.dmg,
  exportScale: 20,
  exportFormat: 'png',  // 'png' | 'gif'
  exportFilter:    'none',   // legacy single-filter field; kept for backwards compat with old .gbcp files
  filterIntensity: 1.0,     // 0.0–1.0
  filterVariant:   'medium', // crt only: 'fine'|'medium'|'thick'|'wide'
  filterParams: buildDefaultFilterParams(), // per-filter granular parameters (see FILTER_DEFS)
  photoTransforms: {},      // { photoIndex: { rotate: 0, flipH: false, flipV: false } }
  hideEmpty: false,         // whether to collapse empty grid slots
  presentationMode: false,  // fullscreen presentation overlay active
  gifMode: false,          // are we in GIF selection mode?
  gifSelection: new Set(), // photo indices in the sequence (for O(1) grid highlight)
  gifFrameOrder: [],       // [{photoIndex, paletteId}] — ordered frame list
  gifPaletteScope: null,   // null=global; number=frame order index being re-palettted
  gifDelay: 250,           // ms per frame
  gifLoop: 'infinite',     // 'infinite' | 'once' | 'bounce'
  gifBorders: false,       // include each frame's border frame in the exported GIF
  activeFilters:   new Set(),        // active filter names for stackable effects
  sectionEnabled:  { exposure: false, splitTone: false, effects: false }, // per-section on/off (off by default)
  effectsPreviewMode: false, // toggle before/after for effects; false = effects visible (normal rendering)
  filterOrder: ['crt', 'lcd', 'grid', 'vignette', 'halftone', 'dot', 'glow', 'chroma', 'jitter', 'noise', 'ghosting', 'pixsort', 'blkglitch', 'wavewarp', 'zoomblur', 'bayer', 'floyd', 'atkinson', 'interlace', 'chswap', 'rgbplanes', 'colcorrupt', 'printer', 'tilecorrupt', 'zine'],
  gifPreviewTimer: null,   // setInterval handle for live GIF preview
  lightboxOpen: false,     // lightbox overlay visible
  viewMode: 'grid',        // 'grid' | 'solo'
  applyScope: 'all',       // 'all' | 'photo' — whether controls write to global or this photo
  photoSettings: {},       // { [photoIndex]: { paletteId?, exportFilter?, filterIntensity?, filterVariant?, filterParams?, brightness?, contrast?, toneIntensity?, shadowColor?, highlightColor?, toneBalance? } }
  // Tone adjustments
  brightness:      0,      // -100 to +100
  contrast:        0,      // -100 to +100
  toneIntensity:   0,      // 0–100 (split toning strength)
  shadowColor:     '#0033aa',
  highlightColor:  '#ff8800',
  toneBalance:     0,      // -100 (more shadow) to +100 (more highlight)
  selectedPhotos:     new Set(), // indices of currently selected photos (multi)
  lastSelectedIndex:  null,      // last clicked photo index, for shift-range
  focusedFilter:      null,      // which filter's param panel is open
  effectClipboard:    null,      // copied effect settings for paste
  borderId:           'int-frame-0', // global border frame id
  borderEnabled:      false,         // global border on/off
  filterScope:        'full',        // 'full' = filters apply to border+photo; 'photo' = photo area only
};


// ── DOM refs ───────────────────────────────────────────────────────────────

const dom = {
  app:             document.getElementById('app'),
  welcome:         document.getElementById('welcome'),
  main:            document.getElementById('main'),
  photoGrid:       document.getElementById('photo-grid'),
  gridPanel:       document.getElementById('grid-panel'),
  detailEmpty:     document.getElementById('detail-empty'),
  exportControls:  document.getElementById('export-controls'),
  gifPreviewWrap:  document.getElementById('gif-preview-wrap'),
  gifPreviewCanvas:document.getElementById('gif-preview-canvas'),
  gifPreviewInfo:  document.getElementById('gif-preview-info'),
  lbOverlay:       document.getElementById('lightbox-overlay'),
  lbCanvas:        document.getElementById('lb-canvas'),
  lbLabel:         document.getElementById('lb-label'),
  lbMeta:          document.getElementById('lb-meta'),
  soloView:        document.getElementById('solo-view'),
  soloCanvas:      document.getElementById('solo-canvas'),
  soloLabel:       document.getElementById('solo-label'),
  soloMeta:        document.getElementById('solo-meta'),
  gifToolbar:      document.getElementById('gif-toolbar'),
  gifFrameStrip:   document.getElementById('gif-frame-strip'),
  gifFrameList:    document.getElementById('gif-frame-list'),
  gifFrameEmpty:   document.getElementById('gif-frame-empty'),
  gifCount:        document.getElementById('gif-count'),
  gifDelay:        document.getElementById('gif-delay'),
  gifDelayVal:     document.getElementById('gif-delay-val'),
  statusText:      document.getElementById('status-text'),
  statusDot:       document.getElementById('status-dot'),
  pocketModal:     document.getElementById('pocket-modal'),
  pocketSaveList:  document.getElementById('pocket-save-list'),
  pocketConfirm:   document.getElementById('pocket-confirm'),
  toast:              document.getElementById('toast'),
  dropOverlay:        document.getElementById('drop-overlay'),
  presentationOverlay:document.getElementById('presentation-overlay'),
  presCanvas:         document.getElementById('pres-canvas'),
  presLabel:          document.getElementById('pres-label'),
  presClose:          document.getElementById('pres-close'),
  presPrev:           document.getElementById('pres-prev'),
  presNext:           document.getElementById('pres-next'),
};

// ── Toast ───────────────────────────────────────────────────────────────────

let toastTimer;
function showToast(msg) {
  dom.toast.textContent = msg;
  dom.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('visible'), 2500);
}

// ── Per-photo settings helpers ─────────────────────────────────────────────

/** Returns a merged settings object for rendering photo at `index`.
 *  Per-photo overrides take precedence over global state. */
function getEffectiveSettings(index) {
  const ps = state.photoSettings[index];
  if (!ps) {
    return {
      palette:        state.palette,
      exportFilter:   state.exportFilter,
      filterIntensity:state.filterIntensity,
      filterVariant:  state.filterVariant,
      filterParams:   state.filterParams,
      activeFilters:  new Set(state.activeFilters),
      brightness:     state.brightness,
      contrast:       state.contrast,
      toneIntensity:  state.toneIntensity,
      shadowColor:    state.shadowColor,
      highlightColor: state.highlightColor,
      toneBalance:    state.toneBalance,
      borderId:       state.borderId,
      borderEnabled:  state.borderEnabled,
      filterScope:    state.filterScope,
    };
  }
  return {
    palette:        ps.paletteId ? (PALETTES[ps.paletteId] || state.palette) : state.palette,
    exportFilter:   ps.exportFilter   ?? state.exportFilter,
    filterIntensity:ps.filterIntensity ?? state.filterIntensity,
    filterVariant:  ps.filterVariant  ?? state.filterVariant,
    filterParams:   ps.filterParams   ?? state.filterParams,
    activeFilters:  ps.activeFilters ? new Set(ps.activeFilters) : new Set(state.activeFilters),
    brightness:     ps.brightness     ?? state.brightness,
    contrast:       ps.contrast       ?? state.contrast,
    toneIntensity:  ps.toneIntensity  ?? state.toneIntensity,
    shadowColor:    ps.shadowColor    ?? state.shadowColor,
    highlightColor: ps.highlightColor ?? state.highlightColor,
    toneBalance:    ps.toneBalance    ?? state.toneBalance,
    borderId:       ps.borderId       ?? state.borderId,
    borderEnabled:  ps.borderEnabled  ?? state.borderEnabled,
    filterScope:    state.filterScope, // always global (not per-photo)
  };
}

/** Write a setting to the selected photos' per-photo overrides, or globally if nothing is selected. */
function setScopedSetting(key, value) {
  const targets = state.selectedPhotos.size > 0 ? [...state.selectedPhotos] : null;
  if (targets) {
    for (const idx of targets) {
      if (!state.photoSettings[idx]) state.photoSettings[idx] = {};
      state.photoSettings[idx][key] = value;
    }
  } else {
    state[key] = value;
  }
}

/** Returns the filterParams object for the current scope. Per-photo when a photo is selected, global otherwise. */
function getWritableFilterParams(filter) {
  const idx = state.selectedPhotos.size > 0 ? [...state.selectedPhotos][0] : state.selectedIndex;
  if (idx !== null && idx !== undefined) {
    if (!state.photoSettings[idx]) state.photoSettings[idx] = {};
    if (!state.photoSettings[idx].filterParams) {
      state.photoSettings[idx].filterParams = JSON.parse(JSON.stringify(state.filterParams));
    }
    const fp = state.photoSettings[idx].filterParams;
    if (!fp[filter]) fp[filter] = {};
    return fp[filter];
  }
  if (!state.filterParams[filter]) state.filterParams[filter] = {};
  return state.filterParams[filter];
}

/** True when photo at `index` has any per-photo setting override. */
function hasPhotoOverride(index) {
  const ps = state.photoSettings[index];
  if (!ps) return false;
  return Object.keys(ps).some(k => ps[k] !== undefined && (k !== 'filterParams' || Object.keys(ps[k]).length > 0));
}

/** Remove all per-photo overrides for `index`. */
function clearPhotoOverride(index) {
  delete state.photoSettings[index];
}

/** Deselect all photos and clear visual state. */
function deselectAll() {
  state.selectedPhotos.clear();
  state.selectedIndex = null;
  state.lastSelectedIndex = null;
  dom.photoGrid.querySelectorAll('.photo-slot').forEach(el => {
    el.classList.remove('selected', 'multi-selected');
  });
  updateSidebarPreview();
}

/** Clear edits on selected photos — removes tone, exposure, and filter overrides
 *  but preserves each photo's palette choice. Requires at least one photo selected. */
function clearEdits() {
  const targets = state.selectedPhotos.size > 0 ? [...state.selectedPhotos] : null;
  if (!targets) {
    showToast('Select a photo first');
    return;
  }
  pushUndo();
  for (const idx of targets) {
    // Preserve per-photo palette id; clear everything else
    const savedPaletteId = state.photoSettings[idx]?.paletteId;
    delete state.photoSettings[idx];
    if (savedPaletteId) {
      state.photoSettings[idx] = { paletteId: savedPaletteId };
    }
    delete state.photoTransforms[idx];
    repaintGridSlot(idx);
  }
  if (state.viewMode === 'solo' && state.selectedIndex !== null) renderSoloView(state.selectedIndex);
  if (state.lightboxOpen && state.selectedIndex !== null) renderLightbox(state.selectedIndex);
  if (state.selectedIndex !== null) syncControlsToEffectiveSettings(state.selectedIndex);
  updateFilterUI();
  _refreshFilterParamPanel();
  const n = targets.length;
  showToast(`Cleared edits on ${n} photo${n > 1 ? 's' : ''}`);
  updateSidebarPreview();
}
// Legacy alias (kept so any remaining references don't throw)
const resetAllEdits = clearEdits;

/** Returns the palette id that should be shown as "active" in the picker. */
function getDisplayPaletteId() {
  if (state.selectedIndex !== null) {
    return getEffectiveSettings(state.selectedIndex).palette?.id || state.palette.id;
  }
  return state.palette.id;
}

/** Sync all right-panel controls to reflect the effective settings for `index`.
 *  Called when scope='photo' and the selected photo changes, or scope toggles. */
function syncControlsToEffectiveSettings(index) {
  if (index === null || index === undefined) return;
  const eff = getEffectiveSettings(index);

  // Palette picker button
  updatePalettePickerBtn(eff.palette);
  // Picker list active state
  const effPalId = eff.palette?.id;
  document.querySelectorAll('.pal-item').forEach(item => {
    item.classList.toggle('active', item.dataset.palette === effPalId);
  });
  updateCurrentPalettePin();

  // Sync filter accordion checkboxes + param values
  syncFilterAccordion(eff);

  // Tone controls
  const bEl  = document.getElementById('tone-brightness');
  const bVal = document.getElementById('tone-brightness-val');
  if (bEl)  bEl.value = eff.brightness;
  if (bVal) bVal.textContent = eff.brightness > 0 ? `+${eff.brightness}` : String(eff.brightness);

  const cEl  = document.getElementById('tone-contrast');
  const cVal = document.getElementById('tone-contrast-val');
  if (cEl)  cEl.value = eff.contrast;
  if (cVal) cVal.textContent = eff.contrast > 0 ? `+${eff.contrast}` : String(eff.contrast);

  const tiEl  = document.getElementById('tone-intensity');
  const tiVal = document.getElementById('tone-intensity-val');
  if (tiEl)  tiEl.value = eff.toneIntensity;
  if (tiVal) tiVal.textContent = `${eff.toneIntensity}%`;

  const scEl = document.getElementById('tone-shadow-color');
  if (scEl)  { scEl.value = eff.shadowColor; syncColorSwatchBtn(scEl, eff.shadowColor); }

  const hcEl = document.getElementById('tone-highlight-color');
  if (hcEl)  { hcEl.value = eff.highlightColor; syncColorSwatchBtn(hcEl, eff.highlightColor); }

  const balEl  = document.getElementById('tone-balance');
  const balVal = document.getElementById('tone-balance-val');
  if (balEl)  balEl.value = eff.toneBalance;
  if (balVal) balVal.textContent = eff.toneBalance > 0 ? `+${eff.toneBalance}` : String(eff.toneBalance);

  // Border picker + checkbox
  const borderCb = document.getElementById('border-enabled-check');
  if (borderCb) borderCb.checked = eff.borderEnabled ?? false;
  document.querySelectorAll('.border-frame-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.frameId === eff.borderId);
  });

}

// ── Status bar ─────────────────────────────────────────────────────────────

function setStatus(text, active = false) {
  dom.statusText.textContent = text;
  dom.statusDot.className = 'status-dot' + (active ? ' green' : '');
}

