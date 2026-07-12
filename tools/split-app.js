#!/usr/bin/env node
/**
 * split-app.js — one-shot migration: split renderer/js/app.js into ordered
 * module files. Slices are contiguous, so concatenating the new files in
 * load order reproduces app.js byte-for-byte (verified before writing).
 *
 * Kept in tools/ for the record; not needed after the migration.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'renderer', 'js', 'app.js');
const OUT_DIR = path.join(ROOT, 'renderer', 'js', 'app');

// [startLine (1-based), filename, description]
const SLICES = [
  [1,    'core-render.js',    'App version, border frames, photo render pipeline, colour utils'],
  [356,  'filter-defs.js',    'Filter definitions (single source of truth for UI + defaults)'],
  [458,  'state.js',          'Global state, DOM refs, per-photo settings helpers, toast, status bar'],
  [759,  'grid-views.js',     'Save loading, transforms, thumbnail cache, grid, repaints, solo view, lightbox'],
  [1330, 'palette-core.js',   'Palette selection and picker button'],
  [1381, 'export-png.js',     'Export scale/format controls, single + batch PNG export'],
  [1488, 'gif.js',            'GIF mode, frame strip, GIF export'],
  [1891, 'file-open.js',      'Analogue Pocket modal, drag & drop'],
  [2027, 'ui-wiring.js',      'Button wiring, thumbnail size, panel resize, sidebar toggle'],
  [2539, 'palettes-ui.js',    'Custom palettes, palette editor, .pal/.gbp, smart import, picker UI'],
  [3277, 'gif-preview.js',    'GIF frame numbering and live preview loop'],
  [3390, 'palettes-extra.js', 'Recent/favourite palettes, browse icon, palette grid visualiser'],
  [3779, 'filters-engine.js', 'CPU filter implementations and tone adjustments'],
  [4911, 'sav-io.js',         'Raw .sav export, image → .sav import (dithering)'],
  [5055, 'project.js',        'Project files (.gbcp), hide-empty toggle, reload'],
  [5261, 'presentation.js',   'Fullscreen presentation, contact sheet, frame duplication'],
  [5401, 'keyboard.js',       'Keyboard navigation and shortcuts'],
  [5572, 'sidebar-wiring.js', 'Tone controls, border picker, collapsible sections, presets, copy/paste'],
  [6164, 'undo.js',           'Undo / redo'],
  [6224, 'filters-ui.js',     'Filter toggles, accordion, filter parameter UI'],
  [6582, 'app-init.js',       'Overflow menus, init()'],
];

const src = fs.readFileSync(SRC, 'utf8');
const lines = src.split('\n');

// Build raw slices
const slices = SLICES.map(([start, name, desc], i) => {
  const end = (i + 1 < SLICES.length) ? SLICES[i + 1][0] - 1 : lines.length;
  return { name, desc, text: lines.slice(start - 1, end).join('\n') + (i + 1 < SLICES.length ? '\n' : '') };
});

// Verify: concatenation must equal the original byte-for-byte
const joined = slices.map(s => s.text).join('');
if (joined !== src) {
  console.error('✗ Slice concatenation does not match app.js — aborting, nothing written.');
  process.exit(1);
}
console.log('✓ Slice concatenation matches app.js byte-for-byte');

// Write files with a banner (banner added AFTER verification)
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const s of slices) {
  const banner = `/**\n * ${s.name} — ${s.desc}\n *\n * Split from app.js. Classic script: shares the global scope with the other\n * app/ files; load order (see index.html) preserves the original execution\n * order and must be kept.\n */\n\n`;
  fs.writeFileSync(path.join(OUT_DIR, s.name), banner + s.text);
  console.log('  wrote renderer/js/app/' + s.name);
}

// Print the script tags to paste into index.html
console.log('\nScript tags (load order):');
for (const s of slices) console.log(`  <script src="js/app/${s.name}"></script>`);
