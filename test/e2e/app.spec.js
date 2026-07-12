/**
 * app.spec.js — end-to-end tests for the DMG DarkRoom web build.
 *
 * Loads a synthetic .sav (built in-page with GBCam itself), then exercises
 * the real user flows: grid, palette picker, PNG export, GIF export via the
 * worker, image import, undo/redo, and a golden-pixel render regression.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const GOLDEN_DIR = path.join(__dirname, 'golden');

/** Build a deterministic 2-photo save in the page and drop it onto the app. */
async function loadSyntheticSav(page) {
  await page.evaluate(() => {
    const sav = new Uint8Array(131072).fill(0xFF);
    const W = GBCam.PHOTO_WIDTH, H = GBCam.PHOTO_HEIGHT;
    const mk = (fn) => {
      const px = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[y * W + x] = fn(x, y);
      return px;
    };
    GBCam.writePhotoToSlot(sav, 0, mk((x) => Math.floor(x / 32) % 4), { albumPos: 0 });
    GBCam.writePhotoToSlot(sav, 1, mk((x, y) => ((x >> 3) + (y >> 3)) % 4), { albumPos: 1 });
    const dt = new DataTransfer();
    dt.items.add(new File([sav], 'e2e-test.sav', { type: 'application/octet-stream' }));
    document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#main')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.errors = errors;
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  expect(page.errors, 'no uncaught page errors').toEqual([]);
});

test('app boots with all modules loaded', async ({ page }) => {
  await expect(page.locator('#welcome')).toBeVisible();
  // Spot-check that functions from several different app/ modules exist
  const missing = await page.evaluate(() =>
    ['init', 'renderGrid', 'exportGif', 'performUndo', 'performRedo', 'setPalette',
     'applyActiveEffects', 'importImageToSlot', 'buildProjectJson', 'setupKeyboard']
      .filter((fn) => typeof window[fn] !== 'function' && typeof eval(fn) !== 'function'));
  expect(missing).toEqual([]);
});

test('loads a .sav via drag & drop and renders the grid', async ({ page }) => {
  await loadSyntheticSav(page);
  await expect(page.locator('.photo-slot')).toHaveCount(30);
  await expect(page.locator('.photo-slot:not(.empty)')).toHaveCount(2);
  await expect(page.locator('#status-text')).toContainText('2 photos');
});

test('rejects a wrong-sized file with an error toast', async ({ page }) => {
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(1234)], 'broken.sav'));
    document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#toast')).toContainText('Unexpected file size');
  await expect(page.locator('#welcome')).toBeVisible();
});

test('palette picker changes the active palette', async ({ page }) => {
  await loadSyntheticSav(page);
  await page.click('#palette-picker-btn');
  await page.fill('#palette-picker-search', 'DMG');
  const first = page.locator('#palette-picker-list .pal-item').first();
  const name = await first.textContent();
  await first.click();
  await expect(page.locator('#palette-picker-name')).toContainText(name.trim().slice(0, 6));
});

test('exports a single photo as PNG', async ({ page }) => {
  await loadSyntheticSav(page);
  await page.click('.photo-slot[data-index="0"]');
  const download = page.waitForEvent('download');
  await page.click('#btn-export-single');
  const dl = await download;
  expect(dl.suggestedFilename()).toMatch(/^gbcam_01_.*\.png$/);
});

test('exports an animated GIF through the worker', async ({ page }) => {
  await loadSyntheticSav(page);
  await page.click('.fmt-btn[data-fmt="gif"]');
  await page.click('.photo-slot[data-index="0"]');
  await page.click('.photo-slot[data-index="1"]');
  const download = page.waitForEvent('download', { timeout: 20000 });
  await page.click('#btn-export-gif');
  const dl = await download;
  expect(dl.suggestedFilename()).toMatch(/\.gif$/);
  // Verify it's a real GIF
  const file = await dl.path();
  const head = fs.readFileSync(file).subarray(0, 6).toString('ascii');
  expect(head).toBe('GIF89a');
});

test('imports an image into an empty slot, then undo/redo', async ({ page }) => {
  await loadSyntheticSav(page);

  const chooser = page.waitForEvent('filechooser');
  // The button may be collapsed into the Actions ▾ overflow menu — click via JS,
  // then pick a dither algorithm from the popover
  await page.locator('#btn-import-image').evaluate((el) => el.click());
  await page.locator('.action-popover .overflow-item', { hasText: 'Atkinson' }).click();
  await (await chooser).setFiles(path.join(__dirname, '..', '..', 'docs', 'icon.png'));

  await expect(page.locator('#toast')).toContainText('Imported into slot 03');
  await expect(page.locator('.photo-slot:not(.empty)')).toHaveCount(3);

  // Undo restores the SRAM and the grid
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#toast')).toContainText('Undo');
  await expect(page.locator('.photo-slot:not(.empty)')).toHaveCount(2);

  // Redo brings the import back
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('#toast')).toContainText('Redo');
  await expect(page.locator('.photo-slot:not(.empty)')).toHaveCount(3);
});

test('golden render: photo 0 thumbnail is pixel-stable', async ({ page }) => {
  await loadSyntheticSav(page);
  // Hash the raw RGBA pixels (PNG encoding differs across Chromium versions)
  const hash = await page.evaluate(() => {
    const canvas = document.querySelector('.photo-slot[data-index="0"] canvas');
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let h1 = 0x811c9dc5, h2 = 0x01000193; // FNV-1a twice with different accumulators
    for (let i = 0; i < d.length; i++) {
      h1 = Math.imul(h1 ^ d[i], 0x01000193) >>> 0;
      h2 = Math.imul(h2 + d[i], 0x85ebca6b) >>> 0;
    }
    return `${canvas.width}x${canvas.height}:${h1.toString(16)}:${h2.toString(16)}`;
  });
  const goldenPath = path.join(GOLDEN_DIR, 'photo0-dmg.txt');
  if (!fs.existsSync(goldenPath) || process.env.UPDATE_GOLDEN) {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(goldenPath, hash);
    test.info().annotations.push({ type: 'golden', description: 'golden written' });
  } else {
    expect(hash).toBe(fs.readFileSync(goldenPath, 'utf8'));
  }
});

test('new FX render and visibly change pixels', async ({ page }) => {
  await loadSyntheticSav(page);
  const results = await page.evaluate(() => {
    const out = {};
    const baseline = () => {
      const canvas = document.querySelector('.photo-slot[data-index="0"] canvas');
      return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    };
    state.sectionEnabled.effects = true;
    const before = Uint8ClampedArray.from(baseline());
    for (const fx of ['printer', 'tilecorrupt', 'zine', 'atkinson']) {
      state.activeFilters = new Set([fx]);
      clearThumbCache();
      repaintGrid();
      const after = baseline();
      let changed = 0;
      for (let i = 0; i < before.length; i += 4) {
        if (before[i] !== after[i] || before[i+1] !== after[i+1] || before[i+2] !== after[i+2]) changed++;
      }
      out[fx] = changed;
    }
    state.activeFilters = new Set();
    state.sectionEnabled.effects = false;
    clearThumbCache();
    repaintGrid();
    return out;
  });
  for (const [fx, changed] of Object.entries(results)) {
    expect(changed, `${fx} should change pixels`).toBeGreaterThan(1000);
  }
});

test('blends two photos into a new slot with undo', async ({ page }) => {
  await loadSyntheticSav(page);
  // Multi-select photos 0 and 1
  await page.click('.photo-slot[data-index="0"]');
  await page.click('.photo-slot[data-index="1"]', { modifiers: ['ControlOrMeta'] });
  await page.locator('#btn-blend').evaluate((el) => el.click());
  await page.locator('.action-popover .overflow-item', { hasText: 'Darken' }).click();
  await expect(page.locator('#toast')).toContainText('Blended into slot 03');
  await expect(page.locator('.photo-slot:not(.empty)')).toHaveCount(3);

  // Blend math: darken = max of the two index maps
  const ok = await page.evaluate(() => {
    const a = state.photos[0].pixels, b = state.photos[1].pixels, c = state.photos[2].pixels;
    for (let i = 0; i < c.length; i++) if (c[i] !== Math.max(a[i], b[i])) return false;
    return true;
  });
  expect(ok).toBe(true);

  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.photo-slot:not(.empty)')).toHaveCount(2);
});

test('webgl tone parity: GPU output matches CPU within ±2', async ({ page }) => {
  await loadSyntheticSav(page);
  const result = await page.evaluate(() => {
    // Headless/CI machines only have software GL — accept it for the parity
    // check (we're validating shader math, not speed)
    localStorage.setItem('gbcam_webgl', 'force');
    if (!WebGLTone.available) return { skipped: true };

    // Deterministic source image: full-range gradient with structure
    const W = 256, H = 128;
    const make = () => {
      const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
      const cx = c.getContext('2d', { willReadFrequently: true });
      const img = cx.createImageData(W, H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        img.data[i]     = x;
        img.data[i + 1] = y * 2;
        img.data[i + 2] = (x * 7 + y * 13) % 256;
        img.data[i + 3] = 255;
      }
      cx.putImageData(img, 0, 0);
      return [c, cx];
    };

    state.sectionEnabled.exposure = true;
    state.sectionEnabled.splitTone = true;
    const settings = {
      brightness: 30, contrast: 45, toneIntensity: 60,
      shadowColor: '#0033aa', highlightColor: '#ff8800', toneBalance: 15,
    };

    const [, cpuCtx] = make();
    applyToneAdjustments(cpuCtx, W, H, settings, false, /* forceCPU */ true);
    const [, gpuCtx] = make();
    const usedGpu = WebGLTone.apply(gpuCtx, W, H, settings);
    if (!usedGpu) return { skipped: true };

    const a = cpuCtx.getImageData(0, 0, W, H).data;
    const b = gpuCtx.getImageData(0, 0, W, H).data;
    let maxDiff = 0, diffs = 0;
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i]);
      if (d > maxDiff) maxDiff = d;
      if (d > 2) diffs++;
    }
    state.sectionEnabled.exposure = false;
    state.sectionEnabled.splitTone = false;
    return { maxDiff, diffs };
  });

  if (result.skipped) test.skip(true, 'WebGL unavailable in this environment');
  expect(result.diffs, 'pixels differing by more than 2').toBe(0);
  expect(result.maxDiff).toBeLessThanOrEqual(2);
});

test('undo/redo round-trips editing state', async ({ page }) => {
  await loadSyntheticSav(page);
  const before = await page.evaluate(() => state.brightness);
  await page.evaluate(() => {
    pushUndo();
    state.brightness = 42;
    repaintGrid();
  });
  await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => state.brightness)).toBe(before);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  expect(await page.evaluate(() => state.brightness)).toBe(42);
});
