/**
 * palettes-ui.js — Custom palettes, palette editor, .pal/.gbp, smart import, picker UI
 *
 * Split from app.js. Classic script: shares the global scope with the other
 * app/ files; load order (see index.html) preserves the original execution
 * order and must be kept.
 */

// ── Custom palettes — localStorage persistence ────────────────────────────

const CUSTOM_PALETTES_KEY = 'gbcam_custom_palettes';

function loadCustomPalettes() {
  try {
    const raw = localStorage.getItem(CUSTOM_PALETTES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) { return []; }
}

function saveCustomPalettesToStorage(palettes) {
  localStorage.setItem(CUSTOM_PALETTES_KEY, JSON.stringify(palettes));
}

function getCustomPalettes() {
  return loadCustomPalettes();
}

// Merge custom palettes into the live PALETTES object and rebuild the bar
function refreshCustomPalettes() {
  // Remove old custom entries
  for (const key of Object.keys(PALETTES)) {
    if (PALETTES[key].custom) delete PALETTES[key];
  }
  // Add loaded custom palettes
  for (const pal of loadCustomPalettes()) {
    PALETTES[pal.id] = { ...pal, custom: true };
  }
}

// ── Palette editor modal ──────────────────────────────────────────────────

let editingPaletteId = null; // null = new palette

const SHADE_LABELS = ['Lightest (0)', 'Light (1)', 'Dark (2)', 'Darkest (3)'];

// Perceived brightness using Rec. 601 luminance weights (lightest = highest value)
function perceivedBrightness(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Sort hex color array lightest → darkest
function sortByBrightness(colors) {
  return [...colors].sort((a, b) => perceivedBrightness(b) - perceivedBrightness(a));
}

// Apply an array of 4 hex colors to the open editor (pickers + hex inputs)
function applyColorsToEditor(colors) {
  const rows = document.querySelectorAll('#palette-color-pickers .pal-editor-row');
  colors.forEach((hex, i) => {
    if (!rows[i]) return;
    const picker = rows[i].querySelector('input[type=color]');
    const hexIn  = rows[i].querySelector('input[type=text]');
    const safe = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#000000';
    if (picker) picker.value = safe.toLowerCase();
    if (hexIn)  hexIn.value  = safe.toUpperCase();
  });
  updatePalettePreview();
}

function openPaletteEditor(existingPalette = null) {
  editingPaletteId = existingPalette ? existingPalette.id : null;

  document.getElementById('palette-modal-title').textContent =
    existingPalette ? `Edit: ${existingPalette.name}` : 'New Palette';

  // Clear Lospec status
  const lospecStatus = document.getElementById('lospec-status');
  if (lospecStatus) lospecStatus.textContent = '';
  const lospecUrl = document.getElementById('palette-lospec-url');
  if (lospecUrl) lospecUrl.value = '';

  // Name
  document.getElementById('palette-name-input').value =
    existingPalette ? existingPalette.name : '';

  // Color pickers with paired hex text inputs
  const container = document.getElementById('palette-color-pickers');
  container.innerHTML = '';
  const colors = existingPalette ? existingPalette.colors : ['#FFFFFF', '#AAAAAA', '#555555', '#000000'];

  colors.forEach((color, i) => {
    const row = document.createElement('div');
    row.className = 'pal-editor-row';
    row.style.cssText = 'display:flex; align-items:center; gap:10px;';

    const label = document.createElement('span');
    label.style.cssText = 'font-size:11px; color:var(--text-2); width:82px; flex-shrink:0;';
    label.textContent = SHADE_LABELS[i];

    // Hidden <input type="color"> for value storage + event compatibility
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = color.toLowerCase();
    picker.dataset.shade = i;
    picker.style.display = 'none';

    // Custom swatch button opens inline picker
    const swatchBtn = document.createElement('button');
    swatchBtn.type = 'button';
    swatchBtn.className = 'pal-color-swatch-btn';
    swatchBtn.style.background = color.toLowerCase();
    swatchBtn.addEventListener('click', e => {
      e.stopPropagation();
      openColorPicker(swatchBtn, picker.value, hex => {
        picker.value = hex;
        swatchBtn.style.background = hex;
        hexInput.value = hex.toUpperCase();
        updatePalettePreview();
      });
    });

    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.value = color.toUpperCase();
    hexInput.maxLength = 7;
    hexInput.placeholder = '#RRGGBB';
    hexInput.style.cssText = 'width:80px; padding:4px 6px; border-radius:var(--radius-sm); border:1px solid var(--border); background:var(--surface-2); color:var(--text); font-size:12px; font-family:var(--font-mono); outline:none; -webkit-user-select:text; user-select:text;';

    // Sync hex input → picker + swatch + preview (only when valid)
    hexInput.addEventListener('input', () => {
      const v = hexInput.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        picker.value = v.toLowerCase();
        swatchBtn.style.background = v.toLowerCase();
        updatePalettePreview();
      }
    });

    row.appendChild(label);
    row.appendChild(picker);
    row.appendChild(swatchBtn);
    row.appendChild(hexInput);
    container.appendChild(row);
  });

  // Delete button visibility
  const deleteBtn = document.getElementById('palette-modal-delete');
  deleteBtn.style.display = (existingPalette && existingPalette.custom) ? 'inline-flex' : 'none';

  // Show modal
  document.getElementById('palette-modal').classList.remove('hidden');
  updatePalettePreview();
  document.getElementById('palette-name-input').focus();
}

function closePaletteEditor() {
  document.getElementById('palette-modal').classList.add('hidden');
  editingPaletteId = null;
}

function getCurrentEditorColors() {
  return Array.from(document.querySelectorAll('#palette-color-pickers input[type=color]'))
    .map(p => p.value);
}

function updatePalettePreview() {
  const canvas = document.getElementById('palette-preview-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const colors = getCurrentEditorColors();
  const previewPalette = { colors };

  // Use selected photo, or first non-empty photo; render at 2× into 256×224 canvas
  const idx = state.selectedIndex !== null ? state.selectedIndex
    : state.photos.findIndex(p => !p.isEmpty);

  if (idx >= 0 && state.photos[idx] && !state.photos[idx].isEmpty) {
    GBCam.renderToCanvas(ctx, state.photos[idx].pixels, previewPalette, 2);
  } else {
    ctx.fillStyle = colors[0] || '#FFFFFF';
    ctx.fillRect(0, 0, 256, 224);
  }
}

// ── Analogue Pocket .pal / .gbp format ───────────────────────────────────
//
// .gbp — 16 bytes
//   bytes  0–11: 4 × RGB (lightest → darkest), straight to our convention
//   bytes 12–15: zero padding
//
// .pal — 56 bytes
//   bytes  0–11: BG palette (4 × RGB, stored darkest → lightest)
//   bytes 12–23: Window palette (same)
//   bytes 24–35: OBJ0 palette  (same)
//   bytes 36–47: OBJ1 palette  (same)
//   bytes 48–50: border/LCD-off color
//   byte     51: 0x81 flags
//   bytes 52–55: 'APGB' magic footer

function parseGbpFile(buffer) {
  if (buffer.byteLength < 12) return null;
  const u8 = new Uint8Array(buffer);
  const colors = [];
  for (let i = 0; i < 4; i++) {
    const r = u8[i * 3], g = u8[i * 3 + 1], b = u8[i * 3 + 2];
    colors.push('#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''));
  }
  return colors; // already lightest → darkest
}

function parsePalFile(buffer) {
  if (buffer.byteLength < 12) return null;
  const u8 = new Uint8Array(buffer);
  const colors = [];
  for (let i = 0; i < 4; i++) {
    const r = u8[i * 3], g = u8[i * 3 + 1], b = u8[i * 3 + 2];
    colors.push('#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''));
  }
  // BG section is stored darkest→lightest; reverse to get our convention
  return colors.reverse();
}

function encodeGbpFile(colors) {
  const buf = new Uint8Array(16); // last 4 bytes stay 0x00
  for (let i = 0; i < 4; i++) {
    const n = parseInt(colors[i].replace('#', ''), 16);
    buf[i * 3]     = (n >> 16) & 0xff;
    buf[i * 3 + 1] = (n >> 8)  & 0xff;
    buf[i * 3 + 2] =  n        & 0xff;
  }
  return buf;
}

function encodePalFile(colors) {
  const buf = new Uint8Array(56);
  // .pal stores darkest→lightest, so reverse our convention
  const rev = [...colors].reverse();

  function writePalette(offset) {
    for (let i = 0; i < 4; i++) {
      const n = parseInt(rev[i].replace('#', ''), 16);
      buf[offset + i * 3]     = (n >> 16) & 0xff;
      buf[offset + i * 3 + 1] = (n >> 8)  & 0xff;
      buf[offset + i * 3 + 2] =  n        & 0xff;
    }
  }
  writePalette(0);   // BG
  writePalette(12);  // Window
  writePalette(24);  // OBJ0
  writePalette(36);  // OBJ1

  // Border color = lightest
  const n0 = parseInt(colors[0].replace('#', ''), 16);
  buf[48] = (n0 >> 16) & 0xff;
  buf[49] = (n0 >> 8)  & 0xff;
  buf[50] =  n0        & 0xff;

  buf[51] = 0x81;
  buf[52] = 0x41; // A
  buf[53] = 0x50; // P
  buf[54] = 0x47; // G
  buf[55] = 0x42; // B

  return buf;
}

function downloadBinary(uint8, filename) {
  const blob = new Blob([uint8], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function safeFilename(name) {
  return (name || 'palette').replace(/[^a-z0-9_\-. ]/gi, '_').trim() || 'palette';
}

function exportEditorAsPal() {
  const colors = getCurrentEditorColors();
  const name = safeFilename(document.getElementById('palette-name-input')?.value);
  downloadBinary(encodePalFile(colors), `${name}.pal`);
}

function exportEditorAsGbp() {
  const colors = getCurrentEditorColors();
  const name = safeFilename(document.getElementById('palette-name-input')?.value);
  downloadBinary(encodeGbpFile(colors), `${name}.gbp`);
}

// Parse a single .pal or .gbp file and apply it to the open editor
function handlePalFileImport(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const ext = file.name.toLowerCase().split('.').pop();
    let colors;
    if (ext === 'gbp') {
      colors = parseGbpFile(e.target.result);
    } else if (ext === 'pal') {
      colors = parsePalFile(e.target.result);
    }
    if (!colors || colors.length < 4) {
      showToast('Could not parse palette file');
      return;
    }
    const nameInput = document.getElementById('palette-name-input');
    if (nameInput && !nameInput.value.trim()) {
      nameInput.value = file.name.replace(/\.(pal|gbp)$/i, '');
    }
    applyColorsToEditor(sortByBrightness(colors));
    const statusEl = document.getElementById('lospec-status');
    if (statusEl) {
      statusEl.textContent = `Loaded: ${file.name}`;
      statusEl.style.color = 'var(--accent)';
    }
  };
  reader.readAsArrayBuffer(file);
}

// Batch-import multiple .pal/.gbp/.json files from the palette-bar Import button
async function batchImportPaletteFiles(files) {
  const customs = loadCustomPalettes();
  let added = 0, skipped = 0;

  for (const file of files) {
    const ext = file.name.toLowerCase().split('.').pop();

    if (ext === 'json') {
      // Existing JSON logic (single file, handled inline here)
      try {
        const text = await file.text();
        const incoming = JSON.parse(text);
        if (!Array.isArray(incoming)) continue;
        for (const p of incoming) {
          if (typeof p.name !== 'string') continue;
          if (!Array.isArray(p.colors) || p.colors.length !== 4) continue;
          if (!p.colors.every(c => /^#[0-9a-fA-F]{6}$/.test(c))) continue;
          customs.push({
            id: 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2),
            name: p.name, colors: p.colors, custom: true,
          });
          added++;
        }
      } catch (_) { skipped++; }
    } else if (ext === 'pal' || ext === 'gbp') {
      try {
        const buf = await file.arrayBuffer();
        const colors = ext === 'gbp' ? parseGbpFile(buf) : parsePalFile(buf);
        if (!colors || colors.length < 4) { skipped++; continue; }
        const name = file.name.replace(/\.(pal|gbp)$/i, '');
        customs.push({
          id: 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2),
          name, colors: sortByBrightness(colors), custom: true,
        });
        added++;
      } catch (_) { skipped++; }
    }
  }

  if (added === 0) { showToast('No valid palettes found'); return; }

  saveCustomPalettesToStorage(customs);
  refreshCustomPalettes();
  rebuildPalettePickerList();
  showToast(`Imported ${added} palette${added !== 1 ? 's' : ''}${skipped ? ` (${skipped} skipped)` : ''}`);
}

// ── Smart palette import (URL / hex values / Lospec / coolors) ──────────

async function importFromText(text) {
  const raw = text.trim();
  if (!raw) return;

  const statusEl = document.getElementById('lospec-status');
  function setStatus(msg, color = 'var(--text-3)') {
    if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color; }
  }

  // Extract any 6-digit hex values from the input (handles coolors URLs, pasted lists, etc.)
  const hexMatches = [...raw.matchAll(/(?:#|%23)?([0-9a-fA-F]{6})(?:[^0-9a-fA-F]|$)/g)]
    .map(m => '#' + m[1])
    .filter((c, i, a) => a.indexOf(c) === i); // deduplicate

  // If 2+ hex values present and it's not a Lospec URL, treat as direct hex import
  if (hexMatches.length >= 2 && !raw.toLowerCase().includes('lospec.com')) {
    const colors = sortByBrightness(hexMatches.slice(0, 4));
    applyColorsToEditor(colors);
    const src = raw.includes('coolors.co') ? 'coolors.co' :
                raw.includes('http')       ? new URL(raw).hostname :
                'hex values';
    setStatus(`${colors.length} colors imported from ${src}`, 'var(--accent)');
    return;
  }

  // Lospec: accept full URL, bare domain path, or just a slug
  let slug = raw;
  const lospecMatch = raw.match(/lospec\.com\/palette-list\/([^/?#\s]+)/i);
  if (lospecMatch) slug = lospecMatch[1];
  slug = slug.replace(/\/+$/, '').replace(/\.json$/, '');

  setStatus('Fetching from Lospec…', 'var(--text-3)');

  try {
    if (!window.api?.fetchJson) throw new Error('fetchJson not available');
    const data = await window.api.fetchJson(`https://lospec.com/palette-list/${slug}.json`);

    if (!Array.isArray(data.colors) || data.colors.length < 4) {
      setStatus(`Need 4 colors — palette only has ${data.colors?.length ?? 0}`, 'var(--yellow)');
      return;
    }

    const colors = sortByBrightness(
      data.colors.slice(0, 4).map(c => c.startsWith('#') ? c : '#' + c)
    );

    const nameInput = document.getElementById('palette-name-input');
    if (nameInput && !nameInput.value.trim() && data.name) nameInput.value = data.name;

    applyColorsToEditor(colors);
    setStatus(
      `"${data.name}" imported${data.colors.length > 4 ? ` (first 4 of ${data.colors.length})` : ''}`,
      'var(--accent)'
    );
  } catch (e) {
    setStatus(`Failed: ${e.message}`, '#ff453a');
  }
}

function savePaletteEditor() {
  const name = document.getElementById('palette-name-input').value.trim() || 'Custom';
  const colors = getCurrentEditorColors();

  const customs = loadCustomPalettes();

  if (editingPaletteId) {
    // Update existing
    const i = customs.findIndex(p => p.id === editingPaletteId);
    if (i >= 0) {
      customs[i] = { id: editingPaletteId, name, colors, custom: true };
    }
  } else {
    // New — generate a unique id
    const id = 'custom_' + Date.now();
    customs.push({ id, name, colors, custom: true });
    editingPaletteId = id; // so we can select it after save
  }

  saveCustomPalettesToStorage(customs);
  refreshCustomPalettes();

  // Select the saved palette
  const savedId = editingPaletteId;
  closePaletteEditor();
  rebuildPalettePickerList();
  setPalette(savedId);
  showToast(`Palette "${name}" saved`);
}

function deletePaletteFromEditor() {
  if (!editingPaletteId) return;
  const customs = loadCustomPalettes().filter(p => p.id !== editingPaletteId);
  saveCustomPalettesToStorage(customs);
  refreshCustomPalettes();
  closePaletteEditor();
  rebuildPalettePickerList();
  // Fall back to DMG if deleted palette was selected
  if (state.palette.id === editingPaletteId) setPalette('dmg');
  showToast('Palette deleted');
}

// ── Palette import / export ──────────────────────────────────────────────

function exportPalettesJson() {
  const customs = loadCustomPalettes();
  if (customs.length === 0) { showToast('No custom palettes to export'); return; }

  const json = JSON.stringify(customs.map(({ id, name, colors }) => ({ id, name, colors })), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'gbcam-palettes.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${customs.length} palette${customs.length !== 1 ? 's' : ''}`);
}

function importPalettesJson(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const incoming = JSON.parse(e.target.result);
      if (!Array.isArray(incoming)) throw new Error('Expected an array');

      const validated = incoming.filter(p =>
        typeof p.name === 'string' &&
        Array.isArray(p.colors) && p.colors.length === 4 &&
        p.colors.every(c => /^#[0-9a-fA-F]{6}$/.test(c))
      ).map(p => ({
        id: 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2),
        name: p.name,
        colors: p.colors,
        custom: true,
      }));

      if (validated.length === 0) { showToast('No valid palettes found in file'); return; }

      const existing = loadCustomPalettes();
      saveCustomPalettesToStorage([...existing, ...validated]);
      refreshCustomPalettes();
      rebuildPalettePickerList();
      showToast(`Imported ${validated.length} palette${validated.length !== 1 ? 's' : ''}`);
    } catch (err) {
      showToast(`Import failed: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

// ── Palette picker UI ─────────────────────────────────────────────────────

function buildPalettePickerUI() {
  updatePalettePickerBtn();
  rebuildPalettePickerList();

  const btn      = document.getElementById('palette-picker-btn');
  const dropdown = document.getElementById('palette-picker-dropdown');
  const search   = document.getElementById('palette-picker-search');

  if (btn) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !dropdown.classList.contains('hidden');
      if (isOpen) {
        closePalettePicker();
      } else {
        dropdown.classList.remove('hidden');
        btn.classList.add('open');
        updateCurrentPalettePin(); // refresh active-palette pin at top of list
        if (search) {
          search.value = '';
          filterPaletteList('');
          search.focus();
        }
      }
    });
  }

  if (search) {
    search.addEventListener('input', () => filterPaletteList(search.value));
    // Prevent closing when typing
    search.addEventListener('click', (e) => e.stopPropagation());
  }

  // Close on outside click
  document.addEventListener('click', (e) => {
    const wrap = document.getElementById('palette-picker-wrap');
    if (wrap && !wrap.contains(e.target)) closePalettePicker();
  });

  // Close on Escape — also exits GIF mode / solo mode / clears selections
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (state.lightboxOpen) { closeLightbox(); return; }
      if (state.viewMode === 'solo') { enterGridMode(); return; }
      if (state.gifMode) {
        // Exit GIF mode and reset format buttons back to PNG
        setExportFormat('png');
        document.querySelectorAll('.fmt-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.fmt === 'png');
        });
      }
      closePalettePicker();
      closePaletteGrid();
    }
  });
}

function closePalettePicker() {
  const dropdown = document.getElementById('palette-picker-dropdown');
  const btn      = document.getElementById('palette-picker-btn');
  if (dropdown) dropdown.classList.add('hidden');
  if (btn)      btn.classList.remove('open');
  renderRecentPalettes(); // update strip now that selection session is over
}

const PAL_GROUP_ORDER = [
  'hardware', 'gbc', 'gbc_game', 'gbc_unused',
  'sgb', 'sgb2',
  'community', 'gallery',
  'helllord', 'trashuncle', 'wolfbunny',
  'bgb', 'sameboy',
  'artistic',
];
const PAL_GROUP_LABELS = {
  hardware:   'GB Hardware',
  gbc:        'GBC Official',
  gbc_game:   'GBC Game Palettes',
  gbc_unused: 'GBC Unused',
  sgb:        'Super Game Boy',
  sgb2:       'SGB Vaporwave',
  community:  'Community (Lospec)',
  gallery:    'Community Gallery',
  helllord:   'R.A.Helllord',
  trashuncle: 'Trashuncle',
  wolfbunny:  'TheWolfBunny64',
  bgb:        'BGB Emulator',
  sameboy:    'SameBoy Emulator',
  artistic:   'Artistic',
};

function rebuildPalettePickerList() {
  const list = document.getElementById('palette-picker-list');
  if (!list) return;
  list.innerHTML = '';

  refreshCustomPalettes();

  // Bucket built-in palettes by group
  const grouped = {};
  for (const [id, pal] of Object.entries(PALETTES)) {
    if (pal.custom) continue;
    const g = pal.group || 'other';
    (grouped[g] = grouped[g] || []).push([id, pal]);
  }

  // Render in defined order, then any unexpected groups
  const orderedGroups = [
    ...PAL_GROUP_ORDER,
    ...Object.keys(grouped).filter(g => !PAL_GROUP_ORDER.includes(g)),
  ];

  for (const g of orderedGroups) {
    if (!grouped[g] || grouped[g].length === 0) continue;
    const header = document.createElement('div');
    header.className = 'pal-section-header';
    header.textContent = PAL_GROUP_LABELS[g] || g;
    list.appendChild(header);
    for (const [id, pal] of grouped[g]) {
      list.appendChild(makePalItem(id, pal));
    }
  }

  // Custom section at the bottom
  const customs = Object.entries(PALETTES).filter(([, p]) => p.custom);
  if (customs.length > 0) {
    const customHeader = document.createElement('div');
    customHeader.className = 'pal-section-header';
    customHeader.textContent = 'Custom';
    list.appendChild(customHeader);
    for (const [id, pal] of customs) {
      list.appendChild(makePalItem(id, pal));
    }
  }
}

function makePalItem(id, pal) {
  const item = document.createElement('div');
  item.className = 'pal-item' + (state.palette.id === id ? ' active' : '');
  item.dataset.palette = id;

  const swatch = document.createElement('div');
  swatch.className = 'palette-swatch';
  for (const color of pal.colors) {
    const span = document.createElement('span');
    span.style.background = color;
    swatch.appendChild(span);
  }

  const name = document.createElement('span');
  name.className = 'pal-item-name';
  name.textContent = pal.name;

  item.appendChild(swatch);
  item.appendChild(name);

  // Credit attribution for community palettes
  if (pal.credit) {
    const credit = document.createElement('a');
    credit.className = 'pal-item-credit';
    credit.textContent = pal.credit;
    if (pal.creditUrl) {
      credit.href = pal.creditUrl;
      credit.target = '_blank';
      credit.rel = 'noopener';
      credit.addEventListener('click', e => e.stopPropagation());
    }
    item.appendChild(credit);
  }

  if (pal.custom) {
    const editBtn = document.createElement('button');
    editBtn.className = 'pal-item-edit';
    editBtn.textContent = 'Edit';
    editBtn.title = 'Edit palette';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closePalettePicker();
      openPaletteEditor(pal);
    });
    item.appendChild(editBtn);
  }

  // Favourite star button
  const starBtn = document.createElement('button');
  starBtn.className = 'pal-item-star' + (isFavPalette(id) ? ' starred' : '');
  starBtn.dataset.palette = id;
  starBtn.textContent = '★';
  starBtn.title = isFavPalette(id) ? 'Remove from favourites' : 'Add to favourites';
  starBtn.addEventListener('click', e => {
    e.stopPropagation();
    toggleFavPalette(id);
  });
  item.appendChild(starBtn);

  item.addEventListener('click', () => {
    setPalette(id);
    closePalettePicker();
  });

  return item;
}

function filterPaletteList(query) {
  const q = query.toLowerCase().trim();
  const items = document.querySelectorAll('#palette-picker-list .pal-item');
  items.forEach(item => {
    const n = (item.querySelector('.pal-item-name')?.textContent || '').toLowerCase();
    item.style.display = (!q || n.includes(q)) ? '' : 'none';
  });
  // Hide section headers when all their items are hidden
  document.querySelectorAll('#palette-picker-list .pal-section-header').forEach(header => {
    let next = header.nextElementSibling;
    let allHidden = true;
    while (next && !next.classList.contains('pal-section-header')) {
      if (next.style.display !== 'none') { allHidden = false; break; }
      next = next.nextElementSibling;
    }
    header.style.display = allHidden ? 'none' : '';
  });
}

