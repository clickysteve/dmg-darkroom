#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# sync-web.sh — copy shared source from renderer/ into docs/ (the web build).
#
# renderer/ is the source of truth for the code shared between the Electron
# app and the GitHub Pages web app. docs/ additionally contains web-only
# files (web-api.js, gif-worker.js, gifenc.esm.js, jszip.esm.js, sw.js,
# manifest.webmanifest, index.html, CNAME, favicon, icon) which are NOT
# touched here.
#
# Run after changing renderer/js/*, renderer/css/*, or renderer/frames/*:
#   npm run sync:web
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "▶ Syncing renderer/ → docs/"

cp renderer/js/app.js          docs/js/app.js
cp renderer/js/gbcam.js        docs/js/gbcam.js
cp renderer/js/palettes.js     docs/js/palettes.js
cp renderer/js/palettes-ext.js docs/js/palettes-ext.js
cp renderer/css/style.css      docs/css/style.css
cp renderer/frames/*.png       docs/frames/

echo "✓ docs/ is in sync with renderer/"
echo ""
echo "Reminder: docs/index.html is maintained separately — if you changed"
echo "renderer/index.html, port the change to docs/index.html by hand."
