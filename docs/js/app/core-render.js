/**
 * core-render.js — App version, border frames, photo render pipeline, colour utils
 *
 * Split from app.js. Classic script: shares the global scope with the other
 * app/ files; load order (see index.html) preserves the original execution
 * order and must be kept.
 */

/**
 * app.js — DMG DarkRoom renderer
 *
 * Dependencies (loaded via script tags before this file):
 *   - gbcam.js  → window.GBCam
 *   - palettes.js → window.PALETTES, window.paletteToRGB
 */

const APP_VERSION = 'v1.2.6';

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

