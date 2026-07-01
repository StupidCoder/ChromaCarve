import { describe, it, expect } from 'vitest';
import { encode } from 'fast-png';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { basRelief, DEFAULT_PARAMS } from './basRelief';

const W = 200;
const H = 200;
const OUT_DIR = join(tmpdir(), 'chromacarve-relief');

/** Rasterize a scene at 2x and box-downsample -> soft anti-aliased mask. */
function rasterize(
  fn: (nx: number, ny: number) => { h: number; covered: boolean },
): { height: Float32Array; mask: Float32Array } {
  const SS = 2;
  const RW = W * SS;
  const RH = H * SS;
  const height = new Float32Array(W * H);
  const mask = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sh = 0;
      let sm = 0;
      for (let dy = 0; dy < SS; dy++)
        for (let dx = 0; dx < SS; dx++) {
          const s = fn((x * SS + dx) / RW, (y * SS + dy) / RH);
          if (s.covered) {
            sh += s.h;
            sm += 1;
          }
        }
      height[y * W + x] = sh / (SS * SS);
      mask[y * W + x] = sm / (SS * SS);
    }
  return { height, mask };
}

function meanInRect(f: ArrayLike<number>, x0: number, x1: number, y0: number, y1: number): number {
  let s = 0;
  let c = 0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      s += f[y * W + x];
      c++;
    }
  return c > 0 ? s / c : 0;
}

/** Mean of the covered pixels lying within `band` px inside the silhouette. */
function edgeBandMean(data: ArrayLike<number>, mask: Float32Array, band: number): number {
  let s = 0;
  let c = 0;
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (mask[i] < 0.5) continue;
      // near-edge if a neighbor within `band` is background
      let near = false;
      for (let d = 1; d <= band && !near; d++) {
        if (
          mask[i - d] < 0.5 ||
          mask[i + d] < 0.5 ||
          mask[i - d * W] < 0.5 ||
          mask[i + d * W] < 0.5
        )
          near = true;
      }
      if (near) {
        s += data[i];
        c++;
      }
    }
  return c > 0 ? s / c : 0;
}

function writeGrayPng(name: string, field: ArrayLike<number>): void {
  const data = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) data[i] = Math.round(Math.min(1, Math.max(0, field[i])) * 255);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, name), encode({ width: W, height: H, data, channels: 1, depth: 8 }));
}

describe('basRelief emergence', () => {
  it('makes a domed object emerge from the base (edges fade to ~0)', () => {
    // Domed disc (peak 0.85 centre, 0.35 rim) with a hard silhouette to the bg.
    const { height, mask } = rasterize((nx, ny) => {
      const r = Math.hypot(nx - 0.5, ny - 0.5) / 0.32;
      return r <= 1 ? { h: 0.35 + 0.5 * Math.sqrt(1 - r * r), covered: true } : { h: 0, covered: false };
    });
    const { data } = basRelief(height, mask, W, H, DEFAULT_PARAMS);
    for (const v of data) expect(Number.isFinite(v)).toBe(true);

    const edge = edgeBandMean(data, mask, 2);
    const centerPeak = meanInRect(data, 90, 110, 90, 110);
    writeGrayPng('emerge-before.png', height);
    writeGrayPng('emerge-after.png', data);
    // Silhouette fades to the base; the interior rises well above it.
    expect(edge).toBeLessThan(0.2);
    expect(centerPeak).toBeGreaterThan(0.5);
  });

  it('emerges a TALL-edge object without a cliff (the head case)', () => {
    // Disc whose height ramps high toward the TOP edge — the outline sits on a
    // tall feature. Both the tall top and the low bottom must fade to the base.
    const RN = 0.32;
    const { height, mask } = rasterize((nx, ny) => {
      const r = Math.hypot(nx - 0.5, ny - 0.5) / RN;
      if (r > 1) return { h: 0, covered: false };
      return { h: 0.2 + 0.7 * (1 - (ny - (0.5 - RN)) / (2 * RN)), covered: true };
    });
    const { data } = basRelief(height, mask, W, H, DEFAULT_PARAMS);
    writeGrayPng('tall-before.png', height);
    writeGrayPng('tall-after.png', data);
    // The whole silhouette — including the TALL top — fades to the base, so no
    // edge is a bright cliff. (Raw: the top edge is ~0.9 hard against the bg.)
    const edge = edgeBandMean(data, mask, 2);
    const interiorPeak = meanInRect(data, 85, 115, 55, 75); // upper interior (tallest)
    expect(edge).toBeLessThan(0.2);
    expect(interiorPeak).toBeGreaterThan(0.5);
  });

  it('preserves a thin feature (it keeps its center height)', () => {
    // A thin horizontal bar (12 px tall) plus a thick block — both on background.
    const { height, mask } = rasterize((nx, ny) => {
      const inBar = nx > 0.2 && nx < 0.8 && ny > 0.45 && ny < 0.51;
      const inBlock = nx > 0.35 && nx < 0.65 && ny > 0.6 && ny < 0.9;
      if (inBar || inBlock) return { h: 0.6, covered: true };
      return { h: 0, covered: false };
    });
    const { data } = basRelief(height, mask, W, H, DEFAULT_PARAMS);
    const barCenter = meanInRect(data, 90, 110, 95, 97);
    // The thin bar still emerges above the base at its center (not erased).
    expect(barCenter).toBeGreaterThan(0.15);
  });

  it('enhances fine surface detail rather than washing it out', () => {
    // A domed disc with fine ripples. After relief the ripple contrast should be
    // clearly present in the interior (Fattal amplifies small gradients).
    const { height, mask } = rasterize((nx, ny) => {
      const r = Math.hypot(nx - 0.5, ny - 0.5) / 0.34;
      if (r > 1) return { h: 0, covered: false };
      const form = 0.4 + 0.4 * Math.sqrt(1 - r * r);
      const detail = 0.03 * Math.sin(nx * 90) * Math.sin(ny * 90);
      return { h: form + detail, covered: true };
    });
    const { data } = basRelief(height, mask, W, H, DEFAULT_PARAMS);
    // local variation (detail) in an interior patch away from the silhouette
    let sum = 0;
    let sumSq = 0;
    let c = 0;
    for (let y = 90; y <= 110; y++)
      for (let x = 90; x <= 110; x++) {
        const v = data[y * W + x];
        sum += v;
        sumSq += v * v;
        c++;
      }
    const std = Math.sqrt(sumSq / c - (sum / c) ** 2);
    expect(std).toBeGreaterThan(0.02); // detail is visibly present
  });
});
