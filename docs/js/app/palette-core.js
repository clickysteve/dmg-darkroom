/**
 * palette-core.js — Palette selection and picker button
 *
 * Split from app.js. Classic script: shares the global scope with the other
 * app/ files; load order (see index.html) preserves the original execution
 * order and must be kept.
 */

// ── Palette ─────────────────────────────────────────────────────────────────

function setPalette(id) {
  pushUndo();
  const targets = state.selectedPhotos.size > 0 ? [...state.selectedPhotos] : null;
  if (targets) {
    targets.forEach(i => {
      if (!state.photoSettings[i]) state.photoSettings[i] = {};
      state.photoSettings[i].paletteId = id;
    });
  } else {
    state.palette = PALETTES[id];
  }
  addRecentPalette(id);
  const displayId = getDisplayPaletteId();
  updatePalettePickerBtn(PALETTES[displayId] || state.palette);
  renderFavPalettes();
  // Update active highlight in dropdown list
  document.querySelectorAll('.pal-item').forEach(item => {
    item.classList.toggle('active', item.dataset.palette === displayId);
    if (item.dataset.palette === displayId) {
      item.querySelector('.pal-item-name').style.color = '';
    }
  });
  repaintGrid();
}

function updatePalettePickerBtn(pal) {
  pal = pal || state.palette;
  const swatch = document.getElementById('palette-picker-swatch');
  const nameEl = document.getElementById('palette-picker-name');

  function fillSwatch(el) {
    el.innerHTML = '';
    for (const color of pal.colors) {
      const span = document.createElement('span');
      span.style.background = color;
      el.appendChild(span);
    }
  }

  if (swatch) fillSwatch(swatch);
  if (nameEl) nameEl.textContent = pal.name;
}

function buildPaletteBar() {
  buildPalettePickerUI();
  renderFavPalettes();
  buildBrowseButtonIcon();
}

