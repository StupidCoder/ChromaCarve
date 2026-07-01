import { solvePoisson } from './dct';

/**
 * Gradient-domain bas-relief (Weyrich et al. 2007 / Fattal et al. 2002). Turns a
 * raw orthographic height field into a compressed, detail-preserving relief that
 * emerges cleanly from a flat base — the object fades smoothly to the background
 * at every silhouette, with no cliffs and with thin features (legs) preserved:
 *
 *   1. gradient of h over the interior (forward differences, both endpoints
 *      covered) — the outer silhouette wall is NOT included; emergence is handled
 *      by the boundary condition, not by a wall gradient
 *   2. gradient magnitude m
 *   3. Fattal attenuation Phi = (m/alpha)^(beta-1): compresses large gradients
 *      (the overall form, self-occlusion steps) while preserving/amplifying small
 *      ones (surface detail)
 *   4. modified gradient field G = grad(h) * Phi
 *   5. divergence of G
 *   6. DIRICHLET Poisson solve (background pinned to 0) via CG preconditioned by
 *      the DCT Neumann solver — the object rises from the base at the silhouette,
 *      thin features keep their center height
 *   7. edge-fade envelope: ramp the relief to 0 over a short band at the
 *      silhouette so it fades smoothly to full black
 *   8. normalize to [0,1]
 *
 * Pure and framework-free (no Three.js / DOM), so it is unit-testable in Node.
 * Row-major (index = y*w + x); orientation is irrelevant to the math.
 */

export interface BasReliefParams {
  /** Fattal exponent in (0,1): lower = stronger form compression + more detail. */
  beta: number;
  /** alpha = alphaFactor * mean(interior gradient magnitude). */
  alphaFactor: number;
  /** Silhouette fade width as a fraction of the smaller grid dimension. */
  emergeFrac: number;
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
  beta: 0.5,
  alphaFactor: 0.18,
  emergeFrac: 0.015,
};

const EPS = 1e-8;
const MEMBER = 0.5; // coverage threshold for foreground membership
const PCG_MAX_ITERS = 40; // DCT-preconditioned CG converges fast
const PCG_TOL = 1e-3; // relative residual — visually exact, far fewer iters

/** Value of the p-th (0..1) percentile of the covered samples, via a histogram. */
function percentile(values: Float64Array, mask: Float32Array, n: number, p: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (mask[i] < MEMBER) continue;
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
    if (mask[i] < MEMBER) continue;
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

/** Chamfer distance (px) from the background, over covered pixels. */
function edgeDistance(cov: Uint8Array, w: number, h: number): Float32Array {
  const n = w * h;
  const d = new Float32Array(n);
  const BIG = 1e9;
  for (let i = 0; i < n; i++) d[i] = cov[i] ? BIG : 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!cov[i]) continue;
      let b = d[i];
      if (x > 0) b = Math.min(b, d[i - 1] + 1);
      if (y > 0) b = Math.min(b, d[i - w] + 1);
      if (x > 0 && y > 0) b = Math.min(b, d[i - w - 1] + 1.4142);
      if (x + 1 < w && y > 0) b = Math.min(b, d[i - w + 1] + 1.4142);
      d[i] = b;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!cov[i]) continue;
      let b = d[i];
      if (x + 1 < w) b = Math.min(b, d[i + 1] + 1);
      if (y + 1 < h) b = Math.min(b, d[i + w] + 1);
      if (x + 1 < w && y + 1 < h) b = Math.min(b, d[i + w + 1] + 1.4142);
      if (x > 0 && y + 1 < h) b = Math.min(b, d[i + w - 1] + 1.4142);
      d[i] = b;
    }
  return d;
}

/**
 * Solve the Dirichlet Poisson system (Laplacian u = -b inside the object, u = 0
 * on the background) with CG preconditioned by the DCT Neumann solver. `b` is the
 * negative divergence on covered pixels. Converges in a handful of DCT solves.
 */
function solveDirichlet(
  b: Float64Array,
  cov: Uint8Array,
  w: number,
  h: number,
  onProgress?: (frac: number) => void,
): Float64Array {
  const n = w * h;
  const applyA = (v: Float64Array, out: Float64Array) => {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!cov[i]) {
          out[i] = 0;
          continue;
        }
        let s = 4 * v[i];
        if (x > 0 && cov[i - 1]) s -= v[i - 1];
        if (x + 1 < w && cov[i + 1]) s -= v[i + 1];
        if (y > 0 && cov[i - w]) s -= v[i - w];
        if (y + 1 < h && cov[i + w]) s -= v[i + w];
        out[i] = s;
      }
  };
  // Preconditioner: DCT Neumann solve on the full grid (approximates A^-1).
  const rhs = new Float64Array(n);
  const applyMinv = (r: Float64Array, out: Float64Array) => {
    for (let i = 0; i < n; i++) rhs[i] = cov[i] ? -r[i] : 0;
    const sol = solvePoisson(rhs, w, h);
    for (let i = 0; i < n; i++) out[i] = cov[i] ? -sol[i] : 0;
  };
  const u = new Float64Array(n);
  const r = new Float64Array(n);
  const z = new Float64Array(n);
  const p = new Float64Array(n);
  const Ap = new Float64Array(n);
  let r0 = 0;
  for (let i = 0; i < n; i++) {
    r[i] = cov[i] ? b[i] : 0;
    r0 += r[i] * r[i];
  }
  if (r0 < EPS) return u;
  applyMinv(r, z);
  for (let i = 0; i < n; i++) p[i] = z[i];
  let rz = 0;
  for (let i = 0; i < n; i++) rz += r[i] * z[i];
  for (let it = 0; it < PCG_MAX_ITERS; it++) {
    if (onProgress) onProgress(it / PCG_MAX_ITERS);
    applyA(p, Ap);
    let pAp = 0;
    for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
    const a = rz / (pAp || 1e-30);
    let rr = 0;
    for (let i = 0; i < n; i++) {
      u[i] += a * p[i];
      r[i] -= a * Ap[i];
      rr += r[i] * r[i];
    }
    if (rr < PCG_TOL * PCG_TOL * r0) break;
    applyMinv(r, z);
    let rzNew = 0;
    for (let i = 0; i < n; i++) rzNew += r[i] * z[i];
    const bt = rzNew / (rz || 1e-30);
    for (let i = 0; i < n; i++) p[i] = z[i] + bt * p[i];
    rz = rzNew;
  }
  return u;
}

/**
 * Run the bas-relief pipeline on a height field. `mask` is the coverage mask
 * (>=0.5 = covered). Uncovered output pixels are set to 0 (floored).
 */
export function basRelief(
  height: Float32Array,
  mask: Float32Array,
  w: number,
  h: number,
  params: BasReliefParams,
  onProgress?: (frac: number) => void,
): BasReliefResult {
  const n = w * h;
  const { beta, alphaFactor, emergeFrac } = params;
  const cov = new Uint8Array(n);
  for (let i = 0; i < n; i++) cov[i] = mask[i] >= MEMBER ? 1 : 0;

  // --- 1. Interior forward-difference gradients (both endpoints covered). ---
  const gx = new Float64Array(n);
  const gy = new Float64Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!cov[i]) continue;
      if (x + 1 < w && cov[i + 1]) gx[i] = height[i + 1] - height[i];
      if (y + 1 < h && cov[i + w]) gy[i] = height[i + w] - height[i];
    }
  }

  // --- 2. Magnitude + mean (Fattal reference level). ---
  const m = new Float64Array(n);
  let sumM = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    m[i] = Math.hypot(gx[i], gy[i]);
    if (cov[i]) {
      sumM += m[i];
      count++;
    }
  }
  const alpha = alphaFactor * (count > 0 ? sumM / count : 0);
  if (!(alpha > EPS)) return normalizeToResult(height, mask, cov, w, h); // flat model

  // --- 3 & 4. Fattal attenuation. ---
  const Gx = new Float64Array(n);
  const Gy = new Float64Array(n);
  const betaExp = beta - 1;
  for (let i = 0; i < n; i++) {
    const phi = Math.pow(Math.max(m[i], EPS) / alpha, betaExp);
    Gx[i] = gx[i] * phi;
    Gy[i] = gy[i] * phi;
  }

  // --- 5. b = -divergence(G) on covered pixels. ---
  const b = new Float64Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!cov[i]) continue;
      let d = Gx[i] + Gy[i];
      if (x > 0) d -= Gx[i - 1];
      if (y > 0) d -= Gy[i - w];
      b[i] = -d;
    }
  }

  // --- 6. Dirichlet Poisson solve (background = 0). ---
  const u = solveDirichlet(b, cov, w, h, onProgress);

  // --- 7. Edge-fade envelope: smoothly ramp to 0 at the silhouette. ---
  const emergePx = Math.max(1, emergeFrac * Math.min(w, h));
  const dist = edgeDistance(cov, w, h);
  for (let i = 0; i < n; i++) {
    if (!cov[i]) continue;
    const t = Math.min(1, dist[i] / emergePx);
    u[i] *= t * t * (3 - 2 * t); // smoothstep
  }

  // --- 8. Normalize to [0,1] over covered pixels. ---
  return normalizeToResult(u, mask, cov, w, h);
}

/** Min-max normalize the field to [0,1] over covered pixels; floor the rest. */
function normalizeToResult(
  field: ArrayLike<number>,
  mask: Float32Array,
  cov: Uint8Array,
  w: number,
  h: number,
): BasReliefResult {
  const n = w * h;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!cov[i]) continue;
    const v = field[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const data = new Float32Array(n);
  if (!(hi > lo)) {
    for (let i = 0; i < n; i++) data[i] = cov[i] ? 0.5 : 0;
    return { data, min: 0, max: 1 };
  }
  const inv = 1 / (hi - lo);
  const norm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = cov[i] ? (field[i] - lo) * inv : 0;
    norm[i] = v;
    data[i] = v;
  }
  const min = percentile(norm, mask, n, 0.01);
  const max = percentile(norm, mask, n, 0.99);
  return { data, min, max: max > min ? max : min + 1e-3 };
}
