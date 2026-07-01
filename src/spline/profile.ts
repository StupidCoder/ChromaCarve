import type { SplinePoint } from '../state/store';

/** Catmull-Rom interpolation of four scalar control values. */
function catmull(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
  );
}

/**
 * Evaluate the profile height at normalized distance x in [0,1]. Points are a
 * Catmull-Rom spline through the (sorted) control points; outside the control
 * range the nearest endpoint value is held.
 */
export function evalProfile(points: SplinePoint[], x: number): number {
  if (points.length === 0) return 0;
  const pts = [...points].sort((a, b) => a.x - b.x);
  if (x <= pts[0].x) return pts[0].y;
  const last = pts[pts.length - 1];
  if (x >= last.x) return last.y;

  let i = 0;
  while (i < pts.length - 1 && pts[i + 1].x <= x) i++;
  const p1 = pts[i];
  const p2 = pts[i + 1];
  const p0 = pts[i - 1] ?? p1;
  const p3 = pts[i + 2] ?? p2;
  const u = (x - p1.x) / (p2.x - p1.x || 1e-6);
  return catmull(p0.y, p1.y, p2.y, p3.y, u);
}

/** Sample the profile into a clamped [0,1] LUT of length n. */
export function sampleProfile(points: SplinePoint[], n: number): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    a[i] = Math.min(1, Math.max(0, evalProfile(points, x)));
  }
  return a;
}
