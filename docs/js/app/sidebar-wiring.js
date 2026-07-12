/**
 * sidebar-wiring.js — Tone controls, border picker, collapsible sections, presets, copy/paste
 *
 * Split from app.js. Classic script: shares the global scope with the other
 * app/ files; load order (see index.html) preserves the original execution
 * order and must be kept.
 */

// ── Tone controls wiring ─────────────────────────────────────────────────────

function setupToneControls() {
  function redrawDetail() { repaintInteractive(); }

  const brightnessEl   = document.getElementById('tone-brightness');
  const brightnessVal  = document.getElementById('tone-brightness-val');
  const contrastEl     = document.getElementById('tone-contrast');
  const contrastVal    = document.getElementById('tone-contrast-val');
  const intensityEl    = document.getElementById('tone-intensity');
  const intensityVal   = document.getElementById('tone-intensity-val');
  const shadowColorEl  = document.getElementById('tone-shadow-color');
  const highlightColorEl = document.getElementById('tone-highlight-color');
  const balanceEl      = document.getElementById('tone-balance');
  const balanceVal     = document.getElementById('tone-balance-val');
  const resetBtn       = document.getElementById('exposure-reset');

  if (!brightnessEl) return; // not in DOM (shouldn't happen)

  // Attach custom color pickers to shadow / highlight inputs
  if (shadowColorEl)    attachColorPickerToInput(shadowColorEl);
  if (highlightColorEl) attachColorPickerToInput(highlightColorEl);

  brightnessEl.addEventListener('input', () => {
    setScopedSetting('brightness', parseInt(brightnessEl.value));
    const v = getEffectiveSettings(state.selectedIndex)?.brightness ?? state.brightness;
    brightnessVal.textContent = v > 0 ? `+${v}` : String(v);
    redrawDetail();
  });

  contrastEl.addEventListener('input', () => {
    setScopedSetting('contrast', parseInt(contrastEl.value));
    const v = getEffectiveSettings(state.selectedIndex)?.contrast ?? state.contrast;
    contrastVal.textContent = v > 0 ? `+${v}` : String(v);
    redrawDetail();
  });

  intensityEl.addEventListener('input', () => {
    setScopedSetting('toneIntensity', parseInt(intensityEl.value));
    const v = getEffectiveSettings(state.selectedIndex)?.toneIntensity ?? state.toneIntensity;
    intensityVal.textContent = `${v}%`;
    redrawDetail();
  });

  shadowColorEl.addEventListener('input', () => {
    setScopedSetting('shadowColor', shadowColorEl.value);
    const eff = getEffectiveSettings(state.selectedIndex);
    if ((eff?.toneIntensity ?? state.toneIntensity) > 0) redrawDetail();
  });

  highlightColorEl.addEventListener('input', () => {
    setScopedSetting('highlightColor', highlightColorEl.value);
    const eff = getEffectiveSettings(state.selectedIndex);
    if ((eff?.toneIntensity ?? state.toneIntensity) > 0) redrawDetail();
  });

  balanceEl.addEventListener('input', () => {
    setScopedSetting('toneBalance', parseInt(balanceEl.value));
    const v = getEffectiveSettings(state.selectedIndex)?.toneBalance ?? state.toneBalance;
    balanceVal.textContent = v > 0 ? `+${v}` : String(v);
    const eff = getEffectiveSettings(state.selectedIndex);
    if ((eff?.toneIntensity ?? state.toneIntensity) > 0) redrawDetail();
  });

  // Exposure reset — brightness + contrast only
  resetBtn?.addEventListener('click', () => {
    pushUndo();
    const targets = state.selectedPhotos.size > 0
      ? [...state.selectedPhotos]
      : state.selectedIndex !== null ? [state.selectedIndex] : null;
    if (targets) {
      for (const idx of targets) {
        if (!state.photoSettings[idx]) state.photoSettings[idx] = {};
        const ps = state.photoSettings[idx];
        ps.brightness = 0;
        ps.contrast   = 0;
      }
    } else {
      state.brightness = 0;
      state.contrast   = 0;
    }
    if (state.selectedIndex !== null) syncControlsToEffectiveSettings(state.selectedIndex);
    repaintGrid();
    updateSidebarPreview();
    showToast('Exposure reset');
  });

  // Split Tone reset — toning fields only
  document.getElementById('split-tone-reset')?.addEventListener('click', () => {
    pushUndo();
    const targets = state.selectedPhotos.size > 0
      ? [...state.selectedPhotos]
      : state.selectedIndex !== null ? [state.selectedIndex] : null;
    if (targets) {
      for (const idx of targets) {
        if (!state.photoSettings[idx]) state.photoSettings[idx] = {};
        const ps = state.photoSettings[idx];
        ps.toneIntensity  = 0;
        ps.toneBalance    = 0;
        ps.shadowColor    = '#0033aa';
        ps.highlightColor = '#ff8800';
      }
    } else {
      state.toneIntensity  = 0;
      state.toneBalance    = 0;
      state.shadowColor    = '#0033aa';
      state.highlightColor = '#ff8800';
    }
    if (state.selectedIndex !== null) syncControlsToEffectiveSettings(state.selectedIndex);
    repaintGrid();
    updateSidebarPreview();
    showToast('Split tone reset');
  });
}

// ── Init ────────────────────────────────────────────────────────────────────

function wireButtonsPaletteEditor() {
  document.getElementById('btn-new-palette').addEventListener('click', () => {
    closePalettePicker();
    openPaletteEditor();
  });
  document.getElementById('palette-modal-close').addEventListener('click', closePaletteEditor);
  document.getElementById('palette-modal-cancel').addEventListener('click', closePaletteEditor);
  document.getElementById('palette-modal-save').addEventListener('click', savePaletteEditor);
  document.getElementById('palette-modal-delete').addEventListener('click', deletePaletteFromEditor);

  // Import field: URL / hex / Lospec
  const lospecBtn = document.getElementById('btn-lospec-import');
  const lospecInput = document.getElementById('palette-lospec-url');
  if (lospecBtn && lospecInput) {
    lospecBtn.addEventListener('click', () => importFromText(lospecInput.value));
    lospecInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') importFromText(lospecInput.value);
    });
  }

  // .pal/.gbp single-file import in editor
  const palFileInput = document.getElementById('palette-pal-input');
  const loadPalBtn   = document.getElementById('btn-load-pal-file');
  if (loadPalBtn && palFileInput) {
    loadPalBtn.addEventListener('click', () => palFileInput.click());
    palFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handlePalFileImport(file);
      e.target.value = '';
    });
  }

  // .pal/.gbp export from editor
  document.getElementById('palette-modal-export-pal')?.addEventListener('click', exportEditorAsPal);
  document.getElementById('palette-modal-export-gbp')?.addEventListener('click', exportEditorAsGbp);

  document.getElementById('btn-export-palettes').addEventListener('click', exportPalettesJson);

  // Palette-bar Import: accepts .json, .pal, .gbp (multi-file)
  document.getElementById('btn-import-palettes').addEventListener('click', () => {
    document.getElementById('palette-import-input').click();
  });
  document.getElementById('palette-import-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    // If all .json — use old single-file importer for backwards compat
    const allJson = files.every(f => f.name.toLowerCase().endsWith('.json'));
    if (allJson && files.length === 1) {
      importPalettesJson(files[0]);
    } else {
      await batchImportPaletteFiles(files);
    }
    e.target.value = '';
  });

  // Close modal on overlay click
  document.getElementById('palette-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('palette-modal')) closePaletteEditor();
  });
}

// ── Border picker ─────────────────────────────────────────────────────────────

function setupBorderPicker() {
  const grid = document.getElementById('border-frame-grid');
  if (!grid) return;

  BORDER_FRAMES.forEach(({ id, label }) => {
    const btn = document.createElement('button');
    btn.className = 'border-frame-btn';
    btn.dataset.frameId = id;
    btn.title = `Frame ${label}`;

    const img = document.createElement('img');
    img.src = `../frames/${id}.png`;
    img.alt = label;
    img.draggable = false;
    btn.appendChild(img);
    const lbl = document.createElement('span');
    lbl.textContent = label;
    btn.appendChild(lbl);

    btn.addEventListener('click', () => {
      pushUndo();
      setScopedSetting('borderId', id);
      document.querySelectorAll('.border-frame-btn').forEach(b => b.classList.toggle('active', b.dataset.frameId === id));
      repaintGrid();
      updateSidebarPreview();
    });

    grid.appendChild(btn);
  });

  // Restore active state
  const currentId = state.borderId;
  grid.querySelectorAll('.border-frame-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.frameId === currentId);
  });
}

// ── Collapsible sidebar sections ──────────────────────────────────────────────

function setupCollapsibleSections() {
  const STORAGE_KEY = 'darkroom:section-states'; // object map of sectionId → isCollapsed
  let sectionStates = {};
  try { sectionStates = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch(_) {}

  function saveState(sectionId, isCollapsed) {
    sectionStates[sectionId] = isCollapsed;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sectionStates)); } catch(_) {}
  }

  document.querySelectorAll('#export-controls .ctrl-group.collapsible').forEach(group => {
    // Find the header: .tone-header, .ctrl-header-row, or a direct .ctrl-label child
    const clickTarget = group.querySelector(':scope > .tone-header')
                     || group.querySelector(':scope > .ctrl-header-row')
                     || group.querySelector(':scope > .ctrl-label');
    if (!clickTarget) return;

    const labelEl  = clickTarget.classList.contains('ctrl-label')
                       ? clickTarget
                       : clickTarget.querySelector('.section-label, .ctrl-label');
    const sectionId = labelEl ? labelEl.textContent.trim() : (group.id || 'section');
    group.dataset.sectionId = sectionId;

    // Inject chevron before the label text
    if (labelEl) {
      const chevron = document.createElement('span');
      chevron.className = 'section-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      chevron.textContent = '▾';
      labelEl.prepend(chevron);
    }

    // Wrap all siblings after the header into a collapsible body
    const allChildren  = [...group.children];
    const headerIdx    = allChildren.indexOf(clickTarget);
    const bodyChildren = allChildren.slice(headerIdx + 1);
    if (bodyChildren.length === 0) return;

    const outer = document.createElement('div');
    outer.className = 'section-body-outer';
    const inner = document.createElement('div');
    inner.className = 'section-body-inner';
    bodyChildren.forEach(c => inner.appendChild(c));
    outer.appendChild(inner);
    group.appendChild(outer);

    // Use saved state if available; otherwise use data-default-collapsed attribute
    const defaultCollapsed = group.getAttribute('data-default-collapsed') === 'true';
    const isCollapsed = sectionId in sectionStates ? sectionStates[sectionId] : defaultCollapsed;
    if (isCollapsed) group.classList.add('collapsed');

    // Toggle on click — ignore clicks on buttons and checkboxes inside the header
    clickTarget.style.cursor = 'pointer';
    clickTarget.addEventListener('click', e => {
      if (e.target.closest('button, input, .section-check-wrap')) return;
      if (e.target !== clickTarget && e.target !== labelEl &&
          !e.target.classList.contains('section-chevron')) return;
      const nowCollapsed = group.classList.toggle('collapsed');
      saveState(sectionId, nowCollapsed);
    });
  });
}


// ── Multi-select and sidebar preview helpers ───────────────────────────────────────


function updateSidebarPreview() {
  const canvas = document.getElementById('sidebar-preview-canvas');
  const emptyEl = document.getElementById('sidebar-preview-empty');

  const idx = state.selectedIndex;
  const photo = idx !== null ? state.photos[idx] : null;

  if (!canvas || !photo || photo.isEmpty) {
    if (emptyEl) emptyEl.style.display = 'block';
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  hideGifPreviewInfo(); // hide GIF frame counter when showing static preview

  const SCALE = 4; // match THUMB_SCALE — ensures filter appearance matches grid thumbnails
  const eff = getEffectiveSettings(idx);
  const hasBorderPrev = eff.borderEnabled && eff.borderId;
  const W = (hasBorderPrev ? 160 : GBCam.PHOTO_WIDTH)  * SCALE;
  const H = (hasBorderPrev ? 144 : GBCam.PHOTO_HEIGHT) * SCALE;

  // Update canvas resolution and container aspect ratio
  canvas.width  = W;
  canvas.height = H;
  const previewWrap = document.getElementById('sidebar-preview-wrap');
  if (previewWrap) previewWrap.style.aspectRatio = hasBorderPrev ? '160/144' : '8/7';

  const tmp = document.createElement('canvas');
  const tmpCtx = tmp.getContext('2d', { willReadFrequently: true });

  renderPhotoComplete(tmpCtx, photo, eff, SCALE, idx);

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
}


// ── Effect Presets ──────────────────────────────────────────────────────────

const PRESET_KEY = 'dmgdr:presets:v1';

function getPresets() {
  try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '{}'); }
  catch { return {}; }
}

function savePreset(name) {
  if (!name) return;
  // Capture the effective settings of the currently selected/viewed photo.
  // If no photo is selected, fall back to global state.
  const idx = state.selectedIndex;
  const eff = idx !== null ? getEffectiveSettings(idx) : null;
  const src = {
    activeFilters:   eff ? [...eff.activeFilters]                          : [...state.activeFilters],
    filterIntensity: eff ? eff.filterIntensity                             : state.filterIntensity,
    filterVariant:   eff ? eff.filterVariant                               : state.filterVariant,
    filterParams:    JSON.parse(JSON.stringify(eff ? eff.filterParams      : state.filterParams)),
    brightness:      eff ? eff.brightness                                  : state.brightness,
    contrast:        eff ? eff.contrast                                    : state.contrast,
    toneIntensity:   eff ? eff.toneIntensity                               : state.toneIntensity,
    shadowColor:     eff ? eff.shadowColor                                 : state.shadowColor,
    highlightColor:  eff ? eff.highlightColor                              : state.highlightColor,
    toneBalance:     eff ? eff.toneBalance                                 : state.toneBalance,
    borderId:        eff ? eff.borderId                                    : state.borderId,
    borderEnabled:   eff ? eff.borderEnabled                              : state.borderEnabled,
  };
  const presets = getPresets();
  presets[name] = src;
  localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
  renderPresetList();
  showToast(`Preset "${name}" saved`);
}

function loadPreset(name) {
  const presets = getPresets();
  const p = presets[name];
  if (!p) return;

  // Apply to selected photos only (per-photo overrides).
  // If nothing explicitly selected, apply to the current single-selected photo.
  const targets = state.selectedPhotos.size > 0
    ? [...state.selectedPhotos]
    : state.selectedIndex !== null ? [state.selectedIndex] : [];

  if (targets.length === 0) { showToast('Select a photo first'); return; }

  for (const idx of targets) {
    if (!state.photoSettings[idx]) state.photoSettings[idx] = {};
    const ps = state.photoSettings[idx];
    if (p.activeFilters  !== undefined) ps.activeFilters  = [...p.activeFilters];
    if (p.filterIntensity !== undefined) ps.filterIntensity = p.filterIntensity;
    if (p.filterVariant  !== undefined) ps.filterVariant  = p.filterVariant;
    if (p.filterParams)                  ps.filterParams   = JSON.parse(JSON.stringify(p.filterParams));
    if (p.brightness     !== undefined) ps.brightness     = p.brightness;
    if (p.contrast       !== undefined) ps.contrast       = p.contrast;
    if (p.toneIntensity  !== undefined) ps.toneIntensity  = p.toneIntensity;
    if (p.shadowColor    !== undefined) ps.shadowColor    = p.shadowColor;
    if (p.highlightColor !== undefined) ps.highlightColor = p.highlightColor;
    if (p.toneBalance    !== undefined) ps.toneBalance    = p.toneBalance;
    if (p.borderId       !== undefined) ps.borderId       = p.borderId;
    if (p.borderEnabled  !== undefined) ps.borderEnabled  = p.borderEnabled;
  }

  // Repaint affected thumbnails
  for (const idx of targets) repaintGridSlot(idx);

  // Sync sidebar UI to the effective settings of the primary selected photo
  if (state.selectedIndex !== null) {
    syncControlsToEffectiveSettings(state.selectedIndex);
  }
  updateSidebarPreview();
  if (state.viewMode === 'solo' && state.selectedIndex !== null) renderSoloView(state.selectedIndex);

  const n = targets.length;
  showToast(`Preset "${name}" applied to ${n} photo${n !== 1 ? 's' : ''}`);
}

function deletePreset(name) {
  const presets = getPresets();
  delete presets[name];
  localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
  renderPresetList();
}

function renderPresetList() {
  const sel = document.getElementById('preset-select');
  if (!sel) return;
  const presets = getPresets();
  const names   = Object.keys(presets).sort((a, b) => a.localeCompare(b));
  const prev     = sel.value;
  sel.innerHTML  = '<option value="">— select preset —</option>';
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value       = name;
    opt.textContent = name;
    sel.appendChild(opt);
  }
  // Restore selection if still valid
  if (prev && names.includes(prev)) sel.value = prev;
}

function exportPresets() {
  const presets = getPresets();
  if (Object.keys(presets).length === 0) { showToast('No presets to export'); return; }
  const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'dmg-darkroom-presets.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${Object.keys(presets).length} preset(s)`);
}

// ── Effect copy / paste ──────────────────────────────────────────────────────

function copyEffects() {
  const _cpTgt = state.selectedIndex;
  const _cpEff = _cpTgt !== null ? getEffectiveSettings(_cpTgt) : null;
  const src = _cpEff || state;
  // Resolve paletteId: per-photo override first, then global palette's id
  const cpPaletteId = _cpTgt !== null && state.photoSettings[_cpTgt]?.paletteId
    ? state.photoSettings[_cpTgt].paletteId
    : (state.palette?.id ?? null);
  state.effectClipboard = {
    // Palette
    paletteId:       cpPaletteId,
    // Filters
    activeFilters:   _cpEff ? [..._cpEff.activeFilters] : [...state.activeFilters],
    filterIntensity: src.filterIntensity ?? state.filterIntensity,
    filterVariant:   src.filterVariant   ?? state.filterVariant,
    filterParams:    JSON.parse(JSON.stringify(src.filterParams ?? state.filterParams)),
    // Tone / exposure
    brightness:      src.brightness     ?? state.brightness,
    contrast:        src.contrast       ?? state.contrast,
    toneIntensity:   src.toneIntensity  ?? state.toneIntensity,
    shadowColor:     src.shadowColor    ?? state.shadowColor,
    highlightColor:  src.highlightColor ?? state.highlightColor,
    toneBalance:     src.toneBalance    ?? state.toneBalance,
  };
  document.querySelectorAll('.btn-paste-effects').forEach(b => b.disabled = false);
  showToast('All settings copied');
}

function pasteEffects() {
  if (!state.effectClipboard) return;
  pushUndo();
  const cb = state.effectClipboard;
  const targets = state.selectedPhotos.size > 0
    ? [...state.selectedPhotos]
    : state.selectedIndex !== null ? [state.selectedIndex] : [];
  if (targets.length === 0) { showToast('Select a photo to paste to'); return; }
  for (const idx of targets) {
    if (!state.photoSettings[idx]) state.photoSettings[idx] = {};
    const ps = state.photoSettings[idx];
    // Palette
    if (cb.paletteId) ps.paletteId = cb.paletteId;
    // Filters
    ps.filterIntensity = cb.filterIntensity;
    ps.filterVariant   = cb.filterVariant;
    ps.filterParams    = JSON.parse(JSON.stringify(cb.filterParams));
    ps.activeFilters   = [...cb.activeFilters];
    // Tone / exposure
    ps.brightness      = cb.brightness;
    ps.contrast        = cb.contrast;
    ps.toneIntensity   = cb.toneIntensity;
    ps.shadowColor     = cb.shadowColor;
    ps.highlightColor  = cb.highlightColor;
    ps.toneBalance     = cb.toneBalance;
  }
  updateFilterUI();
  _refreshFilterParamPanel();
  syncControlsToEffectiveSettings(state.selectedIndex);
  repaintGrid();
  showToast(`Settings pasted to ${targets.length} photo${targets.length > 1 ? 's' : ''}`);
}

function resetEffects() {
  pushUndo();
  // Reset all filter state for selected photo(s), or global if none selected
  const targets = state.selectedPhotos.size > 0
    ? [...state.selectedPhotos]
    : state.selectedIndex !== null ? [state.selectedIndex] : null;
  if (targets) {
    for (const idx of targets) {
      if (!state.photoSettings[idx]) state.photoSettings[idx] = {};
      const ps = state.photoSettings[idx];
      ps.activeFilters   = [];
      ps.filterParams    = buildDefaultFilterParams();
      ps.filterIntensity = 1.0;
      ps.filterVariant   = 'medium';
    }
  } else {
    state.activeFilters.clear();
    state.filterParams    = buildDefaultFilterParams();
    state.filterIntensity = 1.0;
    state.filterVariant   = 'medium';
  }
  updateFilterUI();
  repaintGrid();
  updateSidebarPreview();
  showToast('Effects reset');
}

function clearGifFrames() {
  if (state.gifFrameOrder.length === 0) return;
  state.gifFrameOrder = [];
  state.gifSelection.clear();
  dom.photoGrid.querySelectorAll('.photo-slot').forEach(el => {
    el.classList.remove('selected-for-gif');
    el.removeAttribute('data-gif-frame');
  });
  updateGifCount();
  renderGifFrameStrip();
  updateGifPreview();
  showToast('Frames cleared');
}

function updateFilterOrder(repaint = false) {
  // Capture the current DOM order of .fi-item elements and update state.filterOrder
  const items = document.querySelectorAll('.fi-item');
  const newOrder = Array.from(items).map(item => item.dataset.filter);
  state.filterOrder = newOrder;
  localStorage.setItem('filterOrder', JSON.stringify(newOrder));
  if (repaint) {
    repaintGrid();
    if (state.viewMode === 'solo' && state.selectedIndex !== null) renderSoloView(state.selectedIndex);
    if (state.lightboxOpen && state.selectedIndex !== null) renderLightbox(state.selectedIndex);
    updateSidebarPreview();
  }
}

function setFrameFilterSnapshot(frameIndex) {
  // Capture current filter settings and store in gifFrameOrder[frameIndex]
  if (frameIndex < 0 || frameIndex >= state.gifFrameOrder.length) return;
  const frame = state.gifFrameOrder[frameIndex];
  frame.filterSnapshot = {
    activeFilters:   new Set(state.activeFilters),
    filterParams:    JSON.parse(JSON.stringify(state.filterParams)),
    filterIntensity: state.filterIntensity,
    filterVariant:   state.filterVariant,
  };
}

function getFrameFilterSnapshot(frameIndex) {
  // Retrieve filter settings for a specific frame, or undefined if not set
  if (frameIndex < 0 || frameIndex >= state.gifFrameOrder.length) return undefined;
  return state.gifFrameOrder[frameIndex].filterSnapshot;
}

function applyFrameFilterSnapshot(frameIndex) {
  // Apply the filter snapshot for a frame, if it exists
  const snap = getFrameFilterSnapshot(frameIndex);
  if (!snap) return;
  state.activeFilters   = new Set(snap.activeFilters);
  state.filterParams    = JSON.parse(JSON.stringify(snap.filterParams));
  state.filterIntensity = snap.filterIntensity;
  state.filterVariant   = snap.filterVariant;
  updateFilterUI();
  repaintGrid();
}

