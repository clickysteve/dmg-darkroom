/**
 * gif-worker.js — GIF encoding in a Web Worker (module worker).
 *
 * Keeps the UI thread responsive during large exports. Receives
 * { frames, delay, scale, loop } via postMessage, replies with
 * { progress } per frame and finally { done, buffer }.
 */

import { GIFEncoder } from './gifenc.esm.js';

function scaleIndices(indices, w, h, scale) {
  if (scale === 1) return indices;
  const sw = w * scale, sh = h * scale;
  const out = new Uint8Array(sw * sh);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = indices[y * w + x];
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++)
          out[(y * scale + dy) * sw + (x * scale + dx)] = v;
    }
  return out;
}

self.onmessage = (e) => {
  const { frames, delay, scale, loop } = e.data;
  try {
    const w = frames[0].width * scale;
    const h = frames[0].height * scale;
    const gif = GIFEncoder();

    for (let fi = 0; fi < frames.length; fi++) {
      const frame = frames[fi];
      const scaled = scaleIndices(new Uint8Array(frame.indices), frame.width, frame.height, scale);
      const opts = { palette: frame.palette, delay }; // gifenc: delay in ms
      // Netscape loop block on the first frame only, and only when looping
      if (fi === 0 && loop !== 'once') opts.repeat = 0;
      gif.writeFrame(scaled, w, h, opts);
      self.postMessage({ progress: (fi + 1) / frames.length });
    }

    gif.finish();
    const bytes = gif.bytes();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    self.postMessage({ done: true, buffer: ab }, [ab]);
  } catch (err) {
    self.postMessage({ error: err.message });
  }
};
