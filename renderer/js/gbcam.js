/**
 * gbcam.js — Game Boy Camera SRAM decoder
 *
 * Format reference:
 *   The GB Camera's SRAM is 128KB (131072 bytes), organized as 16 banks × 8KB.
 *   - Bank 0 (0x0000–0x1FFF): game state, thumbnail data, slot metadata
 *   - Banks 1–15 (0x2000–0x1FFFF): full photo tile data
 *
 * Each photo slot is 0x1000 bytes (4096), laid out as:
 *   - 0x000–0xDFF (3584 bytes): 128×112 pixel image in 2bpp tile format
 *                               16 tiles wide × 14 tiles tall = 224 tiles × 16 bytes
 *   - 0xE00–0xEFF (256 bytes):  4×4 tile thumbnail (16×14px 2bpp)
 *   - 0xF00–0xFFF (256 bytes):  metadata / camera settings
 *
 * 30 photos × 4096 bytes + 0x2000 header = 131072 bytes (128KB SRAM exact)
 *
 * Color index mapping (per BGP register in the GB Camera):
 *   0 = lightest (maps to palette[0])
 *   3 = darkest  (maps to palette[3])
 *
 * Sources: GB Camera SRAM reverse engineering by the Game Boy Camera Club,
 * AntonioND's docs, and gbcam2png by raphnet.
 */

window.GBCam = (() => {
  // ── Constants ──────────────────────────────────────────────────────────────

  const PHOTO_WIDTH       = 128;
  const PHOTO_HEIGHT      = 112;
  const TILE_PX           = 8;
  const BYTES_PER_TILE    = 16;   // 8×8 pixels, 2bpp
  const TILES_WIDE        = PHOTO_WIDTH  / TILE_PX;   // 16
  const TILES_TALL        = PHOTO_HEIGHT / TILE_PX;   // 14
  const TILES_PER_PHOTO   = TILES_WIDE * TILES_TALL;  // 224
  const BYTES_PER_PHOTO   = TILES_PER_PHOTO * BYTES_PER_TILE; // 3584 = 0xE00 (image data only)
  const SLOT_SIZE         = 0x1000;  // 4096 — full slot (image + thumbnail + metadata)
  const PHOTO_COUNT       = 30;
  const PHOTO_DATA_OFFSET = 0x2000;  // Start of photo data in SRAM
  const SRAM_SIZE         = 131072;  // 128KB

  // Bank 0 structures
  const LAST_SEEN_OFFSET    = 0x0000;  // "last seen" working image (128×112 2bpp, 0xE00 bytes)
  const STATE_VECTOR_OFFSET = 0x11B2;  // 30 bytes: album position per slot, 0xFF = deleted/unused
  const THUMB_OFFSET        = 0xE00;   // per-slot thumbnail (256 bytes = 16 tiles)
  const META_OFFSET         = 0xF00;   // per-slot metadata / camera settings (256 bytes)

  // ── Tile decoder ──────────────────────────────────────────────────────────
  //
  // Game Boy 2bpp tile layout (16 bytes per 8×8 tile):
  //   Each of the 8 rows uses 2 bytes: lo_byte, hi_byte
  //   For pixel at column col (0=left, 7=right):
  //     bit_pos  = 7 - col
  //     lo_bit   = (lo_byte >> bit_pos) & 1
  //     hi_bit   = (hi_byte >> bit_pos) & 1
  //     color    = (hi_bit << 1) | lo_bit   → 0..3

  function decodeTile(sav, offset) {
    const pixels = new Uint8Array(64);
    for (let row = 0; row < 8; row++) {
      const lo = sav[offset + row * 2];
      const hi = sav[offset + row * 2 + 1];
      for (let col = 0; col < 8; col++) {
        const bit = 7 - col;
        pixels[row * 8 + col] = ((hi >> bit) & 1) << 1 | ((lo >> bit) & 1);
      }
    }
    return pixels;
  }

  // ── Photo decoder ─────────────────────────────────────────────────────────
  //
  // Returns a Uint8Array of length PHOTO_WIDTH × PHOTO_HEIGHT
  // where each value is 0–3 (the color index, not yet mapped to a palette).

  function decodePhotoAt(sav, photoOffset) {
    const pixels = new Uint8Array(PHOTO_WIDTH * PHOTO_HEIGHT);

    for (let tileRow = 0; tileRow < TILES_TALL; tileRow++) {
      for (let tileCol = 0; tileCol < TILES_WIDE; tileCol++) {
        const tileIndex  = tileRow * TILES_WIDE + tileCol;
        const tileOffset = photoOffset + tileIndex * BYTES_PER_TILE;
        const tile       = decodeTile(sav, tileOffset);

        for (let py = 0; py < 8; py++) {
          for (let px = 0; px < 8; px++) {
            const canvasX = tileCol * 8 + px;
            const canvasY = tileRow * 8 + py;
            pixels[canvasY * PHOTO_WIDTH + canvasX] = tile[py * 8 + px];
          }
        }
      }
    }

    return pixels;
  }

  function decodePhoto(sav, photoIndex) {
    return decodePhotoAt(sav, PHOTO_DATA_OFFSET + photoIndex * SLOT_SIZE);
  }

  // ── Tile encoder (inverse of decodeTile) ─────────────────────────────────
  //
  // Writes pixel indices (0–3) from a PHOTO_WIDTH×PHOTO_HEIGHT array into the
  // 2bpp tile layout at the given SRAM offset.

  function encodePhotoAt(sav, photoOffset, pixels) {
    for (let tileRow = 0; tileRow < TILES_TALL; tileRow++) {
      for (let tileCol = 0; tileCol < TILES_WIDE; tileCol++) {
        const tileOffset = photoOffset + (tileRow * TILES_WIDE + tileCol) * BYTES_PER_TILE;
        for (let row = 0; row < 8; row++) {
          let lo = 0, hi = 0;
          for (let col = 0; col < 8; col++) {
            const v = pixels[(tileRow * 8 + row) * PHOTO_WIDTH + tileCol * 8 + col] & 3;
            const bit = 7 - col;
            lo |= (v & 1) << bit;
            hi |= ((v >> 1) & 1) << bit;
          }
          sav[tileOffset + row * 2]     = lo;
          sav[tileOffset + row * 2 + 1] = hi;
        }
      }
    }
  }

  /**
   * Write an imported photo (pixel indices 0–3, 128×112) into a slot:
   *  - image tiles at the slot base
   *  - a 32×32 thumbnail (4×4 tiles) into the thumbnail region
   *  - metadata copied from donorSlot (keeps a self-consistent metadata+checksum
   *    block, the same trick community injectors use), or zeroed if none
   *  - state vector entry set to albumPos (when the vector is valid)
   */
  function writePhotoToSlot(sav, slotIndex, pixels, { donorSlot = null, albumPos = null } = {}) {
    const base = PHOTO_DATA_OFFSET + slotIndex * SLOT_SIZE;
    encodePhotoAt(sav, base, pixels);

    // Thumbnail: nearest-neighbour downscale to 32×32, encoded as 4×4 tiles
    const THUMB_TILES = 4;
    const TS = THUMB_TILES * TILE_PX; // 32
    for (let tr = 0; tr < THUMB_TILES; tr++) {
      for (let tc = 0; tc < THUMB_TILES; tc++) {
        const tileOffset = base + THUMB_OFFSET + (tr * THUMB_TILES + tc) * BYTES_PER_TILE;
        for (let row = 0; row < 8; row++) {
          let lo = 0, hi = 0;
          for (let col = 0; col < 8; col++) {
            const sx = Math.min(PHOTO_WIDTH  - 1, Math.floor((tc * 8 + col) * PHOTO_WIDTH  / TS));
            const sy = Math.min(PHOTO_HEIGHT - 1, Math.floor((tr * 8 + row) * PHOTO_HEIGHT / TS));
            const v = pixels[sy * PHOTO_WIDTH + sx] & 3;
            const bit = 7 - col;
            lo |= (v & 1) << bit;
            hi |= ((v >> 1) & 1) << bit;
          }
          sav[tileOffset + row * 2]     = lo;
          sav[tileOffset + row * 2 + 1] = hi;
        }
      }
    }

    // Metadata: copy from donor slot so checksums stay internally consistent
    if (donorSlot !== null && donorSlot !== slotIndex) {
      const donorBase = PHOTO_DATA_OFFSET + donorSlot * SLOT_SIZE;
      for (let i = 0; i < 256; i++) sav[base + META_OFFSET + i] = sav[donorBase + META_OFFSET + i];
    }

    // State vector: mark the slot used at the requested album position
    if (albumPos !== null && readStateVector(sav)) {
      sav[STATE_VECTOR_OFFSET + slotIndex] = albumPos & 0xFF;
    }
  }

  // ── Empty slot detection ───────────────────────────────────────────────────
  //
  // Heuristic: if >96% of the photo bytes are a single value (all 0x00 or all 0xFF),
  // the region is considered blank. Real photos almost always mix the 4 shades —
  // but a very bright / very dark photo CAN trip this, which is why parseSav
  // prefers the bank-0 state vector when it's valid (see readStateVector).

  function isRegionBlank(sav, offset) {
    const freq = new Uint32Array(256);
    for (let i = 0; i < BYTES_PER_PHOTO; i++) {
      freq[sav[offset + i]]++;
    }
    const dominant = Math.max(...freq);
    return dominant / BYTES_PER_PHOTO > 0.96;
  }

  function isPhotoEmpty(sav, photoIndex) {
    return isRegionBlank(sav, PHOTO_DATA_OFFSET + photoIndex * SLOT_SIZE);
  }

  // ── Bank 0: album state vector ─────────────────────────────────────────────
  //
  // 30 bytes at 0x11B2 — one per slot. Value 0x00–0x1D is the photo's position
  // in the in-camera album; 0xFF means the slot is deleted (or never used).
  // A deleted photo's tile data survives until the camera overwrites the slot,
  // which is what makes deleted-photo recovery possible.
  //
  // Returns the 30-entry vector as a plain array, or null if the region doesn't
  // look like a valid vector (all album positions must be unique and < 30).

  function readStateVector(sav) {
    if (!sav || sav.length < STATE_VECTOR_OFFSET + PHOTO_COUNT) return null;
    const vec = [];
    const seen = new Set();
    for (let i = 0; i < PHOTO_COUNT; i++) {
      const b = sav[STATE_VECTOR_OFFSET + i];
      if (b === 0xFF) { vec.push(0xFF); continue; }
      if (b >= PHOTO_COUNT || seen.has(b)) return null; // not a valid vector
      seen.add(b);
      vec.push(b);
    }
    return vec;
  }

  // ── Palette application ────────────────────────────────────────────────────
  //
  // Renders a decoded photo (Uint8Array of 0–3) onto a canvas context.
  // palette: { colors: ['#rrggbb', '#rrggbb', '#rrggbb', '#rrggbb'] }
  //          colors[0] = lightest, colors[3] = darkest

  function renderToCanvas(ctx, pixels, palette, scale = 1) {
    const w = PHOTO_WIDTH  * scale;
    const h = PHOTO_HEIGHT * scale;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    // Pre-parse palette hex strings to [r, g, b]
    const rgb = palette.colors.map(hex => {
      const n = parseInt(hex.replace('#', ''), 16);
      return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    });

    for (let y = 0; y < PHOTO_HEIGHT; y++) {
      for (let x = 0; x < PHOTO_WIDTH; x++) {
        const colorIndex = pixels[y * PHOTO_WIDTH + x];
        const [r, g, b]  = rgb[colorIndex];

        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const i = ((y * scale + dy) * w + (x * scale + dx)) * 4;
            data[i]     = r;
            data[i + 1] = g;
            data[i + 2] = b;
            data[i + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  // ── Parse entire SRAM ─────────────────────────────────────────────────────

  function parseSav(arrayBuffer) {
    const sav = new Uint8Array(arrayBuffer);

    if (sav.length !== SRAM_SIZE) {
      console.warn(`[GBCam] Unexpected SRAM size: ${sav.length} (expected ${SRAM_SIZE})`);
    }

    // Prefer the bank-0 album vector: it knows the true in-camera state, so a
    // very bright/dark photo can't be misdetected as empty, deleted-but-intact
    // photos become recoverable, and the album display order is preserved.
    const vector = readStateVector(sav);

    const photos = [];
    for (let i = 0; i < PHOTO_COUNT; i++) {
      const blank = isPhotoEmpty(sav, i);
      let isEmpty, isDeleted = false, albumPos = null;

      if (vector) {
        const v = vector[i];
        if (v !== 0xFF) {
          isEmpty  = false;         // in the album — always show, even if "blank"-looking
          albumPos = v;
        } else {
          isDeleted = !blank;       // deleted in-camera but tile data still intact
          isEmpty   = blank;
        }
      } else {
        isEmpty = blank;            // no valid vector — fall back to the heuristic
      }

      const pixels = (isEmpty) ? null : decodePhoto(sav, i);
      photos.push({ index: i, pixels, isEmpty, isDeleted, albumPos });
    }

    // Hidden "last seen" image at the very start of SRAM — the working image
    // shown on the camera's "check the last photo" screen.
    let lastSeen = null;
    if (!isRegionBlank(sav, LAST_SEEN_OFFSET)) {
      lastSeen = decodePhotoAt(sav, LAST_SEEN_OFFSET);
    }

    const activeCount  = photos.filter(p => !p.isEmpty && !p.isDeleted).length;
    const deletedCount = photos.filter(p => p.isDeleted).length;
    return { photos, activeCount, deletedCount, lastSeen, hasVector: !!vector, sav };
  }

  // ── First non-empty photo decoder ─────────────────────────────────────────
  //
  // Returns the pixel indices (Uint8Array, 0–3) for the first non-empty photo
  // slot, or null if the save contains no photos at all.

  function decodeFirstPhoto(sav) {
    for (let i = 0; i < PHOTO_COUNT; i++) {
      if (!isPhotoEmpty(sav, i)) return decodePhoto(sav, i);
    }
    return null;
  }

  // ── Exported API ──────────────────────────────────────────────────────────

  return {
    PHOTO_WIDTH,
    PHOTO_HEIGHT,
    PHOTO_COUNT,
    parseSav,
    decodePhoto,
    decodeFirstPhoto,
    renderToCanvas,
    readStateVector,
    writePhotoToSlot,
  };
})();
