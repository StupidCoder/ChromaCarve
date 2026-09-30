import type { Point2, Point3, SlicePiece } from './types';

/** Tolerance-aware welding checks neighboring cells, including hash boundaries. */
export class PointWelder {
  readonly points: Point3[] = [];
  private cells = new Map<string, number[]>();
  constructor(readonly epsilon: number) {}
  add(point: Point3): number {
    const [x, y, z] = point.map((n) => Math.floor(n / this.epsilon));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const nearby = this.cells.get(`${x + dx},${y + dy},${z + dz}`);
      if (nearby) for (const id of nearby) {
        const p = this.points[id];
        if (Math.hypot(point[0] - p[0], point[1] - p[1], point[2] - p[2]) <= this.epsilon) return id;
      }
    }
    const id = this.points.length;
    this.points.push(point);
    const key = `${x},${y},${z}`;
    const cell = this.cells.get(key);
    if (cell) cell.push(id); else this.cells.set(key, [id]);
    return id;
  }
}

export const signedArea = (ring: Point2[]) => ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0) / 2;

function contains(ring: Point2[], point: Point2) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

const cross = (a: Point2, b: Point2, c: Point2) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function simplify(ring: Point2[], epsilon: number): Point2[] {
  return ring.filter((b, i) => {
    const a = ring[(i + ring.length - 1) % ring.length], c = ring[(i + 1) % ring.length];
    // Remove only numerically collinear triangle-edge subdivisions. Using the
    // welding distance here would erase every vertex of a densely sampled arc.
    const tolerance = 1e-10 * Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]);
    return Math.abs(cross(a, c, b)) > tolerance
      || (b[0] - a[0]) * (b[0] - c[0]) + (b[1] - a[1]) * (b[1] - c[1]) > epsilon * epsilon;
  });
}

/** Reject intersections and touching rings before using point containment. */
function intersectingRings(rings: Point2[][], epsilon: number): boolean {
  const edges = rings.flatMap((ring, r) => ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    return { a, b, r, i, minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]) };
  })).sort((a, b) => a.minX - b.minX);
  let comparisons = 0;
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i];
    for (let j = i + 1; j < edges.length && edges[j].minX <= a.maxX + epsilon; j++) {
      if (++comparisons > 5_000_000) throw new Error('Contours are too complex to validate. Simplify the model and try again.');
      const b = edges[j];
      if (a.maxY < b.minY - epsilon || b.maxY < a.minY - epsilon) continue;
      const distance = Math.abs(a.i - b.i);
      if (a.r === b.r && (distance === 1 || distance === rings[a.r].length - 1)) continue;
      const toleranceA = epsilon * Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1]);
      const toleranceB = epsilon * Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1]);
      const side = (v: number, t: number) => v > t ? 1 : v < -t ? -1 : 0;
      if (side(cross(a.a, a.b, b.a), toleranceA) * side(cross(a.a, a.b, b.b), toleranceA) <= 0
        && side(cross(b.a, b.b, a.a), toleranceB) * side(cross(b.a, b.b, a.b), toleranceB) <= 0) return true;
    }
  }
  return false;
}

export interface ContourResult { pieces: SlicePiece[]; error?: string; code?: string }

/** Segment direction follows plane-normal × surface-normal; it preserves shell orientation. */
export function buildContours(segments: [Point2, Point2][], epsilon: number, layer: number): ContourResult {
  const weld = new PointWelder(epsilon);
  const edges = new Map<string, { a: number; b: number; count: number }>();
  for (const [p, q] of segments) {
    const a = weld.add([p[0], p[1], 0]), b = weld.add([q[0], q[1], 0]);
    if (a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const edge = edges.get(key);
    if (edge) edge.count++; else edges.set(key, { a, b, count: 1 });
  }
  // At a plane-aligned tangent edge, both triangles above it emit the same
  // segment. They cancel: the positive-side cross-section has zero area there.
  const boundary = [...edges.values()].filter((edge) => edge.count % 2);
  const graph = new Map<number, number[]>();
  for (const { a, b } of boundary) {
    graph.set(a, [...(graph.get(a) ?? []), b]);
    graph.set(b, [...(graph.get(b) ?? []), a]);
  }
  if ([...graph.values()].some((neighbors) => neighbors.length !== 2)) {
    return { pieces: [], code: 'open-contour', error: 'Open or branching contour. Repair the mesh, or move the sampling plane away from a touching feature.' };
  }
  const used = new Set<number>();
  const rings: Point2[][] = [];
  for (const edge of boundary) {
    if (used.has(edge.a)) continue;
    const ids = [edge.a];
    used.add(edge.a);
    let previous = edge.a, current = edge.b;
    while (current !== edge.a) {
      if (used.has(current)) return { pieces: [], code: 'branching-contour', error: 'A contour crosses another contour at a shared vertex.' };
      ids.push(current); used.add(current);
      const neighbors = graph.get(current)!;
      const next = neighbors[0] === previous ? neighbors[1] : neighbors[0];
      previous = current; current = next;
    }
    const ring = simplify(ids.map((id) => [weld.points[id][0], weld.points[id][1]]), epsilon);
    if (ring.length < 3 || Math.abs(signedArea(ring)) <= epsilon * epsilon) {
      return { pieces: [], code: 'degenerate-contour', error: 'A contour has no reliable area at this sampling plane.' };
    }
    rings.push(ring);
  }
  if (intersectingRings(rings, epsilon)) {
    return { pieces: [], code: 'intersecting-contours', error: 'Contours intersect or touch. Overlapping solids need to be combined before slicing.' };
  }
  const areas = rings.map(signedArea);
  const parents = rings.map((ring, i) => {
    let parent = -1;
    for (let j = 0; j < rings.length; j++) {
      if (Math.abs(areas[j]) > Math.abs(areas[i]) && contains(rings[j], ring[0])
        && (parent < 0 || Math.abs(areas[j]) < Math.abs(areas[parent]))) parent = j;
    }
    return parent;
  });
  if (parents.some((parent, i) => parent >= 0 && Math.sign(areas[parent]) === Math.sign(areas[i]))) {
    return { pieces: [], code: 'nested-solids', error: 'Nested shells have the same orientation. Combine overlapping solids rather than treating the inner solid as a hole.' };
  }
  const depth = (i: number): number => parents[i] < 0 ? 0 : depth(parents[i]) + 1;
  const orient = (ring: Point2[], positive: boolean) => (signedArea(ring) > 0) === positive ? ring : [...ring].reverse();
  const pieces = rings.flatMap((ring, i) => {
    if (depth(i) % 2) return [];
    const holes = rings.filter((_, j) => parents[j] === i).map((hole) => orient(hole, false));
    return [{ id: '', outer: orient(ring, true), holes,
      areaMm2: Math.abs(areas[i]) - holes.reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0) }];
  });
  const minimum = (piece: SlicePiece, axis: number) => piece.outer.reduce((min, p) => Math.min(min, p[axis]), Infinity);
  pieces.sort((a, b) => minimum(a, 0) - minimum(b, 0) || minimum(a, 1) - minimum(b, 1));
  pieces.forEach((piece, i) => { piece.id = `${layer + 1}.${i + 1}`; });
  return { pieces };
}
