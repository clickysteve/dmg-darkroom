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

const GBCam = (() => {
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
  // The capture buffer at 0x0000–0x0FFF is 128×128 (256 tiles); the usable
  // 128×112 "last seen" image starts one tile row in, at 0x0100.
  const LAST_SEEN_OFFSET    = 0x0100;
  const STATE_VECTOR_OFFSET = 0x11B2;  // 30 bytes: album position per slot, 0xFF = deleted/unused
  const VECTOR_MAGIC_OFFSET = 0x11D0;  // ASCII "Magic"
  const VECTOR_CKSUM_OFFSET = 0x11D5;  // sum/xor over 0x11B2–0x11D4
  const VECTOR_ECHO_OFFSET  = 0x11D7;  // byte-identical echo of 0x11B2–0x11D6
  const THUMB_OFFSET        = 0xE00;   // per-slot thumbnail (256 bytes = 16 tiles)
  const META_OFFSET         = 0xF00;   // per-slot metadata (see decodeSlotMeta)
  const META_ECHO_OFFSET    = 0xF5C;   // byte-identical echo of 0xF00–0xF5B
  const MAGIC = [0x4D, 0x61, 0x67, 0x69, 0x63]; // ASCII "Magic"

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
   * Set one slot's album-vector entry and recompute the vector's Magic,
   * checksum, and echo — all three must be consistent or the camera treats
   * the save as corrupt and wipes it at boot.
   */
  function setStateVectorEntry(sav, slotIndex, value) {
    sav[STATE_VECTOR_OFFSET + slotIndex] = value & 0xFF;
    MAGIC.forEach((b, i) => { sav[VECTOR_MAGIC_OFFSET + i] = b; });
    const ck = blockChecksum(sav, STATE_VECTOR_OFFSET, VECTOR_MAGIC_OFFSET + 4);
    sav[VECTOR_CKSUM_OFFSET]     = ck.sum;
    sav[VECTOR_CKSUM_OFFSET + 1] = ck.xor;
    // Echo of the whole block (vector + Magic + checksum) at 0x11D7
    const len = VECTOR_CKSUM_OFFSET + 2 - STATE_VECTOR_OFFSET; // 0x25 bytes
    for (let i = 0; i < len; i++) sav[VECTOR_ECHO_OFFSET + i] = sav[STATE_VECTOR_OFFSET + i];
  }

  /**
   * Write an imported photo (pixel indices 0–3, 128×112) into a slot:
   *  - image tiles at the slot base
   *  - a 32×32 thumbnail (4×4 tiles) into the thumbnail region
   *  - a fresh, checksummed metadata block (+ echo)
   *  - state vector entry set to albumPos, with vector checksum + echo updated
   */
  function writePhotoToSlot(sav, slotIndex, pixels, { albumPos = null } = {}) {
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

    // Fresh metadata block with valid Magic + checksum + echo
    writeSlotMeta(sav, slotIndex);

    // State vector: mark the slot used at the requested album position
    // (recomputes the vector checksum + echo so the camera accepts the save)
    if (albumPos !== null && readStateVector(sav)) {
      setStateVectorEntry(sav, slotIndex, albumPos);
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

  // ── Checksums ───────────────────────────────────────────────────────────────
  //
  // Every "Magic" block in the save (per-slot metadata, album vector, owner
  // block) is protected by the same pair: an 8-bit SUM seeded 0x4E and an
  // 8-bit XOR seeded 0x54, computed over the block INCLUDING its "Magic"
  // string. A wrong checksum (or missing "Magic") makes the camera wipe the
  // entire save at boot — so anything that writes SRAM must recompute these.
  // Ref: Raphael-Boichot/Inject-pictures-in-your-Game-Boy-Camera-saves,
  //      untoxa/gb-photo (CAMERA_SUM_SEED/CAMERA_XOR_SEED), funtography wiki.

  function blockChecksum(sav, start, endInclusive) {
    let sum = 0x4E, xor = 0x54;
    for (let i = start; i <= endInclusive; i++) {
      sum = (sum + sav[i]) & 0xFF;
      xor ^= sav[i];
    }
    return { sum, xor };
  }

  // ── Per-slot metadata (slot-relative 0xF00–0xF5B, echo at 0xF5C) ────────────
  //
  //   0xF00–0xF03  user ID (8 digits, one per nibble, stored digit+1; 0 = blank)
  //   0xF04–0xF0C  user name (9 chars, GB Camera charset)
  //   0xF0D        gender (bits 0–1: 0 none / 1 male / 2 female), blood type (>>2)
  //   0xF0E–0xF11  birthdate (nibble digits: year ×4, then two 2-digit fields)
  //   0xF15–0xF2F  comment (27 chars = 3 lines × 9)
  //   0xF33        0 = original, 1 = copy (received via link cable)
  //   0xF36–0xF53  hotspot data (sounds/effects, 5 slots)
  //   0xF54        border/frame index chosen in-camera
  //   0xF55–0xF59  ASCII "Magic"
  //   0xF5A–0xF5B  checksum (sum, xor) over 0xF00–0xF59
  //
  // Note: the stock camera does NOT store exposure/dither/edge settings in the
  // save — only the border index survives. (Confirmed across Boichot, untoxa,
  // and the funtography wiki.)

  // International-ROM character set (byte → char). 0x00 terminates.
  const CHARSET_INT = (() => {
    const map = {};
    const put = (start, str) => { [...str].forEach((ch, i) => { map[start + i] = ch; }); };
    put(0x32, '♥');
    put(0x56, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    put(0x70, "_',.");
    put(0x74, 'ÁÂÀÄÉÊÈËÍÏÓÖÚÜÑ');
    put(0x83, '-&!? ');
    put(0x88, 'abcdefghijklmnopqrstuvwxyz');
    put(0xA2, '·~☎ ');
    put(0xA6, 'áâàäéêèëíïóöúüñ');
    put(0xB5, 'çß☺☹');
    put(0xBA, '0123456789');
    put(0xC4, '/:˜"@');
    return map;
  })();

  function decodeText(sav, offset, length) {
    let out = '';
    for (let i = 0; i < length; i++) {
      const b = sav[offset + i];
      if (b === 0x00) break;
      out += CHARSET_INT[b] ?? ' ';
    }
    return out.trim();
  }

  function decodeNibbleDigits(sav, offset, byteLen) {
    let out = '';
    for (let i = 0; i < byteLen; i++) {
      for (const nib of [sav[offset + i] >> 4, sav[offset + i] & 0x0F]) {
        out += (nib >= 0x1 && nib <= 0xA) ? String(nib - 1) : '-';
      }
    }
    return out;
  }

  const GENDERS = { 1: 'male', 2: 'female' };
  const BLOODS  = { 1: 'A', 2: 'B', 3: 'O', 4: 'AB' };

  /** Decode the metadata block of a photo slot. Returns null for out-of-range slots. */
  function decodeSlotMeta(sav, slotIndex) {
    if (slotIndex < 0 || slotIndex >= PHOTO_COUNT) return null;
    const base = PHOTO_DATA_OFFSET + slotIndex * SLOT_SIZE;
    const m = base + META_OFFSET;

    const magicOk = MAGIC.every((b, i) => sav[m + 0x55 + i] === b);
    const ck = blockChecksum(sav, m, m + 0x59);
    const checksumValid = magicOk && sav[m + 0x5A] === ck.sum && sav[m + 0x5B] === ck.xor;

    const genderByte = sav[m + 0x0D];
    const birth = decodeNibbleDigits(sav, m + 0x0E, 4); // YYYY + two 2-digit fields (day/month order differs between sources)

    const commentLines = [];
    for (let line = 0; line < 3; line++) {
      const txt = decodeText(sav, m + 0x15 + line * 9, 9);
      if (txt) commentLines.push(txt);
    }

    return {
      userId:      decodeNibbleDigits(sav, m, 4),
      userName:    decodeText(sav, m + 0x04, 9),
      gender:      GENDERS[genderByte & 0x03] || null,
      bloodType:   BLOODS[genderByte >> 2] || null,
      birthdate:   /^-+$/.test(birth) ? null : birth,   // "YYYYxxyy" digit string
      comment:     commentLines.join(' '),
      isCopy:      sav[m + 0x33] === 0x01,
      borderIndex: sav[m + 0x54],
      checksumValid,
    };
  }

  /** Write a fresh, checksummed metadata block (blank profile, hotspots off). */
  function writeSlotMeta(sav, slotIndex, { borderIndex = 0 } = {}) {
    const m = PHOTO_DATA_OFFSET + slotIndex * SLOT_SIZE + META_OFFSET;
    for (let i = 0; i <= 0x5B; i++) sav[m + i] = 0x00;
    for (let i = 0; i < 4; i++) sav[m + i] = 0x11;            // user ID "00000000"
    // name, gender, birthdate, comment left blank (0x00)
    for (let i = 0; i < 5; i++) {
      sav[m + 0x36 + i] = 0x00;                                // hotspots off
      sav[m + 0x45 + i] = 0xFF;                                // hotspot sound off
      sav[m + 0x4A + i] = 0xFF;                                // hotspot effect off
      sav[m + 0x4F + i] = 0xFF;                                // hotspot jump off
    }
    sav[m + 0x54] = borderIndex & 0xFF;
    MAGIC.forEach((b, i) => { sav[m + 0x55 + i] = b; });
    const ck = blockChecksum(sav, m, m + 0x59);
    sav[m + 0x5A] = ck.sum;
    sav[m + 0x5B] = ck.xor;
    // Echo copy at 0xF5C–0xFB7 (the camera cross-checks / repairs from it)
    for (let i = 0; i <= 0x5B; i++) sav[m + 0x5C + i] = sav[m + i];
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

  const api = {
    PHOTO_WIDTH,
    PHOTO_HEIGHT,
    PHOTO_COUNT,
    parseSav,
    decodePhoto,
    decodeFirstPhoto,
    renderToCanvas,
    readStateVector,
    writePhotoToSlot,
    decodeSlotMeta,
    blockChecksum,
  };
  return api;
})();

// Dual-environment export: browser global + node (for the unit test suite)
if (typeof window !== 'undefined') window.GBCam = GBCam;
if (typeof module !== 'undefined' && module.exports) module.exports = GBCam;
