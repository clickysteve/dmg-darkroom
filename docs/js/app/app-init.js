/**
 * app-init.js — Overflow menus, init()
 *
 * Split from app.js. Classic script: shares the global scope with the other
 * app/ files; load order (see index.html) preserves the original execution
 * order and must be kept.
 */

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
  setupImageImport();
  // GIF encode progress (from the encoder worker/main process)
  window.api?.onGifProgress?.((p) => {
    if (typeof p === 'number') setStatus(`Encoding GIF… ${Math.round(p * 100)}%`, true);
  });
  setStatus('No file loaded');
  setExportScale(20);
  setThumbnailSize(120); // default: ~120px thumbnails (auto-fill)
}

document.addEventListener('DOMContentLoaded', init);
