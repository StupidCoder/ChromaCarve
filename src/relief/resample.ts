/**
 * Single-channel field resampling for the bas-relief solve. The Dirichlet solve
 * runs the DCT-preconditioned CG on power-of-two grids (fast radix-2 FFT;
 * arbitrary sizes fall back to slow Bluestein), capped smaller for interactive
 * previews and larger for exports. Relief is low-frequency so the upsampled
 * result closely matches full resolution.
 */

export const RELIEF_PREVIEW_DIM = 512;
export const RELIEF_EXPORT_DIM = 2048;

/** Largest useful power-of-two solve size for a dimension, capped. */
export function reliefSolveSize(dim: number, cap: number): number {
  const p = Math.pow(2, Math.round(Math.log2(Math.max(1, dim))));
  return Math.min(cap, p);
}

/** Area-average downsample of a single-channel field to sw*sh. */
export function boxDownsample(
  src: Float32Array,
  w: number,
  h: number,
  sw: number,
  sh: number,
): Float32Array {
  const out = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const y0 = Math.floor((y * h) / sh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / sh));
    for (let x = 0; x < sw; x++) {
      const x0 = Math.floor((x * w) / sw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / sw));
      let sum = 0;
      let count = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          sum += src[yy * w + xx];
          count++;
        }
      }
      out[y * sw + x] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}

/** Bilinear resample of a single-channel field from sw*sh to w*h. */
export function bilinearUpsample(
  src: Float32Array,
  sw: number,
  sh: number,
  w: number,
  h: number,
): Float32Array {
  const out = new Float32Array(w * h);
  const sx = sw > 1 ? (sw - 1) / Math.max(1, w - 1) : 0;
  const sy = sh > 1 ? (sh - 1) / Math.max(1, h - 1) : 0;
  for (let y = 0; y < h; y++) {
    const fy = y * sy;
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = x * sx;
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const a = src[y0 * sw + x0];
      const b = src[y0 * sw + x1];
      const c = src[y1 * sw + x0];
      const d = src[y1 * sw + x1];
      const top = a + (b - a) * tx;
      const bot = c + (d - c) * tx;
      out[y * w + x] = top + (bot - top) * ty;
    }
  }
  return out;
}

/** Resample a single-channel field to sw*sh (box-average down, bilinear up). */
export function resampleField(
  src: Float32Array,
  w: number,
  h: number,
  sw: number,
  sh: number,
): Float32Array {
  return sw <= w && sh <= h
    ? boxDownsample(src, w, h, sw, sh)
    : bilinearUpsample(src, w, h, sw, sh);
}
