/**
 * filters-engine.js — CPU filter implementations and tone adjustments
 *
 * Split from app.js. Classic script: shares the global scope with the other
 * app/ files; load order (see index.html) preserves the original execution
 * order and must be kept.
 */

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

function applyToneAdjustments(ctx, width, height, settings, forExport = false, forceCPU = false) {
  if (!forExport && state.effectsPreviewMode) return;
  const s = settings || state;
  const brightness   = (state.sectionEnabled?.exposure   ?? true) ? (s.brightness   ?? 0) : 0;
  const contrast     = (state.sectionEnabled?.exposure   ?? true) ? (s.contrast     ?? 0) : 0;
  const toneIntensity= (state.sectionEnabled?.splitTone  ?? true) ? (s.toneIntensity?? 0) : 0;
  const { shadowColor, highlightColor, toneBalance } = s;
  if (brightness === 0 && contrast === 0 && toneIntensity === 0) return;

  // GPU fast path — identical math in a fragment shader (see webgl-tone.js).
  // Falls through to the CPU loop on any failure or when WebGL is unavailable.
  // Exports always use the CPU path so saved files are bit-identical across
  // machines regardless of GPU/driver float behaviour.
  if (!forceCPU && !forExport && typeof WebGLTone !== 'undefined' &&
      WebGLTone.apply(ctx, width, height, { brightness, contrast, toneIntensity, shadowColor, highlightColor, toneBalance })) {
    return;
  }

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

