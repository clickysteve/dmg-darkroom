/**
 * filter-defs.js — Filter definitions (single source of truth for UI + defaults)
 *
 * Split from app.js. Classic script: shares the global scope with the other
 * app/ files; load order (see index.html) preserves the original execution
 * order and must be kept.
 */

// ── Filter definitions (single source of truth for UI + defaults) ─────────

const FILTER_DEFS = [
  { id: 'crt',      label: 'CRT Scanlines',       params: [
    { type: 'seg',   key: 'variant',   label: 'Scanlines',        def: 'medium',      stateKey: 'filterVariant', opts: [['fine','Fine'],['medium','Medium'],['thick','Thick'],['wide','Wide']] },
    { type: 'seg',   key: 'curve',     label: 'Screen shape',     def: 'none',        opts: [['none','Flat'],['mild','Mild'],['strong','Strong']] },
    { type: 'range', key: 'mix',       label: 'Mix',              def: 100, min: 0,   max: 100, step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'lcd',      label: 'LCD',                  params: [
    { type: 'range', key: 'subpixel',  label: 'Sub-pixel tint',   def: 30, min: 0,   max: 80,  step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'bleed',     label: 'Backlight bleed',  def: 0,  min: 0,   max: 80,  step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'glow',     label: 'Phosphor Glow',        params: [
    { type: 'range', key: 'intensity', label: 'Intensity',        def: 80, min: 0,   max: 100, step: 1,  fmt: v => `${v}%` },
    { type: 'range', key: 'blur',      label: 'Bloom radius',     def: 110, min: 0,  max: 300, step: 5,  fmt: v => `${v}%` },
    { type: 'seg',   key: 'phosphor',  label: 'Phosphor colour',  def: 'none',       opts: [['none','None'],['green','Green'],['amber','Amber'],['blue','Blue']] },
  ]},
  { id: 'vignette', label: 'Vignette',             params: [
    { type: 'range', key: 'falloff',   label: 'Intensity',        def: 50, min: 0,   max: 100, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'shape',     label: 'Shape',            def: 0,  min: 0,   max: 100, step: 1, fmt: v => v <= 5 ? 'Round' : v >= 95 ? 'Square' : `${v}%` },
  ]},
  { id: 'halftone', label: 'Halftone',             params: [
    { type: 'range', key: 'radius',    label: 'Dot size',         def: 38, min: 10,  max: 70,  step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'darkness',  label: 'Darkness',         def: 35, min: 0,   max: 100, step: 1, fmt: v => `${v}%` },
    { type: 'seg',   key: 'shape',     label: 'Dot shape',        def: 'circle',     opts: [['circle','Round'],['square','Square'],['diamond','Diamond']] },
  ]},
  { id: 'dot',      label: 'Dot Matrix',           params: [
    { type: 'range', key: 'radius',    label: 'Dot size',         def: 44, min: 20,  max: 80,  step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'halation',  label: 'Halation',         def: 0,  min: 0,   max: 80,  step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'chroma',   label: 'Chromatic Aberration', params: [
    { type: 'range', key: 'shiftH',    label: 'Horizontal shift', def: 75, min: 0,   max: 500, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'shiftV',    label: 'Vertical shift',   def: 0,  min: 0,   max: 500, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'shiftR',    label: 'Radial shift',     def: 0,  min: -500, max: 500, step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'grid',     label: 'Pixel Grid',           params: [
    { type: 'range', key: 'opacity',   label: 'Grid opacity',     def: 30, min: 1,   max: 100, step: 1,   fmt: v => `${v}%` },
    { type: 'range', key: 'weight',    label: 'Line weight',      def: 1,  min: 1,   max: 5,   step: 0.5, fmt: v => `${v}px` },
  ]},
  { id: 'jitter',   label: 'Scanline Jitter',      params: [
    { type: 'range', key: 'amount',    label: 'Jitter amount',    def: 40, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'frequency', label: 'Frequency',        def: 50, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'noise',    label: 'Noise / Static',       params: [
    { type: 'range', key: 'amount',    label: 'Amount',           def: 40, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
    { type: 'seg',   key: 'type',      label: 'Type',             def: 'film',       opts: [['film','Film'],['static','Static'],['bands','Bands']] },
  ]},
  { id: 'ghosting', label: 'VHS Ghosting',         params: [
    { type: 'range', key: 'offset',    label: 'Echo offset',      def: 60, min: 1,   max: 150, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'fade',      label: 'Echo fade',        def: 70, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'pixsort',   label: 'Pixel Sort',           params: [
    { type: 'range', key: 'threshold', label: 'Threshold',        def: 50, min: 0,   max: 100, step: 1, fmt: v => `${v}%` },
    { type: 'seg',   key: 'direction', label: 'Direction',        def: 'down',       opts: [['down','Down'],['up','Up'],['right','Right'],['left','Left']] },
  ]},
  { id: 'blkglitch', label: 'Block Glitch',         params: [
    { type: 'range', key: 'shift',     label: 'Shift amount',     def: 40, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'density',   label: 'Block count',      def: 30, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'size',      label: 'Block height',     def: 20, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'maxheight', label: 'Max height',       def: 30, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'wavewarp',  label: 'Wave Warp',            params: [
    { type: 'range', key: 'amplitude', label: 'Amplitude',        def: 30, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'frequency', label: 'Frequency',        def: 40, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'zoomblur',  label: 'Zoom Blur',            params: [
    { type: 'range', key: 'amount',    label: 'Amount',           def: 30, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'bayer',    label: 'Bayer Dithering',      params: [
    { type: 'range', key: 'levels',    label: 'Color levels',     def: 4,  min: 2,   max: 8,   step: 1, fmt: v => `${v}` },
  ]},
  { id: 'floyd',    label: 'Floyd-Steinberg',      params: [
    { type: 'range', key: 'levels',    label: 'Levels',           def: 2,  min: 2,   max: 8,   step: 1, fmt: v => `${v}` },
  ]},
  { id: 'interlace', label: 'Interlace',           params: [
    { type: 'range', key: 'intensity', label: 'Intensity',        def: 60, min: 1,   max: 100, step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'chswap',    label: 'Channel Swap',         params: [
    { type: 'seg',   key: 'mode',      label: 'Mode',             def: 'rgb',        opts: [['rgb','RGB'],['rbg','RBG'],['grb','GRB'],['gbr','GBR'],['brg','BRG'],['bgr','BGR']] },
  ]},
  { id: 'rgbplanes', label: 'RGB Planes',           params: [
    { type: 'range', key: 'shift',     label: 'Channel split',    def: 50,  min: 1, max: 300, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'scatter',   label: 'Row scatter',      def: 40,  min: 0, max: 100, step: 1, fmt: v => `${v}%` },
  ]},
  { id: 'colcorrupt', label: 'Color Corrupt',       params: [
    { type: 'range', key: 'density',   label: 'Density',          def: 35,  min: 1, max: 100, step: 1, fmt: v => `${v}%` },
    { type: 'range', key: 'strength',  label: 'Strength',         def: 65,  min: 1, max: 100, step: 1, fmt: v => `${v}%` },
  ]},
];

function buildDefaultFilterParams() {
  const out = {};
  for (const fd of FILTER_DEFS) {
    out[fd.id] = {};
    for (const p of fd.params) {
      if (p.stateKey) continue; // handled in state directly (e.g. filterVariant)
      out[fd.id][p.key] = p.def;
    }
  }
  return out;
}

