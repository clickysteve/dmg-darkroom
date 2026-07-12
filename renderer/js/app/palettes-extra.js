/**
 * palettes-extra.js — Recent/favourite palettes, browse icon, palette grid visualiser
 *
 * Split from app.js. Classic script: shares the global scope with the other
 * app/ files; load order (see index.html) preserves the original execution
 * order and must be kept.
 */

// ── Recent palettes (kept for project file backwards-compat) ──────────────

const RECENT_PALETTES_KEY = 'gbcam_recent_palettes';
const MAX_RECENT_PALETTES = 6;

function loadRecentPalettes() {
  try { return JSON.parse(localStorage.getItem(RECENT_PALETTES_KEY) || '[]'); }
  catch (_) { return []; }
}

function addRecentPalette(id) {
  let recents = loadRecentPalettes().filter(r => r !== id);
  recents.unshift(id);
  recents = recents.slice(0, MAX_RECENT_PALETTES);
  localStorage.setItem(RECENT_PALETTES_KEY, JSON.stringify(recents));
}

function renderRecentPalettes() { /* strip removed — see fav palettes */ }

// ── Favourite palettes ─────────────────────────────────────────────────────

const FAV_PALETTES_KEY = 'gbcam_fav_palettes';
const MAX_FAV_PALETTES = 64; // total you can star
const FAV_PAGE_SIZE    = 16; // max visible at once (hard cap)
let   favOffset        = 0;  // current wheel position
let   _favVisibleCount = 16; // dynamically updated by setupFavCarouselResponsive

function loadFavPalettes() {
  try { return JSON.parse(localStorage.getItem(FAV_PALETTES_KEY) || '[]'); }
  catch (_) { return []; }
}

function isFavPalette(id) { return loadFavPalettes().includes(id); }

function shiftFavOffset(delta) {
  const favs = loadFavPalettes().filter(id => PALETTES[id]);
  if (favs.length <= _favVisibleCount) return;
  favOffset = ((favOffset + delta) % favs.length + favs.length) % favs.length;
  renderFavPalettes();
}

function toggleFavPalette(id) {
  let favs = loadFavPalettes();
  if (favs.includes(id)) {
    favs = favs.filter(f => f !== id);
    // clamp offset so it stays valid after removal
    const newLen = favs.filter(f => PALETTES[f]).length;
    if (newLen <= _favVisibleCount) favOffset = 0;
    else favOffset = Math.min(favOffset, newLen - 1);
  } else {
    if (favs.length >= MAX_FAV_PALETTES) {
      showToast(`Favourites full (${MAX_FAV_PALETTES} max) — remove one first ★`);
      return;
    }
    favs.push(id);
  }
  localStorage.setItem(FAV_PALETTES_KEY, JSON.stringify(favs));
  renderFavPalettes();
  // Sync star state in any open picker list
  document.querySelectorAll(`.pal-item-star[data-palette="${id}"]`).forEach(btn => {
    btn.classList.toggle('starred', isFavPalette(id));
    btn.title = isFavPalette(id) ? 'Remove from favourites' : 'Add to favourites';
  });
  // Sync star state in palette grid
  document.querySelectorAll(`.pgrid-star[data-palette="${id}"]`).forEach(btn => {
    btn.classList.toggle('starred', isFavPalette(id));
  });
}

function renderFavPalettes() {
  const container = document.getElementById('fav-palettes');
  if (!container) return;
  container.innerHTML = '';

  const favs = loadFavPalettes().filter(id => PALETTES[id]);
  const total = favs.length;
  const visible = Math.min(_favVisibleCount, FAV_PAGE_SIZE);
  const hasWheel = total > visible && visible > 0;

  // ‹ left arrow
  if (hasWheel) {
    const left = document.createElement('button');
    left.className = 'fav-nav-btn';
    left.title = 'Previous favourites (-)';
    left.textContent = '‹';
    left.addEventListener('click', () => shiftFavOffset(-1));
    container.appendChild(left);
  }

  // Visible window — wraps around
  const count = Math.min(visible, total);
  for (let i = 0; i < count; i++) {
    const id  = favs[(favOffset + i) % total];
    const pal = PALETTES[id];
    const btn = document.createElement('button');
    btn.className = 'fav-pal-btn' + (getDisplayPaletteId() === id ? ' active' : '');
    btn.title = pal.name;

    const swatch = document.createElement('div');
    swatch.className = 'fav-pal-swatch';
    for (const color of pal.colors) {
      const span = document.createElement('span');
      span.style.background = color;
      swatch.appendChild(span);
    }
    btn.appendChild(swatch);
    btn.addEventListener('click', () => { setPalette(id); renderFavPalettes(); });
    container.appendChild(btn);
  }

  // › right arrow
  if (hasWheel) {
    const right = document.createElement('button');
    right.className = 'fav-nav-btn';
    right.title = 'Next favourites (+)';
    right.textContent = '›';
    right.addEventListener('click', () => shiftFavOffset(1));
    container.appendChild(right);
  }

  // Keep the fav dropdown in sync
  renderFavDropdown();
}

/** Populate the fav-dropdown with clickable palette items (palette bar overflow menu). */
function renderFavDropdown() {
  const dd = document.getElementById('fav-dropdown');
  if (!dd) return;
  const favs = loadFavPalettes().filter(id => PALETTES[id]);
  dd.innerHTML = '';
  if (favs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'overflow-item';
    empty.style.cssText = 'opacity:0.45;cursor:default;pointer-events:none;';
    empty.textContent = 'No favourites yet';
    dd.appendChild(empty);
    return;
  }
  for (const id of favs) {
    const pal = PALETTES[id];
    const item = document.createElement('button');
    item.className = 'overflow-item';
    const swatch = document.createElement('span');
    swatch.className = 'overflow-pal-swatch';
    for (const color of pal.colors) {
      const sq = document.createElement('span');
      sq.style.background = color;
      swatch.appendChild(sq);
    }
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(pal.name));
    item.addEventListener('click', () => {
      dd.classList.add('hidden');
      setPalette(id);
    });
    dd.appendChild(item);
  }
}

// ── Browse button: inject colourful mini-grid icon + update text ────────────

function buildBrowseButtonIcon() {
  const btn = document.getElementById('btn-palette-grid');
  if (!btn) return;

  // 3 representative palettes × 4 colours = 3-row colour grid
  const ids = ['dmg', 'gbcam_gold', 'gbc_a_up'];
  const cw = 5, ch = 5, gap = 1;
  const cols = 4, rows = ids.length;
  const W = cols * cw + (cols - 1) * gap;
  const H = rows * ch + (rows - 1) * gap;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.classList.add('pgrid-icon');

  ids.forEach((id, row) => {
    const pal = PALETTES[id];
    if (!pal) return;
    pal.colors.slice(0, 4).forEach((color, col) => {
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', col * (cw + gap));
      rect.setAttribute('y', row * (ch + gap));
      rect.setAttribute('width', cw);
      rect.setAttribute('height', ch);
      rect.setAttribute('fill', color);
      svg.appendChild(rect);
    });
  });

  btn.innerHTML = '';
  btn.appendChild(svg);
  const span = document.createElement('span');
  span.textContent = 'All Palettes';
  btn.appendChild(span);
}

// ── Current palette pin — shown at top of picker dropdown ──────────────────

function updateCurrentPalettePin() {
  const pin = document.getElementById('pal-current-pin');
  if (!pin) return;
  pin.innerHTML = '';

  const id = state.palette?.id;
  if (!id) return;
  const pal = state.palette;

  const label = document.createElement('div');
  label.className = 'pal-pin-label';
  label.textContent = 'Active palette';

  const item = document.createElement('div');
  item.className = 'pal-pin-item';

  const swatch = document.createElement('div');
  swatch.className = 'palette-swatch';
  pal.colors.forEach(c => {
    const s = document.createElement('span');
    s.style.background = c;
    swatch.appendChild(s);
  });

  const name = document.createElement('span');
  name.className = 'pal-pin-name';
  name.textContent = pal.name;

  const star = document.createElement('button');
  const isFaved = isFavPalette(id);
  star.className = 'pal-pin-star' + (isFaved ? ' starred' : '');
  star.textContent = '★';
  star.title = isFaved ? 'Remove from favourites' : 'Add to favourites';
  star.addEventListener('click', e => {
    e.stopPropagation();
    toggleFavPalette(id);
    const nowFaved = isFavPalette(id);
    star.classList.toggle('starred', nowFaved);
    star.title = nowFaved ? 'Remove from favourites' : 'Add to favourites';
  });

  item.appendChild(swatch);
  item.appendChild(name);
  item.appendChild(star);
  item.addEventListener('click', () => {
    setPalette(id);
    closePalettePicker();
  });

  pin.appendChild(label);
  pin.appendChild(item);
}

// ── Palette visual grid ────────────────────────────────────────────────────

function openPaletteGrid() {
  const modal = document.getElementById('palette-grid-modal');
  if (!modal) return;
  modal.classList.remove('hidden');

  // Wire up search field (fresh assignment avoids double-listeners)
  const searchEl = document.getElementById('palette-grid-search');
  if (searchEl) {
    searchEl.value = '';
    searchEl.oninput = () => filterPaletteGrid(searchEl.value);
    // Do NOT auto-focus — it traps pointer events away from slider + close button
  }

  // Wire up tile size slider, restoring last saved size
  const sizeSlider = document.getElementById('palette-grid-size');
  if (sizeSlider) {
    const savedSize = localStorage.getItem('gbcam_pgrid_size');
    if (savedSize) sizeSlider.value = savedSize;
    updatePaletteGridSize(parseInt(sizeSlider.value));
    sizeSlider.oninput = () => {
      updatePaletteGridSize(parseInt(sizeSlider.value));
      localStorage.setItem('gbcam_pgrid_size', sizeSlider.value);
    };
  }

  buildPaletteGrid();
}

function updatePaletteGridSize(px) {
  const list = document.getElementById('palette-grid-list');
  if (list) list.style.gridTemplateColumns = `repeat(auto-fill, minmax(min(${px}px, 48%), 1fr))`;
}

function closePaletteGrid() {
  const modal = document.getElementById('palette-grid-modal');
  if (modal) modal.classList.add('hidden');
  renderRecentPalettes(); // update strip after grid closes
}

async function buildPaletteGrid() {
  const list = document.getElementById('palette-grid-list');
  if (!list) return;
  list.innerHTML = '<p style="color:var(--text-3);font-size:12px;padding:8px;">Rendering…</p>';

  // Use selected photo, or first non-empty one
  const photoIdx = state.selectedIndex !== null ? state.selectedIndex
    : state.photos.findIndex(p => !p.isEmpty);
  const photo = (photoIdx >= 0 && !state.photos[photoIdx]?.isEmpty) ? state.photos[photoIdx] : null;

  await new Promise(r => requestAnimationFrame(r));
  list.innerHTML = '';

  const renderQueue = [];
  for (const [id, pal] of Object.entries(PALETTES)) {
    const cell = document.createElement('div');
    cell.className = 'pgrid-cell' + (state.palette.id === id ? ' active' : '');
    cell.dataset.paletteId = id;

    const canvas = document.createElement('canvas');
    canvas.width  = GBCam.PHOTO_WIDTH;
    canvas.height = GBCam.PHOTO_HEIGHT;

    const namEl = document.createElement('div');
    namEl.className = 'pgrid-name';
    namEl.textContent = pal.name;

    // Chunky 4-colour swatch strip
    const swatchRow = document.createElement('div');
    swatchRow.className = 'pgrid-swatches';
    for (const color of pal.colors) {
      const block = document.createElement('span');
      block.style.background = color;
      swatchRow.appendChild(block);
    }

    // Star / favourite button
    const gridStar = document.createElement('button');
    gridStar.className = 'pgrid-star' + (isFavPalette(id) ? ' starred' : '');
    gridStar.dataset.palette = id;
    gridStar.textContent = '★';
    gridStar.title = isFavPalette(id) ? 'Remove from favourites' : 'Add to favourites';
    gridStar.addEventListener('click', e => {
      e.stopPropagation();
      toggleFavPalette(id);
      gridStar.classList.toggle('starred', isFavPalette(id));
    });

    cell.appendChild(canvas);
    cell.appendChild(namEl);
    cell.appendChild(swatchRow);
    cell.appendChild(gridStar);
    list.appendChild(cell);

    cell.addEventListener('click', () => {
      setPalette(id);
      closePaletteGrid();
    });

    renderQueue.push({ canvas, pal, photo });
  }

  // Scroll active palette into view
  const activeCell = list.querySelector('.pgrid-cell.active');
  if (activeCell) activeCell.scrollIntoView({ block: 'center', behavior: 'instant' });

  // Render canvases in RAF batches to keep the UI responsive
  const BATCH = 30;
  for (let i = 0; i < renderQueue.length; i += BATCH) {
    await new Promise(r => requestAnimationFrame(r));
    const batch = renderQueue.slice(i, i + BATCH);
    for (const { canvas, pal, photo: ph } of batch) {
      const ctx = canvas.getContext('2d');
      if (ph) {
        GBCam.renderToCanvas(ctx, ph.pixels, pal, 1);
      } else {
        ctx.fillStyle = pal.colors[0] || '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  }
}

function filterPaletteGrid(query) {
  const q = query.toLowerCase().trim();
  const list = document.getElementById('palette-grid-list');
  if (!list) return;
  list.querySelectorAll('.pgrid-cell').forEach(cell => {
    const name = (cell.querySelector('.pgrid-name')?.textContent || '').toLowerCase();
    cell.style.display = (!q || name.includes(q)) ? '' : 'none';
  });
}

