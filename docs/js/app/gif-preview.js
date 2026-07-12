/**
 * gif-preview.js — GIF frame numbering and live preview loop
 *
 * Split from app.js. Classic script: shares the global scope with the other
 * app/ files; load order (see index.html) preserves the original execution
 * order and must be kept.
 */

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
//
// Driven by requestAnimationFrame (timestamp-gated to gifDelay) instead of
// setInterval — rAF stops firing in hidden/background windows, so the preview
// no longer burns CPU when the app isn't visible.

let _gifPreviewRAF = null;

function stopGifPreviewLoop() {
  if (_gifPreviewRAF !== null) {
    cancelAnimationFrame(_gifPreviewRAF);
    _gifPreviewRAF = null;
  }
  if (state.gifPreviewTimer) { // legacy interval handle, just in case
    clearInterval(state.gifPreviewTimer);
    state.gifPreviewTimer = null;
  }
}

function startGifPreviewLoop(tick) {
  let last = performance.now();
  const loop = (now) => {
    _gifPreviewRAF = requestAnimationFrame(loop);
    if (now - last >= state.gifDelay) {
      last = now;
      tick();
    }
  };
  _gifPreviewRAF = requestAnimationFrame(loop);
}

function updateGifPreview() {
  stopGifPreviewLoop();

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
    startGifPreviewLoop(showFrame);
  }
}

// Hide gif info bar when not in gif preview mode
function hideGifPreviewInfo() {
  const infoEl  = document.getElementById('gif-preview-info');
  const emptyEl = document.getElementById('sidebar-preview-empty');
  if (infoEl) infoEl.style.display = 'none';
}

