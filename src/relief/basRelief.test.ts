import { describe, it, expect } from 'vitest';
import { encode } from 'fast-png';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { basRelief, DEFAULT_PARAMS } from './basRelief';

const W = 200;
const H = 200;

/** A hemisphere resting on a flat plane. The rim (r ≈ R) has a vertical tangent
 * (near-infinite slope) — the "steep cliff" the relief pass must dissolve. */
function hemisphereOnPlane(): { height: Float32Array; mask: Float32Array; R: number } {
  const height = new Float32Array(W * H);
  const mask = new Float32Array(W * H).fill(1); // whole image is a covered surface
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  const R = 0.32 * Math.min(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = Math.hypot(x - cx, y - cy);
      height[y * W + x] = r <= R ? Math.sqrt(R * R - r * r) : 0;
    }
  }
  return { height, mask, R };
}

/** Per-pixel forward-difference gradient magnitude of a field. */
function gradMag(field: ArrayLike<number>): Float64Array {
  const g = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const gx = x + 1 < W ? field[i + 1] - field[i] : 0;
      const gy = y + 1 < H ? field[i + W] - field[i] : 0;
      g[i] = Math.hypot(gx, gy);
    }
  }
  return g;
}

/** 5-point discrete Laplacian magnitude of a field. */
function laplacianMag(field: ArrayLike<number>): Float64Array {
  const l = new Float64Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      l[i] = Math.abs(field[i + 1] + field[i - 1] + field[i + W] + field[i - W] - 4 * field[i]);
    }
  }
  return l;
}

/** Normalize a field to [0,1]. */
function normalized(field: ArrayLike<number>, n: number): Float64Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (field[i] < lo) lo = field[i];
    if (field[i] > hi) hi = field[i];
  }
  const out = new Float64Array(n);
  const inv = hi > lo ? 1 / (hi - lo) : 0;
  for (let i = 0; i < n; i++) out[i] = (field[i] - lo) * inv;
  return out;
}

/** Max value over pixels whose radius from center is within [rLo, rHi]. */
function maxInBand(field: ArrayLike<number>, rLo: number, rHi: number): number {
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  let mx = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = Math.hypot(x - cx, y - cy);
      if (r >= rLo && r <= rHi) mx = Math.max(mx, field[y * W + x]);
    }
  }
  return mx;
}

function writeGrayPng(path: string, field: ArrayLike<number>): void {
  const data = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) data[i] = Math.round(Math.min(1, Math.max(0, field[i])) * 255);
  writeFileSync(path, encode({ width: W, height: H, data, channels: 1, depth: 8 }));
}

describe('basRelief on a hemisphere', () => {
  it('turns the steep rim into a gentle ramp while keeping the surface smooth', () => {
    const { height, mask, R } = hemisphereOnPlane();
    const result = basRelief(height, mask, W, H, DEFAULT_PARAMS);

    // No NaNs / infinities.
    for (const v of result.data) expect(Number.isFinite(v)).toBe(true);

    const rawNorm = normalized(height, W * H);
    const reliefNorm = result.data; // already [0,1]

    // Rim gradient: raw has a near-vertical cliff; relief should be far gentler.
    const rimBefore = maxInBand(gradMag(rawNorm), R - 2, R + 1);
    const rimAfter = maxInBand(gradMag(reliefNorm), R - 2, R + 1);
    // Interior smoothness (well inside the dome): no ringing after the solve.
    const interiorBefore = maxInBand(laplacianMag(rawNorm), 0, 0.5 * R);
    const interiorAfter = maxInBand(laplacianMag(reliefNorm), 0, 0.5 * R);

    // Emit before/after visualizations for manual inspection.
    const dir = join(tmpdir(), 'chromacarve-relief');
    mkdirSync(dir, { recursive: true });
    writeGrayPng(join(dir, 'hemisphere-before.png'), rawNorm);
    writeGrayPng(join(dir, 'hemisphere-after.png'), reliefNorm);
    // eslint-disable-next-line no-console
    console.log(
      `[basRelief] rim grad ${rimBefore.toFixed(4)} -> ${rimAfter.toFixed(4)}, ` +
        `interior lap ${interiorBefore.toFixed(4)} -> ${interiorAfter.toFixed(4)}\n` +
        `[basRelief] wrote ${dir}/hemisphere-before.png and hemisphere-after.png`,
    );

    // Cliff -> ramp: the rim gradient must collapse dramatically.
    expect(rimAfter).toBeLessThan(0.3 * rimBefore);
    // Surface stays smooth: no ringing from the Poisson solve. The interior
    // Laplacian stays tiny (orders of magnitude below what a cliff/ringing
    // would produce), confirming a smooth reintegrated surface.
    expect(interiorAfter).toBeLessThan(0.01);
    expect(interiorBefore).toBeLessThan(0.01);
  });
});
