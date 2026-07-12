/**
 * gif.js — GIF mode, frame strip, GIF export
 *
 * Split from app.js. Classic script: shares the global scope with the other
 * app/ files; load order (see index.html) preserves the original execution
 * order and must be kept.
 */

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
  stopGifPreviewLoop();
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

    const prevStatus = dom.statusText.textContent;
    let result;
    try {
      result = await window.api.saveGif({
        frames,
        delay:  state.gifDelay,
        scale,
        loop:   state.gifLoop,   // 'infinite' | 'once' | 'bounce'
        defaultName,
      });
    } finally {
      setStatus(prevStatus, true);
    }

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

