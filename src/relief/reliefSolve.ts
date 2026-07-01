import { basRelief, type BasReliefParams, type BasReliefResult } from './basRelief';
import { reliefSolveSize, resampleField, bilinearUpsample } from './resample';

/**
 * Solve the bas-relief on a power-of-two grid capped by `cap`: resample the
 * height/mask down to the solve grid, run the solve, and resample the result
 * back up. Reports progress in [0,1]. Pure — runs on the worker or main thread.
 */
export function solveReliefCapped(
  height: Float32Array,
  mask: Float32Array,
  w: number,
  h: number,
  params: BasReliefParams,
  cap: number,
  onProgress?: (frac: number) => void,
): BasReliefResult {
  const sw = reliefSolveSize(w, cap);
  const sh = reliefSolveSize(h, cap);
  const needsResample = sw !== w || sh !== h;
  const sHeight = needsResample ? resampleField(height, w, h, sw, sh) : height;
  const sMask = needsResample ? resampleField(mask, w, h, sw, sh) : mask;

  // Reserve a little headroom at each end for the resample steps.
  const r = basRelief(sHeight, sMask, sw, sh, params, (f) => onProgress?.(0.05 + 0.9 * f));

  if (!needsResample) {
    onProgress?.(1);
    return r;
  }
  const data = bilinearUpsample(r.data, sw, sh, w, h);
  onProgress?.(1);
  return { data, min: r.min, max: r.max };
}
