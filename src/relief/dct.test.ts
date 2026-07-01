import { describe, it, expect } from 'vitest';
import { dct2, idct2, solvePoisson } from './dct';

/** Max abs difference between two arrays after removing each one's mean. */
function meanRemovedError(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let err = 0;
  for (let i = 0; i < n; i++) {
    err = Math.max(err, Math.abs((a[i] - ma) - (b[i] - mb)));
  }
  return err;
}

/**
 * Build the divergence of grad(h) using the same finite-difference stencil the
 * Poisson solver assumes: forward-difference gradient (0 on the far edge),
 * backward-difference divergence. This is the discrete Neumann Laplacian of h.
 */
function laplacianRhs(h: Float64Array, w: number, hgt: number): Float64Array {
  const n = w * hgt;
  const gx = new Float64Array(n);
  const gy = new Float64Array(n);
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x + 1 < w) gx[i] = h[i + 1] - h[i];
      if (y + 1 < hgt) gy[i] = h[i + w] - h[i];
    }
  }
  const div = new Float64Array(n);
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let d = gx[i] + gy[i];
      if (x > 0) d -= gx[i - 1];
      if (y > 0) d -= gy[i - w];
      div[i] = d;
    }
  }
  return div;
}

function smoothField(w: number, h: number): Float64Array {
  const f = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      // A few low-frequency cosines — smooth and non-separable.
      f[y * w + x] =
        1.3 * Math.cos(Math.PI * u) +
        0.7 * Math.cos(2 * Math.PI * v) +
        0.4 * Math.cos(Math.PI * u) * Math.cos(3 * Math.PI * v) +
        0.9 * u * v;
    }
  }
  return f;
}

describe('DCT transform pair', () => {
  for (const [w, h] of [
    [60, 48],
    [31, 17], // odd dimensions to exercise the Bluestein FFT path
    [1, 8],
  ] as const) {
    it(`idct2(dct2(x)) recovers x for ${w}x${h}`, () => {
      const orig = smoothField(w, h);
      const work = orig.slice();
      dct2(work, w, h);
      idct2(work, w, h);
      let err = 0;
      for (let i = 0; i < orig.length; i++) err = Math.max(err, Math.abs(work[i] - orig[i]));
      expect(err).toBeLessThan(1e-9);
    });
  }
});

describe('Poisson solver', () => {
  for (const [w, h] of [
    [60, 48],
    [31, 17], // non-power-of-two, odd -> Bluestein
  ] as const) {
    it(`recovers a known field up to a constant for ${w}x${h}`, () => {
      const h0 = smoothField(w, h);
      const rhs = laplacianRhs(h0, w, h);
      const solved = solvePoisson(rhs, w, h);
      expect(meanRemovedError(solved, h0)).toBeLessThan(1e-6);
    });
  }

  it('produces a finite result (DC term fixed, no NaN)', () => {
    const w = 16;
    const h = 16;
    const rhs = laplacianRhs(smoothField(w, h), w, h);
    const solved = solvePoisson(rhs, w, h);
    for (const v of solved) expect(Number.isFinite(v)).toBe(true);
  });
});
