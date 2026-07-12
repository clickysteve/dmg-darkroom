/**
 * webgl-tone.js — GPU implementation of the tone pipeline
 * (brightness / contrast / split toning).
 *
 * The tone pass is the hottest per-pixel loop in the app: it runs on every
 * repaint of every canvas (30 thumbnails × ~230k px at 4× scale). This module
 * runs the identical math in a fragment shader, reading the source canvas as
 * a texture (no getImageData) and writing the result back with drawImage.
 *
 * Design rules:
 *  - The shader mirrors applyToneAdjustments' CPU math exactly (same clamp
 *    and round points, same luminance weights, alpha-0 pixels untouched).
 *    Parity is enforced by the e2e test "webgl tone parity" (max diff ≤ 2).
 *  - Any failure — no WebGL, context lost, shader error — returns false and
 *    the caller falls back to the CPU loop. The GPU path is an optimisation,
 *    never a requirement.
 *  - Disable manually with localStorage.setItem('gbcam_webgl', 'off').
 */

const WebGLTone = (() => {
  let gl = null;
  let glCanvas = null;
  let program = null;
  let uniforms = null;
  let failed = false;

  const VERT = `
attribute vec2 aPos;
varying vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  // Mirrors applyToneAdjustments (filters-engine.js) step for step.
  const FRAG = `
precision highp float;
varying vec2 vUV;
uniform sampler2D uTex;
uniform float uBrightness;      // -100..100 (0 = off)
uniform float uContrastFactor;  // precomputed S-curve factor (1 = off)
uniform float uToneStr;         // toneIntensity / 100 (0 = off)
uniform float uMid;             // (toneBalance + 100) / 200
uniform vec3  uShadow;          // 0..255
uniform vec3  uHighlight;       // 0..255

vec3 roundv(vec3 v) { return floor(v + 0.5); }

void main() {
  vec4 texel = texture2D(uTex, vUV);
  if (texel.a == 0.0) { gl_FragColor = texel; return; }
  vec3 c = texel.rgb * 255.0;

  // Brightness (integer add + clamp)
  c = clamp(c + vec3(uBrightness), 0.0, 255.0);

  // Contrast (S-curve through 128, rounded like the CPU path)
  if (uContrastFactor != 1.0) {
    c = clamp(roundv(uContrastFactor * (c - 128.0) + 128.0), 0.0, 255.0);
  }

  // Split toning — blend toward shadow/highlight tints by luminance
  if (uToneStr > 0.0) {
    float lum = dot(c, vec3(0.299, 0.587, 0.114)) / 255.0;
    float sw = uMid > 0.0 ? max(0.0, 1.0 - lum / uMid) : 0.0;
    float hw = uMid < 1.0 ? max(0.0, (lum - uMid) / (1.0 - uMid)) : 0.0;
    c = clamp(roundv(c + uToneStr * (sw * (uShadow - c) + hw * (uHighlight - c))), 0.0, 255.0);
  }

  gl_FragColor = vec4(c / 255.0, texel.a);
}`;

  function isDisabled() {
    try { return localStorage.getItem('gbcam_webgl') === 'off'; }
    catch (_) { return false; }
  }

  function isForced() {
    // 'force' accepts software-rasterised WebGL too (used by the parity tests)
    try { return localStorage.getItem('gbcam_webgl') === 'force'; }
    catch (_) { return false; }
  }

  function init() {
    if (failed || gl) return !failed;
    try {
      glCanvas = document.createElement('canvas');
      gl = glCanvas.getContext('webgl', {
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
        antialias: false,
        depth: false,
        stencil: false,
        // Software-emulated WebGL (SwiftShader) is slower than the CPU loop —
        // refuse it so those machines transparently keep the CPU path.
        failIfMajorPerformanceCaveat: !isForced(),
      });
      if (!gl) throw new Error('no hardware webgl');

      const compile = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(sh));
        }
        return sh;
      };

      program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program));
      }
      gl.useProgram(program);

      // Fullscreen triangle
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(program, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      // The source canvas is top-left origin; flip so vUV matches
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

      uniforms = {
        brightness:     gl.getUniformLocation(program, 'uBrightness'),
        contrastFactor: gl.getUniformLocation(program, 'uContrastFactor'),
        toneStr:        gl.getUniformLocation(program, 'uToneStr'),
        mid:            gl.getUniformLocation(program, 'uMid'),
        shadow:         gl.getUniformLocation(program, 'uShadow'),
        highlight:      gl.getUniformLocation(program, 'uHighlight'),
      };
      gl.uniform1i(gl.getUniformLocation(program, 'uTex'), 0);

      glCanvas.addEventListener('webglcontextlost', () => { gl = null; failed = true; });
      return true;
    } catch (e) {
      console.warn('[WebGLTone] init failed, using CPU tone path:', e.message);
      failed = true;
      gl = null;
      return false;
    }
  }

  function hexToVec3(hex) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }

  /**
   * Apply tone adjustments on the GPU. Returns true when the result has been
   * written back into ctx; false when the caller must use the CPU path.
   */
  function apply(ctx, width, height, { brightness, contrast, toneIntensity, shadowColor, highlightColor, toneBalance }) {
    if (isDisabled() || !init()) return false;
    try {
      if (glCanvas.width !== width || glCanvas.height !== height) {
        glCanvas.width = width;
        glCanvas.height = height;
        gl.viewport(0, 0, width, height);
      }

      const contrastFactor = contrast !== 0
        ? (259 * (contrast + 255)) / (255 * (259 - contrast))
        : 1;

      gl.uniform1f(uniforms.brightness, brightness || 0);
      gl.uniform1f(uniforms.contrastFactor, contrastFactor);
      gl.uniform1f(uniforms.toneStr, (toneIntensity || 0) / 100);
      gl.uniform1f(uniforms.mid, ((toneBalance || 0) + 100) / 200);
      gl.uniform3fv(uniforms.shadow, hexToVec3(shadowColor || '#000000'));
      gl.uniform3fv(uniforms.highlight, hexToVec3(highlightColor || '#ffffff'));

      // Upload the current canvas as the source texture (GPU-side copy)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ctx.canvas);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Write the result back (also GPU-side)
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(glCanvas, 0, 0);
      return true;
    } catch (e) {
      console.warn('[WebGLTone] apply failed, using CPU tone path:', e.message);
      failed = true;
      return false;
    }
  }

  return { apply, get available() { return !failed && !isDisabled(); } };
})();
