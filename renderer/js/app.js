/**
 * app.js — DMG DarkRoom renderer
 *
 * Dependencies (loaded via script tags before this file):
 *   - gbcam.js  → window.GBCam
 *   - palettes.js → window.PALETTES, window.paletteToRGB
 */

const APP_VERSION = 'v1.2.5';

// ── Border frames ─────────────────────────────────────────────────────────────

const BORDER_FRAMES = [
  { id: 'int-frame-0',  label: '1'   },
  { id: 'int-frame-1',  label: '2'   },
  { id: 'int-frame-2',  label: '3'   },
  { id: 'int-frame-3',  label: '4'   },
  { id: 'int-frame-4',  label: '5'   },
  { id: 'int-frame-5',  label: '6'   },
  { id: 'int-frame-6',  label: '7'   },
  { id: 'int-frame-7',  label: '8'   },
  { id: 'int-frame-8',  label: '9'   },
  { id: 'int-frame-9',  label: '10'  },
  { id: 'int-frame-10', label: '11'  },
  { id: 'int-frame-11', label: '12'  },
  { id: 'int-frame-12', label: '13'  },
  { id: 'int-frame-13', label: '14'  },
  { id: 'int-frame-14', label: '15'  },
  { id: 'int-frame-15', label: '16'  },
  { id: 'int-frame-16', label: '17'  },
  { id: 'int-frame-17', label: '18'  },
  { id: 'jp-frame-0',   label: 'JP 1' },
  { id: 'jp-frame-1',   label: 'JP 2' },
  { id: 'jp-frame-6',   label: 'JP 3' },
];

const _borderImageCache = {}; // id → HTMLImageElement (loaded)

function preloadBorderImages() {
  BORDER_FRAMES.forEach(({ id }) => {
    const img = new Image();
    img.onload  = () => { _borderImageCache[id] = img; };
    img.onerror = () => console.warn(`Border frame not found: ${id}`);
    img.src = `../frames/${id}.png`;
  });
}

/**
 * Returns a 160×144 canvas with border pixels colorized to the given palette.
 * Photo area (x 16-143, y 16-127) remains transparent.
 * Returns null if the image hasn't loaded yet.
 */
function getColorizedBorderCanvas(borderId, palette) {
  const img = _borderImageCache[borderId];
  if (!img) return null;

  const raw = document.createElement('canvas');
  raw.width  = 160;
  raw.height = 144;
  const rawCtx = raw.getContext('2d', { willReadFrequently: true });
  rawCtx.drawImage(img, 0, 0);

  const imageData = rawCtx.getImageData(0, 0, 160, 144);
  const d = imageData.data;
  const rgb = window.paletteToRGB(palette); // [[r,g,b]×4] — index 0=lightest, 3=darkest

  // Photo window bounds in the 160×144 frame (pixels here stay transparent so the photo shows through)
  const PX1 = 16, PX2 = 143, PY1 = 16, PY2 = 127;

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) {
      // Transparent pixel — check whether it's the photo window or a border area
      const pidx = i / 4;
      const px = pidx % 160;
      const py = Math.floor(pidx / 160);
      if (px >= PX1 && px <= PX2 && py >= PY1 && py <= PY2) {
        // Inside photo window — leave transparent so the photo beneath shows through
        continue;
      }
      // Outside photo window (e.g. film-strip perforations): fill with darkest palette colour
      // so they look the same in exports as they do in the preview (dark page background).
      const [pr, pg, pb] = rgb[3];
      d[i] = pr;  d[i + 1] = pg;  d[i + 2] = pb;  d[i + 3] = 255;
      continue;
    }
    // Non-transparent border pixel — colorize based on brightness
    const R = d[i];
    const gbIdx = Math.min(3, Math.max(0, Math.round((255 - R) * 3 / 255)));
    const [pr, pg, pb] = rgb[gbIdx];
    d[i] = pr;  d[i + 1] = pg;  d[i + 2] = pb;  d[i + 3] = 255;
  }

  rawCtx.putImageData(imageData, 0, 0);
  return raw;
}

/**
 * Render a photo with an optional GB Camera border frame.
 * Falls through to renderPhotoWithTransform when borderId is 'none'.
 * When a border is active the canvas becomes 160×144×scale.
 * eff must contain { palette, borderId }.
 */
function renderPhotoWithBorder(ctx, photo, eff, scale, idx) {
  const borderEnabled = eff.borderEnabled && eff.borderId;
  const borderId = borderEnabled ? eff.borderId : 'none';

  if (borderId === 'none') {
    renderPhotoWithTransform(ctx, photo, eff.palette, scale, idx);
    return;
  }

  const BW = 160 * scale;
  const BH = 144 * scale;
  const OX = 16 * scale;
  const OY = 16 * scale;

  ctx.canvas.width  = BW;
  ctx.canvas.height = BH;
  ctx.clearRect(0, 0, BW, BH);

  // Draw photo (with any transform) into the photo area slot
  const tmpPhoto = document.createElement('canvas');
  const tmpCtx   = tmpPhoto.getContext('2d');
  renderPhotoWithTransform(tmpCtx, photo, eff.palette, scale, idx);
  ctx.drawImage(tmpPhoto, OX, OY);

  // Overlay colorised border (transparent centre reveals photo)
  const borderBase = getColorizedBorderCanvas(borderId, eff.palette);
  if (borderBase) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(borderBase, 0, 0, BW, BH);
  }
}

/**
 * Full render pipeline for a photo: composite → effects → tone.
 * Handles both 'full' scope (effects apply to border+photo) and
 * 'photo' scope (effects applied to photo area only before border composite).
 *
 * Replaces the pattern: renderPhotoWithBorder + applyActiveEffects + applyToneAdjustments
 * at every call site.
 *
 * opts.thumbMode  — omit THUMBNAIL_SKIP_FILTERS (for grid thumbnails)
 * opts.forExport  — pass forExport=true to effects/tone functions
 */
function renderPhotoComplete(ctx, photo, eff, scale, idx, opts = {}) {
  const { thumbMode = false, forExport = false } = opts;

  const borderEnabled = eff.borderEnabled && eff.borderId;
  const photoScopeOnly = eff.filterScope === 'photo' && borderEnabled;

  // Build the filter set (thumbnail mode skips slow filters)
  let filtersToApply = eff.activeFilters;
  if (thumbMode && filtersToApply.size > 0) {
    filtersToApply = new Set([...filtersToApply].filter(id => !THUMBNAIL_SKIP_FILTERS.has(id)));
  }

  if (photoScopeOnly) {
    // Photo-scope: apply effects+tone to the raw 128×112 photo canvas,
    // then composite it behind a clean border.
    const BW = 160 * scale;
    const BH = 144 * scale;
    ctx.canvas.width  = BW;
    ctx.canvas.height = BH;
    ctx.clearRect(0, 0, BW, BH);

    const tmpPhoto = document.createElement('canvas');
    const tmpCtx   = tmpPhoto.getContext('2d', { willReadFrequently: true });
    renderPhotoWithTransform(tmpCtx, photo, eff.palette, scale, idx);
    const PW = tmpPhoto.width;
    const PH = tmpPhoto.height;

    if (filtersToApply.size > 0) {
      applyActiveEffects(tmpCtx, PW, PH, scale, eff.filterIntensity, eff.filterVariant,
                         eff.filterParams, filtersToApply, forExport, idx);
    }
    applyToneAdjustments(tmpCtx, PW, PH, eff, forExport);

    ctx.drawImage(tmpPhoto, 16 * scale, 16 * scale);

    const borderBase = getColorizedBorderCanvas(eff.borderId, eff.palette);
    if (borderBase) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(borderBase, 0, 0, BW, BH);
    }
  } else {
    // Full-scope (default): render photo+border composite first,
    // then apply effects+tone to the full canvas.
    renderPhotoWithBorder(ctx, photo, eff, scale, idx);
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    if (filtersToApply.size > 0) {
      applyActiveEffects(ctx, W, H, scale, eff.filterIntensity, eff.filterVariant,
                         eff.filterParams, filtersToApply, forExport, idx);
    }
    applyToneAdjustments(ctx, W, H, eff, forExport);
  }
}

// ── Color picker helpers ───────────────────────────────────────────────────

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1,3), 16) / 255;
  const g = parseInt(hex.slice(3,5), 16) / 255;
  const b = parseInt(hex.slice(5,7), 16) / 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return '#' + [r, g, b].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

let _colorPickerPanel = null;

function openColorPicker(anchorEl, initialHex, onChange) {
  if (_colorPickerPanel) { _colorPickerPanel.remove(); _colorPickerPanel = null; }

  let [h, s, l] = hexToHsl(initialHex || '#888888');

  const panel = document.createElement('div');
  panel.className = 'color-picker-panel';
  _colorPickerPanel = panel;

  const preview = document.createElement('div');
  preview.className = 'cp-preview';
  preview.style.background = initialHex;
  panel.appendChild(preview);

  const hexInput = document.createElement('input');
  hexInput.type = 'text';
  hexInput.className = 'cp-hex-input';
  hexInput.value = initialHex.toUpperCase();
  hexInput.maxLength = 7;

  function update() {
    const hex = hslToHex(h, s, l);
    preview.style.background = hex;
    hexInput.value = hex.toUpperCase();
    onChange(hex);
  }

  function makeRow(labelTxt, val, min, max, onSliderChange) {
    const row = document.createElement('div');
    row.className = 'cp-slider-row';
    const lbl = document.createElement('span');
    lbl.className = 'cp-slider-label';
    lbl.textContent = labelTxt;
    const sl = document.createElement('input');
    sl.type = 'range'; sl.min = min; sl.max = max; sl.step = 1; sl.value = val;
    const valEl = document.createElement('span');
    valEl.className = 'cp-slider-val';
    valEl.textContent = Math.round(val);
    sl.addEventListener('input', () => {
      valEl.textContent = sl.value;
      onSliderChange(parseFloat(sl.value));
    });
    row.appendChild(lbl); row.appendChild(sl); row.appendChild(valEl);
    return row;
  }

  panel.appendChild(makeRow('H', h, 0, 360, v => { h = v; update(); }));
  panel.appendChild(makeRow('S', s, 0, 100, v => { s = v; update(); }));
  panel.appendChild(makeRow('L', l, 0, 100, v => { l = v; update(); }));

  hexInput.addEventListener('change', () => {
    const v = hexInput.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      [h, s, l] = hexToHsl(v);
      update();
    }
  });
  panel.appendChild(hexInput);

  document.body.appendChild(panel);
  const rect = anchorEl.getBoundingClientRect();
  panel.style.left = `${Math.min(rect.left, window.innerWidth - 230)}px`;
  panel.style.top  = `${Math.min(rect.bottom + 4, window.innerHeight - 250)}px`;

  setTimeout(() => {
    function closeHandler(e) {
      if (!panel.contains(e.target) && e.target !== anchorEl) {
        panel.remove();
        if (_colorPickerPanel === panel) _colorPickerPanel = null;
        document.removeEventListener('mousedown', closeHandler);
      }
    }
    document.addEventListener('mousedown', closeHandler);
  }, 0);
}

/** Wraps a hidden <input type=color> with a visible swatch button that opens
 *  the custom picker. Pass the className for the swatch button. */
function attachColorPickerToInput(input, swatchClass = 'color-swatch-btn') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = swatchClass;
  btn.style.background = input.value;
  input.parentNode.insertBefore(btn, input);

  btn.addEventListener('click', e => {
    e.stopPropagation();
    openColorPicker(btn, input.value, hex => {
      btn.style.background = hex;
      input.value = hex;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  // Keep swatch in sync if input is updated programmatically
  const origDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(input, '_cpBtn', { value: btn, writable: true });
  return btn;
}

// Sync a swatch button to a new value (called when controls are reset/synced)
function syncColorSwatchBtn(input, hex) {
  if (input._cpBtn) input._cpBtn.style.background = hex;
}

const THUMB_SCALE = 4; // grid thumbnails rendered at 4× — fixed scale

// Pixel-dense effects that look garbled / shift on mouseover at thumbnail scale.
// These are skipped during grid repaint — they'll still apply in solo/export views.
const THUMBNAIL_SKIP_FILTERS = new Set(); // all filters render in thumbnails (4× scale is sufficient)

// ── Filter definitions (single source of truth for UI + defaults) ─────────

const FILTER_DEFS = [
  { id: 'crt',      label: 'CRT Scanlines',       params: [
    { type: 'seg',   key: 'variant',   label: 'Scanlines',        def: 'medium',      stateKey: 'filterVariant', opts: [['fine','Fine'],['medium','Medium'],['thick','Thick'],['wide','Wide']] },
    { type: 'seg',   key: 'curve',     label: 'Screen shape',     def: 'none',        opts: [['none','Flat'],['mild','Mild'],['strong','Strong']] },
    { type: 'range', key: 'mix',       label: 'Mix',              def: 100, min: 0,   max: 100, step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'lcd',      label: 'LCD',                  params: [
    { type: 'range', key: 'subpixel',  label: 'Sub-pixel tint',   def: 30, min: 0,   max: 80,  step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'bleed',     label: 'Backlight bleed',  def: 0,  min: 0,   max: 80,  step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'glow',     label: 'Phosphor Glow',        params: [
    { type: 'range', key: 'intensity', label: 'Intensity',        def: 80, min: 0,   max: 100, step: 1,  fmt: v => `${v}%` },
    { type: 'range', key: 'blur',      label: 'Bloom radius',     def: 110, min: 0,  max: 300, step: 5,  fmt: v => `${v}%` },
    { type: 'seg',   key: 'phosphor',  label: 'Phosphor colour',  def: 'none',       opts: [['none','None'],['green','Green'],['amber','Amber'],['blue','Blue']] },
  ]},
  { id: 'vignette', label: 'Vignette',             params: [
    { type: 'range', key: 'falloff',   label: 'Intensity',        def: 50, min: 0,   max: 100, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'shape',     label: 'Shape',            def: 0,  min: 0,   max: 100, step: 1, fmt: v => v <= 5 ? 'Round' : v >= 95 ? 'Square' : `${v}%` },
  ]},
  { id: 'halftone', label: 'Halftone',             params: [
    { type: 'range', key: 'radius',    label: 'Dot size',         def: 38, min: 10,  max: 70,  step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'darkness',  label: 'Darkness',         def: 35, min: 0,   max: 100, step: 1, fmt: v => `${v}%` },
    { type: 'seg',   key: 'shape',     label: 'Dot shape',        def: 'circle',     opts: [['circle','Round'],['square','Square'],['diamond','Diamond']] },
  ]},
  { id: 'dot',      label: 'Dot Matrix',           params: [
    { type: 'range', key: 'radius',    label: 'Dot size',         def: 44, min: 20,  max: 80,  step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'halation',  label: 'Halation',         def: 0,  min: 0,   max: 80,  step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'chroma',   label: 'Chromatic Aberration', params: [
    { type: 'range', key: 'shiftH',    label: 'Horizontal shift', def: 75, min: 0,   max: 500, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'shiftV',    label: 'Vertical shift',   def: 0,  min: 0,   max: 500, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'shiftR',    label: 'Radial shift',     def: 0,  min: -500, max: 500, step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'grid',     label: 'Pixel Grid',           params: [
    { type: 'range', key: 'opacity',   label: 'Grid opacity',     def: 30, min: 1,   max: 100, step: 1,   fmt: v => `${v}%` },
    { type: 'range', key: 'weight',    label: 'Line weight',      def: 1,  min: 1,   max: 5,   step: 0.5, fmt: v => `${v}px` },
  ]},
  { id: 'jitter',   label: 'Scanline Jitter',      params: [
    { type: 'range', key: 'amount',    label: 'Jitter amount',    def: 40, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'frequency', label: 'Frequency',        def: 50, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'noise',    label: 'Noise / Static',       params: [
    { type: 'range', key: 'amount',    label: 'Amount',           def: 40, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
    { type: 'seg',   key: 'type',      label: 'Type',             def: 'film',       opts: [['film','Film'],['static','Static'],['bands','Bands']] },
  ]},
  { id: 'ghosting', label: 'VHS Ghosting',         params: [
    { type: 'range', key: 'offset',    label: 'Echo offset',      def: 60, min: 1,   max: 150, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'fade',      label: 'Echo fade',        def: 70, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'pixsort',   label: 'Pixel Sort',           params: [
    { type: 'range', key: 'threshold', label: 'Threshold',        def: 50, min: 0,   max: 100, step: 1, fmt: v => `${v}%` },
    { type: 'seg',   key: 'direction', label: 'Direction',        def: 'down',       opts: [['down','Down'],['up','Up'],['right','Right'],['left','Left']] },
  ]},
  { id: 'blkglitch', label: 'Block Glitch',         params: [
    { type: 'range', key: 'shift',     label: 'Shift amount',     def: 40, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'density',   label: 'Block count',      def: 30, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'size',      label: 'Block height',     def: 20, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'maxheight', label: 'Max height',       def: 30, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'wavewarp',  label: 'Wave Warp',            params: [
    { type: 'range', key: 'amplitude', label: 'Amplitude',        def: 30, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'frequency', label: 'Frequency',        def: 40, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'zoomblur',  label: 'Zoom Blur',            params: [
    { type: 'range', key: 'amount',    label: 'Amount',           def: 30, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'bayer',    label: 'Bayer Dithering',      params: [
    { type: 'range', key: 'levels',    label: 'Color levels',     def: 4,  min: 2,   max: 8,   step: 1, fmt: v => `${v}` },
  ]},
  { id: 'floyd',    label: 'Floyd-Steinberg',      params: [
    { type: 'range', key: 'levels',    label: 'Levels',           def: 2,  min: 2,   max: 8,   step: 1, fmt: v => `${v}` },
  ]},
  { id: 'interlace', label: 'Interlace',           params: [
    { type: 'range', key: 'intensity', label: 'Intensity',        def: 60, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'chswap',    label: 'Channel Swap',         params: [
    { type: 'seg',   key: 'mode',      label: 'Mode',             def: 'rgb',        opts: [['rgb','RGB'],['rbg','RBG'],['grb','GRB'],['gbr','GBR'],['brg','BRG'],['bgr','BGR']] },
  ]},
  { id: 'rgbplanes', label: 'RGB Planes',           params: [
    { type: 'range', key: 'shift',     label: 'Channel split',    def: 50,  min: 1, max: 300, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'scatter',   label: 'Row scatter',      def: 40,  min: 0, max: 100, step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'colcorrupt', label: 'Color Corrupt',       params: [
    { type: 'range', key: 'density',   label: 'Density',          def: 35,  min: 1, max: 100, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'strength',  label: 'Strength',         def: 65,  min: 1, max: 100, step: 1, fmt: v => `${v}%` },
  ]},
];

function buildDefaultFilterParams() {
  const out = {};
  for (const fd of FILTER_DEFS) {
    out[fd.id] = {};
    for (const p of fd.params) {
      if (p.stateKey) continue; // handled in state directly (e.g. filterVariant)
      out[fd.id][p.key] = p.def;
    }
  }
  return out;
}

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
  filterOrder: ['crt', 'lcd', 'grid', 'vignette', 'halftone', 'dot', 'glow', 'chroma', 'jitter', 'noise', 'ghosting', 'pixsort', 'blkglitch', 'wavewarp', 'zoomblur', 'bayer', 'floyd', 'interlace', 'chswap', 'rgbplanes', 'colcorrupt'],
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

// ── Load SAV ───────────────────────────────────────────────────────────────

async function loadSavFile(result) {
  if (!result || result.error) {
    if (result?.error) showToast(`⚠ ${result.error}`);
    return;
  }

  const { buffer, name, path: filePath } = result;
  const { photos, activeCount, sav } = GBCam.parseSav(buffer);

  state.sav = sav;
  state.photos = photos;
  state.activeCount = activeCount;
  state.filename = name;
  state.filePath = filePath || null;
  state.selectedIndex = null;
  state.gifMode = false;
  state.gifSelection.clear();
  state.photoTransforms = {}; // reset transforms on new file load
  state.photoSettings   = {}; // reset per-photo overrides on new file load
  if (filePath) saveLastSavPath(filePath);

  renderGrid();
  showMainView();
  updateExportSelectedBtn();
  setStatus(`${name} — ${activeCount} photo${activeCount !== 1 ? 's' : ''} found`, true);
}

// ── Photo transforms ────────────────────────────────────────────────────────

/** Get (or default-initialise) the transform for a photo index */
function getTransform(idx) {
  if (!state.photoTransforms[idx]) {
    state.photoTransforms[idx] = { rotate: 0, flipH: false, flipV: false };
  }
  return state.photoTransforms[idx];
}

function hasTransform(idx) {
  const t = state.photoTransforms[idx];
  return t && (t.rotate !== 0 || t.flipH || t.flipV);
}

/**
 * Render a photo onto ctx with transform applied.
 * Adjusts ctx.canvas dimensions to match the post-rotation output size.
 */
function renderPhotoWithTransform(ctx, photo, palette, scale, idx) {
  const t  = getTransform(idx);
  const sw = GBCam.PHOTO_WIDTH  * scale;
  const sh = GBCam.PHOTO_HEIGHT * scale;

  if (!t.rotate && !t.flipH && !t.flipV) {
    ctx.canvas.width  = sw;
    ctx.canvas.height = sh;
    GBCam.renderToCanvas(ctx, photo.pixels, palette, scale);
    return;
  }

  const rotated = (t.rotate === 90 || t.rotate === 270);
  const dw = rotated ? sh : sw;
  const dh = rotated ? sw : sh;

  const tmp = Object.assign(document.createElement('canvas'), { width: sw, height: sh });
  GBCam.renderToCanvas(tmp.getContext('2d'), photo.pixels, palette, scale);

  ctx.canvas.width  = dw;
  ctx.canvas.height = dh;
  ctx.save();
  ctx.translate(dw / 2, dh / 2);
  if (t.flipH) ctx.scale(-1,  1);
  if (t.flipV) ctx.scale( 1, -1);
  ctx.rotate(t.rotate * Math.PI / 180);
  ctx.drawImage(tmp, -sw / 2, -sh / 2);
  ctx.restore();
}

function applyTransformAction(idx, action) {
  const t = getTransform(idx);
  if (action === 'rotate-cw')  { t.rotate = (t.rotate + 90)  % 360; }
  if (action === 'rotate-ccw') { t.rotate = (t.rotate + 270) % 360; }
  if (action === 'flip-h')     { t.flipH = !t.flipH; }
  if (action === 'flip-v')     { t.flipV = !t.flipV; }
  if (action === 'reset-transform') { t.rotate = 0; t.flipH = false; t.flipV = false; }
}

// ── Views ───────────────────────────────────────────────────────────────────

function showMainView() {
  dom.welcome.classList.add('hidden');
  dom.main.style.display = 'flex';
  // Reveal file-only titlebar buttons (Export .sav, Save Project)
  dom.app.classList.add('has-file');
}

function resetToWelcome() {
  // Clear loaded file state
  state.sav = null;
  state.photos = [];
  state.activeCount = 0;
  state.filename = null;
  state.filePath = null;
  state.selectedIndex = null;
  state.photoSettings = {};
  state.gifMode = false;
  state.gifSelection = new Set();
  state.gifFrameOrder = [];
  state.lightboxOpen = false;
  state.viewMode = 'grid';
  // Return to welcome screen
  dom.main.style.display = 'none';
  dom.welcome.classList.remove('hidden');
  dom.app.classList.remove('has-file');
  // Clear grid
  if (dom.photoGrid) dom.photoGrid.innerHTML = '';
}

// ── Grid ────────────────────────────────────────────────────────────────────

function renderGrid() {
  dom.photoGrid.innerHTML = '';

  for (const photo of state.photos) {
    const slot = document.createElement('div');
    slot.className = 'photo-slot' + (photo.isEmpty ? ' empty' : '');
    slot.dataset.index = photo.index;

    // Slot number badge
    const num = document.createElement('span');
    num.className = 'slot-num';
    num.textContent = String(photo.index + 1).padStart(2, '0');
    slot.appendChild(num);

    if (photo.isEmpty) {
      const placeholder = document.createElement('div');
      placeholder.className = 'empty-placeholder';
      placeholder.textContent = '—';
      slot.appendChild(placeholder);
    } else {
      // Canvas thumbnail — rendered at THUMB_SCALE (4×) for filter clarity
      const canvas = document.createElement('canvas');
      const effThumb = getEffectiveSettings(photo.index);
      const hasBorderThumb = effThumb.borderEnabled && effThumb.borderId;
      canvas.width  = (hasBorderThumb ? 160 : GBCam.PHOTO_WIDTH)  * THUMB_SCALE;
      canvas.height = (hasBorderThumb ? 144 : GBCam.PHOTO_HEIGHT) * THUMB_SCALE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      renderPhotoComplete(ctx, photo, effThumb, THUMB_SCALE, photo.index, { thumbMode: true });
      slot.appendChild(canvas);

      // GIF selection (invisible div for event delegation; frame number via data attr)
      const check = document.createElement('div');
      check.className = 'gif-check';
      check.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleGifSelection(photo.index, slot);
      });
      slot.appendChild(check);

      slot.addEventListener('click', (e) => selectPhoto(photo.index, e));
      slot.addEventListener('dblclick', (e) => {
        selectPhoto(photo.index, e);
        enterSoloMode();
      });
    }

    dom.photoGrid.appendChild(slot);
  }

  // Apply selected state
  if (state.selectedIndex !== null) {
    const el = dom.photoGrid.querySelector(`[data-index="${state.selectedIndex}"]`);
    if (el) el.classList.add('selected');
  }

  // Apply multi-selected state
  for (const idx of state.selectedPhotos) {
    if (state.selectedPhotos.size > 1) {
      const el = dom.photoGrid.querySelector(`[data-index="${idx}"]`);
      if (el) el.classList.add('multi-selected');
    }
  }

  // Apply GIF selections
  for (const idx of state.gifSelection) {
    const el = dom.photoGrid.querySelector(`[data-index="${idx}"]`);
    if (el) el.classList.add('selected-for-gif');
  }
  updateGifFrameNumbers();
}

// ── Repaint helpers ──────────────────────────────────────────────────────────

// Repaint only the detail/preview canvases (solo, lightbox, sidebar).
// Fast — renders 1-3 canvases instead of the full 30-slot grid.
// Use during interactive slider drag so the UI stays responsive.
function repaintDetailOnly() {
  if (state.viewMode === 'solo' && state.selectedIndex !== null) {
    renderSoloView(state.selectedIndex);
  }
  if (state.lightboxOpen && state.selectedIndex !== null) {
    renderLightbox(state.selectedIndex);
  }
  updateSidebarPreview();
}

// ── Grid repaint ─────────────────────────────────────────────────────────────

function repaintGrid() {
  const slots = dom.photoGrid.querySelectorAll('.photo-slot:not(.empty)');
  for (const slot of slots) repaintGridSlot(parseInt(slot.dataset.index));
  if (state.gifMode && state.gifSelection.size > 0) updateGifPreview();
  if (state.viewMode === 'solo' && state.selectedIndex !== null) renderSoloView(state.selectedIndex);
  if (state.lightboxOpen       && state.selectedIndex !== null) renderLightbox(state.selectedIndex);
  updateSidebarPreview();
}

// Debounced grid repaint for global-scope slider changes — fires once after the
// user stops dragging so we don't re-render all 30 thumbnails on every tick.
let _gridDebounceTimer = null;
function scheduleGridRepaint() {
  clearTimeout(_gridDebounceTimer);
  _gridDebounceTimer = setTimeout(() => {
    _gridDebounceTimer = null;
    const slots = dom.photoGrid.querySelectorAll('.photo-slot:not(.empty)');
    for (const slot of slots) repaintGridSlot(parseInt(slot.dataset.index));
    if (state.gifMode && state.gifSelection.size > 0) updateGifPreview();
  }, 200);
}

// ── Interactive repaint (sliders, seg controls) ──────────────────────────────
//
// Gated to one repaint per animation frame — slider input events can fire faster
// than 60 fps on a trackpad, so we coalesce them to avoid queuing up work.
//
//   per-photo scope → detail view + selected thumbnail(s) immediately
//   global scope    → detail view immediately + all thumbnails after 200 ms pause

let _interactiveRAF = null;
function repaintInteractive() {
  if (_interactiveRAF !== null) return; // already a repaint queued this frame
  _interactiveRAF = requestAnimationFrame(() => {
    _interactiveRAF = null;
    repaintDetailOnly();
    if (state.selectedPhotos.size > 0) {
      // Per-photo edit — only repaint affected thumbnails immediately
      for (const idx of state.selectedPhotos) repaintGridSlot(idx);
    } else {
      // Global edit — repaint all thumbnails (debounced)
      scheduleGridRepaint();
    }
  });
}

// Re-render a single thumbnail slot (after palette or transform change)
function repaintGridSlot(index) {
  const photo = state.photos[index];
  if (!photo || photo.isEmpty) return;
  const slot   = dom.photoGrid.querySelector(`[data-index="${index}"]`);
  if (!slot) return;
  const canvas = slot.querySelector('canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const eff = getEffectiveSettings(index);
  // Re-size canvas if needed (border state may have changed)
  const hasBorderSlot = eff.borderEnabled && eff.borderId;
  const expW = (hasBorderSlot ? 160 : GBCam.PHOTO_WIDTH)  * THUMB_SCALE;
  const expH = (hasBorderSlot ? 144 : GBCam.PHOTO_HEIGHT) * THUMB_SCALE;
  if (canvas.width !== expW || canvas.height !== expH) {
    canvas.width  = expW;
    canvas.height = expH;
  }
  renderPhotoComplete(ctx, photo, eff, THUMB_SCALE, index, { thumbMode: true });
  // Slot badge — photo-specific settings override indicator
  slot.classList.toggle('has-photo-settings', hasPhotoOverride(index));
}

// ── Photo selection ─────────────────────────────────────────────────────────

function updateExportSelectedBtn() {
  const btn = document.getElementById('btn-export-single');
  if (!btn) return;
  const hasPhoto = state.selectedIndex !== null && state.photos[state.selectedIndex] && !state.photos[state.selectedIndex].isEmpty;
  btn.disabled = !hasPhoto;
  btn.style.opacity = hasPhoto ? '' : '0.4';
}

function selectPhoto(index, event) {
  if (state.gifMode) {
    const slot = dom.photoGrid.querySelector(`[data-index="${index}"]`);
    if (slot && !slot.classList.contains('empty')) toggleGifSelection(index, slot);
    return;
  }

  const photo = state.photos[index];
  if (!photo || photo.isEmpty) return;

  if (event?.shiftKey && state.lastSelectedIndex !== null) {
    // Range select: add all non-empty photos between lastSelectedIndex and index
    const lo = Math.min(state.lastSelectedIndex, index);
    const hi = Math.max(state.lastSelectedIndex, index);
    for (let i = lo; i <= hi; i++) {
      if (state.photos[i] && !state.photos[i].isEmpty) state.selectedPhotos.add(i);
    }
    state.selectedIndex = index;
  } else if (event?.metaKey || event?.ctrlKey) {
    // Cmd/Ctrl: toggle this photo in/out of selection
    if (state.selectedPhotos.has(index)) {
      state.selectedPhotos.delete(index);
    } else {
      state.selectedPhotos.add(index);
    }
    state.selectedIndex = index;
    state.lastSelectedIndex = index;
  } else {
    // Plain click: single select
    state.selectedPhotos.clear();
    state.selectedPhotos.add(index);
    state.selectedIndex = index;
    state.lastSelectedIndex = index;
  }

  // Update visual selection on all slots
  dom.photoGrid.querySelectorAll('.photo-slot').forEach(el => {
    const i = parseInt(el.dataset.index);
    const inSet = state.selectedPhotos.has(i);
    el.classList.toggle('selected', i === state.selectedIndex);
    el.classList.toggle('multi-selected', inSet && state.selectedPhotos.size > 1);
  });

  if (state.viewMode === 'solo') renderSoloView(index);
  syncControlsToEffectiveSettings(index);
  updateExportSelectedBtn();
  updateSidebarPreview();
}

// ── Detail / lightbox rendering ───────────────────────────────────────────────

// renderDetail: kept as a compatibility stub — callers expecting a "view update"
// will now refresh the lightbox if it's open.
function renderDetail(index) {
  if (state.lightboxOpen && index !== null && index === state.selectedIndex) {
    renderLightbox(index);
  }
}

// ── Solo view ─────────────────────────────────────────────────────────────────

function enterSoloMode() {
  state.viewMode = 'solo';
  dom.gridPanel.classList.add('solo-mode');
  document.getElementById('btn-view-grid')?.classList.remove('active');
  document.getElementById('btn-view-solo')?.classList.add('active');

  // Auto-select first non-empty photo if nothing selected
  if (state.selectedIndex === null) {
    const first = state.photos.findIndex(p => !p.isEmpty);
    if (first >= 0) {
      state.selectedIndex = first;
      dom.photoGrid.querySelector(`[data-index="${first}"]`)?.classList.add('selected');
    }
  }
  if (state.selectedIndex !== null) renderSoloView(state.selectedIndex);
}

function enterGridMode() {
  state.viewMode = 'grid';
  dom.gridPanel.classList.remove('solo-mode');
  document.getElementById('btn-view-grid')?.classList.add('active');
  document.getElementById('btn-view-solo')?.classList.remove('active');
  // Scroll selected photo into view
  if (state.selectedIndex !== null) {
    dom.photoGrid.querySelector(`[data-index="${state.selectedIndex}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function renderSoloView(index) {
  const photo = state.photos[index];
  if (!photo || photo.isEmpty) return;

  const wrap = dom.soloCanvas?.parentElement;
  if (!wrap || !dom.soloCanvas) return;

  // Calculate largest integer scale that fits the available canvas area
  const availW = wrap.clientWidth  - 8;  // minor padding
  const availH = wrap.clientHeight - 8;
  const effSolo = getEffectiveSettings(index);
  const hasBorderSolo = effSolo.borderEnabled && effSolo.borderId;
  const soloDisplayW = hasBorderSolo ? 160 : GBCam.PHOTO_WIDTH;
  const soloDisplayH = hasBorderSolo ? 144 : GBCam.PHOTO_HEIGHT;
  const scaleW = Math.max(1, Math.floor(availW / soloDisplayW));
  const scaleH = Math.max(1, Math.floor(availH / soloDisplayH));
  const SOLO_SCALE = Math.max(1, Math.min(scaleW, scaleH));

  const ctx = dom.soloCanvas.getContext('2d');
  renderPhotoComplete(ctx, photo, effSolo, SOLO_SCALE, index);

  // Update info strip
  if (dom.soloLabel) dom.soloLabel.textContent = `Photo ${index + 1}`;
  if (dom.soloMeta) {
    const t = getTransform(index);
    const rotLabel  = t.rotate ? ` · ${t.rotate}°` : '';
    const flipLabel = (t.flipH || t.flipV) ? ` · flipped` : '';
    dom.soloMeta.textContent = `${GBCam.PHOTO_WIDTH}×${GBCam.PHOTO_HEIGHT}px · slot ${index + 1}/30${rotLabel}${flipLabel}`;
  }
  // Sync transform button active states
  document.querySelectorAll('#solo-transforms .transform-btn').forEach(btn => {
    const t2 = getTransform(index);
    if (btn.dataset.action === 'flip-h') btn.classList.toggle('active', t2.flipH);
    if (btn.dataset.action === 'flip-v') btn.classList.toggle('active', t2.flipV);
  });
  updateSidebarPreview();
}

function soloStep(dir) {
  const photos = state.photos;
  let idx = state.selectedIndex ?? 0;
  let tries = 0;
  while (tries < 30) {
    idx = ((idx + dir + photos.length) % photos.length);
    if (!photos[idx]?.isEmpty) break;
    tries++;
  }
  if (photos[idx]?.isEmpty) return;

  dom.photoGrid.querySelectorAll('.photo-slot').forEach(el => el.classList.remove('selected'));
  dom.photoGrid.querySelector(`[data-index="${idx}"]`)?.classList.add('selected');
  state.selectedIndex = idx;
  state.selectedPhotos = new Set([idx]);
  syncControlsToEffectiveSettings(idx);
  renderSoloView(idx);
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function openLightbox(index) {
  const photo = state.photos[index];
  if (!photo || photo.isEmpty) return;
  state.lightboxOpen = true;
  dom.lbOverlay.classList.remove('hidden');
  renderLightbox(index);
}

function closeLightbox() {
  state.lightboxOpen = false;
  dom.lbOverlay.classList.add('hidden');
}

function renderLightbox(index) {
  const photo = state.photos[index];
  if (!photo || photo.isEmpty) { closeLightbox(); return; }

  const PREVIEW_SCALE = 8;
  const ctx = dom.lbCanvas.getContext('2d');
  const effLb = getEffectiveSettings(index);
  renderPhotoComplete(ctx, photo, effLb, PREVIEW_SCALE, index);

  dom.lbLabel.textContent = `Photo ${index + 1}`;
  const t = getTransform(index);
  const rotLabel  = t.rotate ? ` · ${t.rotate}°` : '';
  const flipLabel = (t.flipH || t.flipV) ? ` · flipped` : '';
  dom.lbMeta.textContent = `${GBCam.PHOTO_WIDTH}×${GBCam.PHOTO_HEIGHT}px · 2bpp · slot ${index + 1}/30${rotLabel}${flipLabel}`;

  // Sync transform button active states in lightbox footer
  document.querySelectorAll('#lb-transforms .transform-btn').forEach(btn => {
    const action = btn.dataset.action;
    if (action === 'flip-h') btn.classList.toggle('active', t.flipH);
    if (action === 'flip-v') btn.classList.toggle('active', t.flipV);
  });
}

function lightboxStep(dir) {
  if (!state.lightboxOpen) return;
  const photos = state.photos;
  let idx = state.selectedIndex ?? 0;
  let tries = 0;
  while (tries < 30) {
    idx = ((idx + dir + photos.length) % photos.length);
    if (!photos[idx]?.isEmpty) break;
    tries++;
  }
  if (photos[idx]?.isEmpty) return;

  dom.photoGrid.querySelectorAll('.photo-slot').forEach(el => el.classList.remove('selected'));
  const slot = dom.photoGrid.querySelector(`[data-index="${idx}"]`);
  if (slot) {
    slot.classList.add('selected');
    slot.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  state.selectedIndex = idx;
  state.selectedPhotos = new Set([idx]);
  syncControlsToEffectiveSettings(idx);
  renderLightbox(idx);
}

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

// ── Export scale / format controls ──────────────────────────────────────────

function getExportDimensions() {
  // Returns { width, height } for the current export scale setting
  if (state.exportScale === 'custom') {
    const w = parseInt(document.getElementById('custom-width')?.value) || 512;
    const h = Math.round(w * (GBCam.PHOTO_HEIGHT / GBCam.PHOTO_WIDTH));
    return { width: w, height: h };
  }
  return {
    width:  GBCam.PHOTO_WIDTH  * state.exportScale,
    height: GBCam.PHOTO_HEIGHT * state.exportScale,
  };
}

function setExportScale(scale) {
  state.exportScale = scale;
  const isCustom = scale === 'custom';

  document.querySelectorAll('.scale-btn').forEach(btn => {
    const val = btn.dataset.scale === 'custom' ? 'custom' : parseInt(btn.dataset.scale);
    btn.classList.toggle('active', val === scale);
  });

  const wrap = document.getElementById('custom-size-wrap');
  if (wrap) wrap.style.display = isCustom ? 'block' : 'none';

  if (isCustom) {
    // Trigger initial display update
    updateCustomSizeDisplay();
  }
}

function updateCustomSizeDisplay() {
  const input = document.getElementById('custom-width');
  const display = document.getElementById('custom-size-display');
  if (!input || !display) return;
  const w = parseInt(input.value) || 512;
  const h = Math.round(w * (GBCam.PHOTO_HEIGHT / GBCam.PHOTO_WIDTH));
  display.textContent = `${w}×${h}`;
}

function setExportFormat(fmt) {
  state.exportFormat = fmt;
  document.querySelectorAll('.fmt-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.fmt === fmt);
  });
  if (fmt === 'gif') {
    enterGifMode();
  } else {
    exitGifMode();
  }
}

// ── Export: single PNG ───────────────────────────────────────────────────────

async function exportSinglePng() {
  const index = state.selectedIndex;
  if (index === null) return;
  const photo = state.photos[index];
  if (!photo || photo.isEmpty) return;

  const scale = state.exportScale === 'custom'
    ? Math.max(1, Math.round((parseInt(document.getElementById('custom-width')?.value) || 512) / GBCam.PHOTO_WIDTH))
    : state.exportScale;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const effExp = getEffectiveSettings(index);
  renderPhotoComplete(ctx, photo, effExp, scale, index, { forExport: true });

  const dataUrl = canvas.toDataURL('image/png');
  const filterTag = effExp.activeFilters.size > 0 ? `_${[...effExp.activeFilters].join('+')}` : '';
  const scaleTag = state.exportScale === 'custom' ? `${width}px` : `${state.exportScale}x`;
  const defaultName = `gbcam_${String(index + 1).padStart(2, '0')}_${effExp.palette.id}_${scaleTag}${filterTag}.png`;

  const saved = await window.api.savePng(dataUrl, defaultName);
  if (saved) showToast(`Saved: ${typeof saved === 'string' ? saved.split('/').pop() : saved}`);
}

// ── Export: batch PNG ────────────────────────────────────────────────────────

async function exportBatchPng() {
  const photos = state.photos.filter(p => !p.isEmpty);
  if (photos.length === 0) { showToast('No photos to export'); return; }

  const { width, height } = getExportDimensions();
  const scaleTag = state.exportScale === 'custom' ? `${width}px` : `${state.exportScale}x`;
  const batch = [];

  const batchScale = state.exportScale === 'custom' ? Math.max(1, Math.round(width / GBCam.PHOTO_WIDTH)) : state.exportScale;

  for (const photo of photos) {
    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d');
    const effBatch = getEffectiveSettings(photo.index);
    renderPhotoComplete(ctx, photo, effBatch, batchScale, photo.index, { forExport: true });
    const dataUrl = canvas.toDataURL('image/png');
    const batchFilterTag = effBatch.activeFilters.size > 0 ? `_${[...effBatch.activeFilters].join('+')}` : '';
    const name = `gbcam_${String(photo.index + 1).padStart(2, '0')}_${effBatch.palette.id}_${scaleTag}${batchFilterTag}.png`;
    batch.push({ dataUrl, name });
  }

  const result = await window.api.savePngBatch(batch);
  if (result) showToast(`Exported ${result.count} photos`);
}

// ── Export: animated GIF ────────────────────────────────────────────────────

function enterGifMode() {
  state.gifMode = true;
  dom.photoGrid.classList.add('gif-mode');
  dom.gifToolbar.classList.add('visible');
  if (dom.gifFrameStrip) dom.gifFrameStrip.classList.add('visible');
  updateGifCount();
  renderGifFrameStrip();
}

function exitGifMode() {
  if (state.gifPreviewTimer) {
    clearInterval(state.gifPreviewTimer);
    state.gifPreviewTimer = null;
  }
  state.gifMode = false;
  state.gifSelection.clear();
  state.gifFrameOrder = [];
  state.gifPaletteScope = null;
  dom.photoGrid.classList.remove('gif-mode');
  dom.gifToolbar.classList.remove('visible');
  if (dom.gifFrameStrip) dom.gifFrameStrip.classList.remove('visible');
  dom.photoGrid.querySelectorAll('.photo-slot').forEach(el => {
    el.classList.remove('selected-for-gif');
    el.removeAttribute('data-gif-frame');
  });
  if (dom.gifPreviewWrap) dom.gifPreviewWrap.classList.remove('visible');
  hideGifPreviewInfo();
  updateSidebarPreview(); // restore single-photo preview
}

function toggleGifSelection(index, slotEl) {
  // Always add a new frame — duplicates allowed.
  // Removal is handled via the × button on each chip.
  state.gifFrameOrder.push({ photoIndex: index, paletteId: null });
  state.gifSelection.add(index); // set keeps uniqueness for grid highlight
  slotEl.classList.add('selected-for-gif');
  updateGifCount();
  updateGifFrameNumbers();
  renderGifFrameStrip();
  updateGifPreview();
}

function updateGifCount() {
  const n = state.gifFrameOrder.length;
  dom.gifCount.textContent = `${n} frame${n !== 1 ? 's' : ''}`;
}

// ── GIF frame strip ─────────────────────────────────────────────────────────

const GIF_THUMB_W = 96;
const GIF_THUMB_H = 84;

function renderGifFrameStrip() {
  if (!dom.gifFrameList) return;
  dom.gifFrameList.innerHTML = '';

  const empty = state.gifFrameOrder.length === 0;
  if (dom.gifFrameEmpty) dom.gifFrameEmpty.style.display = empty ? '' : 'none';

  state.gifFrameOrder.forEach((frame, orderIdx) => {
    const photo = state.photos[frame.photoIndex];
    if (!photo) return;

    const chip = document.createElement('div');
    chip.className = 'gif-chip';
    chip.draggable = true;
    chip.dataset.orderIdx = orderIdx;

    // Frame number badge
    const num = document.createElement('div');
    num.className = 'gif-chip-num';
    num.textContent = orderIdx + 1;

    // Thumbnail canvas — rendered with per-photo effective settings
    const canvas = document.createElement('canvas');
    canvas.width  = GIF_THUMB_W;
    canvas.height = GIF_THUMB_H;
    canvas.className = 'gif-chip-canvas';

    // Resolve palette: frame override → frame's per-photo palette → global palette
    const eff = getEffectiveSettings(frame.photoIndex);
    const pal = frame.paletteId ? PALETTES[frame.paletteId] : eff.palette;
    if (pal) {
      const chipScale = GIF_THUMB_W / GBCam.PHOTO_WIDTH; // ~0.75
      // Render at native res first
      const tmp = Object.assign(document.createElement('canvas'), {
        width: GBCam.PHOTO_WIDTH, height: GBCam.PHOTO_HEIGHT,
      });
      const tctx = tmp.getContext('2d');
      GBCam.renderToCanvas(tctx, photo.pixels, pal, 1);
      applyToneAdjustments(tctx, GBCam.PHOTO_WIDTH, GBCam.PHOTO_HEIGHT, eff);
      if (eff.activeFilters.size > 0) {
        applyActiveEffects(tctx, GBCam.PHOTO_WIDTH, GBCam.PHOTO_HEIGHT, 1,
          eff.filterIntensity, eff.filterVariant, eff.filterParams, eff.activeFilters, false, frame.photoIndex);
      }
      canvas.getContext('2d').drawImage(tmp, 0, 0, GIF_THUMB_W, GIF_THUMB_H);
    }

    // Palette swatch button
    const palBtn = document.createElement('button');
    palBtn.className = 'gif-chip-pal';
    palBtn.title = `Palette: ${pal ? pal.name : 'global'} — click to change`;
    if (frame.paletteId) palBtn.classList.add('overridden');

    const swatch = document.createElement('div');
    swatch.className = 'palette-swatch gif-chip-swatch';
    pal.colors.forEach(color => {
      const sp = document.createElement('span');
      sp.style.background = color;
      swatch.appendChild(sp);
    });
    palBtn.appendChild(swatch);
    palBtn.addEventListener('click', e => {
      e.stopPropagation();
      openFramePalettePicker(orderIdx, palBtn);
    });

    // Duplicate button
    const dup = document.createElement('button');
    dup.className = 'gif-chip-dup';
    dup.textContent = '+';
    dup.title = 'Duplicate frame';
    dup.addEventListener('click', e => {
      e.stopPropagation();
      duplicateGifFrame(orderIdx);
    });

    // Remove button
    const rm = document.createElement('button');
    rm.className = 'gif-chip-remove';
    rm.textContent = '×';
    rm.title = 'Remove frame';
    rm.addEventListener('click', e => {
      e.stopPropagation();
      removeGifFrame(orderIdx);
    });

    chip.appendChild(num);
    chip.appendChild(canvas);
    chip.appendChild(palBtn);
    chip.appendChild(dup);
    chip.appendChild(rm);
    dom.gifFrameList.appendChild(chip);

    // ── Drag to reorder ──────────────────────────────────────────────────
    chip.addEventListener('dragstart', e => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(orderIdx));
      chip.classList.add('dragging');
    });
    chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    chip.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      chip.classList.add('drag-over');
    });
    chip.addEventListener('dragleave', () => chip.classList.remove('drag-over'));
    chip.addEventListener('drop', e => {
      e.preventDefault();
      chip.classList.remove('drag-over');
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
      const toIdx   = orderIdx;
      if (fromIdx === toIdx) return;
      const [moved] = state.gifFrameOrder.splice(fromIdx, 1);
      state.gifFrameOrder.splice(toIdx, 0, moved);
      updateGifFrameNumbers();
      renderGifFrameStrip();
      updateGifPreview();
    });
  });
}

function removeGifFrame(orderIdx) {
  const frame = state.gifFrameOrder[orderIdx];
  if (!frame) return;
  state.gifFrameOrder.splice(orderIdx, 1);
  // Only remove from selection Set if no other frames reference this photo
  if (!state.gifFrameOrder.some(f => f.photoIndex === frame.photoIndex)) {
    state.gifSelection.delete(frame.photoIndex);
    const slot = dom.photoGrid.querySelector(`[data-index="${frame.photoIndex}"]`);
    if (slot) {
      slot.classList.remove('selected-for-gif');
      slot.removeAttribute('data-gif-frame');
    }
  }
  updateGifCount();
  updateGifFrameNumbers();
  renderGifFrameStrip();
  updateGifPreview();
}

// Mini palette picker scoped to a single GIF frame
let _framePalettePopover = null;
function openFramePalettePicker(orderIdx, anchorEl) {
  // Close any open one
  if (_framePalettePopover) { _framePalettePopover.remove(); _framePalettePopover = null; }

  const popover = document.createElement('div');
  popover.className = 'frame-pal-popover';
  _framePalettePopover = popover;

  // "Use global" option
  const globalOpt = document.createElement('button');
  globalOpt.className = 'frame-pal-opt' + (!state.gifFrameOrder[orderIdx]?.paletteId ? ' active' : '');
  globalOpt.textContent = 'Global palette';
  globalOpt.addEventListener('click', () => {
    state.gifFrameOrder[orderIdx].paletteId = null;
    popover.remove(); _framePalettePopover = null;
    renderGifFrameStrip(); updateGifPreview();
  });
  popover.appendChild(globalOpt);

  // Separator
  const sep = document.createElement('div');
  sep.className = 'frame-pal-sep';
  popover.appendChild(sep);

  // All palettes in groups
  const currentId = state.gifFrameOrder[orderIdx]?.paletteId;
  for (const [id, pal] of Object.entries(PALETTES)) {
    const opt = document.createElement('button');
    opt.className = 'frame-pal-opt' + (currentId === id ? ' active' : '');

    const sw = document.createElement('div');
    sw.className = 'palette-swatch frame-pal-swatch';
    pal.colors.forEach(c => { const s = document.createElement('span'); s.style.background = c; sw.appendChild(s); });

    const nm = document.createElement('span');
    nm.textContent = pal.name;
    nm.className = 'frame-pal-name';

    opt.appendChild(sw);
    opt.appendChild(nm);
    opt.addEventListener('click', () => {
      state.gifFrameOrder[orderIdx].paletteId = id;
      popover.remove(); _framePalettePopover = null;
      renderGifFrameStrip(); updateGifPreview();
    });
    popover.appendChild(opt);
  }

  // Position relative to anchor
  document.body.appendChild(popover);
  const rect = anchorEl.getBoundingClientRect();
  const ph = popover.offsetHeight;
  const spaceBelow = window.innerHeight - rect.bottom;
  popover.style.left = `${rect.left}px`;
  popover.style.top = spaceBelow > ph + 8
    ? `${rect.bottom + 4}px`
    : `${rect.top - ph - 4}px`;

  // Close on outside click
  const close = e => {
    if (!popover.contains(e.target) && e.target !== anchorEl) {
      popover.remove(); _framePalettePopover = null;
      document.removeEventListener('mousedown', close);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', close), 0);
}

function setGifLoop(mode) {
  state.gifLoop = mode;
  document.querySelectorAll('.gif-loop-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.loop === mode);
  });
  // Reflect the new loop mode in the live preview immediately
  if (state.gifMode && state.gifSelection.size > 0) updateGifPreview();
}

/**
 * Render one GIF frame (photo + optional border) onto ctx.canvas at the given scale.
 * When includeBorders is on, every frame is rendered at 160×144 (native) so all GIF
 * frames share dimensions: photos with a border get the colorised frame, photos without
 * one are centred on the darkest palette colour. Returns native (unscaled) { width, height }.
 */
function renderGifFrameToCanvas(ctx, photo, eff, pal, idx, scale, includeBorders) {
  if (!includeBorders) {
    renderPhotoWithTransform(ctx, photo, pal, scale, idx);
    return { width: GBCam.PHOTO_WIDTH, height: GBCam.PHOTO_HEIGHT };
  }

  const hasBorder = eff.borderEnabled && eff.borderId && eff.borderId !== 'none';
  if (hasBorder) {
    // Reuse the still-export compositor: photo drawn into the window + colorised border.
    renderPhotoWithBorder(ctx, photo, { palette: pal, borderEnabled: true, borderId: eff.borderId }, scale, idx);
  } else {
    // No border on this photo — pad to 160×144 on the darkest palette colour, photo centred.
    const W = 160 * scale, H = 144 * scale;
    ctx.canvas.width  = W;
    ctx.canvas.height = H;
    const rgb = paletteToRGB(pal);
    ctx.fillStyle = `rgb(${rgb[3][0]},${rgb[3][1]},${rgb[3][2]})`;
    ctx.fillRect(0, 0, W, H);
    const tmp = document.createElement('canvas');
    renderPhotoWithTransform(tmp.getContext('2d', { willReadFrequently: true }), photo, pal, scale, idx);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, Math.round((W - tmp.width) / 2), Math.round((H - tmp.height) / 2));
  }
  return { width: 160, height: 144 };
}

/** Map a composited RGB canvas back to 2-bit palette indices (exact — every pixel is a palette colour). */
function canvasToPaletteIndices(ctx, w, h, rgb) {
  const data = ctx.getImageData(0, 0, w, h).data;
  const indices = new Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2];
    let best = 0, bestD = Infinity;
    for (let k = 0; k < rgb.length; k++) {
      const dr = r - rgb[k][0], dg = g - rgb[k][1], db = b - rgb[k][2];
      const d2 = dr * dr + dg * dg + db * db;
      if (d2 < bestD) { bestD = d2; best = k; }
    }
    indices[p] = best;
  }
  return indices;
}

async function exportGif() {
  if (state.gifFrameOrder.length === 0) {
    showToast('Add frames first');
    return;
  }

  try {
    // Resolve numeric scale (custom mode → pixel ratio)
    const scale = state.exportScale === 'custom'
      ? Math.max(1, Math.round((parseInt(document.getElementById('custom-width')?.value) || 512) / GBCam.PHOTO_WIDTH))
      : state.exportScale;

    // Build the frame sequence from gifFrameOrder — apply bounce (ping-pong) if selected
    const baseFrames = state.gifFrameOrder;
    let sequence = baseFrames;
    if (state.gifLoop === 'bounce' && baseFrames.length > 2) {
      // Forward + reversed middle (exclude duplicate endpoints)
      const mid = [...baseFrames].reverse().slice(1, baseFrames.length - 1);
      sequence = [...baseFrames, ...mid];
    }

    const frames = [];
    const includeBorders = state.gifBorders;
    // Reusable canvas for border compositing (only used when includeBorders is on)
    const composite = includeBorders ? document.createElement('canvas') : null;
    const compCtx = composite ? composite.getContext('2d', { willReadFrequently: true }) : null;

    for (const frame of sequence) {
      const photo = state.photos[frame.photoIndex];
      if (!photo || photo.isEmpty) continue;
      // Per-frame override → per-photo effective palette → global palette
      const eff = getEffectiveSettings(frame.photoIndex);
      const pal = (frame.paletteId && PALETTES[frame.paletteId]) || eff.palette;
      const rgb = paletteToRGB(pal);

      if (includeBorders) {
        // Composite photo + border at native resolution (scale 1), then re-index to 2-bit.
        const dims = renderGifFrameToCanvas(compCtx, photo, eff, pal, frame.photoIndex, 1, true);
        frames.push({
          indices: canvasToPaletteIndices(compCtx, dims.width, dims.height, rgb),
          palette: rgb,
          width:   dims.width,
          height:  dims.height,
        });
      } else {
        frames.push({
          indices: Array.from(photo.pixels),
          palette: rgb,
          width:   GBCam.PHOTO_WIDTH,
          height:  GBCam.PHOTO_HEIGHT,
        });
      }
    }

    if (frames.length === 0) { showToast('No valid frames'); return; }

    const loopTag = state.gifLoop !== 'infinite' ? `_${state.gifLoop}` : '';
    const defaultName = `darkroom_anim_${scale}x${loopTag}.gif`;

    const result = await window.api.saveGif({
      frames,
      delay:  state.gifDelay,
      scale,
      loop:   state.gifLoop,   // 'infinite' | 'once' | 'bounce'
      defaultName,
    });

    if (!result) return; // user canceled save dialog
    if (result.error) { showToast(`GIF error: ${result.error}`); return; }

    const fLabel = `${frames.length} frame${frames.length !== 1 ? 's' : ''}`;
    const lLabel = state.gifLoop === 'once' ? '· once' : state.gifLoop === 'bounce' ? '· bounce' : '';
    showToast(`GIF saved (${fLabel}${lLabel ? ' ' + lLabel : ''})`);
  } catch (e) {
    console.error('[exportGif]', e);
    showToast(`Export failed: ${e.message}`);
  }
}

// ── Analogue Pocket modal ────────────────────────────────────────────────────

let selectedPocketSave = null;

async function openPocketModal() {
  dom.pocketModal.classList.remove('hidden');
  dom.pocketSaveList.innerHTML = '<p style="color:var(--text-3);font-size:12px;">Scanning for Analogue Pocket SD card…</p>';
  dom.pocketConfirm.disabled = true;
  selectedPocketSave = null;

  const { saves } = await window.api.detectPocket();
  dom.pocketSaveList.innerHTML = '';

  if (saves.length === 0) {
    dom.pocketSaveList.innerHTML =
      '<p style="color:var(--text-3);font-size:12px;line-height:1.5;">' +
      'No camera saves found. Make sure your Analogue Pocket SD card is inserted, ' +
      'and that you have run the camera app at least once.</p>';
    return;
  }

  // Web version: file handles but no previewPixels — decode client-side via GBCam
  for (const save of saves) {
    if (!save.previewPixels && save.handle) {
      try {
        const file = await save.handle.getFile();
        const buf  = new Uint8Array(await file.arrayBuffer());
        save.previewPixels = GBCam.decodeFirstPhoto(buf);
      } catch (_) {}
    }
  }

  const previewPalette = PALETTES.dmg;

  for (const save of saves) {
    const item = document.createElement('div');
    item.className = 'save-item';

    // Left: preview thumbnail
    const previewWrap = document.createElement('div');
    previewWrap.className = 'save-preview-wrap';

    if (save.previewPixels) {
      const canvas = document.createElement('canvas');
      canvas.width  = GBCam.PHOTO_WIDTH;
      canvas.height = GBCam.PHOTO_HEIGHT;
      canvas.className = 'save-preview';
      const ctx = canvas.getContext('2d');
      const pixels = save.previewPixels instanceof Uint8Array
        ? save.previewPixels
        : new Uint8Array(save.previewPixels);
      GBCam.renderToCanvas(ctx, pixels, previewPalette, 1);
      previewWrap.appendChild(canvas);
    } else {
      const ph = document.createElement('div');
      ph.className = 'save-preview-empty';
      ph.textContent = '?';
      previewWrap.appendChild(ph);
    }

    // Right: filename + path
    const info = document.createElement('div');
    info.className = 'save-info';
    info.innerHTML =
      `<span class="save-name">${save.name}</span>` +
      `<span class="save-path">📼 ${save.volume} › ${save.path.split('/').slice(-2).join('/')}</span>`;

    item.appendChild(previewWrap);
    item.appendChild(info);

    item.addEventListener('click', () => {
      dom.pocketSaveList.querySelectorAll('.save-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      selectedPocketSave = save;
      dom.pocketConfirm.disabled = false;
    });
    dom.pocketSaveList.appendChild(item);
  }
}

function closePocketModal() {
  dom.pocketModal.classList.add('hidden');
}

async function confirmPocketOpen() {
  if (!selectedPocketSave) return;
  closePocketModal();
  // Pass the whole save object — Electron uses .path, web uses .handle
  const result = await window.api.readFile(selectedPocketSave);
  await loadSavFile(result);
}

// ── Drag & drop ─────────────────────────────────────────────────────────────

function setupDragDrop() {
  const overlay = dom.dropOverlay;

  document.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    overlay?.classList.remove('hidden');
  });

  document.addEventListener('dragleave', e => {
    if (!e.relatedTarget) overlay?.classList.add('hidden');
  });

  document.addEventListener('drop', async e => {
    e.preventDefault();
    overlay?.classList.add('hidden');
    const file = e.dataTransfer.files[0];
    if (!file) return;

    if (window.api?.readFile && file.path) {
      // Electron: use native path for proper size validation in main process
      const result = await window.api.readFile(file.path);
      await loadSavFile(result);
    } else {
      // Web / fallback
      const buffer = await file.arrayBuffer();
      await loadSavFile({
        buffer,
        name: file.name,
        path: null,
        error: buffer.byteLength !== 131072
          ? `Unexpected file size: ${buffer.byteLength} bytes (expected 131072 for this save format).`
          : null,
      });
    }
  });
}

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

// ── GIF frame numbering ────────────────────────────────────────────────────

function updateGifFrameNumbers() {
  // Clear all badges first
  dom.photoGrid.querySelectorAll('.photo-slot').forEach(el => {
    el.removeAttribute('data-gif-frame');
  });
  // Re-assign from ordered frame list (last occurrence wins for duplicates)
  state.gifFrameOrder.forEach((frame, i) => {
    const slot = dom.photoGrid.querySelector(`[data-index="${frame.photoIndex}"]`);
    if (slot) slot.dataset.gifFrame = String(i + 1);
  });
}

// ── GIF live preview in detail panel ──────────────────────────────────────

function updateGifPreview() {
  if (state.gifPreviewTimer) {
    clearInterval(state.gifPreviewTimer);
    state.gifPreviewTimer = null;
  }

  const baseFrames = state.gifFrameOrder;

  if (!state.gifMode || baseFrames.length === 0) {
    if (dom.gifPreviewWrap) dom.gifPreviewWrap.classList.remove('visible');
    return;
  }

  // Apply bounce expansion
  let frames = baseFrames;
  if (state.gifLoop === 'bounce' && baseFrames.length > 2) {
    const mid = [...baseFrames].reverse().slice(1, baseFrames.length - 1);
    frames = [...baseFrames, ...mid];
  }

  // Both the GIF animation and the single-photo preview share the same canvas
  const sharedCanvas = document.getElementById('sidebar-preview-canvas');
  const infoEl       = document.getElementById('gif-preview-info');
  const emptyEl      = document.getElementById('sidebar-preview-empty');
  if (emptyEl) emptyEl.style.display = 'none';
  if (infoEl)  infoEl.style.display  = '';

  const PREVIEW_SCALE = 2;
  let frameIdx = 0;
  const loopLabel = state.gifLoop === 'bounce' ? ' · ↔ bounce' : state.gifLoop === 'once' ? ' · once' : '';

  function showFrame() {
    const n = frameIdx % frames.length;
    const frameObj = frames[n];
    const photo = state.photos[frameObj.photoIndex];
    if (!photo || photo.isEmpty) { frameIdx++; return; }

    const canvas = sharedCanvas;
    const frameCtx = canvas.getContext('2d', { willReadFrequently: true });
    const effGif = getEffectiveSettings(frameObj.photoIndex);
    const pal = frameObj.paletteId ? PALETTES[frameObj.paletteId] : effGif.palette;
    // Renders bare photo, or photo + border when the GIF "Borders" toggle is on.
    // Sets canvas.width/height itself (128×112 or 160×144, scaled).
    renderGifFrameToCanvas(frameCtx, photo, effGif, pal, frameObj.photoIndex, PREVIEW_SCALE, state.gifBorders);
    if (effGif.activeFilters.size > 0) {
      applyActiveEffects(frameCtx, canvas.width, canvas.height, PREVIEW_SCALE,
        effGif.filterIntensity, effGif.filterVariant, effGif.filterParams, effGif.activeFilters, false, frameObj.photoIndex);
    }
    applyToneAdjustments(frameCtx, canvas.width, canvas.height, effGif);

    const palLabel = frameObj.paletteId ? ` · ${pal?.name}` : '';
    if (infoEl) {
      infoEl.textContent =
        `Frame ${n + 1}/${frames.length} · Photo ${frameObj.photoIndex + 1}${palLabel}${loopLabel}`;
    }
    frameIdx++;
  }

  showFrame(); // render first frame immediately
  if (frames.length > 1) {
    state.gifPreviewTimer = setInterval(showFrame, state.gifDelay);
  }
}

// Hide gif info bar when not in gif preview mode
function hideGifPreviewInfo() {
  const infoEl  = document.getElementById('gif-preview-info');
  const emptyEl = document.getElementById('sidebar-preview-empty');
  if (infoEl) infoEl.style.display = 'none';
}

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

// ── Export filters / effects ───────────────────────────────────────────────

// Legacy: called by openProject() for backwards compat with older .gbcp files
// that stored a single exportFilter value. No-op for current accordion design.
function setExportFilter(filter) {
  setScopedSetting('exportFilter', filter);
  repaintGrid();
}

/** Injects per-filter granular controls into #filter-params.
 *  displayParams: optional read-only values to populate the UI with (used when
 *  syncing controls to effective settings without creating a photoSettings entry).
 *  Omit to use the normal writable path (getWritableFilterParams). */
function buildFilterParams(filter, displayParams) {
  const container = document.getElementById('fp-' + filter) || document.getElementById('filter-params');
  if (!container) return;
  container.innerHTML = '';
  if (!filter || filter === 'none') return;

  // ── Intensity slider (always shown first in inline panel) ────────────────
  {
    const eff = state.selectedIndex !== null ? getEffectiveSettings(state.selectedIndex) : null;
    const curIntensity = Math.round((eff?.filterIntensity ?? state.filterIntensity) * 100);
    const wrap = document.createElement('div');
    wrap.className = 'range-wrap fp-row';
    wrap.innerHTML = `
      <div class="range-header">
        <span class="ctrl-label">Intensity</span>
        <span class="range-val" id="filter-intensity-val">${curIntensity}%</span>
      </div>
      <input type="range" id="filter-intensity" min="0" max="100" step="5" value="${curIntensity}">`;
    container.appendChild(wrap);
    const sl = wrap.querySelector('#filter-intensity');
    const vl = wrap.querySelector('#filter-intensity-val');
    sl.addEventListener('input', () => {
      const v = parseFloat(sl.value) / 100;
      vl.textContent = `${sl.value}%`;
      setScopedSetting('filterIntensity', v);
      repaintGrid();
      updateSidebarPreview();
    });
  }

  // ── CRT variant buttons (injected only for CRT) ─────────────────────────
  if (filter === 'crt') {
    const eff = state.selectedIndex !== null ? getEffectiveSettings(state.selectedIndex) : null;
    const curVariant = eff?.filterVariant ?? state.filterVariant ?? 'medium';
    const vWrap = document.createElement('div');
    vWrap.id = 'crt-variant-wrap';
    vWrap.style.marginTop = '6px';
    vWrap.innerHTML = `
      <div class="ctrl-label" style="margin-bottom:4px;">Scanlines</div>
      <div class="seg-control">
        <button class="seg-btn crt-variant-btn${curVariant==='fine'?' active':''}" data-variant="fine">Fine</button>
        <button class="seg-btn crt-variant-btn${curVariant==='medium'?' active':''}" data-variant="medium">Medium</button>
        <button class="seg-btn crt-variant-btn${curVariant==='thick'?' active':''}" data-variant="thick">Thick</button>
        <button class="seg-btn crt-variant-btn${curVariant==='wide'?' active':''}" data-variant="wide">Wide</button>
      </div>`;
    container.appendChild(vWrap);
    vWrap.querySelectorAll('.crt-variant-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        setScopedSetting('filterVariant', btn.dataset.variant);
        vWrap.querySelectorAll('.crt-variant-btn').forEach(b => b.classList.toggle('active', b === btn));
        repaintGrid();
        updateSidebarPreview();
      });
    });
  }

  // displayParams = values to show; writable ref is obtained lazily on interaction.
  const initP = displayParams || getWritableFilterParams(filter);

  function repaint() { repaintGrid(); }

  function addSlider(label, key, min, max, step, valFmt) {
    const wrap = document.createElement('div');
    wrap.className = 'range-wrap fp-row';
    const hdr = document.createElement('div');
    hdr.className = 'range-header';
    const lbl = document.createElement('span'); lbl.className = 'ctrl-label'; lbl.textContent = label;
    const val = document.createElement('span'); val.className = 'range-val'; val.textContent = valFmt(initP[key]);
    hdr.appendChild(lbl); hdr.appendChild(val);
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = min; slider.max = max; slider.step = step; slider.value = initP[key];
    slider.addEventListener('input', () => {
      const p = getWritableFilterParams(filter); // create entry only on actual user interaction
      p[key] = parseFloat(slider.value);
      val.textContent = valFmt(p[key]);
      repaint();
    });
    wrap.appendChild(hdr); wrap.appendChild(slider);
    container.appendChild(wrap);
  }

  function addSeg(label, key, options) {
    const wrap = document.createElement('div'); wrap.className = 'fp-row';
    const lbl = document.createElement('div'); lbl.className = 'ctrl-label'; lbl.style.marginBottom = '4px'; lbl.textContent = label;
    const seg = document.createElement('div'); seg.className = 'seg-control';
    for (const [optVal, optLabel] of options) {
      const btn = document.createElement('button');
      btn.className = 'seg-btn' + (initP[key] === optVal ? ' active' : '');
      btn.textContent = optLabel;
      btn.addEventListener('click', () => {
        const p = getWritableFilterParams(filter); // create entry only on actual user interaction
        p[key] = optVal;
        seg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.textContent === optLabel));
        repaint();
      });
      seg.appendChild(btn);
    }
    wrap.appendChild(lbl); wrap.appendChild(seg);
    container.appendChild(wrap);
  }

  if (filter === 'crt') {
    addSeg('Phosphor tint', 'phosphor', [['none','None'],['green','Green'],['amber','Amber']]);
    addSeg('Screen shape',  'curve',    [['none','Flat'],['mild','Mild'],['strong','Strong']]);
  } else if (filter === 'lcd') {
    addSlider('Sub-pixel tint', 'subpixel', 0, 80, 5, v => `${v}%`);
  } else if (filter === 'dot') {
    addSlider('Dot size', 'radius', 20, 80, 2, v => `${v}%`);
  } else if (filter === 'glow') {
    addSlider('Bloom radius', 'blur', 50, 300, 10, v => `${v}%`);
    addSeg('Phosphor colour', 'phosphor', [['none','None'],['green','Green'],['amber','Amber']]);
  } else if (filter === 'chroma') {
    addSlider('Channel shift', 'shift', 25, 300, 5, v => `${v}%`);
  } else if (filter === 'jitter') {
    addSlider('Jitter amount', 'amount', 5, 100, 5, v => `${v}%`);
  } else if (filter === 'grid') {
    addSlider('Grid opacity', 'opacity', 10, 100, 5, v => `${v}%`);
  } else if (filter === 'vignette') {
    addSlider('Falloff', 'falloff', 0, 100, 5, v => `${v}%`);
  } else if (filter === 'halftone') {
    addSlider('Dot size', 'radius', 20, 60, 2, v => `${v}%`);
  }
}

/**
 * Applies a visual effect overlay onto an already-rendered export canvas.
 * All effects are rendered to an offscreen canvas first, then composited at
 * `intensity` opacity so the user's intensity slider works for every filter.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width     — canvas width in px
 * @param {number} height    — canvas height in px
 * @param {number} scale     — pixels-per-GB-pixel
 * @param {string} filter    — filter id from FILTER_DEFS (e.g. 'crt', 'noise', 'bayer', etc.)
 * @param {number} intensity — 0.0–1.0 (default 1.0)
 * @param {string} variant   — crt only: 'fine'|'medium'|'thick'|'wide' (default 'medium')
 */
// ── Tone adjustments (brightness / contrast / split toning) ─────────────────

function applyToneAdjustments(ctx, width, height, settings, forExport = false) {
  if (!forExport && state.effectsPreviewMode) return;
  const s = settings || state;
  const brightness   = (state.sectionEnabled?.exposure   ?? true) ? (s.brightness   ?? 0) : 0;
  const contrast     = (state.sectionEnabled?.exposure   ?? true) ? (s.contrast     ?? 0) : 0;
  const toneIntensity= (state.sectionEnabled?.splitTone  ?? true) ? (s.toneIntensity?? 0) : 0;
  const { shadowColor, highlightColor, toneBalance } = s;
  if (brightness === 0 && contrast === 0 && toneIntensity === 0) return;

  const imageData = ctx.getImageData(0, 0, width, height);
  const d = imageData.data;

  // Pre-compute contrast factor (S-curve through 128)
  const contrastFactor = contrast !== 0
    ? (259 * (contrast + 255)) / (255 * (259 - contrast))
    : 1;

  // Parse split toning colors
  const sr = parseInt(shadowColor.slice(1, 3), 16);
  const sg = parseInt(shadowColor.slice(3, 5), 16);
  const sb = parseInt(shadowColor.slice(5, 7), 16);
  const hr = parseInt(highlightColor.slice(1, 3), 16);
  const hg = parseInt(highlightColor.slice(3, 5), 16);
  const hb = parseInt(highlightColor.slice(5, 7), 16);
  const toneStr   = toneIntensity / 100;
  const mid       = (toneBalance + 100) / 200; // 0..1, default 0.5

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let r = d[i], g = d[i + 1], b = d[i + 2];

    // Brightness
    if (brightness !== 0) {
      r = Math.min(255, Math.max(0, r + brightness));
      g = Math.min(255, Math.max(0, g + brightness));
      b = Math.min(255, Math.max(0, b + brightness));
    }

    // Contrast
    if (contrast !== 0) {
      r = Math.min(255, Math.max(0, Math.round(contrastFactor * (r - 128) + 128)));
      g = Math.min(255, Math.max(0, Math.round(contrastFactor * (g - 128) + 128)));
      b = Math.min(255, Math.max(0, Math.round(contrastFactor * (b - 128) + 128)));
    }

    // Split toning — blend toward shadow/highlight tint based on luminance
    if (toneIntensity > 0) {
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const sw  = mid > 0    ? Math.max(0, 1 - lum / mid)          : 0;
      const hw  = mid < 1    ? Math.max(0, (lum - mid) / (1 - mid)): 0;
      r = Math.min(255, Math.max(0, Math.round(r + toneStr * (sw * (sr - r) + hw * (hr - r)))));
      g = Math.min(255, Math.max(0, Math.round(g + toneStr * (sw * (sg - g) + hw * (hg - g)))));
      b = Math.min(255, Math.max(0, Math.round(b + toneStr * (sw * (sb - b) + hw * (hb - b)))));
    }

    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Deterministic pseudo-random float in [0,1) seeded from two integers.
 * Used to stabilise noise/glitch effects so they don't flicker on every repaint.
 * @param {number} seed1  — first seed (e.g. photo index)
 * @param {number} seed2  — second seed (e.g. pixel index or row)
 */
function _seededRand(seed1, seed2) {
  let h = (seed1 * 1664525 + seed2 * 1013904223 + 0x9e3779b9) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 0x100000000);
}

function applyExportFilter(ctx, width, height, scale, filter,
                           intensity = 1.0, variant = 'medium', filterParams, photoSeed = 0) {
  filterParams = filterParams || state.filterParams;
  if (!filter || filter === 'none') return;
  if (intensity <= 0) return;

  const s = Math.max(1, Math.round(scale));

  // Render the effect onto an offscreen canvas, then draw at the target intensity
  const eff = Object.assign(document.createElement('canvas'), { width, height });
  const ec  = eff.getContext('2d');

  if (filter === 'crt') {
    // Scanline gap: a dark strip at the BOTTOM of each simulated GB pixel row.
    // Each variant controls what fraction of the row height becomes a dark gap.
    // This means variants are dramatically different at any scale ≥ 2.
    const cfgs = {
      fine:   { gap: 0.22, alpha: 0.45 },   // subtle gap, light darkening
      medium: { gap: 0.40, alpha: 0.70 },   // classic CRT look
      thick:  { gap: 0.58, alpha: 0.84 },   // heavy scanlines
      wide:   { gap: 0.76, alpha: 0.94 },   // almost half the row is dark
    };
    const cfg    = cfgs[variant] || cfgs.medium;
    const crtMix = ((filterParams.crt || {}).mix ?? 100) / 100; // 0–1 blend
    const rowH    = Math.max(1, s);
    const gapH    = Math.min(Math.max(1, Math.round(rowH * cfg.gap)), rowH - 1);
    const brightH = Math.max(1, rowH - gapH);

    // Draw dark gaps at the bottom of each GB pixel row (use canvas height so border area is covered too)
    const numCrtRows = Math.ceil(height / rowH);
    for (let row = 0; row < numCrtRows; row++) {
      const rowTop = row * rowH;
      ec.fillStyle = `rgba(0,0,0,${cfg.alpha * crtMix})`;
      ec.fillRect(0, rowTop + brightH, width, gapH);
    }

    // Screen curvature — edge darkening + specular highlight
    const curve = (filterParams.crt || {}).curve ?? 'none';
    if (curve !== 'none') {
      const cx = width / 2, cy = height / 2;
      const isStrong = curve === 'strong';
      const edgeDark = isStrong ? 0.62 : 0.34;
      const innerR   = Math.min(width, height) * (isStrong ? 0.15 : 0.28);
      const outerR   = Math.max(width, height) * 0.88;
      const edgeGrad = ec.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
      edgeGrad.addColorStop(0, 'rgba(0,0,0,0)');
      edgeGrad.addColorStop(1, `rgba(0,0,0,${edgeDark})`);
      ec.fillStyle = edgeGrad;
      ec.fillRect(0, 0, width, height);
      // Specular highlight at top-centre (convex glass look)
      const specA    = isStrong ? 0.14 : 0.07;
      const specGrad = ec.createRadialGradient(cx, height * 0.07, 0, cx, height * 0.28, width * 0.55);
      specGrad.addColorStop(0, `rgba(255,255,255,${specA})`);
      specGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ec.fillStyle = specGrad;
      ec.fillRect(0, 0, width, height);
    }

  } else if (filter === 'lcd') {
    const spStr    = ((filterParams.lcd || {}).subpixel ?? 30) / 100;
    const lcdBleed = ((filterParams.lcd || {}).bleed    ?? 0)  / 100;
    // Scale separator lines proportionally so they look the same at any render scale.
    // Target ~15% of the cell; clamp to at least 1px.
    const sepH = Math.max(1, Math.round(s * 0.15));
    const sepW = Math.max(1, Math.round(s * 0.12));
    // Row gaps
    for (let y = s - sepH; y < height; y += s) {
      ec.fillStyle = 'rgba(0,0,0,0.38)';
      ec.fillRect(0, y, width, sepH);
    }
    // Column separators
    for (let x = s; x < width; x += s) {
      ec.fillStyle = 'rgba(0,0,0,0.22)';
      ec.fillRect(x - sepW, 0, sepW, height);
    }
    // RGB sub-pixel tint columns (strength from slider)
    if (s >= 4 && spStr > 0) {
      const cw = Math.max(1, Math.round(s / 3));
      for (let x = 0; x < width; x += s) {
        ec.fillStyle = `rgba(255,80,80,${spStr})`;
        ec.fillRect(x, 0, cw, height);
        ec.fillStyle = `rgba(80,255,80,${spStr})`;
        ec.fillRect(x + cw, 0, cw, height);
        ec.fillStyle = `rgba(80,80,255,${spStr})`;
        ec.fillRect(x + cw * 2, 0, cw, height);
      }
    }
    // Backlight bleed — faint white glow from corners/edges
    if (lcdBleed > 0) {
      const corners = [[0, 0], [width, 0], [0, height], [width, height]];
      const bleedR  = Math.max(width, height) * 0.6;
      for (const [cx2, cy2] of corners) {
        const bg = ec.createRadialGradient(cx2, cy2, 0, cx2, cy2, bleedR);
        bg.addColorStop(0, `rgba(255,255,255,${lcdBleed * 0.18})`);
        bg.addColorStop(1, 'rgba(255,255,255,0)');
        ec.fillStyle = bg;
        ec.fillRect(0, 0, width, height);
      }
    }

  } else if (filter === 'grid') {
    // Pixel grid — draws lines on GB pixel boundaries so each pixel has a clear border.
    // Only meaningful when each GB pixel occupies ≥ 2 screen pixels.
    // Weight slider is in "units at 4×", scaled proportionally so the visual weight
    // stays consistent at any render scale (1 unit ≈ 1px at 4×, 5px at 20×, etc.).
    const gridOpacity = ((filterParams.grid || {}).opacity ?? 30) / 100;
    const lineWBase   = ((filterParams.grid || {}).weight ?? 1);
    const lineW       = Math.max(1, Math.round(lineWBase * s / 4));
    if (s >= 2) {
      ec.strokeStyle = `rgba(0,0,0,${gridOpacity})`;
      ec.lineWidth = lineW;
      // Vertical lines at each GB pixel boundary — use canvas width so border area is covered
      const numGridCols = Math.ceil(width / s);
      for (let col = 1; col <= numGridCols; col++) {
        const x = col * s - lineW / 2;
        ec.beginPath(); ec.moveTo(x, 0); ec.lineTo(x, height); ec.stroke();
      }
      // Horizontal lines at each GB pixel boundary — use canvas height so border area is covered
      const numGridRows = Math.ceil(height / s);
      for (let row = 1; row <= numGridRows; row++) {
        const y = row * s - lineW / 2;
        ec.beginPath(); ec.moveTo(0, y); ec.lineTo(width, y); ec.stroke();
      }
    }

  } else if (filter === 'vignette') {
    const _fv    = (filterParams.vignette || {}).falloff ?? 50;
    const _shape = ((filterParams.vignette || {}).shape  ?? 0) / 100; // 0=round, 1=square
    const _t     = (typeof _fv === 'string'
      ? ({ soft: 20, medium: 50, hard: 80 }[_fv] ?? 50)
      : _fv) / 100; // 0..1
    const cx = width / 2, cy = height / 2;
    // Bring vignette closer to centre: inner starts at 20% (soft) → 0% (hard)
    const innerMult = 0.20 - _t * 0.18; // 0.20 → 0.02
    const outerMult = 0.75 - _t * 0.15; // 0.75 → 0.60
    const darkMax   = 0.30 + _t * 0.68; // 0.30 → 0.98

    if (_shape > 0.05) {
      // Square-ish vignette — squish canvas coords then apply circular gradient
      ec.save();
      ec.translate(cx, cy);
      ec.scale(1, width / height * (1 - _shape * 0.4) + _shape * (height / width * 1.4));
      ec.translate(-cx, -cy);
      const squishR = Math.min(width, height) * Math.max(0, innerMult + _shape * 0.05);
      const squishOuter = Math.max(width, height) * (outerMult + _shape * 0.05);
      const gSq = ec.createRadialGradient(cx, cy, squishR, cx, cy, squishOuter);
      gSq.addColorStop(0,   'rgba(0,0,0,0)');
      gSq.addColorStop(0.5, `rgba(0,0,0,${(darkMax * 0.30).toFixed(2)})`);
      gSq.addColorStop(1,   `rgba(0,0,0,${darkMax})`);
      ec.fillStyle = gSq;
      ec.fillRect(-width, -height, width * 3, height * 3);
      ec.restore();
    } else {
      const inner = Math.min(width, height) * Math.max(0, innerMult);
      const outer = Math.max(width, height) * outerMult;
      const grad  = ec.createRadialGradient(cx, cy, inner, cx, cy, outer);
      grad.addColorStop(0,   'rgba(0,0,0,0)');
      grad.addColorStop(0.5, `rgba(0,0,0,${(darkMax * 0.25).toFixed(2)})`);
      grad.addColorStop(1,   `rgba(0,0,0,${darkMax})`);
      ec.fillStyle = grad;
      ec.fillRect(0, 0, width, height);
    }

  } else if (filter === 'halftone') {
    const htRad      = ((filterParams.halftone || {}).radius   ?? 38) / 100;
    const htDarkness = ((filterParams.halftone || {}).darkness ?? 35) / 100;
    const htShape    = (filterParams.halftone || {}).shape ?? 'circle';
    const r = Math.max(1, Math.round(s * htRad));
    ec.fillStyle = `rgba(0,0,0,${htDarkness.toFixed(2)})`;
    for (let y = Math.round(s * 0.5); y < height; y += s) {
      for (let x = Math.round(s * 0.5); x < width; x += s) {
        ec.beginPath();
        if (htShape === 'circle') {
          ec.arc(x, y, r, 0, Math.PI * 2);
        } else if (htShape === 'square') {
          ec.rect(x - r, y - r, r * 2, r * 2);
        } else if (htShape === 'diamond') {
          ec.moveTo(x, y - r);
          ec.lineTo(x + r, y);
          ec.lineTo(x, y + r);
          ec.lineTo(x - r, y);
          ec.closePath();
        }
        ec.fill();
      }
    }

  } else if (filter === 'dot') {
    // ── Dot Matrix ─────────────────────────────────────────────────────────
    // Dark overlay with circular cut-outs per GB pixel — makes each pixel
    // appear as a rounded dot with visible gaps between them (like a DMD).
    ec.fillStyle = 'rgba(0,0,0,0.88)';
    ec.fillRect(0, 0, width, height);
    // Punch circular holes so the underlying pixel colours show through
    ec.globalCompositeOperation = 'destination-out';
    const dotRadPct  = ((filterParams.dot || {}).radius   ?? 44) / 100;
    const halationPct= ((filterParams.dot || {}).halation ?? 0)  / 100;
    const dotR = Math.max(1, Math.round(s * dotRadPct));
    const dotRows = Math.ceil(height / s);
    const dotCols = Math.ceil(width / s);
    for (let py = 0; py < dotRows; py++) {
      for (let px = 0; px < dotCols; px++) {
        const cx = Math.round(px * s + s * 0.5);
        const cy = Math.round(py * s + s * 0.5);
        ec.beginPath();
        ec.arc(cx, cy, dotR, 0, Math.PI * 2);
        ec.fill();
      }
    }
    ec.globalCompositeOperation = 'source-over';
    // Halation — soft outer glow around each dot
    if (halationPct > 0) {
      for (let py = 0; py < dotRows; py++) {
        for (let px = 0; px < dotCols; px++) {
          const cx2 = Math.round(px * s + s * 0.5);
          const cy2 = Math.round(py * s + s * 0.5);
          const gR   = dotR + Math.round(s * halationPct * 0.8);
          const hGrad = ec.createRadialGradient(cx2, cy2, dotR * 0.8, cx2, cy2, gR);
          hGrad.addColorStop(0, `rgba(255,255,255,${halationPct * 0.3})`);
          hGrad.addColorStop(1, 'rgba(255,255,255,0)');
          ec.fillStyle = hGrad;
          ec.beginPath();
          ec.arc(cx2, cy2, gR, 0, Math.PI * 2);
          ec.fill();
        }
      }
    }

  } else if (filter === 'glow') {
    // ── Phosphor Glow ──────────────────────────────────────────────────────
    // Creates a coloured phosphor bloom: tint a copy of the source, blur it
    // heavily, then screen-blend it back so bright pixels glow outward.
    const glowBlurPct  = ((filterParams.glow || {}).blur      ?? 110) / 100;
    const glowIntensity = ((filterParams.glow || {}).intensity ?? 80)  / 100;
    const ph           = (filterParams.glow || {}).phosphor ?? 'none';

    // If intensity is zero and no phosphor tint, nothing to render
    if (glowIntensity <= 0 && ph === 'none') return;

    const phColors = { green: 'rgba(0,255,80,0.40)', amber: 'rgba(255,170,0,0.42)', blue: 'rgba(80,160,255,0.40)' };

    // Step 1: draw source image onto tinting canvas
    const bloomSrc = Object.assign(document.createElement('canvas'), { width, height });
    const bsc = bloomSrc.getContext('2d');
    bsc.drawImage(ctx.canvas, 0, 0);

    // Step 2: overlay phosphor colour using 'source-atop' so tint only goes where pixels are
    if (ph !== 'none' && phColors[ph]) {
      bsc.globalCompositeOperation = 'source-atop';
      bsc.fillStyle = phColors[ph];
      bsc.fillRect(0, 0, width, height);
      bsc.globalCompositeOperation = 'source-over';
    }

    // Step 3: blur the tinted source. At blur=0 skip blurring.
    const blurPx = Math.round(s * 3.5 * glowBlurPct);
    const bloom  = Object.assign(document.createElement('canvas'), { width, height });
    const bc     = bloom.getContext('2d');
    if (blurPx > 0) {
      bc.filter = `blur(${blurPx}px)`;
    }
    bc.drawImage(bloomSrc, 0, 0);
    bc.filter = 'none';

    // Step 4: screen blend — bright pixels push toward white/colour with bloom aura
    ctx.save();
    ctx.globalAlpha              = Math.min(1, Math.max(0, glowIntensity));
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(bloom, 0, 0);
    ctx.restore();
    return; // composited directly; skip the generic end-of-function drawImage

  } else if (filter === 'chroma') {
    // ── Chromatic Aberration — independent H/V/R channel shifts ──────────
    const cp = filterParams.chroma || {};
    const hpx = Math.round(s * (cp.shiftH ?? 75) / 100);
    const vpx = Math.round(s * (cp.shiftV ?? 0)  / 100);
    const rpx = Math.round(s * (cp.shiftR ?? 0)  / 100);
    const orig  = ctx.getImageData(0, 0, width, height);
    const dst   = new ImageData(width, height);
    const d = orig.data, o = dst.data;
    const cx2 = width / 2, cy2 = height / 2;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        // Radial component: normalised direction vector from centre
        let nx = 0, ny = 0;
        if (rpx !== 0) {
          const dx = x - cx2, dy = y - cy2;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          nx = dx / dist; ny = dy / dist;
        }
        // Red channel: shift +H/+V/+R
        const rx = Math.min(width  - 1, Math.max(0, Math.round(x + hpx + nx * rpx)));
        const ry = Math.min(height - 1, Math.max(0, Math.round(y + vpx + ny * rpx)));
        // Blue channel: shift -H/-V/-R
        const bx = Math.min(width  - 1, Math.max(0, Math.round(x - hpx - nx * rpx)));
        const by = Math.min(height - 1, Math.max(0, Math.round(y - vpx - ny * rpx)));

        const ri = (ry * width + rx) * 4;
        const bi = (by * width + bx) * 4;
        o[i]     = d[ri];       // R from shifted source
        o[i + 1] = d[i + 1];   // G stays
        o[i + 2] = d[bi + 2];  // B from shifted source
        o[i + 3] = 255;
      }
    }

    const t = Math.min(1, Math.max(0, intensity));
    if (t < 1) {
      for (let i = 0; i < o.length; i += 4) {
        o[i]     = Math.round(d[i]     * (1 - t) + o[i]     * t);
        o[i + 1] = Math.round(d[i + 1] * (1 - t) + o[i + 1] * t);
        o[i + 2] = Math.round(d[i + 2] * (1 - t) + o[i + 2] * t);
      }
    }

    ctx.putImageData(dst, 0, 0);
    return; // composited directly; skip the generic end-of-function drawImage

  } else if (filter === 'jitter') {
    // ── Scanline Jitter ────────────────────────────────────────────────────
    // Displaces each row of pixels horizontally by a deterministic amount,
    // grouped by GB tile row for an authentic corrupted-signal look.
    const jitterPct   = ((filterParams.jitter || {}).amount    ?? 40) / 100;
    const jitterFreq  = ((filterParams.jitter || {}).frequency ?? 50) / 100; // 0.1–1.0: lower = fewer affected rows
    const maxShift    = Math.max(1, Math.round(s * jitterPct * 3));
    const orig = ctx.getImageData(0, 0, width, height);
    const dst  = new ImageData(width, height);
    const d = orig.data, o = dst.data;
    const tileH = Math.max(1, s); // pixels per GB pixel row

    for (let y = 0; y < height; y++) {
      const tileY = Math.floor(y / tileH);
      const frac  = (Math.sin(tileY * 43758.5453123) * 43758.5453123) % 1;
      const norm  = frac < 0 ? frac + 1 : frac;
      // Frequency: only displace rows where the "noise" exceeds (1 - jitterFreq)
      const shouldJitter = norm > (1 - jitterFreq);
      const shift = shouldJitter ? Math.round((norm * 2 - 1) * maxShift) : 0;
      for (let x = 0; x < width; x++) {
        const sx = Math.min(width - 1, Math.max(0, x + shift));
        const i  = (y * width + x) * 4;
        const si = (y * width + sx) * 4;
        o[i]   = d[si]; o[i+1] = d[si+1]; o[i+2] = d[si+2]; o[i+3] = 255;
      }
    }

    const t = Math.min(1, Math.max(0, intensity));
    if (t < 1) {
      for (let i = 0; i < o.length; i += 4) {
        o[i]   = Math.round(d[i]   * (1-t) + o[i]   * t);
        o[i+1] = Math.round(d[i+1] * (1-t) + o[i+1] * t);
        o[i+2] = Math.round(d[i+2] * (1-t) + o[i+2] * t);
      }
    }
    ctx.putImageData(dst, 0, 0);
    return;

  } else if (filter === 'noise') {
    // ── Noise / Static ──────────────────────────────────────────────────────
    // Film: per-pixel luminance noise. Static: random R/G/B noise. Bands: row noise.
    // Uses seeded PRNG (photoSeed) so noise is stable across repaints.
    const noiseAmt  = ((filterParams.noise || {}).amount ?? 40) / 100;
    const noiseType = (filterParams.noise || {}).type ?? 'film';
    const orig = ctx.getImageData(0, 0, width, height);
    const d    = orig.data;
    const src  = new Uint8ClampedArray(d); // original for intensity blend

    if (noiseType === 'film') {
      for (let i = 0; i < d.length; i += 4) {
        const g = (_seededRand(photoSeed, i)     - 0.5) * noiseAmt * 200;
        d[i]   = Math.min(255, Math.max(0, d[i]   + g));
        d[i+1] = Math.min(255, Math.max(0, d[i+1] + g));
        d[i+2] = Math.min(255, Math.max(0, d[i+2] + g));
      }
    } else if (noiseType === 'static') {
      for (let i = 0; i < d.length; i += 4) {
        d[i]   = Math.min(255, Math.max(0, d[i]   + (_seededRand(photoSeed, i)     - 0.5) * noiseAmt * 200));
        d[i+1] = Math.min(255, Math.max(0, d[i+1] + (_seededRand(photoSeed, i + 1) - 0.5) * noiseAmt * 200));
        d[i+2] = Math.min(255, Math.max(0, d[i+2] + (_seededRand(photoSeed, i + 2) - 0.5) * noiseAmt * 200));
      }
    } else if (noiseType === 'bands') {
      for (let y = 0; y < height; y++) {
        const rowNoise = (_seededRand(photoSeed, y) - 0.5) * noiseAmt * 180;
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          d[i]   = Math.min(255, Math.max(0, d[i]   + rowNoise));
          d[i+1] = Math.min(255, Math.max(0, d[i+1] + rowNoise));
          d[i+2] = Math.min(255, Math.max(0, d[i+2] + rowNoise));
        }
      }
    }
    const t = Math.min(1, Math.max(0, intensity));
    if (t < 1) {
      for (let i = 0; i < d.length; i += 4) {
        d[i]   = Math.round(src[i]   * (1 - t) + d[i]   * t);
        d[i+1] = Math.round(src[i+1] * (1 - t) + d[i+1] * t);
        d[i+2] = Math.round(src[i+2] * (1 - t) + d[i+2] * t);
      }
    }
    ctx.putImageData(orig, 0, 0);
    return;

  } else if (filter === 'ghosting') {
    // ── VHS Ghosting ──────────────────────────────────────────────────────
    // Blends in a horizontally-offset semi-transparent copy of the image,
    // then a second dimmer copy at 2× offset — mimics VHS tape ghosting.
    const ghostOffset = ((filterParams.ghosting || {}).offset ?? 60) / 100;
    const ghostFade   = ((filterParams.ghosting || {}).fade   ?? 70) / 100;
    const shift2      = Math.max(2, Math.round(s * ghostOffset));
    const orig = ctx.getImageData(0, 0, width, height);
    const dst  = new ImageData(width, height);
    const d = orig.data, o = dst.data;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i   = (y * width + x) * 4;
        // Ghost 1: shift left by offset
        const g1x = Math.max(0, x - shift2);
        const g1i = (y * width + g1x) * 4;
        // Ghost 2: shift left by 2× offset (dimmer)
        const g2x = Math.max(0, x - shift2 * 2);
        const g2i = (y * width + g2x) * 4;
        const a1  = (1 - ghostFade) * 0.8;
        const a2  = (1 - ghostFade) * 0.35;
        o[i]   = Math.min(255, d[i]   + d[g1i]   * a1 + d[g2i]   * a2);
        o[i+1] = Math.min(255, d[i+1] + d[g1i+1] * a1 + d[g2i+1] * a2);
        o[i+2] = Math.min(255, d[i+2] + d[g1i+2] * a1 + d[g2i+2] * a2);
        o[i+3] = 255;
      }
    }
    const tg = Math.min(1, Math.max(0, intensity));
    if (tg < 1) {
      for (let i = 0; i < o.length; i += 4) {
        o[i]   = Math.round(d[i]   * (1 - tg) + o[i]   * tg);
        o[i+1] = Math.round(d[i+1] * (1 - tg) + o[i+1] * tg);
        o[i+2] = Math.round(d[i+2] * (1 - tg) + o[i+2] * tg);
      }
    }
    ctx.putImageData(dst, 0, 0);
    return;

  } else if (filter === 'pixsort') {
    // ── Pixel Sort ────────────────────────────────────────────────────────
    // Finds contiguous runs of pixels above a luminance threshold and sorts
    // them by brightness — dark-to-bright in direction of travel — creating
    // coloured streaks that drip or slide along the image.
    const threshPct = ((filterParams.pixsort || {}).threshold ?? 50) / 100;
    const dir       = (filterParams.pixsort || {}).direction ?? 'down';
    const src = ctx.getImageData(0, 0, width, height);
    const sd  = src.data;
    const out = new Uint8ClampedArray(sd); // start as identity copy
    const lum = i => (sd[i] * 0.299 + sd[i+1] * 0.587 + sd[i+2] * 0.114) / 255;

    // Helper: sort a run of pixels, write to out
    const sortRun = (pixels, ascending, indices) => {
      const run = pixels.map((i, j) => [lum(i), sd[i], sd[i+1], sd[i+2], sd[i+3]]);
      run.sort((a, b) => ascending ? a[0] - b[0] : b[0] - a[0]);
      for (let j = 0; j < run.length; j++) {
        const ri = pixels[j];
        out[ri] = run[j][1]; out[ri+1] = run[j][2]; out[ri+2] = run[j][3]; out[ri+3] = run[j][4];
      }
    };

    if (dir === 'down' || dir === 'vertical') {
      // Sort columns top→bottom, dark at top
      for (let x = 0; x < width; x++) {
        let run = [];
        for (let y = 0; y <= height; y++) {
          const i = (y * width + x) * 4;
          const l = y < height ? lum(i) : -1;
          if (l >= threshPct) { run.push(i); }
          else if (run.length > 0) { sortRun(run, true, null); run = []; }
        }
      }
    } else if (dir === 'up') {
      // Sort columns bottom→top, dark at bottom (bright streaks upward)
      for (let x = 0; x < width; x++) {
        let run = [];
        for (let y = height - 1; y >= -1; y--) {
          const i = (Math.max(0, y) * width + x) * 4;
          const l = y >= 0 ? lum(i) : -1;
          if (y >= 0 && l >= threshPct) { run.push(i); }
          else if (run.length > 0) { sortRun(run, false, null); run = []; }
        }
      }
    } else if (dir === 'right' || dir === 'horizontal') {
      // Sort rows left→right, dark at left
      for (let y = 0; y < height; y++) {
        let run = [];
        for (let x = 0; x <= width; x++) {
          const i = (y * width + x) * 4;
          const l = x < width ? lum(i) : -1;
          if (x < width && l >= threshPct) { run.push(i); }
          else if (run.length > 0) { sortRun(run, true, null); run = []; }
        }
      }
    } else if (dir === 'left') {
      // Sort rows right→left, dark at right (bright streaks leftward)
      for (let y = 0; y < height; y++) {
        let run = [];
        for (let x = width - 1; x >= -1; x--) {
          const i = (y * width + Math.max(0, x)) * 4;
          const l = x >= 0 ? lum(i) : -1;
          if (x >= 0 && l >= threshPct) { run.push(i); }
          else if (run.length > 0) { sortRun(run, false, null); run = []; }
        }
      }
    }
    const tp = Math.min(1, Math.max(0, intensity));
    if (tp < 1) {
      for (let i = 0; i < out.length; i += 4) {
        out[i]   = Math.round(sd[i]   * (1 - tp) + out[i]   * tp);
        out[i+1] = Math.round(sd[i+1] * (1 - tp) + out[i+1] * tp);
        out[i+2] = Math.round(sd[i+2] * (1 - tp) + out[i+2] * tp);
      }
    }
    ctx.putImageData(new ImageData(out, width, height), 0, 0);
    return;

  } else if (filter === 'blkglitch') {
    // ── Block Glitch ──────────────────────────────────────────────────────
    // Picks random horizontal strips and shifts each one sideways with
    // wraparound — simulates corrupted video block data.
    const shiftPct     = ((filterParams.blkglitch || {}).shift     ?? 40) / 100;
    const densityPct   = ((filterParams.blkglitch || {}).density   ?? 30) / 100;
    const sizePct      = ((filterParams.blkglitch || {}).size      ?? 20) / 100;
    const maxHeightPct = ((filterParams.blkglitch || {}).maxheight ?? 30) / 100;
    const src = ctx.getImageData(0, 0, width, height);
    const sd  = src.data;
    const out = new Uint8ClampedArray(sd);
    const maxShift  = Math.max(1, Math.round(width  * shiftPct * 0.5));
    const maxBlockH = Math.max(1, Math.round(height * maxHeightPct * sizePct));
    const numBlocks = Math.max(1, Math.round(densityPct * 25));

    // Seeded RNG so block layout is stable across repaints (no flicker)
    let _rngBg = (photoSeed * 1664525 + 1013904223) | 0;
    const _randBg = () => { _rngBg = (_rngBg * 1664525 + 1013904223) | 0; return (_rngBg >>> 0) / 0x100000000; };

    for (let b = 0; b < numBlocks; b++) {
      const y0  = Math.floor(_randBg() * height);
      const bh  = Math.max(1, Math.ceil(_randBg() * maxBlockH));
      const dxs = Math.round((_randBg() - 0.5) * 2 * maxShift);
      for (let y = y0; y < Math.min(height, y0 + bh); y++) {
        for (let x = 0; x < width; x++) {
          const srcX = ((x - dxs) % width + width) % width;
          const di = (y * width + x) * 4;
          const si = (y * width + srcX) * 4;
          out[di] = sd[si]; out[di+1] = sd[si+1]; out[di+2] = sd[si+2]; out[di+3] = sd[si+3];
        }
      }
    }
    const tb = Math.min(1, Math.max(0, intensity));
    if (tb < 1) {
      for (let i = 0; i < out.length; i += 4) {
        out[i]   = Math.round(sd[i]   * (1 - tb) + out[i]   * tb);
        out[i+1] = Math.round(sd[i+1] * (1 - tb) + out[i+1] * tb);
        out[i+2] = Math.round(sd[i+2] * (1 - tb) + out[i+2] * tb);
      }
    }
    ctx.putImageData(new ImageData(out, width, height), 0, 0);
    return;

  } else if (filter === 'wavewarp') {
    // ── Wave Warp ─────────────────────────────────────────────────────────
    // Displaces each row horizontally by a sine function of its y position,
    // creating a smooth rippling warp across the image.
    const ampPct  = ((filterParams.wavewarp || {}).amplitude ?? 30) / 100;
    const freqPct = ((filterParams.wavewarp || {}).frequency ?? 40) / 100;
    const amplitude = Math.max(1, Math.round(width * ampPct * 0.25));
    const cycles    = 1 + freqPct * 7; // 1 to 8 full cycles over image height

    const src = ctx.getImageData(0, 0, width, height);
    const sd  = src.data;
    const out = new Uint8ClampedArray(sd.length);

    for (let y = 0; y < height; y++) {
      const offsetX = Math.round(Math.sin((y / height) * cycles * Math.PI * 2) * amplitude);
      for (let x = 0; x < width; x++) {
        const srcX = ((x - offsetX) % width + width) % width;
        const di = (y * width + x) * 4;
        const si = (y * width + srcX) * 4;
        out[di] = sd[si]; out[di+1] = sd[si+1]; out[di+2] = sd[si+2]; out[di+3] = sd[si+3];
      }
    }
    const tw = Math.min(1, Math.max(0, intensity));
    if (tw < 1) {
      for (let i = 0; i < out.length; i += 4) {
        out[i]   = Math.round(sd[i]   * (1 - tw) + out[i]   * tw);
        out[i+1] = Math.round(sd[i+1] * (1 - tw) + out[i+1] * tw);
        out[i+2] = Math.round(sd[i+2] * (1 - tw) + out[i+2] * tw);
      }
    }
    ctx.putImageData(new ImageData(out, width, height), 0, 0);
    return;

  } else if (filter === 'zoomblur') {
    // ── Zoom Blur ─────────────────────────────────────────────────────────
    // Composites multiple scaled copies of the image radiating outward from
    // the centre at decreasing opacity, producing a radial motion-blur effect.
    // The original is always the base layer so brightness is preserved at all amounts.
    const zoomAmt = ((filterParams.zoomblur || {}).amount ?? 30) / 100;
    const steps   = 12;
    const maxExpand = 0.6; // at 100% the outermost copy is 1.6× the canvas size

    // Snapshot the current canvas before modifying it
    const tmp = Object.assign(document.createElement('canvas'), { width, height });
    tmp.getContext('2d').drawImage(ctx.canvas, 0, 0);

    // Draw original at full opacity as the base
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(tmp, 0, 0);

    // Blend zoomed copies on top — each at low opacity, scaled with zoomAmt and intensity
    const blendAlpha = Math.min(0.9, zoomAmt) / steps * Math.min(1, Math.max(0, intensity));
    for (let i = 1; i <= steps; i++) {
      const t  = i / steps;
      const sc = 1 + t * zoomAmt * maxExpand;
      const dx = (width  - width  * sc) / 2;
      const dy = (height - height * sc) / 2;
      ctx.globalAlpha = blendAlpha * (1 - t * 0.4); // fade off at outermost
      ctx.drawImage(tmp, dx, dy, width * sc, height * sc);
    }
    ctx.globalAlpha = 1;
    return;
  } else if (filter === 'bayer') {
    // ── Bayer Dithering ────────────────────────────────────────────────────
    // Ordered dithering using Bayer matrix, reduces color depth for retro effect.
    const levels = ((filterParams.bayer || {}).levels ?? 4);
    const bayerMatrix = [
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5]
    ];
    const step = Math.floor(256 / levels);
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const bayerOrig = new Uint8ClampedArray(data); // copy for intensity blend
    for (let i = 0; i < data.length; i += 4) {
      const pixelIndex = i / 4;
      const row = Math.floor(pixelIndex / width) % 4;
      const col = pixelIndex % width % 4;
      const threshold = (bayerMatrix[row][col] / 16) * 255;
      for (let c = 0; c < 3; c++) {
        const quantized = Math.floor(data[i + c] / step) * step;
        data[i + c] = data[i + c] > quantized + threshold ? quantized + step : quantized;
      }
    }
    const tby = Math.min(1, Math.max(0, intensity));
    if (tby < 1) {
      for (let i = 0; i < data.length; i += 4) {
        data[i]   = Math.round(bayerOrig[i]   * (1 - tby) + data[i]   * tby);
        data[i+1] = Math.round(bayerOrig[i+1] * (1 - tby) + data[i+1] * tby);
        data[i+2] = Math.round(bayerOrig[i+2] * (1 - tby) + data[i+2] * tby);
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return;
  } else if (filter === 'floyd') {
    // ── Floyd-Steinberg Dithering ──────────────────────────────────────────
    // Error diffusion dithering. Converts to luminance first so GB palette images
    // (which are already 4-colour) still show pronounced halftoning. At levels=2
    // this produces pure B&W dithering with classic dot-pattern halftone.
    const levels = ((filterParams.floyd || {}).levels ?? 2);
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const floydOrig = new Uint8ClampedArray(data); // copy for intensity blend

    // Build luminance channel with error buffer, then quantise
    const lums   = new Float32Array(width * height);
    const errors = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      lums[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
    }

    const step = 255 / (levels - 1);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const val = Math.max(0, Math.min(255, lums[idx] + errors[idx]));
        const quantized = Math.round(val / step) * step;
        const err = val - quantized;
        lums[idx] = quantized;
        // Distribute error (Floyd-Steinberg weights)
        if (x + 1 < width)                errors[idx + 1]           += err * 7/16;
        if (y + 1 < height) {
          if (x - 1 >= 0)                 errors[idx + width - 1]   += err * 3/16;
                                           errors[idx + width]       += err * 5/16;
          if (x + 1 < width)              errors[idx + width + 1]   += err * 1/16;
        }
      }
    }

    // Write quantised luminance back to all RGB channels (grayscale result)
    for (let i = 0; i < width * height; i++) {
      const v = Math.round(lums[i]);
      data[i * 4]     = v;
      data[i * 4 + 1] = v;
      data[i * 4 + 2] = v;
    }
    const tfl = Math.min(1, Math.max(0, intensity));
    if (tfl < 1) {
      for (let i = 0; i < data.length; i += 4) {
        data[i]   = Math.round(floydOrig[i]   * (1 - tfl) + data[i]   * tfl);
        data[i+1] = Math.round(floydOrig[i+1] * (1 - tfl) + data[i+1] * tfl);
        data[i+2] = Math.round(floydOrig[i+2] * (1 - tfl) + data[i+2] * tfl);
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return;
  } else if (filter === 'interlace') {
    // ── Interlace ──────────────────────────────────────────────────────────
    // Simulates interlaced video: odd fields are slightly shifted horizontally
    // and alternating lines are darkened, mimicking CRT field interleaving.
    const amt = ((filterParams.interlace || {}).intensity ?? 60) / 100;
    const src = ctx.getImageData(0, 0, width, height);
    const sd  = src.data;
    const out = new Uint8ClampedArray(sd);

    // Field offset in pixels (how much odd lines shift right)
    const fieldOffset = Math.round(amt * s * 2); // 2 screen pixels at full
    const darken      = 1 - amt * 0.65;          // odd lines darkened up to 65%

    for (let y = 0; y < height; y++) {
      const isOdd = (y % 2 === 1);
      const dx    = isOdd ? fieldOffset : 0;
      const dark  = isOdd ? darken : 1;
      for (let x = 0; x < width; x++) {
        const srcX = Math.min(width - 1, Math.max(0, x - dx));
        const di = (y * width + x) * 4;
        const si = (y * width + srcX) * 4;
        out[di]     = sd[si]     * dark;
        out[di + 1] = sd[si + 1] * dark;
        out[di + 2] = sd[si + 2] * dark;
        out[di + 3] = sd[si + 3];
      }
    }
    const ti = Math.min(1, Math.max(0, intensity));
    if (ti < 1) {
      for (let i = 0; i < out.length; i += 4) {
        out[i]   = Math.round(sd[i]   * (1 - ti) + out[i]   * ti);
        out[i+1] = Math.round(sd[i+1] * (1 - ti) + out[i+1] * ti);
        out[i+2] = Math.round(sd[i+2] * (1 - ti) + out[i+2] * ti);
      }
    }
    ctx.putImageData(new ImageData(out, width, height), 0, 0);
    return;
  } else if (filter === 'chswap') {
    // ── Channel Swap ───────────────────────────────────────────────────────
    // Rearranges RGB channels (RGB, RBG, GRB, GBR, BRG, BGR).
    const mode = ((filterParams.chswap || {}).mode ?? 'rgb');
    const channelMap = {
      'rgb': [0, 1, 2],
      'rbg': [0, 2, 1],
      'grb': [1, 0, 2],
      'gbr': [1, 2, 0],
      'brg': [2, 0, 1],
      'bgr': [2, 1, 0]
    };
    const map = channelMap[mode] || [0, 1, 2];
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const tmp = new Uint8ClampedArray(data);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = tmp[i + map[0]];
      data[i + 1] = tmp[i + map[1]];
      data[i + 2] = tmp[i + map[2]];
    }
    const tcs = Math.min(1, Math.max(0, intensity));
    if (tcs < 1) {
      for (let i = 0; i < data.length; i += 4) {
        data[i]   = Math.round(tmp[i]   * (1 - tcs) + data[i]   * tcs);
        data[i+1] = Math.round(tmp[i+1] * (1 - tcs) + data[i+1] * tcs);
        data[i+2] = Math.round(tmp[i+2] * (1 - tcs) + data[i+2] * tcs);
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return;

  } else if (filter === 'rgbplanes') {
    // ── RGB Planes ─────────────────────────────────────────────────────────
    // Separates R, G, B channels into independently displaced planes. Per-row
    // offsets vary by scanline using a seeded hash — creates the prism/rainbow
    // horizontal-strip channel-split look characteristic of analogue signal corruption.
    const shiftPct   = ((filterParams.rgbplanes || {}).shift   ?? 50) / 100;
    const scatterPct = ((filterParams.rgbplanes || {}).scatter ?? 40) / 100;
    const maxShift   = Math.max(1, Math.round(width * shiftPct * 0.28));

    const src = ctx.getImageData(0, 0, width, height);
    const sd  = src.data;
    const out = new Uint8ClampedArray(sd.length);
    for (let i = 3; i < out.length; i += 4) out[i] = 255;

    for (let y = 0; y < height; y++) {
      // Per-row seeded scatter — low scatter = parallel strips, high = chaotic
      const rowNoise = (_seededRand(photoSeed, y * 1337 + 7) - 0.5);
      const rowBase  = _seededRand(photoSeed, y * 91 + 3);

      // R shifts right, B shifts left; scatter adds per-row variation to both
      const rOff = Math.round((0.35 + rowNoise * scatterPct) * maxShift);
      const gOff = Math.round(rowNoise * scatterPct * maxShift * 0.25);
      const bOff = Math.round((0.35 - rowNoise * scatterPct) * maxShift);

      for (let x = 0; x < width; x++) {
        const i  = (y * width + x) * 4;
        const rx = Math.min(width - 1, Math.max(0, x - rOff));
        const gx = Math.min(width - 1, Math.max(0, x - gOff));
        const bx = Math.min(width - 1, Math.max(0, x + bOff));
        out[i]   = sd[(y * width + rx) * 4];
        out[i+1] = sd[(y * width + gx) * 4 + 1];
        out[i+2] = sd[(y * width + bx) * 4 + 2];
        out[i+3] = 255;
      }
    }
    const trp = Math.min(1, Math.max(0, intensity));
    if (trp < 1) {
      for (let i = 0; i < out.length; i += 4) {
        out[i]   = Math.round(sd[i]   * (1 - trp) + out[i]   * trp);
        out[i+1] = Math.round(sd[i+1] * (1 - trp) + out[i+1] * trp);
        out[i+2] = Math.round(sd[i+2] * (1 - trp) + out[i+2] * trp);
      }
    }
    ctx.putImageData(new ImageData(out, width, height), 0, 0);
    return;

  } else if (filter === 'colcorrupt') {
    // ── Color Corrupt ──────────────────────────────────────────────────────
    // Randomly selected GB pixel rows get their colour channels scrambled:
    // channel swap, inversion, hue rotation, or saturation crush — mimics
    // corrupted video data or damaged tape read errors.
    const densityPct  = ((filterParams.colcorrupt || {}).density  ?? 35) / 100;
    const strengthPct = ((filterParams.colcorrupt || {}).strength ?? 65) / 100;

    const src = ctx.getImageData(0, 0, width, height);
    const sd  = src.data;
    const out = new Uint8ClampedArray(sd);

    // Seeded RNG so corruption bands are stable across repaints
    let _rngCC = (photoSeed * 1664525 + 1013904223) | 0;
    const _randCC = () => { _rngCC = (_rngCC * 1664525 + 1013904223) | 0; return (_rngCC >>> 0) / 0x100000000; };

    // Assign a corruption type per GB pixel row (stable per seed)
    const gbH      = GBCam.PHOTO_HEIGHT;
    const rowTypes = new Array(gbH);
    for (let row = 0; row < gbH; row++) {
      rowTypes[row] = _randCC() < densityPct ? Math.floor(_randCC() * 4) : -1;
    }

    for (let y = 0; y < height; y++) {
      const gbRow = Math.min(gbH - 1, Math.floor(y / Math.max(1, s)));
      const type  = rowTypes[gbRow];
      if (type < 0) continue;

      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = sd[i], g = sd[i+1], b = sd[i+2];
        let nr = r, ng = g, nb = b;

        if (type === 0) {
          // Swap R ↔ B
          nr = Math.round(r * (1 - strengthPct) + b * strengthPct);
          nb = Math.round(b * (1 - strengthPct) + r * strengthPct);
        } else if (type === 1) {
          // Invert all channels
          nr = Math.round(r * (1 - strengthPct) + (255 - r) * strengthPct);
          ng = Math.round(g * (1 - strengthPct) + (255 - g) * strengthPct);
          nb = Math.round(b * (1 - strengthPct) + (255 - b) * strengthPct);
        } else if (type === 2) {
          // Boost saturation — push each channel away from grey
          const grey = (r + g + b) / 3;
          nr = Math.min(255, Math.max(0, Math.round(r + (r - grey) * strengthPct * 2.5)));
          ng = Math.min(255, Math.max(0, Math.round(g + (g - grey) * strengthPct * 2.5)));
          nb = Math.min(255, Math.max(0, Math.round(b + (b - grey) * strengthPct * 2.5)));
        } else {
          // Channel cycle: R→G, G→B, B→R
          nr = Math.round(r * (1 - strengthPct) + g * strengthPct);
          ng = Math.round(g * (1 - strengthPct) + b * strengthPct);
          nb = Math.round(b * (1 - strengthPct) + r * strengthPct);
        }
        out[i] = nr; out[i+1] = ng; out[i+2] = nb;
      }
    }
    const tcc = Math.min(1, Math.max(0, intensity));
    if (tcc < 1) {
      for (let i = 0; i < out.length; i += 4) {
        out[i]   = Math.round(sd[i]   * (1 - tcc) + out[i]   * tcc);
        out[i+1] = Math.round(sd[i+1] * (1 - tcc) + out[i+1] * tcc);
        out[i+2] = Math.round(sd[i+2] * (1 - tcc) + out[i+2] * tcc);
      }
    }
    ctx.putImageData(new ImageData(out, width, height), 0, 0);
    return;

  }

  // Composite the effect onto the main canvas at the requested intensity
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, intensity));
  ctx.drawImage(eff, 0, 0);
  ctx.restore();
}

// ── Export: raw .sav file ──────────────────────────────────────────────────

async function exportSav() {
  if (!state.sav) return;
  const defaultName = state.filename || 'GBCAMERA.sav';
  const result = await window.api.exportSav(state.sav.buffer, defaultName);
  if (result) showToast(`Saved: ${result}`);
}

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

// ── Drag and drop .sav ────────────────────────────────────────────────────────

function setupDragDropSav() {
  const appEl = dom.app || document.getElementById('app');
  if (!appEl) return;

  appEl.addEventListener('dragover', e => {
    const hasSav = Array.from(e.dataTransfer.items || [])
      .some(item => item.kind === 'file');
    if (!hasSav) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    dom.dropOverlay?.classList.remove('hidden');
  });

  appEl.addEventListener('dragleave', e => {
    if (!appEl.contains(e.relatedTarget)) {
      dom.dropOverlay?.classList.add('hidden');
    }
  });

  appEl.addEventListener('drop', async e => {
    e.preventDefault();
    dom.dropOverlay?.classList.add('hidden');
    const file = e.dataTransfer.files[0];
    if (!file) return;

    if (window.api?.readFile && file.path) {
      // Electron: use native path
      const result = await window.api.readFile(file.path);
      await loadSavFile(result);
    } else {
      // Web: read via FileReader
      const buf = await file.arrayBuffer();
      await loadSavFile({ buffer: buf, name: file.name, path: null });
    }
  });
}

// ── Fullscreen presentation mode ──────────────────────────────────────────────

let _presIndex = null;

function openPresentation(index) {
  const filled = state.photos.map((p, i) => ({ p, i })).filter(x => !x.p.isEmpty);
  if (filled.length === 0) return;

  _presIndex = filled.find(x => x.i === index)?.i ?? filled[0].i;
  state.presentationMode = true;
  dom.presentationOverlay?.classList.remove('hidden');
  renderPresentation();
}

function closePresentation() {
  state.presentationMode = false;
  dom.presentationOverlay?.classList.add('hidden');
  _presIndex = null;
}

function presentationStep(dir) {
  const filled = state.photos.map((p, i) => i).filter(i => !state.photos[i].isEmpty);
  if (filled.length === 0) return;
  const cur = filled.indexOf(_presIndex);
  const next = (cur + dir + filled.length) % filled.length;
  _presIndex = filled[next];
  renderPresentation();
}

function renderPresentation() {
  if (_presIndex === null || !dom.presCanvas) return;
  const photo = state.photos[_presIndex];
  if (!photo || photo.isEmpty) return;

  // Fit photo to the viewport (with generous padding)
  const vw = window.innerWidth  - 160;
  const vh = window.innerHeight - 120;
  const t  = getTransform(_presIndex);
  const rotated = (t.rotate === 90 || t.rotate === 270);
  const srcW = rotated ? GBCam.PHOTO_HEIGHT : GBCam.PHOTO_WIDTH;
  const srcH = rotated ? GBCam.PHOTO_WIDTH  : GBCam.PHOTO_HEIGHT;
  const scale = Math.max(1, Math.floor(Math.min(vw / srcW, vh / srcH)));

  const ctx = dom.presCanvas.getContext('2d');
  const effPres = getEffectiveSettings(_presIndex);
  renderPhotoComplete(ctx, photo, effPres, scale, _presIndex);

  const filled = state.photos.filter(p => !p.isEmpty).length;
  const pos    = state.photos.slice(0, _presIndex + 1).filter(p => !p.isEmpty).length;
  if (dom.presLabel) dom.presLabel.textContent = `Photo ${_presIndex + 1}  ·  ${pos} / ${filled}`;
}

// ── Contact sheet export ──────────────────────────────────────────────────────

async function exportContactSheet() {
  const filled = state.photos.filter(p => !p.isEmpty);
  if (filled.length === 0) { showToast('No photos to export'); return; }

  // Use 160×144 cells so bordered and non-bordered photos share the same grid.
  // Non-bordered photos are centred (black fill fills the border area).
  const SHEET_SCALE = 4;
  const cols  = Math.min(filled.length, 5);
  const rows  = Math.ceil(filled.length / cols);
  const CELL  = 160 * SHEET_SCALE;   // 640 px wide per cell
  const CELLH = 144 * SHEET_SCALE;   // 576 px tall
  const GAP   = 8;
  const PAD   = 16;
  const LABEL = 18; // px for photo number below each cell

  const sheetW = PAD * 2 + cols * CELL + (cols - 1) * GAP;
  const sheetH = PAD * 2 + rows * (CELLH + LABEL + GAP) - GAP;

  const sheet  = document.createElement('canvas');
  sheet.width  = sheetW;
  sheet.height = sheetH;
  const sc     = sheet.getContext('2d');

  // Background
  sc.fillStyle = '#111113';
  sc.fillRect(0, 0, sheetW, sheetH);

  for (let i = 0; i < filled.length; i++) {
    const photo = filled[i];
    const col   = i % cols;
    const row   = Math.floor(i / cols);
    const x     = PAD + col * (CELL + GAP);
    const y     = PAD + row * (CELLH + LABEL + GAP);

    // Render photo (with border if any) + filters + tone
    const tmp  = document.createElement('canvas');
    const tctx = tmp.getContext('2d');
    const effSheet = getEffectiveSettings(photo.index);
    renderPhotoComplete(tctx, photo, effSheet, SHEET_SCALE, photo.index, { forExport: true });

    // Black fill for cell, then centre the rendered photo (non-bordered = centred in 160×144 slot)
    sc.fillStyle = '#000';
    sc.fillRect(x, y, CELL, CELLH);
    const offX = Math.floor((CELL  - tmp.width)  / 2);
    const offY = Math.floor((CELLH - tmp.height) / 2);
    sc.drawImage(tmp, x + offX, y + offY);

    // Photo number label
    sc.fillStyle = 'rgba(255,255,255,0.45)';
    sc.font      = '11px ui-monospace, monospace';
    sc.textAlign = 'center';
    sc.fillText(`${photo.index + 1}`, x + CELL / 2, y + CELLH + 13);
  }

  const dataUrl = sheet.toDataURL('image/png');
  const name    = `gbcam_contact_${state.palette.id}.png`;

  if (window.api?.savePng) {
    const saved = await window.api.savePng(dataUrl, name);
    if (saved) showToast(`Contact sheet saved`);
  } else {
    const a = Object.assign(document.createElement('a'), { href: dataUrl, download: name });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    showToast('Contact sheet downloaded');
  }
}

// ── Frame duplication ─────────────────────────────────────────────────────────

function duplicateGifFrame(orderIdx) {
  const frame = state.gifFrameOrder[orderIdx];
  if (!frame) return;
  // Insert a copy immediately after
  state.gifFrameOrder.splice(orderIdx + 1, 0, { ...frame });
  updateGifFrameNumbers();
  renderGifFrameStrip();
  updateGifPreview();
}

// Repaint all views after a transform action
function _repaintAfterTransform(index) {
  repaintGridSlot(index);
  if (state.viewMode === 'solo') renderSoloView(index);
  if (state.lightboxOpen) renderLightbox(index);
}

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

// ── Undo ─────────────────────────────────────────────────────────────────────

const MAX_UNDO = 30;
const undoStack = [];

/** Deep-clone the parts of state that we want to undo. */
function captureState() {
  return {
    activeFilters:   new Set(state.activeFilters),
    filterParams:    JSON.parse(JSON.stringify(state.filterParams)),
    filterIntensity: state.filterIntensity,
    filterVariant:   state.filterVariant,
    palette:         state.palette ? { ...state.palette } : null,
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
  };
}

/** Push the current state onto the undo stack before a destructive action. */
function pushUndo() {
  undoStack.push(captureState());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

/** Restore the most recent undo snapshot. */
function performUndo() {
  if (undoStack.length === 0) { showToast('Nothing to undo'); return; }
  const snap = undoStack.pop();
  state.activeFilters   = snap.activeFilters;
  state.filterParams    = snap.filterParams;
  state.filterIntensity = snap.filterIntensity;
  state.filterVariant   = snap.filterVariant;
  state.palette         = snap.palette;
  state.brightness     = snap.brightness     ?? state.brightness;
  state.contrast       = snap.contrast       ?? state.contrast;
  state.toneIntensity  = snap.toneIntensity  ?? state.toneIntensity;
  state.shadowColor    = snap.shadowColor    ?? state.shadowColor;
  state.highlightColor = snap.highlightColor ?? state.highlightColor;
  state.toneBalance    = snap.toneBalance    ?? state.toneBalance;
  if (snap.photoSettings)   state.photoSettings   = snap.photoSettings;
  if (snap.photoTransforms) state.photoTransforms = snap.photoTransforms;
  if (snap.sectionEnabled)  state.sectionEnabled  = snap.sectionEnabled;
  if (snap.borderId      != null) state.borderId      = snap.borderId;
  if (snap.borderEnabled != null) state.borderEnabled = snap.borderEnabled;
  updateFilterUI();
  syncControlsToEffectiveSettings(state.selectedIndex);
  repaintGrid();
  updateSidebarPreview();
  showToast('Undo');
}

// ── Stackable effects ────────────────────────────────────────────────────────

function applyActiveEffects(ctx, width, height, scale, filterIntensity, filterVariant, filterParams, activeFilters, forExport = false, photoSeed = 0) {
  if (!forExport && state.effectsPreviewMode) return;
  if (state.sectionEnabled?.effects === false) return;
  const af = activeFilters || state.activeFilters;
  if (af.size === 0) return;
  // Use state.filterOrder but ensure any active filter not in the stored order
  // still runs — protects against stale localStorage filterOrder missing new filters.
  const baseOrder = state.filterOrder || [];
  const knownSet  = new Set(baseOrder);
  const extraFilters = [...af].filter(id => !knownSet.has(id));
  const filterOrder  = [...baseOrder, ...extraFilters];
  for (const filterName of filterOrder) {
    if (af.has(filterName)) {
      applyExportFilter(ctx, width, height, scale, filterName, filterIntensity, filterVariant, filterParams, photoSeed);
    }
  }
}

// ── Filter UI management ───────────────────────────────────────────────────

function updateFilterUI() {
  // Sync checkboxes and accordion expand/collapse state
  const _uiTgt = state.selectedPhotos.size > 0
    ? [...state.selectedPhotos][0]
    : state.selectedIndex;
  const eff = (_uiTgt !== null && _uiTgt !== undefined)
    ? getEffectiveSettings(_uiTgt)
    : null;
  syncFilterAccordion(eff);
}

function toggleFilter(filterName) {
  pushUndo();
  const targets = state.selectedPhotos.size > 0 ? [...state.selectedPhotos] : null;
  if (targets) {
    // Per-photo toggle — apply to selected photos only
    const firstPs = state.photoSettings[targets[0]];
    const firstAf = firstPs?.activeFilters ? new Set(firstPs.activeFilters) : new Set(state.activeFilters);
    const adding = !firstAf.has(filterName);
    for (const idx of targets) {
      if (!state.photoSettings[idx]) state.photoSettings[idx] = {};
      const ps = state.photoSettings[idx];
      const cur = ps.activeFilters ? new Set(ps.activeFilters) : new Set(state.activeFilters);
      if (adding) cur.add(filterName); else cur.delete(filterName);
      ps.activeFilters = [...cur];
    }
    if (adding) {
      state.focusedFilter = filterName;
      _autoEnableEffectsSection();
    } else if (state.focusedFilter === filterName) {
      const remaining = new Set(state.photoSettings[targets[0]]?.activeFilters || []);
      state.focusedFilter = [...remaining].pop() || null;
    }
  } else {
    // Global toggle — no photo selected, applies to all
    if (state.activeFilters.has(filterName)) {
      state.activeFilters.delete(filterName);
      if (state.focusedFilter === filterName) {
        state.focusedFilter = [...state.activeFilters].pop() || null;
      }
    } else {
      state.activeFilters.add(filterName);
      state.focusedFilter = filterName;
      _autoEnableEffectsSection();
    }
  }
  updateFilterUI();
  repaintGrid();
  updateSidebarPreview();
}

/** If the effects section is disabled, automatically enable it (and update its checkbox). */
function _autoEnableEffectsSection() {
  if (!state.sectionEnabled.effects) {
    state.sectionEnabled.effects = true;
    const cb = document.querySelector('.section-check[data-section="effects"]');
    if (cb) cb.checked = true;
  }
}

function _refreshFilterParamPanel() {
  // No-op — filter accordion syncs via syncFilterAccordion()
}

/**
 * Sync accordion checkboxes, expand/collapse state, and param slider values
 * to reflect `eff` (effective settings object) — or global state if eff is null.
 */
function syncFilterAccordion(eff) {
  const af = eff ? eff.activeFilters : state.activeFilters;
  const fp = eff ? eff.filterParams  : state.filterParams;
  const fv = eff ? eff.filterVariant : state.filterVariant;

  document.querySelectorAll('.fi-item').forEach(item => {
    const filterId = item.dataset.filter;
    const active   = af.has(filterId);
    const cb       = item.querySelector('.fi-check');
    if (cb) cb.checked = active;

    // Expand/collapse: auto-open when filter becomes active; never auto-close
    item.classList.toggle('fi-active', active);
    if (active) item.classList.add('fi-open');

    // Sync param values
    const fp_f = (fp && fp[filterId]) || {};
    item.querySelectorAll('[data-fi-key]').forEach(el => {
      const key      = el.dataset.fiKey;
      const stateKey = el.dataset.fiStatekey;
      const curVal   = stateKey ? fv : (fp_f[key] ?? el._fiDef);
      if (el.tagName === 'INPUT' && el.type === 'range') {
        el.value = curVal;
        const valEl = el.previousElementSibling?.querySelector('.fi-val')
                   || el.parentElement?.querySelector('.fi-val');
        if (valEl && el._fiFmt) valEl.textContent = el._fiFmt(Number(curVal));
      } else if (el.classList.contains('seg-control')) {
        el.querySelectorAll('.seg-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.val === String(curVal));
        });
      }
    });
  });
}

/**
 * Build the filter accordion DOM inside #filter-accordion.
 * Called once from init(). Event handlers live here.
 */
function setupFilterAccordion() {
  const container = document.getElementById('filter-accordion');
  if (!container) return;
  container.innerHTML = '';

  for (const fd of FILTER_DEFS) {
    const item = document.createElement('div');
    item.className = 'fi-item';
    item.dataset.filter = fd.id;

    // ── Header ──────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'fi-header';

    const chevron = document.createElement('span');
    chevron.className = 'fi-chevron section-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '▾';

    const dragHandle = document.createElement('span');
    dragHandle.className = 'fi-drag-handle';
    dragHandle.setAttribute('aria-hidden', 'true');
    dragHandle.textContent = '⋮⋮';
    dragHandle.title = 'Drag to reorder';

    const lbl = document.createElement('span');
    lbl.className = 'fi-label';
    lbl.textContent = fd.label;

    const checkWrap = document.createElement('label');
    checkWrap.className = 'section-check-wrap fi-check-wrap';
    checkWrap.title = `Enable ${fd.label}`;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'fi-check';
    cb.dataset.filter = fd.id;
    checkWrap.appendChild(cb);

    // Per-filter reset button — resets this filter's params to defaults
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'btn btn-ghost btn-xs btn-icon fi-reset';
    resetBtn.title = `Reset ${fd.label} to defaults`;
    resetBtn.textContent = '↺';
    resetBtn.addEventListener('click', e => {
      e.stopPropagation(); // don't toggle collapse
      pushUndo();
      const defaults = buildDefaultFilterParams()[fd.id] || {};
      const fp = getWritableFilterParams(fd.id);
      Object.assign(fp, defaults);
      // Sync sliders in this item's param panel
      item.querySelectorAll('input[type="range"][data-fi-key]').forEach(slider => {
        const key = slider.dataset.fiKey;
        if (key in defaults) {
          slider.value = defaults[key];
          const valEl = slider.closest('.range-wrap')?.querySelector('.fi-val');
          if (valEl && slider._fiFmt) valEl.textContent = slider._fiFmt(defaults[key]);
        }
      });
      item.querySelectorAll('.seg-control[data-fi-key]').forEach(seg => {
        const key = seg.dataset.fiKey;
        if (key in defaults) {
          seg.querySelectorAll('.seg-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.val === String(defaults[key]))
          );
        }
      });
      repaintInteractive();
    });

    header.appendChild(dragHandle);
    header.appendChild(chevron);
    header.appendChild(lbl);
    header.appendChild(resetBtn);
    header.appendChild(checkWrap);

    // ── Draggable reordering ────────────────────────────────────────────────
    // draggable is only enabled while the pointer is held on the header row,
    // so sliders and controls in the params panel never accidentally start a drag.
    item.draggable = false;
    header.addEventListener('mousedown', () => { item.draggable = true; });
    item.addEventListener('dragend', () => {
      item.draggable = false;
      item.classList.remove('fi-dragging');
      document.querySelectorAll('.fi-item').forEach(el => el.classList.remove('fi-drag-over'));
      updateFilterOrder(true);
    });
    // Safety: release draggability if the mouse is released anywhere without a drop
    document.addEventListener('mouseup', () => { item.draggable = false; }, { passive: true });
    item.addEventListener('dragstart', e => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/html', item.innerHTML);
      item.classList.add('fi-dragging');
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const dragging = document.querySelector('.fi-item.fi-dragging');
      if (dragging && dragging !== item) {
        item.classList.add('fi-drag-over');
        const rect = item.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        if (e.clientY < midpoint) {
          item.parentNode.insertBefore(dragging, item);
        } else {
          item.parentNode.insertBefore(dragging, item.nextSibling);
        }
        updateFilterOrder();
      }
    });
    item.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('fi-drag-over');
    });
    item.appendChild(header);

    // ── Params body ─────────────────────────────────────────────────────────
    const outer = document.createElement('div');
    outer.className = 'fi-body-outer';
    const inner = document.createElement('div');
    inner.className = 'fi-body-inner';
    const content = document.createElement('div');
    content.className = 'fi-body-content';
    inner.appendChild(content);

    for (const p of fd.params) {
      if (p.type === 'range') {
        const wrap = document.createElement('div');
        wrap.className = 'range-wrap fp-row';
        const hdr2 = document.createElement('div');
        hdr2.className = 'range-header';
        const pLbl = document.createElement('span');
        pLbl.className = 'ctrl-label';
        pLbl.textContent = p.label;
        const pVal = document.createElement('span');
        pVal.className = 'range-val fi-val';
        pVal.textContent = p.fmt(p.def);
        hdr2.appendChild(pLbl);
        hdr2.appendChild(pVal);

        const slider = document.createElement('input');
        slider.type  = 'range';
        slider.min   = p.min;
        slider.max   = p.max;
        slider.step  = p.step;
        slider.value = p.def;
        slider.dataset.fiKey = p.key;
        if (p.stateKey) slider.dataset.fiStatekey = p.stateKey;
        slider._fiDef = p.def;
        slider._fiFmt = p.fmt;

        slider.addEventListener('pointerdown', () => { pushUndo(); });
        slider.addEventListener('input', () => {
          const v = parseFloat(slider.value);
          pVal.textContent = p.fmt(v);
          if (p.stateKey) {
            setScopedSetting(p.stateKey, slider.value);
          } else {
            const fp = getWritableFilterParams(fd.id);
            fp[p.key] = v;
          }
          repaintInteractive();
        });

        wrap.appendChild(hdr2);
        wrap.appendChild(slider);
        content.appendChild(wrap);

      } else if (p.type === 'seg') {
        const wrap = document.createElement('div');
        wrap.className = 'fp-row';
        const pLbl = document.createElement('div');
        pLbl.className = 'ctrl-label';
        pLbl.style.marginBottom = '4px';
        pLbl.textContent = p.label;
        const seg = document.createElement('div');
        seg.className = 'seg-control';
        seg.dataset.fiKey = p.key;
        if (p.stateKey) seg.dataset.fiStatekey = p.stateKey;
        seg._fiDef = p.def;

        for (const [optVal, optLabel] of p.opts) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'seg-btn' + (optVal === p.def ? ' active' : '');
          btn.textContent = optLabel;
          btn.dataset.val = optVal;
          btn.addEventListener('click', () => {
            pushUndo();
            seg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
            if (p.stateKey) {
              setScopedSetting(p.stateKey, optVal);
            } else {
              const fp = getWritableFilterParams(fd.id);
              fp[p.key] = optVal;
            }
            repaintInteractive();
          });
          seg.appendChild(btn);
        }

        wrap.appendChild(pLbl);
        wrap.appendChild(seg);
        content.appendChild(wrap);
      }
    }

    outer.appendChild(inner);
    item.appendChild(outer);

    // ── Toggle filter on checkbox change ─────────────────────────────────
    cb.addEventListener('change', () => {
      toggleFilter(fd.id);
      if (cb.checked) item.classList.add('fi-open'); // auto-expand on enable
    });

    // ── Chevron click: expand/collapse params body ────────────────────────
    header.addEventListener('click', e => {
      if (e.target.closest('.fi-check-wrap')) return; // let checkbox handle it
      item.classList.toggle('fi-open');
    });

    container.appendChild(item);
  }
}

// ── Overflow / collapse menus ─────────────────────────────────────────────────
// Three rows can collapse into dropdowns when they run out of horizontal space:
//   Titlebar → Tools ▾   (CSS breakpoint ≤1280px)
//   Grid header → Actions ▾  (JS ResizeObserver)
//   Palette bar → Favs ▾  (CSS breakpoint ≤1024px)

function setupOverflowMenus() {
  const allDropdowns = () => document.querySelectorAll('.overflow-dropdown');

  function closeAll() { allDropdowns().forEach(d => d.classList.add('hidden')); }

  // Close on outside click or Escape
  document.addEventListener('click', closeAll);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });

  // Toggle a dropdown on its trigger button
  function bindToggle(btnId, ddId) {
    const btn = document.getElementById(btnId);
    const dd  = document.getElementById(ddId);
    if (!btn || !dd) return;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const opening = dd.classList.contains('hidden');
      closeAll();
      if (opening) dd.classList.remove('hidden');
    });
  }

  // Wire overflow items: data-for → click the target element by id
  function wireItems(ddId) {
    const dd = document.getElementById(ddId);
    if (!dd) return;
    dd.querySelectorAll('.overflow-item[data-for]').forEach(item => {
      const target = document.getElementById(item.dataset.for);
      if (!target) return;
      item.addEventListener('click', e => {
        e.stopPropagation();
        closeAll();
        target.click();
      });
      // Mirror disabled attribute (e.g. Paste Settings)
      if (target.hasAttribute('disabled') || target.disabled) item.disabled = true;
      new MutationObserver(() => { item.disabled = target.disabled; })
        .observe(target, { attributes: true, attributeFilter: ['disabled'] });
    });
  }

  // ── Titlebar Tools menu ──────────────────────────────────────────────────────
  bindToggle('btn-tools-menu', 'tools-dropdown');
  wireItems('tools-dropdown');

  // ── Grid Actions menu ────────────────────────────────────────────────────────
  bindToggle('btn-grid-actions', 'grid-actions-dropdown');
  wireItems('grid-actions-dropdown');

  // ── Grid actions overflow detection ─────────────────────────────────────────
  // Collapses individual action buttons into the Actions ▾ menu when they no
  // longer fit in #grid-header. Uses getBoundingClientRect so it accounts for
  // the actual panel width after sidebar resizing — pure CSS media queries can't
  // do this because they don't know about the sidebar.
  const gridHeader = document.getElementById('grid-header');
  const gridPanel  = document.getElementById('grid-panel');
  if (gridHeader && gridPanel && window.ResizeObserver) {
    let _ghRaf = null;
    const checkGridOverflow = () => {
      _ghRaf = null;
      // Temporarily remove the class so all items are visible and measurable.
      gridHeader.classList.remove('overflow-active');
      // Force synchronous reflow so positions are current after class removal.
      void gridHeader.offsetHeight;
      // Check if any .grid-action-item has its right edge past the header's
      // right edge. getBoundingClientRect gives true viewport coordinates,
      // which cannot be fooled by flex layout or overflow:visible.
      const headerRight = gridHeader.getBoundingClientRect().right;
      let isOverflowing = false;
      for (const item of gridHeader.querySelectorAll('.grid-action-item')) {
        if (item.offsetParent === null) continue; // display:none — skip
        if (item.getBoundingClientRect().right > headerRight + 1) {
          isOverflowing = true;
          break;
        }
      }
      // Always sync — do NOT guard with a lastOverflow variable here.
      // We removed the class above, so any guard based on a stale "true"
      // value would prevent re-adding it (true !== true = false). Just toggle.
      gridHeader.classList.toggle('overflow-active', isOverflowing);
    };
    const scheduleGhCheck = () => {
      if (_ghRaf) return;
      _ghRaf = requestAnimationFrame(checkGridOverflow);
    };
    // gridPanel changes width when the window resizes or the user drags the
    // panel-resize handle — covers both window resize and sidebar resize.
    new ResizeObserver(scheduleGhCheck).observe(gridPanel);
    // dom.app gets has-file when a .sav loads — file-only buttons appear,
    // changing the total content width without any resize event.
    new MutationObserver(scheduleGhCheck).observe(dom.app, {
      attributes: true, attributeFilter: ['class']
    });
    // solo-mode class on gridPanel hides grid-only buttons — re-check.
    new MutationObserver(scheduleGhCheck).observe(gridPanel, {
      attributes: true, attributeFilter: ['class']
    });
    scheduleGhCheck(); // initial check
  }

  // ── Fav Palettes menu ────────────────────────────────────────────────────────
  bindToggle('btn-fav-menu', 'fav-dropdown');
  // Content populated by renderFavDropdown() called from renderFavPalettes()
}

function init() {
  // Inject version string
  const verEl = document.getElementById('app-version');
  if (verEl) verEl.textContent = APP_VERSION + ' ';

  buildPaletteBar();
  wireButtons();
  wireButtonsPaletteEditor();
  setupDragDrop();
  setupPanelResize();
  setupSidebarToggle();
  setupOverflowMenus();
  setupKeyboard();
  setupFavCarouselResponsive();
  setupSidebarCollapse();
  setupCollapsibleSections();
  setupFilterAccordion();
  preloadBorderImages();
  setupBorderPicker();
  setStatus('No file loaded');
  setExportScale(20);
  setThumbnailSize(120); // default: ~120px thumbnails (auto-fill)
}

document.addEventListener('DOMContentLoaded', init);
