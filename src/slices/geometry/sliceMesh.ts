import { buildContours, PointWelder } from './contours';
import { validSliceSetup, type Point2, type Point3, type SliceInput, type SliceIssue, type SliceLayer, type SliceProgress, type SliceResult } from './types';

export const MAX_SLICE_LAYERS = 2000;
export const MAX_SLICE_TRIANGLES = 1_000_000;

/** Center full-thickness slabs around the model; sample offset never moves slabs. */
export function planLayers(min: number, max: number, thickness: number, offset = 0) {
  if (![min, max, thickness, offset].every(Number.isFinite) || max <= min || thickness <= 0 || Math.abs(offset) > thickness / 2) {
    throw new Error('Layer dimensions and sampling offset are invalid.');
  }
  // Absorb floating-point roundoff at exact multiples, not a physical fraction of a layer.
  const count = Math.max(1, Math.ceil((max - min) / thickness - 1e-10));
  if (count > MAX_SLICE_LAYERS) throw new Error(`This setup needs ${count.toLocaleString()} layers. Increase plywood thickness or reduce the model size (limit ${MAX_SLICE_LAYERS}).`);
  const stack = count * thickness;
  const bottom = (min + max - stack) / 2;
  return { count, stack, bottom, firstSample: bottom + thickness / 2 + offset };
}

interface Triangle { a: number; b: number; c: number; min: number; max: number }
const difference = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Point3, b: Point3): Point3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function intersection(triangle: Triangle, points: Point3[], plane: number, epsilon: number): [Point2, Point2] | undefined {
  const vertices = [points[triangle.a], points[triangle.b], points[triangle.c]];
  // Half-open convention: vertices on the plane belong to the negative side.
  // Coplanar faces contribute nothing; incident faces bound the positive-side limit.
  const distances = vertices.map((p) => Math.abs(p[2] - plane) <= epsilon ? 0 : p[2] - plane);
  const hits: Point2[] = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    if ((distances[i] > 0) === (distances[j] > 0)) continue;
    const t = distances[i] / (distances[i] - distances[j]);
    hits.push([vertices[i][0] + t * (vertices[j][0] - vertices[i][0]), vertices[i][1] + t * (vertices[j][1] - vertices[i][1])]);
  }
  if (hits.length !== 2 || Math.hypot(hits[0][0] - hits[1][0], hits[0][1] - hits[1][1]) <= epsilon) return;
  const normal = cross(difference(vertices[1], vertices[0]), difference(vertices[2], vertices[0]));
  const forward = (hits[1][0] - hits[0][0]) * -normal[1] + (hits[1][1] - hits[0][1]) * normal[0];
  return forward >= 0 ? [hits[0], hits[1]] : [hits[1], hits[0]];
}

/** Pure, deterministic engine. Production callers run this exclusively in a worker. */
export function sliceMesh(input: SliceInput, progress: (value: SliceProgress) => void = () => {}): SliceResult {
  const { positions, indices, setup } = input;
  if (!validSliceSetup(setup)) throw new Error('The physical model settings are invalid.');
  const vertexCount = positions.length / 3;
  const triangleCount = (indices?.length ?? vertexCount) / 3;
  if (!vertexCount || positions.length % 3 || triangleCount % 1 || !triangleCount) throw new Error('The model contains no complete triangles.');
  if (triangleCount > MAX_SLICE_TRIANGLES) throw new Error(`Simplify this model to ${MAX_SLICE_TRIANGLES.toLocaleString()} triangles or fewer before slicing.`);
  const sourceMin: Point3 = [Infinity, Infinity, Infinity], sourceMax: Point3 = [-Infinity, -Infinity, -Infinity];
  progress({ fraction: 0, phase: 'Preparing model' });
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) throw new Error('The model contains invalid vertex coordinates.');
    sourceMin[i % 3] = Math.min(sourceMin[i % 3], positions[i]);
    sourceMax[i % 3] = Math.max(sourceMax[i % 3], positions[i]);
  }
  const longest = Math.max(...sourceMax.map((n, i) => n - sourceMin[i]));
  if (longest <= 0) throw new Error('The model has no measurable size.');
  const scale = setup.sizeMm / longest;
  const center = sourceMin.map((n, i) => (n + sourceMax[i]) / 2);
  const [rx, ry, rz] = setup.rotationDeg.map((n) => n * Math.PI / 180);
  const a = Math.cos(rx), b = Math.sin(rx), c = Math.cos(ry), d = Math.sin(ry), e = Math.cos(rz), f = Math.sin(rz);
  const min: Point3 = [Infinity, Infinity, Infinity], max: Point3 = [-Infinity, -Infinity, -Infinity];
  // Scale-relative tolerance in physical mm. Never silently bridge fabrication-sized gaps.
  const epsilon = Math.max(1e-8, setup.sizeMm * 1e-7);
  const weld = new PointWelder(epsilon);
  const vertexIds = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const x = (positions[i * 3] - center[0]) * scale, y = (positions[i * 3 + 1] - center[1]) * scale, z = (positions[i * 3 + 2] - center[2]) * scale;
    // XYZ Euler rotation, then right-handed slice frame (X, -Z, Y).
    const point: Point3 = [c * e * x - c * f * y + d * z,
      -((b * f - a * e * d) * x + (b * e + a * f * d) * y + a * c * z),
      (a * f + b * e * d) * x + (a * e - b * f * d) * y - b * c * z];
    vertexIds[i] = weld.add(point);
    point.forEach((value, axis) => { min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value); });
    if (i % 8192 === 0) progress({ fraction: 0.2 * i / vertexCount, phase: 'Preparing model' });
  }
  if (max[2] - min[2] <= epsilon) throw new Error('The model has no thickness along the stack direction. Rotate it or choose a solid model.');
  const plan = planLayers(min[2], max[2], setup.thicknessMm, setup.samplingOffsetMm);
  const triangles: Triangle[] = [];
  const edges = new Map<string, { count: number; direction: number }>();
  const issues: SliceIssue[] = [];
  let degenerate = 0;
  for (let t = 0; t < triangleCount; t++) {
    const ids = [0, 1, 2].map((j) => {
      const index = indices ? indices[t * 3 + j] : t * 3 + j;
      if (index >= vertexCount) throw new Error('The model contains an invalid triangle index.');
      return vertexIds[index];
    });
    const [a, b, c] = ids;
    const p = weld.points[a], q = weld.points[b], r = weld.points[c];
    const normal = cross(difference(q, p), difference(r, p));
    if (new Set(ids).size < 3 || Math.hypot(...normal) <= epsilon * epsilon) { degenerate++; continue; }
    triangles.push({ a, b, c, min: Math.min(p[2], q[2], r[2]), max: Math.max(p[2], q[2], r[2]) });
    for (let j = 0; j < 3; j++) {
      const start = ids[j], end = ids[(j + 1) % 3];
      const key = start < end ? `${start}:${end}` : `${end}:${start}`;
      const direction = start < end ? 1 : -1;
      const edge = edges.get(key);
      if (edge) { edge.count++; edge.direction += direction; }
      else edges.set(key, { count: 1, direction });
    }
    if (t % 8192 === 0) progress({ fraction: 0.2 + 0.2 * t / triangleCount, phase: 'Checking mesh boundaries' });
  }
  let open = 0, nonManifold = 0, inconsistent = 0;
  for (const edge of edges.values()) {
    if (edge.count === 1) open++;
    else if (edge.count > 2) nonManifold++;
    else if (edge.direction !== 0) inconsistent++;
  }
  if (open) issues.push({ code: 'open-mesh', severity: 'error', message: `${open.toLocaleString()} open mesh edges. Close the holes before using these sections for fabrication.` });
  if (nonManifold) issues.push({ code: 'non-manifold', severity: 'error', message: `${nonManifold.toLocaleString()} edges have more than two faces. Repair touching or duplicate surfaces.` });
  if (inconsistent) issues.push({ code: 'winding', severity: 'error', message: `${inconsistent.toLocaleString()} edges have inconsistent face orientation. Repair the mesh normals.` });
  if (degenerate) issues.push({ code: 'degenerate-triangles', severity: 'error', message: `${degenerate.toLocaleString()} collapsed triangles were excluded. Repair or simplify the mesh before fabrication.` });
  if (!triangles.length) throw new Error('No usable triangles remain after mesh validation.');
  // Sweep in plane order: visit only triangles that can intersect each layer.
  const ordered = triangles.sort((a, b) => a.min - b.min);
  const active = new Set<Triangle>();
  let next = 0, totalSegments = 0, intersections = 0;
  const layers: SliceLayer[] = [];
  for (let index = 0; index < plan.count; index++) {
    const sampleMm = plan.firstSample + index * setup.thicknessMm;
    while (next < ordered.length && ordered[next].min <= sampleMm + epsilon) active.add(ordered[next++]);
    const segments: [Point2, Point2][] = [];
    for (const triangle of active) {
      if (triangle.max < sampleMm - epsilon) { active.delete(triangle); continue; }
      if (++intersections > 30_000_000) throw new Error('This setup is too detailed to slice in the browser. Increase thickness or simplify the model.');
      const segment = intersection(triangle, weld.points, sampleMm, epsilon);
      if (segment) segments.push(segment);
    }
    totalSegments += segments.length;
    if (totalSegments > 2_000_000) throw new Error('This setup produces too many contour segments. Increase thickness or simplify the model.');
    const contours = buildContours(segments, epsilon, index);
    if (contours.error) issues.push({ code: contours.code!, severity: 'error', layer: index, message: contours.error });
    layers.push({ index, sampleMm, bottomMm: plan.bottom + index * setup.thicknessMm,
      topMm: plan.bottom + (index + 1) * setup.thicknessMm, pieces: contours.pieces, valid: !contours.error,
      ...(contours.error ? { invalidSegments: segments } : {}) });
    progress({ fraction: 0.4 + 0.6 * (index + 1) / plan.count, phase: `Slicing layer ${index + 1} of ${plan.count}` });
  }
  const populated = layers.filter((layer) => layer.pieces.length);
  const emptyLayers = layers.filter((layer) => layer.valid && !layer.pieces.length).length;
  if (emptyLayers) issues.push({ code: 'empty-layers', severity: 'warning', message: `${emptyLayers} layer${emptyLayers === 1 ? ' has' : 's have'} no pieces. Empty layers retain their position; adjust the sampling offset, orientation or thickness if this creates a gap.` });
  if (!populated.length) issues.push({ code: 'no-pieces', severity: 'error', message: 'No usable pieces were generated. Adjust the setup or repair the model.' });
  return {
    layers, bounds: { min, max }, modelSizeMm: [max[0] - min[0], max[2] - min[2], max[1] - min[1]],
    plannedStackMm: plan.stack,
    occupiedStackMm: populated.length ? populated[populated.length - 1].topMm - populated[0].bottomMm : 0,
    pieceCount: populated.reduce((count, layer) => count + layer.pieces.length, 0), emptyLayers,
    valid: !issues.some((issue) => issue.severity === 'error'), issues,
  };
}
