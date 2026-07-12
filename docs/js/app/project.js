/**
 * project.js — Project files (.gbcp), hide-empty toggle, reload
 *
 * Split from app.js. Classic script: shares the global scope with the other
 * app/ files; load order (see index.html) preserves the original execution
 * order and must be kept.
 */

// ── Project file (.gbcp) ────────────────────────────────────────────────────

function buildProjectJson() {
  // Encode the raw sav as base64
  const bytes = new Uint8Array(state.sav.buffer);
  let binary = '';
  // Chunk to avoid call stack limits on large arrays
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  const sav64 = btoa(binary);

  return JSON.stringify({
    version: 1,
    app: 'DMG DarkRoom',
    filename: state.filename || 'GBCAMERA.sav',
    sav: sav64,
    settings: {
      paletteId:      state.palette.id,
      exportScale:    state.exportScale,
      exportFilter:    state.exportFilter,
      filterIntensity: state.filterIntensity,
      filterVariant:   state.filterVariant,
      filterParams:    state.filterParams,
      brightness:      state.brightness,
      contrast:        state.contrast,
      toneIntensity:   state.toneIntensity,
      shadowColor:     state.shadowColor,
      highlightColor:  state.highlightColor,
      toneBalance:     state.toneBalance,
      gifDelay:        state.gifDelay,
      gifLoop:         state.gifLoop,
      gifBorders:      state.gifBorders,
      activeFilters:   [...state.activeFilters],
      sectionEnabled:  state.sectionEnabled,
      borderId:        state.borderId,
      borderEnabled:   state.borderEnabled,
      filterScope:     state.filterScope,
      photoSettings:   state.photoSettings,
      photoTransforms: state.photoTransforms,
      filterOrder:     state.filterOrder,
      customPalettes:  loadCustomPalettes(),
      recentPalettes:  loadRecentPalettes(),
      favPalettes:     loadFavPalettes(),
    },
  }, null, 2);
}

async function saveProject() {
  if (!state.sav) return;
  const baseName    = (state.filename || 'gbcamera').replace(/\.sav$/i, '');
  const defaultName = `${baseName}.gbcp`;
  const result = await window.api.saveProject(buildProjectJson(), defaultName);
  if (result) showToast(`Project saved: ${result}`);
}

async function openProject() {
  const result = await window.api.openProject();
  if (!result) return;
  if (result.error) { showToast(`Error: ${result.error}`); return; }

  let project;
  try { project = JSON.parse(result.json); }
  catch (_) { showToast('Invalid project file'); return; }

  if (project.version !== 1 || !project.sav) {
    showToast('Unrecognised project format');
    return;
  }

  // Decode base64 sav → ArrayBuffer
  const binary = atob(project.sav);
  const buffer = new ArrayBuffer(binary.length);
  const u8     = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i);

  // Load the photos (same pipeline as a normal .sav open)
  await loadSavFile({ buffer, name: project.filename || result.name, path: null });

  // Restore settings
  const s = project.settings || {};
  if (s.paletteId && PALETTES[s.paletteId]) setPalette(s.paletteId);
  if (s.exportScale !== undefined)           setExportScale(s.exportScale);
  if (s.exportFilter) setExportFilter(s.exportFilter);
  if (s.filterIntensity !== undefined) {
    state.filterIntensity = s.filterIntensity;
    const sl = document.getElementById('filter-intensity');
    const vl = document.getElementById('filter-intensity-val');
    if (sl) sl.value = Math.round(s.filterIntensity * 100);
    if (vl) vl.textContent = `${Math.round(s.filterIntensity * 100)}%`;
  }
  if (s.filterVariant) {
    state.filterVariant = s.filterVariant;
    document.querySelectorAll('.crt-variant-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.variant === s.filterVariant));
  }
  if (s.gifDelay) {
    state.gifDelay = s.gifDelay;
    if (dom.gifDelay)    dom.gifDelay.value = s.gifDelay;
    if (dom.gifDelayVal) dom.gifDelayVal.textContent = `${s.gifDelay}ms`;
  }
  if (s.gifLoop) setGifLoop(s.gifLoop);
  if (typeof s.gifBorders === 'boolean') {
    state.gifBorders = s.gifBorders;
    const cb = document.getElementById('gif-borders');
    if (cb) cb.checked = s.gifBorders;
  }
  if (s.photoSettings && typeof s.photoSettings === 'object') {
    // Restore with integer-keyed entries (JSON keys are strings, convert back)
    state.photoSettings = {};
    for (const [k, v] of Object.entries(s.photoSettings)) {
      state.photoSettings[parseInt(k)] = v;
    }
  }

  // Restore global editing state (added in v1.3 — older projects simply skip these)
  if (Array.isArray(s.activeFilters)) state.activeFilters = new Set(s.activeFilters);
  if (s.sectionEnabled && typeof s.sectionEnabled === 'object') {
    state.sectionEnabled = { ...state.sectionEnabled, ...s.sectionEnabled };
    document.querySelectorAll('.section-check[data-section]').forEach(cb => {
      if (cb.dataset.section in state.sectionEnabled) cb.checked = !!state.sectionEnabled[cb.dataset.section];
    });
  }
  if (typeof s.borderId === 'string')       state.borderId      = s.borderId;
  if (typeof s.borderEnabled === 'boolean') state.borderEnabled = s.borderEnabled;
  const projBorderCb = document.getElementById('border-enabled-check');
  if (projBorderCb) projBorderCb.checked = state.borderEnabled;
  document.querySelectorAll('.border-frame-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.frameId === state.borderId);
  });
  if (s.filterScope === 'full' || s.filterScope === 'photo') {
    state.filterScope = s.filterScope;
    const scopeCb = document.getElementById('filter-scope-check');
    if (scopeCb) scopeCb.checked = state.filterScope === 'full';
  }

  // Restore filter order (and reorder accordion DOM to match)
  if (Array.isArray(s.filterOrder) && s.filterOrder.length > 0) {
    state.filterOrder = s.filterOrder;
    localStorage.setItem('filterOrder', JSON.stringify(s.filterOrder));
    const accordion = document.getElementById('filter-accordion');
    if (accordion) {
      s.filterOrder.forEach(filterId => {
        const item = accordion.querySelector(`.fi-item[data-filter="${filterId}"]`);
        if (item) accordion.appendChild(item);
      });
    }
  }

  // Merge incoming custom palettes without overwriting existing ones
  if (Array.isArray(s.customPalettes) && s.customPalettes.length > 0) {
    const existing    = loadCustomPalettes();
    const existingIds = new Set(existing.map(p => p.id));
    const incoming    = s.customPalettes.filter(p => !existingIds.has(p.id));
    if (incoming.length > 0) {
      saveCustomPalettesToStorage([...existing, ...incoming]);
      refreshCustomPalettes();
      rebuildPalettePickerList();
    }
  }

  // Restore recent palettes strip
  if (Array.isArray(s.recentPalettes)) {
    localStorage.setItem(RECENT_PALETTES_KEY, JSON.stringify(s.recentPalettes));
  }
  if (Array.isArray(s.favPalettes)) {
    localStorage.setItem(FAV_PALETTES_KEY, JSON.stringify(s.favPalettes));
    renderFavPalettes();
  }

  // Repaint with the fully-restored global state (filters, borders, sections)
  updateFilterUI();
  repaintGrid();

  showToast(`Project loaded: ${result.name}`);
}

// ── Hide empty slots ─────────────────────────────────────────────────────────

function toggleHideEmpty() {
  state.hideEmpty = !state.hideEmpty;
  dom.photoGrid.classList.toggle('hide-empty', state.hideEmpty);
  const btn = document.getElementById('btn-hide-empty');
  if (btn) {
    btn.classList.toggle('active', state.hideEmpty);
    btn.textContent = state.hideEmpty ? 'Show empty' : 'Hide empty';
  }
}

// ── Reload last .sav ─────────────────────────────────────────────────────────

const LAST_SAV_PATH_KEY = 'gbcam_last_sav_path';

function saveLastSavPath(filePath) {
  if (filePath) localStorage.setItem(LAST_SAV_PATH_KEY, filePath);
}

async function reloadSav() {
  const p = state.filePath || localStorage.getItem(LAST_SAV_PATH_KEY);
  if (!p) { showToast('No file to reload'); return; }
  const result = window.api?.readFile
    ? await window.api.readFile(p)
    : null;
  if (result) await loadSavFile(result);
}

