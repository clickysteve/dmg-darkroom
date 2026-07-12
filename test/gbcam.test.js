/**
 * gbcam.test.js — unit tests for the SRAM decoder/encoder (node:test).
 *
 * Run: npm test
 *
 * Uses the real saves in test_saves/ when present (they're gitignored, so CI
 * skips those cases) plus synthetic fixtures that always run.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GBCam = require('../renderer/js/gbcam.js');

const SAVES_DIR = path.join(__dirname, '..', 'test_saves');
const realSaves = fs.existsSync(SAVES_DIR)
  ? fs.readdirSync(SAVES_DIR).filter(f => /\.(sav|srm)$/i.test(f))
  : [];

function loadSav(name) {
  const buf = fs.readFileSync(path.join(SAVES_DIR, name));
  return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

// ── Synthetic fixtures ────────────────────────────────────────────────────────

/** A blank-but-valid SRAM: all 0xFF, valid (all-deleted) album vector. */
function blankSav() {
  return new Uint8Array(131072).fill(0xFF);
}

/** Deterministic test image: 4-column bands of indices 0–3. */
function bandImage() {
  const { PHOTO_WIDTH: W, PHOTO_HEIGHT: H } = GBCam;
  const px = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      px[y * W + x] = Math.floor(x / 32) % 4;
  return px;
}

// ── Encode/decode roundtrip ──────────────────────────────────────────────────

test('writePhotoToSlot → decodePhoto roundtrip is pixel-exact', () => {
  const sav = blankSav();
  const img = bandImage();
  GBCam.writePhotoToSlot(sav, 7, img, { albumPos: 0 });
  assert.deepEqual(GBCam.decodePhoto(sav, 7), img);
});

test('imported slot parses as an active photo', () => {
  const sav = blankSav();
  GBCam.writePhotoToSlot(sav, 0, bandImage(), { albumPos: 0 });
  const r = GBCam.parseSav(sav.buffer);
  assert.equal(r.photos[0].isEmpty, false);
  assert.equal(r.photos[0].isDeleted, false);
  assert.equal(r.photos[0].albumPos, 0);
  assert.equal(r.activeCount, 1);
});

// ── Checksums (the camera wipes the save if these are wrong) ─────────────────

test('written metadata block has valid Magic + checksum + echo', () => {
  const sav = blankSav();
  GBCam.writePhotoToSlot(sav, 3, bandImage(), { albumPos: 0 });
  const meta = GBCam.decodeSlotMeta(sav, 3);
  assert.equal(meta.checksumValid, true);
  // Echo must be byte-identical to the primary copy
  const base = 0x2000 + 3 * 0x1000 + 0xF00;
  for (let i = 0; i <= 0x5B; i++) {
    assert.equal(sav[base + 0x5C + i], sav[base + i], `echo byte ${i}`);
  }
});

test('vector write updates Magic, checksum and echo consistently', () => {
  const sav = blankSav();
  GBCam.writePhotoToSlot(sav, 5, bandImage(), { albumPos: 2 });
  // Magic present
  assert.deepEqual([...sav.slice(0x11D0, 0x11D5)], [0x4D, 0x61, 0x67, 0x69, 0x63]);
  // Stored checksum matches recomputed
  const ck = GBCam.blockChecksum(sav, 0x11B2, 0x11D4);
  assert.equal(sav[0x11D5], ck.sum);
  assert.equal(sav[0x11D6], ck.xor);
  // Echo mirrors the whole block
  for (let i = 0; i < 0x25; i++) {
    assert.equal(sav[0x11D7 + i], sav[0x11B2 + i], `vector echo byte ${i}`);
  }
});

// ── State vector semantics ────────────────────────────────────────────────────

test('invalid vector (duplicate positions) falls back to heuristic', () => {
  const sav = blankSav();
  sav[0x11B2] = 0x00;
  sav[0x11B3] = 0x00; // duplicate album position → invalid
  assert.equal(GBCam.readStateVector(sav), null);
  const r = GBCam.parseSav(sav.buffer);
  assert.equal(r.hasVector, false);
});

test('out-of-range vector value is invalid', () => {
  const sav = blankSav();
  sav[0x11B2] = 30; // positions must be < 30
  assert.equal(GBCam.readStateVector(sav), null);
});

test('deleted-but-intact slot is flagged recovered, not empty', () => {
  const sav = blankSav();
  GBCam.writePhotoToSlot(sav, 4, bandImage(), { albumPos: 0 });
  // Now mark it deleted in the vector (leave tile data intact)
  const withDeleted = new Uint8Array(sav);
  withDeleted[0x11B2 + 4] = 0xFF;
  // fix checksum for the modified vector
  const ck = GBCam.blockChecksum(withDeleted, 0x11B2, 0x11D4);
  withDeleted[0x11D5] = ck.sum;
  withDeleted[0x11D6] = ck.xor;
  const r = GBCam.parseSav(withDeleted.buffer);
  assert.equal(r.photos[4].isDeleted, true);
  assert.equal(r.photos[4].isEmpty, false);
  assert.equal(r.deletedCount, 1);
});

// ── Last-seen image ───────────────────────────────────────────────────────────

test('last-seen image is decoded from 0x0100 when present', () => {
  const sav = blankSav();
  // Write a recognisable pattern as 2bpp tiles at the last-seen offset.
  // Tile bytes 0x00,0xFF alternating gives a mix that defeats the blank check.
  for (let i = 0; i < 3584; i++) sav[0x0100 + i] = (i % 2) ? 0xFF : 0x00;
  const r = GBCam.parseSav(sav.buffer);
  assert.ok(r.lastSeen, 'lastSeen should be decoded');
  assert.equal(r.lastSeen.length, 128 * 112);
  // lo=0x00, hi=0xFF → every pixel = index 2
  assert.ok(r.lastSeen.every(v => v === 2));
});

test('blank last-seen region yields null', () => {
  const r = GBCam.parseSav(blankSav().buffer);
  assert.equal(r.lastSeen, null);
});

// ── Metadata decoding ─────────────────────────────────────────────────────────

test('decodeSlotMeta reads name, gender and border from a crafted block', () => {
  const sav = blankSav();
  GBCam.writePhotoToSlot(sav, 0, bandImage(), { albumPos: 0 });
  const base = 0x2000 + 0xF00;
  // Name "GB" → international charset: A=0x56 … G=0x5C, B=0x57
  sav[base + 0x04] = 0x5C;
  sav[base + 0x05] = 0x57;
  sav[base + 0x06] = 0x00;
  sav[base + 0x0D] = 0x01 | (0x03 << 2); // male, blood O
  sav[base + 0x54] = 7;                  // border index
  // recompute checksum after direct pokes
  const ck = GBCam.blockChecksum(sav, base, base + 0x59);
  sav[base + 0x5A] = ck.sum;
  sav[base + 0x5B] = ck.xor;

  const m = GBCam.decodeSlotMeta(sav, 0);
  assert.equal(m.userName, 'GB');
  assert.equal(m.gender, 'male');
  assert.equal(m.bloodType, 'O');
  assert.equal(m.borderIndex, 7);
  assert.equal(m.checksumValid, true);
});

test('decodeSlotMeta flags a corrupted checksum', () => {
  const sav = blankSav();
  GBCam.writePhotoToSlot(sav, 0, bandImage(), { albumPos: 0 });
  sav[0x2000 + 0xF5A] ^= 0xFF;
  assert.equal(GBCam.decodeSlotMeta(sav, 0).checksumValid, false);
});

// ── Real saves (skipped in CI — test_saves/ is gitignored) ───────────────────

for (const name of realSaves) {
  test(`real save ${name}: vector checksum matches stored bytes`, () => {
    const sav = loadSav(name);
    const ck = GBCam.blockChecksum(sav, 0x11B2, 0x11D4);
    assert.equal(sav[0x11D5], ck.sum);
    assert.equal(sav[0x11D6], ck.xor);
  });

  test(`real save ${name}: all slot metadata checksums valid`, () => {
    const sav = loadSav(name);
    for (let i = 0; i < 30; i++) {
      assert.equal(GBCam.decodeSlotMeta(sav, i).checksumValid, true, `slot ${i}`);
    }
  });

  test(`real save ${name}: parses with a valid vector and stable counts`, () => {
    const sav = loadSav(name);
    const r = GBCam.parseSav(sav.buffer.slice(0));
    assert.equal(r.hasVector, true);
    assert.equal(r.photos.length, 30);
    assert.equal(
      r.activeCount + r.deletedCount + r.photos.filter(p => p.isEmpty).length,
      30
    );
  });

  test(`real save ${name}: import into a copy leaves all checksums valid`, () => {
    const sav = loadSav(name);
    const r = GBCam.parseSav(sav.buffer.slice(0));
    const target = r.photos.find(p => p.isEmpty)?.index
                ?? r.photos.find(p => p.isDeleted)?.index;
    if (target === undefined) return; // nothing writable — skip
    GBCam.writePhotoToSlot(sav, target, bandImage(), { albumPos: 29 });
    const ck = GBCam.blockChecksum(sav, 0x11B2, 0x11D4);
    assert.equal(sav[0x11D5], ck.sum);
    assert.equal(sav[0x11D6], ck.xor);
    assert.equal(GBCam.decodeSlotMeta(sav, target).checksumValid, true);
  });
}
