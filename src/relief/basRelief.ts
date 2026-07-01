import { solvePoisson } from './dct';

/**
 * Gradient-domain bas-relief processing (Weyrich et al., "Digital Bas-Relief
 * from 3D Scenes", SIGGRAPH 2007, building on Fattal et al. 2002 gradient-domain
 * compression). Turns a raw orthographic height field into a flattened,
 * cliff-free relief that preserves fine detail:
 *
 *   1. gradient of h via forward differences (no-flux across the silhouette)
 *   2. gradient magnitude m
 *   3. silhouette / discontinuity removal: suppress gradients where m > tau
 *   4. Fattal attenuation Phi = (m/alpha)^(beta-1) on the remaining gradients
 *   5. modified gradient field G
 *   6. divergence of G
 *   7. Poisson solve (Neumann BC) via the DCT spectral solver
 *   8. normalize to [0,1]
 *
 * Pure and framework-free (no Three.js / DOM), so it is unit-testable in Node.
 * Inputs and outputs are row-major (index = y*w + x), rows bottom-up — matching
 * the pipeline's float readback; orientation is irrelevant to the math.
 */

export interface BasReliefParams {
  /** Fattal exponent in (0,1): <1 compresses large gradients, preserves detail. */
  beta: number;
  /** Wall threshold as a percentile of gradient magnitude (per-image). */
  tauPercentile: number;
  /** Multiplier applied to gradients above tau (0 fully dissolves the wall). */
  wallGamma: number;
  /** alpha = alphaFactor * mean(|gradient|). */
  alphaFactor: number;
}

export interface BasReliefResult {
  /** Processed height, normalized to [0,1] over covered pixels (row-major). */
  data: Float32Array;
  /** Low percentile of the processed height over covered pixels (for stretch). */
  min: number;
  /** High percentile of the processed height over covered pixels (for stretch). */
  max: number;
}

export const DEFAULT_PARAMS: BasReliefParams = {
  beta: 0.85,
  tauPercentile: 0.95,
  wallGamma: 0,
  alphaFactor: 0.1,
};

const EPS = 1e-8;

/** Value of the p-th (0..1) percentile of the covered samples, via a histogram. */
function percentile(values: Float64Array, mask: Float32Array, n: number, p: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (mask[i] < 0.5) continue;
    const v = values[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    count++;
  }
  if (count === 0 || !(hi > lo)) return lo === Infinity ? 0 : lo;
  const BINS = 512;
  const hist = new Int32Array(BINS);
  const scale = (BINS - 1) / (hi - lo);
  for (let i = 0; i < n; i++) {
    if (mask[i] < 0.5) continue;
    const b = Math.min(BINS - 1, Math.max(0, Math.floor((values[i] - lo) * scale)));
    hist[b]++;
  }
  const target = count * p;
  let cum = 0;
  for (let b = 0; b < BINS; b++) {
    cum += hist[b];
    if (cum >= target) return lo + b / scale;
  }
  return hi;
}

/**
 * Run the bas-relief pipeline on a height field. `mask` is the coverage mask
 * (>=0.5 = covered). `w`/`h` are the grid dimensions. Uncovered output pixels
 * are set to 0 (floored); the caller masks them downstream.
 */
export function basRelief(
  height: Float32Array,
  mask: Float32Array,
  w: number,
  h: number,
  params: BasReliefParams,
): BasReliefResult {
  const n = w * h;
  const { beta, tauPercentile, wallGamma, alphaFactor } = params;

  // --- 1. Forward-difference gradients with no-flux across the silhouette. ---
  // gx[x,y] = h[x+1,y]-h[x,y] (0 on the last column or across an uncovered edge).
  const gx = new Float64Array(n);
  const gy = new Float64Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const covered = mask[i] >= 0.5;
      if (x + 1 < w && covered && mask[i + 1] >= 0.5) gx[i] = height[i + 1] - height[i];
      if (y + 1 < h && covered && mask[i + w] >= 0.5) gy[i] = height[i + w] - height[i];
    }
  }

  // --- 2. Gradient magnitude. ---
  const m = new Float64Array(n);
  let sumM = 0;
  let coveredCount = 0;
  for (let i = 0; i < n; i++) {
    m[i] = Math.hypot(gx[i], gy[i]);
    if (mask[i] >= 0.5) {
      sumM += m[i];
      coveredCount++;
    }
  }

  // Flat / empty model: nothing to compress. Return the input as-is so the
  // attenuation (which divides by mean gradient) cannot produce NaN.
  const meanM = coveredCount > 0 ? sumM / coveredCount : 0;
  const alpha = alphaFactor * meanM;
  if (!(alpha > EPS)) {
    return normalizeToResult(height, mask, w, h);
  }

  // --- 3. Wall threshold tau from the gradient-magnitude percentile. ---
  const tau = percentile(m, mask, n, tauPercentile);

  // --- 4 & 5. Suppress silhouette walls (before Fattal), then attenuate. ---
  const Gx = new Float64Array(n);
  const Gy = new Float64Array(n);
  const betaExp = beta - 1;
  for (let i = 0; i < n; i++) {
    const sup = m[i] > tau ? wallGamma : 1;
    const mag = Math.max(m[i] * sup, EPS); // eps guard: Phi diverges as mag->0
    const phi = Math.pow(mag / alpha, betaExp);
    Gx[i] = gx[i] * sup * phi;
    Gy[i] = gy[i] * sup * phi;
  }

  // --- 6. Divergence via matching backward differences. ---
  // div[x,y] = (Gx[x,y]-Gx[x-1,y]) + (Gy[x,y]-Gy[x,y-1]); off-grid terms are 0.
  const div = new Float64Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let d = Gx[i] + Gy[i];
      if (x > 0) d -= Gx[i - 1];
      if (y > 0) d -= Gy[i - w];
      div[i] = d;
    }
  }

  // --- 7. Poisson solve with Neumann BC. ---
  const solved = solvePoisson(div, w, h);

  // --- 8. Normalize to [0,1] over covered pixels. ---
  return normalizeToResult(solved, mask, w, h);
}

/** Min-max normalize the field to [0,1] over covered pixels; floor the rest. */
function normalizeToResult(
  field: ArrayLike<number>,
  mask: Float32Array,
  w: number,
  h: number,
): BasReliefResult {
  const n = w * h;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (mask[i] < 0.5) continue;
    const v = field[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const data = new Float32Array(n);
  if (!(hi > lo)) {
    // Constant surface: keep it flat at 0.5, degenerate stretch range.
    for (let i = 0; i < n; i++) data[i] = mask[i] >= 0.5 ? 0.5 : 0;
    return { data, min: 0, max: 1 };
  }
  const inv = 1 / (hi - lo);
  const norm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = mask[i] >= 0.5 ? (field[i] - lo) * inv : 0;
    norm[i] = v;
    data[i] = v;
  }
  // Percentile range (1st..99th) for the optional downstream depth stretch.
  const min = percentile(norm, mask, n, 0.01);
  const max = percentile(norm, mask, n, 0.99);
  return { data, min, max: max > min ? max : min + 1e-3 };
}
