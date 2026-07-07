/**
 * gif-encoder-worker.js — GIF encoding in a worker thread.
 *
 * Runs omggif off the main process so large exports don't freeze the app.
 * Receives { frames, delay, scale, loop } via postMessage, replies with
 * { progress } messages per frame and finally { done, buffer }.
 */

const { parentPort } = require('worker_threads');
const { GifWriter } = require('omggif');

function scaleIndices(indices, width, height, scale) {
  if (scale === 1) return indices;
  const sw = width * scale;
  const sh = height * scale;
  const out = new Uint8Array(sw * sh);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const val = indices[y * width + x];
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          out[(y * scale + dy) * sw + (x * scale + dx)] = val;
        }
      }
    }
  }
  return out;
}

function encodeGif(frames, delayMs, scale, loop) {
  const width = frames[0].width * scale;
  const height = frames[0].height * scale;
  const delayCs = Math.max(1, Math.round(delayMs / 10)); // centiseconds

  // loop: 'infinite' or 'bounce' → repeat forever (0); 'once' → no Netscape extension
  const gwOpts = (loop === 'once') ? {} : { loop: 0 };

  // Worst-case LZW output is ~1.5× input; 2× + header slack is provably enough.
  const bufSize = width * height * frames.length * 2 + 100000;
  const buf = Buffer.alloc(bufSize);
  const gw = new GifWriter(buf, width, height, gwOpts);

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const scaled = scaleIndices(new Uint8Array(frame.indices), frame.width, frame.height, scale);
    // omggif expects palette as [0xRRGGBB, ...]
    const palette = frame.palette.map(([r, g, b]) => (r << 16) | (g << 8) | b);
    // Pad palette to power of 2 (minimum 4 entries for 2-bit)
    while (palette.length < 4) palette.push(0);

    gw.addFrame(0, 0, width, height, scaled, {
      palette,
      delay: delayCs,
      disposal: 2,
    });
    parentPort.postMessage({ progress: (i + 1) / frames.length });
  }

  return buf.slice(0, gw.end());
}

parentPort.on('message', ({ frames, delay, scale, loop }) => {
  try {
    const out = encodeGif(frames, delay, scale, loop);
    // Transfer the underlying ArrayBuffer to avoid a copy
    const ab = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
    parentPort.postMessage({ done: true, buffer: ab }, [ab]);
  } catch (e) {
    parentPort.postMessage({ error: e.message });
  }
});
