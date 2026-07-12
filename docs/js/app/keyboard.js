/**
 * keyboard.js — Keyboard navigation and shortcuts
 *
 * Split from app.js. Classic script: shares the global scope with the other
 * app/ files; load order (see index.html) preserves the original execution
 * order and must be kept.
 */

// ── Keyboard navigation ────────────────────────────────────────────────────────

function setupKeyboard() {
  document.addEventListener('keydown', e => {
    // Ignore when typing in an input
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    // Cmd/Ctrl+Z — Undo
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      performUndo();
      return;
    }

    // Shift+Cmd/Ctrl+Z or Ctrl+Y — Redo
    if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && e.shiftKey) ||
        (e.ctrlKey && e.key === 'y')) {
      e.preventDefault();
      performRedo();
      return;
    }

    // Cmd/Ctrl+C — Copy settings
    if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      e.preventDefault();
      copyEffects();
      return;
    }

    // Cmd/Ctrl+V — Paste settings
    if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
      e.preventDefault();
      pasteEffects();
      return;
    }

    // Cmd/Ctrl+A — Select All
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault();
      document.getElementById('btn-select-all')?.click();
      return;
    }

    // P — toggle effects preview (before/after)
    if (e.key === 'p' || e.key === 'P') {
      const previewCb = document.getElementById('effects-preview-check');
      if (previewCb) {
        previewCb.checked = !previewCb.checked;
        previewCb.dispatchEvent(new Event('change'));
      }
      return;
    }

    // Escape — close things (outermost layer first)
    if (e.key === 'Escape') {
      if (state.presentationMode)  { closePresentation(); return; }
      if (state.lightboxOpen)      { closeLightbox(); return; }
      if (document.querySelector('#palette-grid-modal:not(.hidden)')) {
        document.getElementById('palette-grid-close')?.click(); return;
      }
      if (state.gifMode) { exitGifMode(); return; }
      if (state.viewMode === 'solo') { enterGridMode(); return; }
      // Clear selection if anything is selected
      if (state.selectedPhotos.size > 0 || state.selectedIndex !== null) {
        deselectAll();
        return;
      }
      return;
    }

    // Fullscreen (F)
    if (e.key === 'f' || e.key === 'F') {
      if (state.presentationMode) { closePresentation(); return; }
      if (state.selectedIndex !== null) { openPresentation(state.selectedIndex); return; }
    }

    // View mode shortcuts: G = grid, S = solo
    if (e.key === 'g' || e.key === 'G') {
      if (state.photos.length > 0 && state.viewMode !== 'grid') { enterGridMode(); return; }
    }
    if (e.key === 's' || e.key === 'S') {
      if (state.photos.length > 0 && state.selectedIndex !== null && state.viewMode !== 'solo') {
        enterSoloMode(); return;
      }
    }

    // Presentation navigation
    if (state.presentationMode) {
      if (e.key === 'ArrowLeft')  { presentationStep(-1); return; }
      if (e.key === 'ArrowRight') { presentationStep( 1); return; }
      return;
    }

    // Lightbox arrow navigation
    if (state.lightboxOpen) {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); lightboxStep(-1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); lightboxStep( 1); return; }
    }

    // Solo view arrow navigation
    if (state.viewMode === 'solo' && !state.lightboxOpen) {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); soloStep(-1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); soloStep( 1); return; }
      if (e.key === 'ArrowUp')    { e.preventDefault(); soloStep(-1); return; }
      if (e.key === 'ArrowDown')  { e.preventDefault(); soloStep( 1); return; }
    }

    // Photo navigation (only when a file is loaded)
    if (state.photos.length === 0) return;

    if (!state.lightboxOpen && state.viewMode === 'grid' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const filled = state.photos.map((p, i) => i).filter(i => !state.photos[i].isEmpty);
      if (filled.length === 0) return;
      const cur = state.selectedIndex ?? -1;
      const idx = filled.indexOf(cur);
      let next;
      if (e.key === 'ArrowLeft') {
        next = idx <= 0 ? filled[filled.length - 1] : filled[idx - 1];
      } else {
        next = idx === filled.length - 1 ? filled[0] : filled[idx + 1];
      }
      selectPhoto(next);
      dom.photoGrid.querySelector(`[data-index="${next}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }

    if (!state.lightboxOpen && state.viewMode === 'grid' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const all  = state.photos.map((p, i) => i).filter(i => !state.photos[i].isEmpty);
      if (all.length === 0) return;
      const cur  = state.selectedIndex ?? all[0];
      const curPos = all.indexOf(cur);
      const cols = Math.max(1, Math.round(dom.photoGrid.offsetWidth /
        (dom.photoGrid.querySelector('.photo-slot')?.offsetWidth || 140)));
      const step = e.key === 'ArrowUp' ? -cols : cols;
      const next = all[Math.max(0, Math.min(all.length - 1, curPos + step))];
      selectPhoto(next);
      dom.photoGrid.querySelector(`[data-index="${next}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }

    // Space — toggle GIF selection for current photo
    if (e.key === ' ') {
      e.preventDefault();
      if (!state.gifMode) return;
      if (state.selectedIndex === null) return;
      const slot = dom.photoGrid.querySelector(`[data-index="${state.selectedIndex}"]`);
      if (slot && !slot.classList.contains('empty')) {
        toggleGifSelection(state.selectedIndex, slot);
      }
      return;
    }

    // Transform shortcuts (only when a photo is selected)
    if (state.selectedIndex === null) return;
    const photo = state.photos[state.selectedIndex];
    if (!photo || photo.isEmpty) return;

    if (e.key === 'r' && !e.shiftKey) { applyTransformAction(state.selectedIndex, 'rotate-cw');  _repaintAfterTransform(state.selectedIndex); }
    if (e.key === 'l')                { applyTransformAction(state.selectedIndex, 'rotate-ccw'); _repaintAfterTransform(state.selectedIndex); }
    if (e.key === 'r' &&  e.shiftKey) { applyTransformAction(state.selectedIndex, 'rotate-ccw'); _repaintAfterTransform(state.selectedIndex); } // kept for compat
    if (e.key === 'h')                { applyTransformAction(state.selectedIndex, 'flip-h');      _repaintAfterTransform(state.selectedIndex); }
    if (e.key === 'v')                { applyTransformAction(state.selectedIndex, 'flip-v');      _repaintAfterTransform(state.selectedIndex); }
  });

  // Fav carousel navigation: - prev, + next (global, not photo-dependent)
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '-' || e.key === '_') { shiftFavOffset(-1); return; }
    if (e.key === '+' || e.key === '=') { shiftFavOffset( 1); return; }
  });
}

