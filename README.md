<img src="docs/icon.png" width="200" alt="DMG DarkRoom">

# DMG DarkRoom

**Game Boy Camera darkroom — in your browser.** Load `.sav` or `.srm` files, browse your photos, apply palettes and effects, and export.

**→ [dmgdarkroom.allmyfriendsarejpegs.com](https://dmgdarkroom.allmyfriendsarejpegs.com)**

---

## Features

**Palettes**
- 100+ colour palettes: DMG, GBC, SGB, and Lospec community palettes
- Custom palette editor with `.pal` / `.gbp` import/export
- Palette favourites, palette grid visualiser, and random palette picker

**Effects & tone**
- CRT, LCD grid, halftone, dot matrix, phosphor glow, chromatic aberration, vignette, noise/static, VHS ghosting, and scanline jitter — each with granular per-filter controls
- Brightness, contrast, and split toning (shadow/highlight colour with intensity and balance)

**Border frames**
- 21 authentic Game Boy Camera border frames, palette-colorized to match your chosen palette
- Enable per-photo or globally; frame selection and on/off state saved in presets and project files
- Frames sourced from [gb-cam-lab](https://github.com/RomanObaraz/gb-cam-lab)

**Editing**
- Apply palettes, effects, and borders per-photo or globally across your whole roll
- Copy and paste settings between photos
- Effect presets — save, load, import and export as JSON (borders included)
- Per-photo rotate and flip
- Undo support

**Export**
- Batch PNG export at any scale with palettes and effects applied
- Animated GIF builder — drag-to-reorder frames, per-frame palette, optional border frames, bounce mode, loop controls
- Contact sheet — all 30 photos in one image

**Loading**
- Drag and drop `.sav` or `.srm` files, or open from file
- Analogue Pocket SD card support
- Save and reload project files (`.gbcp`)

**Recovery & album**
- Photos display in their true in-camera album order (bank 0 state vector)
- Deleted-photo recovery — photos deleted in-camera but not yet overwritten are shown with a "recovered" badge
- Hidden "last seen" image from the start of SRAM shown as an extra slot (LS)
- Photo metadata decoded from the save: photographer name, gender, birthdate, comment, and link-cable copy flag (shown in solo view and lightbox)

**Import**
- Import any image into an empty photo slot — cover-cropped to 128×112 and dithered to 4 shades (Bayer ordered dithering), written back with thumbnail, metadata, and album entry
- Export the modified `.sav` for use in emulators, flash carts, and other tools

---

## Keyboard shortcuts

### Navigation

| Key | Action |
|-----|--------|
| `←` / `→` | Previous / next photo |
| `↑` / `↓` | Previous / next row (grid view) |
| `G` | Switch to grid view |
| `S` | Switch to solo view |
| `F` | Open fullscreen presentation (or close) |
| `Escape` | Close presentation / lightbox / solo mode |

### Photo transforms (requires a photo selected)

| Key | Action |
|-----|--------|
| `R` | Rotate clockwise |
| `L` | Rotate counter-clockwise |
| `H` | Flip horizontal |
| `V` | Flip vertical |

### Editing

| Key | Action |
|-----|--------|
| `Cmd/Ctrl+Z` | Undo |
| `Shift+Cmd/Ctrl+Z` | Redo |
| `Cmd/Ctrl+C` | Copy settings |
| `Cmd/Ctrl+V` | Paste settings |
| `Cmd/Ctrl+A` | Select all photos |
| `P` | Toggle before/after effects preview |
| `Space` | Toggle GIF frame selection (in GIF mode) |

### Palettes

| Key | Action |
|-----|--------|
| `-` | Previous favourite palette |
| `+` | Next favourite palette |

---

## Usage

Open **[dmgdarkroom.allmyfriendsarejpegs.com](https://dmgdarkroom.allmyfriendsarejpegs.com)** in Chrome or Edge for the best experience (full File System Access API). Firefox and Safari work with standard file pickers.

No installation. No sign-up. Runs entirely in your browser — and works offline once loaded (installable as a PWA).

---

## Technical notes

- Game Boy Camera SRAM: 128KB, photos at `0x2000`, 30 slots × 3584 bytes, 128×112px 2bpp
- Bank 0 album state vector at `0x11B2`: 30 bytes, one per slot — album position, or `0xFF` for deleted/unused (used for album ordering, deleted-photo recovery, and empty-slot detection). Protected by a "Magic" string + sum/xor checksum + echo copy, all maintained on write
- Per-slot metadata at `+0xF00`: user ID, name, gender/blood, birthdate, comment, hotspots, in-camera border index, "Magic" + checksum, echo at `+0xF5C` (the stock camera stores no exposure settings)
- "Last seen" working image: 3584 bytes at `0x0100`, same tile format
- `.srm` files are raw SRAM dumps in RetroArch format — identical structure to `.sav`
- Tone adjustments render on the GPU (WebGL) when hardware acceleration is available, with an automatic bit-equivalent CPU fallback; exports always use the CPU path for reproducibility

## Development

- `renderer/js/app/` holds the app modules (classic scripts, shared global scope — load order in `index.html` matters); `docs/` is the deployed web build, synced via `npm run sync:web`
- `npm test` — unit tests for the SRAM decoder/encoder (node)
- `npm run test:e2e` — Playwright end-to-end tests against the web build (`npx playwright install chromium` first)
- CI runs both suites plus a renderer/docs sync check on every push

---

## Credits

**SRAM format research:** [AntonioND/gbcam2png](https://github.com/AntonioND/gbcam2png) and the [Game Boy Camera Club](https://gameboycameraclub.com) community.

**GBC and SGB palettes:** sourced from [The Cutting Room Floor](https://tcrf.net/Notes:Game_Boy_Color_Bootstrap_ROM).

**Community palettes:** sourced from [Lospec](https://lospec.com) — individual palette credits to [Kirokaze](https://lospec.com/kirokaze), [Kerrie Lake](https://lospec.com/kerrielake), [Poltergasm](https://lospec.com/poltergasm), [WildLeoKnight](https://lospec.com/wildleoknight), [Klafooty](https://lospec.com/klafooty), [Space Sandwich](https://lospec.com/spacesandwich), and [BurakoIRL](https://lospec.com/burakoirl).

**Border frames:** sourced from [RomanObaraz/gb-cam-lab](https://github.com/RomanObaraz/gb-cam-lab).

---

Made by [clickysteve](https://github.com/clickysteve) · [allmyfriendsarejpegs.com](https://allmyfriendsarejpegs.com)
