/**
 * ui-wiring.js — Button wiring, thumbnail size, panel resize, sidebar toggle
 *
 * Split from app.js. Classic script: shares the global scope with the other
 * app/ files; load order (see index.html) preserves the original execution
 * order and must be kept.
 */

// ── Wire up buttons ──────────────────────────────────────────────────────────

function wireButtons() {
  // Welcome screen
  document.getElementById('btn-open-sav').addEventListener('click', async () => {
    const result = await window.api.openSavFile();
    await loadSavFile(result);
  });
  document.getElementById('btn-open-pocket').addEventListener('click', openPocketModal);

  // Home button (title)
  document.getElementById('btn-home')?.addEventListener('click', () => {
    if (state.photos.length > 0) resetToWelcome();
  });

  // Titlebar buttons
  document.getElementById('tb-open-sav').addEventListener('click', async () => {
    const result = await window.api.openSavFile();
    await loadSavFile(result);
  });
  document.getElementById('tb-open-pocket').addEventListener('click', openPocketModal);

  // Palette bar (handled in buildPaletteBar)

  // Scale controls (numeric or 'custom')
  document.querySelectorAll('.scale-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.scale === 'custom' ? 'custom' : parseInt(btn.dataset.scale);
      setExportScale(val);
    });
  });

  // Custom width input
  const customWidthInput = document.getElementById('custom-width');
  if (customWidthInput) {
    customWidthInput.addEventListener('input', updateCustomSizeDisplay);
  }

  // Thumbnail size slider
  const thumbSlider = document.getElementById('thumb-size-slider');
  if (thumbSlider) {
    thumbSlider.addEventListener('input', () => setThumbnailSize(parseInt(thumbSlider.value)));
  }

  // Format controls
  document.querySelectorAll('.fmt-btn').forEach(btn => {
    btn.addEventListener('click', () => setExportFormat(btn.dataset.fmt));
  });

  // Note: filter toggle wiring is handled by the accordion's fi-check elements (injected in buildFilterAccordion).

  // Copy / Paste — wire up all instances (grid header + any others)
  document.querySelectorAll('.btn-copy-effects').forEach(b => b.addEventListener('click', copyEffects));
  document.querySelectorAll('.btn-paste-effects').forEach(b => b.addEventListener('click', pasteEffects));

  // Effects reset button
  document.getElementById('btn-reset-effects')?.addEventListener('click', resetEffects);

  // Effects preview checkbox — controls ALL effects (filters + tone/exposure/splitTone)
  // Checked = effects visible (default); unchecked = original/before view
  const _previewCb = document.getElementById('effects-preview-check');
  if (_previewCb) {
    _previewCb.checked = !state.effectsPreviewMode; // checked = showing effects
    _previewCb.addEventListener('change', () => {
      state.effectsPreviewMode = !_previewCb.checked;
      repaintGrid();
      if (state.viewMode === 'solo' && state.selectedIndex !== null) renderSoloView(state.selectedIndex);
      if (state.lightboxOpen && state.selectedIndex !== null) renderLightbox(state.selectedIndex);
      updateSidebarPreview();
    });
  }

  // Deselect button
  document.getElementById('btn-deselect-all')?.addEventListener('click', () => {
    deselectAll();
  });

  // Preset controls
  document.getElementById('btn-save-preset')?.addEventListener('click', () => {
    const name = prompt('Preset name:');
    if (name && name.trim()) savePreset(name.trim());
  });

  document.getElementById('btn-load-preset')?.addEventListener('click', () => {
    const sel = document.getElementById('preset-select');
    if (sel?.value) loadPreset(sel.value);
    else showToast('Select a preset first');
  });

  document.getElementById('btn-delete-preset')?.addEventListener('click', () => {
    const sel = document.getElementById('preset-select');
    if (!sel?.value) { showToast('Select a preset first'); return; }
    if (confirm(`Delete preset "${sel.value}"?`)) deletePreset(sel.value);
  });

  document.getElementById('btn-export-presets')?.addEventListener('click', exportPresets);

  document.getElementById('btn-import-presets')?.addEventListener('click', () => {
    document.getElementById('preset-import-input')?.click();
  });

  document.getElementById('preset-import-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        if (typeof imported !== 'object' || Array.isArray(imported)) throw new Error('Invalid format');
        const existing = getPresets();
        const merged = { ...existing, ...imported };
        localStorage.setItem(PRESET_KEY, JSON.stringify(merged));
        renderPresetList();
        showToast(`Imported ${Object.keys(imported).length} preset(s)`);
      } catch {
        showToast('Import failed — not a valid preset file');
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // allow re-importing same file
  });

  // Render preset dropdown on load
  renderPresetList();

  // Section enable/disable checkboxes (global sections only)
  document.querySelectorAll('.section-check').forEach(cb => {
    const section = cb.dataset.section;
    cb.checked = state.sectionEnabled[section] ?? false;
    cb.addEventListener('change', () => {
      state.sectionEnabled[section] = cb.checked;
      repaintGrid();
      if (state.viewMode === 'solo' && state.selectedIndex !== null) renderSoloView(state.selectedIndex);
      if (state.lightboxOpen && state.selectedIndex !== null) renderLightbox(state.selectedIndex);
      updateSidebarPreview();
    });
  });

  // Border enable/disable — scoped like borderId (per-photo or global)
  const borderEnabledCb = document.getElementById('border-enabled-check');
  if (borderEnabledCb) {
    borderEnabledCb.checked = state.borderEnabled ?? false;
    borderEnabledCb.addEventListener('change', () => {
      pushUndo();
      setScopedSetting('borderEnabled', borderEnabledCb.checked);
      repaintGrid();
      if (state.viewMode === 'solo' && state.selectedIndex !== null) renderSoloView(state.selectedIndex);
      if (state.lightboxOpen && state.selectedIndex !== null) renderLightbox(state.selectedIndex);
      updateSidebarPreview();
    });
  }

  // Filter scope toggle — "Filters affect border" checkbox (global setting)
  const filterScopeCb = document.getElementById('filter-scope-check');
  if (filterScopeCb) {
    filterScopeCb.checked = state.filterScope === 'full';
    filterScopeCb.addEventListener('change', () => {
      state.filterScope = filterScopeCb.checked ? 'full' : 'photo';
      repaintGrid();
      if (state.viewMode === 'solo' && state.selectedIndex !== null) renderSoloView(state.selectedIndex);
      if (state.lightboxOpen && state.selectedIndex !== null) renderLightbox(state.selectedIndex);
      updateSidebarPreview();
    });
  }

  // Sticky preview pin toggle
  const previewPinBtn = document.getElementById('preview-pin-btn');
  const previewGroup  = document.getElementById('preview-group');
  const PREVIEW_PIN_KEY = 'dmgdr:previewPinned';

  function applyPreviewPin(pinned) {
    if (!previewGroup) return;
    previewGroup.classList.toggle('preview-pinned', pinned);
    if (previewPinBtn) previewPinBtn.classList.toggle('active', pinned);
  }

  if (previewPinBtn && previewGroup) {
    const savedPin = localStorage.getItem(PREVIEW_PIN_KEY) === 'true';
    applyPreviewPin(savedPin);
    previewPinBtn.addEventListener('click', () => {
      const nowPinned = !previewGroup.classList.contains('preview-pinned');
      applyPreviewPin(nowPinned);
      localStorage.setItem(PREVIEW_PIN_KEY, String(nowPinned));
    });
  }

  // Note: intensity slider and CRT variant buttons are now injected dynamically
  // by buildFilterParams into each filter's inline panel — no static wiring needed.

  // Lightbox
  document.getElementById('lb-close').addEventListener('click', closeLightbox);
  document.getElementById('lb-prev').addEventListener('click',  () => lightboxStep(-1));
  document.getElementById('lb-next').addEventListener('click',  () => lightboxStep( 1));
  document.getElementById('lb-export').addEventListener('click', exportSinglePng);
  dom.lbOverlay.addEventListener('click', e => { if (e.target === dom.lbOverlay) closeLightbox(); });

  document.getElementById('lb-transforms').addEventListener('click', e => {
    const btn = e.target.closest('.transform-btn');
    if (!btn || state.selectedIndex === null) return;
    const action = btn.dataset.action;
    if (action === 'fullscreen') { openPresentation(state.selectedIndex); return; }
    applyTransformAction(state.selectedIndex, action);
    _repaintAfterTransform(state.selectedIndex);
  });

  // View mode toggle (Grid / Solo)
  document.getElementById('btn-view-grid')?.addEventListener('click', enterGridMode);
  document.getElementById('btn-view-solo')?.addEventListener('click', enterSoloMode);

  // Solo navigation + transforms
  document.getElementById('solo-prev')?.addEventListener('click', () => soloStep(-1));
  document.getElementById('solo-next')?.addEventListener('click', () => soloStep( 1));
  document.getElementById('solo-transforms')?.addEventListener('click', e => {
    const btn = e.target.closest('.transform-btn');
    if (!btn || state.selectedIndex === null) return;
    const action = btn.dataset.action;
    if (action === 'fullscreen') { openPresentation(state.selectedIndex); return; }
    if (action === 'reset-transform') {
      // Reset ALL edits for this photo — transform + per-photo settings
      const idx = state.selectedIndex;
      delete state.photoTransforms[idx];
      delete state.photoSettings[idx];
      _repaintAfterTransform(idx);
      syncControlsToEffectiveSettings(idx);
      updateSidebarPreview();
      showToast('Photo reset');
      return;
    }
    applyTransformAction(state.selectedIndex, action);
    _repaintAfterTransform(state.selectedIndex);
  });

  // Export buttons
  document.getElementById('btn-export-single').addEventListener('click', exportSinglePng);
  document.getElementById('btn-export-all').addEventListener('click', exportBatchPng);
  document.getElementById('btn-export-gif').addEventListener('click', exportGif);
  document.getElementById('btn-contact-sheet')?.addEventListener('click', exportContactSheet);

  // Clear Edits button
  document.getElementById('btn-reset-all')?.addEventListener('click', clearEdits);

  // Select All button
  document.getElementById('btn-select-all')?.addEventListener('click', () => {
    state.selectedPhotos.clear();
    state.photos.forEach(p => { if (!p.isEmpty) state.selectedPhotos.add(p.index); });
    state.selectedIndex = [...state.selectedPhotos][0] ?? null;
    state.lastSelectedIndex = state.selectedIndex;
    dom.photoGrid.querySelectorAll('.photo-slot:not(.empty)').forEach(el => el.classList.add('multi-selected'));
    if (state.selectedIndex !== null) syncControlsToEffectiveSettings(state.selectedIndex);
    updateSidebarPreview();
  });

  // Tone controls
  setupToneControls();

  // Titlebar: export .sav + project + reload
  document.getElementById('tb-export-sav')?.addEventListener('click', exportSav);
  document.getElementById('tb-save-project')?.addEventListener('click', saveProject);
  document.getElementById('tb-open-project')?.addEventListener('click', openProject);
  document.getElementById('tb-reload-sav')?.addEventListener('click', reloadSav);

  // Grid header: hide empty
  document.getElementById('btn-hide-empty')?.addEventListener('click', toggleHideEmpty);

  // (Photo transform buttons are now in the lightbox footer — see #lb-transforms above)

  // Presentation overlay
  dom.presClose?.addEventListener('click', closePresentation);
  dom.presPrev?.addEventListener('click',  () => presentationStep(-1));
  dom.presNext?.addEventListener('click',  () => presentationStep( 1));
  dom.presentationOverlay?.addEventListener('click', e => {
    if (e.target === dom.presentationOverlay) closePresentation();
  });

  // Palette grid
  document.getElementById('btn-palette-grid').addEventListener('click', openPaletteGrid);
  document.getElementById('palette-grid-close').addEventListener('click', closePaletteGrid);

  // Random palette dice button
  document.getElementById('btn-random-palette').addEventListener('click', () => {
    const ids = Object.keys(PALETTES);
    const id  = ids[Math.floor(Math.random() * ids.length)];
    setPalette(id);
    showToast(`🎲 ${PALETTES[id].name}`);
  });

  // GIF toolbar
  document.getElementById('btn-gif-clear')?.addEventListener('click', clearGifFrames);

  document.getElementById('gif-cancel').addEventListener('click', () => {
    setExportFormat('png');
    // Reset format buttons
    document.querySelectorAll('.fmt-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.fmt === 'png');
    });
  });

  // GIF loop mode
  document.querySelectorAll('.gif-loop-btn').forEach(btn => {
    btn.addEventListener('click', () => setGifLoop(btn.dataset.loop));
  });

  // GIF border toggle — include each frame's border in the exported GIF (and preview)
  document.getElementById('gif-borders')?.addEventListener('change', (e) => {
    state.gifBorders = e.target.checked;
    if (state.gifMode && state.gifSelection.size > 0) updateGifPreview();
  });

  // GIF delay slider
  dom.gifDelay.addEventListener('input', () => {
    state.gifDelay = parseInt(dom.gifDelay.value);
    dom.gifDelayVal.textContent = `${state.gifDelay}ms`;
    if (state.gifMode && state.gifSelection.size > 1) updateGifPreview();
  });

  // Pocket modal
  document.getElementById('pocket-cancel').addEventListener('click', closePocketModal);
  dom.pocketConfirm.addEventListener('click', confirmPocketOpen);

  // Menu events from main process
  window.api.onMenuOpenSav(async () => {
    const result = await window.api.openSavFile();
    await loadSavFile(result);
  });
  window.api.onMenuOpenPocket(() => openPocketModal());
  window.api.onMenuExportAll(() => {
    if (state.photos.length > 0) exportBatchPng();
  });
}

// ── Thumbnail size ────────────────────────────────────────────────────────────

function setThumbnailSize(px) {
  // min(${px}px, 48%) caps the column minimum at just under half the container
  // width, guaranteeing at least 2 columns always fit — eliminates the deadzone
  // where the slider top-end does nothing because only 1 column is placed.
  dom.photoGrid.style.gridTemplateColumns = `repeat(auto-fill, minmax(min(${px}px, 48%), 1fr))`;
}

// ── Panel resize (drag handle between grid and detail panel) ─────────────────

// ── Sidebar overlay toggle (tablet ≤1024px) ──────────────────────────────────

function setupSidebarToggle() {
  const toggleBtn = document.getElementById('btn-sidebar-toggle');
  const backdrop  = document.getElementById('sidebar-backdrop');
  const app       = document.getElementById('app');
  if (!toggleBtn || !backdrop || !app) return;

  const open  = () => { app.classList.add('sidebar-open');    toggleBtn.textContent = '‹'; toggleBtn.title = 'Close editing panel'; };
  const close = () => { app.classList.remove('sidebar-open'); toggleBtn.textContent = '›'; toggleBtn.title = 'Show editing panel'; };

  toggleBtn.addEventListener('click', () => {
    app.classList.contains('sidebar-open') ? close() : open();
  });
  backdrop.addEventListener('click', close);

  // Auto-close when viewport expands back to desktop size
  window.addEventListener('resize', () => {
    if (window.innerWidth > 1024) close();
  });
}

/** Responsive fav carousel: measures available width and adjusts visible chip count dynamically. */
function setupFavCarouselResponsive() {
  const container = document.getElementById('fav-palettes');
  const btnMenu   = document.getElementById('btn-fav-menu');
  if (!container || !btnMenu) return;

  // Chip width: swatch (4 × 11px) + 2×padding(2px) + 2×border(2px) = 52px + 3px gap = 55px
  const FAV_CHIP_PX  = 55;
  // Two nav arrow buttons when wheel is active: 20px each + 3px gap each side = 46px
  const NAV_ARROW_PX = 46;

  let _lastCount = -1;
  let _rafId = null;

  function update() {
    _rafId = null;
    const favs  = loadFavPalettes().filter(id => PALETTES[id]);
    const total = favs.length;

    // Measure available width with menu button hidden (true remaining space)
    const menuWasVisible = btnMenu.style.display !== 'none';
    btnMenu.style.display = 'none';
    const available = container.clientWidth;
    if (menuWasVisible) btnMenu.style.display = ''; // restore to re-evaluate below

    // Calculate visible count, accounting for nav arrows if needed
    let count = Math.floor(available / FAV_CHIP_PX);
    if (total > count && count > 0) {
      // Arrows eat NAV_ARROW_PX — reduce count with arrow overhead
      count = Math.max(0, Math.floor((available - NAV_ARROW_PX) / FAV_CHIP_PX));
    }
    count = Math.min(count, FAV_PAGE_SIZE);

    const showMenu = count === 0 && total > 0;
    btnMenu.style.display = showMenu ? 'inline-flex' : 'none';

    if (count !== _lastCount) {
      _lastCount = count;
      _favVisibleCount = Math.max(0, count);
      renderFavPalettes();
    }
  }

  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      if (_rafId) return;
      _rafId = requestAnimationFrame(update);
    }).observe(container);
  }

  // Initial call after layout settles
  requestAnimationFrame(update);
}

/** Sidebar collapse/expand tab — visible at desktop, hidden at tablet (overlay uses #btn-sidebar-toggle). */
function setupSidebarCollapse() {
  const btn    = document.getElementById('sidebar-collapse-btn');
  const panel  = document.getElementById('detail-panel');
  const handle = document.getElementById('panel-resize-handle');
  const app    = document.getElementById('app');
  if (!btn || !panel || !app) return;

  const STORED_KEY = 'gbcam_sidebar_collapsed';

  const isDesktop = () => window.innerWidth > 1024;

  function doCollapse(save = true) {
    // Clear any inline width set by drag-resize so the CSS class rule can take effect
    panel.style.width = '';
    panel.style.flex  = '';
    app.classList.add('sidebar-collapsed');
    btn.textContent = '›';
    btn.title = 'Expand sidebar';
    if (handle) handle.style.cursor = 'default';
    if (save) localStorage.setItem(STORED_KEY, '1');
    setTimeout(() => window.dispatchEvent(new Event('resize')), 200);
  }
  function doExpand(save = true) {
    // Clear any inline width so the panel returns to its CSS-defined width
    panel.style.width = '';
    panel.style.flex  = '';
    app.classList.remove('sidebar-collapsed');
    btn.textContent = '‹';
    btn.title = 'Collapse sidebar';
    if (handle) handle.style.cursor = '';
    if (save) localStorage.setItem(STORED_KEY, '0');
    setTimeout(() => window.dispatchEvent(new Event('resize')), 200);
  }

  // Restore persisted state (only at desktop — tablet overlay ignores this)
  if (isDesktop() && localStorage.getItem(STORED_KEY) === '1') doCollapse(false);

  // When crossing the 1024px breakpoint, sync the collapsed class appropriately
  let _wasDesktop = isDesktop();
  window.addEventListener('resize', () => {
    const nowDesktop = isDesktop();
    if (nowDesktop === _wasDesktop) return;
    _wasDesktop = nowDesktop;
    if (!nowDesktop) {
      // Going tablet: remove sidebar-collapsed so overlay system isn't blocked
      app.classList.remove('sidebar-collapsed');
    } else {
      // Going desktop: restore from storage
      if (localStorage.getItem(STORED_KEY) === '1') doCollapse(false);
    }
  });

  // Stop the mousedown on the button from triggering a resize drag
  btn.addEventListener('mousedown', e => e.stopPropagation());
  btn.addEventListener('click', () => {
    app.classList.contains('sidebar-collapsed') ? doExpand() : doCollapse();
  });
}

function setupPanelResize() {
  const handle = document.getElementById('panel-resize-handle');
  const detailPanel = document.getElementById('detail-panel');
  if (!handle || !detailPanel) return;

  let startX, startWidth;

  handle.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startWidth = detailPanel.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(e) {
      const dx = startX - e.clientX; // dragging left = panel wider
      const newWidth = Math.max(260, Math.min(600, startWidth + dx));
      detailPanel.style.width = `${newWidth}px`;
      detailPanel.style.flex = 'none';
    }

    function onUp() {
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}

