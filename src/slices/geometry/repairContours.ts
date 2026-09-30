import { polygonBoolean, type MultiPolygon, type Polygon } from './polygonBoolean';
import { PointWelder, signedArea } from './contours';
import type { Point2, SlicePiece } from './types';

type Segment = [Point2, Point2];
const cross = (a: Point2, b: Point2) => a[0] * b[1] - a[1] * b[0];
const sub = (a: Point2, b: Point2): Point2 => [a[0] - b[0], a[1] - b[1]];
const distance = (a: Point2, b: Point2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a: Point2, b: Point2, t: number): Point2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function inside(ring: Point2[], point: Point2) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}
function edgeProjection(p: Point2, a: Point2, b: Point2): Point2 {
  const ab = sub(b, a), ap = sub(p, a), length2 = ab[0] ** 2 + ab[1] ** 2;
  const t = length2 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1]) / length2)) : 0;
  return lerp(a, b, t);
}
const edgeDistance = (p: Point2, a: Point2, b: Point2) => distance(p, edgeProjection(p, a, b));
const edgesOf = (polygons: MultiPolygon): Segment[] => polygons.flatMap((polygon) => polygon.flatMap((ring) => ring.slice(1).map((p, i) => [ring[i], p] as Segment)));
const inSolid = (p: Point2, polygons: MultiPolygon) => polygons.some(([outer, ...holes]) => inside(outer, p) && !holes.some((hole) => inside(hole, p)));

/** Test every portion of a proposed closing edge against existing material.
 * Intersections split it into constant-inside intervals; outside intervals use
 * a conservative distance bound, never just endpoint proximity. */
function supported(a: Point2, b: Point2, polygons: MultiPolygon, gap: number, epsilon: number): boolean {
  const edges = edgesOf(polygons), ab = sub(b, a), stops = [0, 1];
  for (const [c, d] of edges) {
    const cd = sub(d, c), denominator = cross(ab, cd);
    if (Math.abs(denominator) < epsilon * epsilon) continue;
    const ac = sub(c, a), t = cross(ac, cd) / denominator, u = cross(ac, ab) / denominator;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) stops.push(t);
  }
  stops.sort((x, y) => x - y);
  let checks = 0;
  const near = (p: Point2) => edges.reduce((best, [c, d]) => {
    if (++checks > 1_000_000) throw new Error('Attachment is too complex to verify. Simplify the model.');
    return Math.min(best, edgeDistance(p, c, d));
  }, Infinity);
  const covered = (p: Point2, q: Point2, depth: number): boolean => {
    const middle = lerp(p, q, 0.5), d = near(middle), radius = distance(p, q) / 2;
    if (d + radius <= gap + epsilon) return true;
    if (d > gap + epsilon || depth >= 18) return false;
    return covered(p, middle, depth + 1) && covered(middle, q, depth + 1);
  };
  for (let i = 1; i < stops.length; i++) {
    const p = lerp(a, b, stops[i - 1]), q = lerp(a, b, stops[i]);
    if (distance(p, q) <= epsilon || inSolid(lerp(p, q, 0.5), polygons)) continue;
    // A closing edge exactly on an existing edge is already supported.
    if (edges.some(([c, d]) => edgeDistance(p, c, d) <= epsilon && edgeDistance(q, c, d) <= epsilon)) continue;
    if (!covered(p, q, 0)) return false;
  }
  return true;
}

function pathsFromSegments(segments: Segment[], epsilon: number) {
  const weld = new PointWelder(epsilon), edges = new Map<string, { a: number; b: number; count: number }>();
  for (const [p, q] of segments) {
    const a = weld.add([...p, 0]), b = weld.add([...q, 0]);
    if (a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`, old = edges.get(key);
    if (old) old.count++; else edges.set(key, { a, b, count: 1 });
  }
  const boundary = [...edges.values()].filter((edge) => edge.count % 2);
  const graph = new Map<number, number[]>();
  for (const { a, b } of boundary) { graph.set(a, [...(graph.get(a) ?? []), b]); graph.set(b, [...(graph.get(b) ?? []), a]); }
  if ([...graph.values()].some((neighbors) => neighbors.length > 2)) throw new Error('Branching paths need manual repair or a different sampling offset.');
  const directed = new Set(boundary.map(({ a, b }) => `${a}:${b}`));
  const used = new Set<number>(), rings: Point2[][] = [], chains: Point2[][] = [];
  const walk = (start: number, next?: number) => {
    const path: Point2[] = []; const ids: number[] = []; let current = start, previous = -1;
    while (!used.has(current)) {
      used.add(current); ids.push(current); path.push(weld.points[current].slice(0, 2) as Point2);
      const neighbors = graph.get(current)!;
      const following = next ?? neighbors.find((id) => id !== previous);
      next = undefined; if (following === undefined) break;
      previous = current; current = following;
    }
    if (ids.length > 1 && !directed.has(`${ids[0]}:${ids[1]}`)) path.reverse();
    return { path, closed: current === start && path.length > 2 };
  };
  for (const [start, neighbors] of graph) if (neighbors.length === 1 && !used.has(start)) chains.push(walk(start).path);
  for (const edge of boundary) if (!used.has(edge.a)) {
    const { path, closed } = walk(edge.a, edge.b);
    if (closed) rings.push(path); else chains.push(path);
  }
  return { rings, chains };
}

/** Fill only the narrow space between a supported closing edge and the
 * nearest solid boundary, so an attached patch does not remain a floating island. */
function attachmentStrips(a: Point2, b: Point2, solid: MultiPolygon, gap: number, epsilon: number): Polygon[] {
  if (gap <= epsilon) return [];
  const edges = edgesOf(solid);
  const project = (p: Point2): Point2 => {
    if (inSolid(p, solid)) return p;
    let best = p, minimum = Infinity;
    for (const [c, d] of edges) {
      const q = edgeProjection(p, c, d), length = distance(p, q);
      if (length < minimum) { minimum = length; best = q; }
    }
    return best;
  };
  const count = Math.max(1, Math.ceil(distance(a, b) / (gap / 2)));
  if (count > 10000) throw new Error('Attachment is too complex. Increase the repair tolerance or simplify the model.');
  const strips: Polygon[] = [];
  for (let i = 0; i < count; i++) {
    const p = lerp(a, b, i / count), q = lerp(a, b, (i + 1) / count);
    const pp = project(p), qq = project(q);
    const overlap = (from: Point2, to: Point2): [Point2, Point2] => {
      const length = distance(from, to);
      if (length <= epsilon) return [from, to];
      // Extend into both adjoining regions by numerical tolerance only, avoiding
      // quantization slivers where a projected point rounds off the exact edge.
      return [lerp(from, to, -4 * epsilon / length), lerp(from, to, 1 + 4 * epsilon / length)];
    };
    if (distance(p, pp) > epsilon || distance(q, qq) > epsilon) {
      const [p0, p1] = overlap(p, pp), [q0, q1] = overlap(q, qq);
      strips.push([[p0, q0, q1, p1]]);
    }
  }
  return strips;
}

export interface ContourRepair {
  pieces: SlicePiece[];
  closedLoops: number;
  attachedPaths: number;
  shortGaps: number;
  unresolvedPaths: number;
  bridges: Segment[];
}

/** Conservative, explicit 2D repair. Never convex-hulls the character silhouette. */
export function repairContours(segments: Segment[], epsilon: number, layer: number, gap: number): ContourRepair {
  if (segments.length > 25000) throw new Error('This section is too complex to repair. Simplify the model.');
  const polygonClipping = polygonBoolean(epsilon);
  const { rings, chains } = pathsFromSegments(segments, epsilon);
  if (rings.length + chains.length > 256) throw new Error('Too many separate paths to repair in this layer. Simplify the model.');
  const bridges: Segment[] = []; let attachedPaths = 0, shortGaps = 0;
  // Stitch near-coincident ends across material seams before treating each open
  // path as a separate patch. Use mutual nearest neighbors; ties are ambiguous.
  let stitching = true;
  while (stitching) {
    stitching = false;
    const ends = chains.flatMap((chain, index) => [{ index, end: 0, point: chain[0] }, { index, end: 1, point: chain[chain.length - 1] }]);
    if (ends.length > 2048) throw new Error('Too many open paths to repair. Simplify the model.');
    const nearest = ends.map((a, i) => {
      const candidates = ends.map((b, j) => ({ j, distance: j === i || a.end === b.end ? Infinity : distance(a.point, b.point) })).sort((a, b) => a.distance - b.distance);
      return candidates[0]?.distance <= gap + epsilon && (!candidates[1] || candidates[1].distance > candidates[0].distance + epsilon) ? candidates[0].j : -1;
    });
    for (let i = 0; i < ends.length; i++) {
      const j = nearest[i];
      if (j < 0 || nearest[j] !== i) continue;
      const a = ends[i], b = ends[j];
      const first = a.end === 1 ? chains[a.index] : [...chains[a.index]].reverse();
      bridges.push([a.point, b.point]); shortGaps++;
      if (a.index === b.index) { rings.push(chains[a.index]); chains.splice(a.index, 1); }
      else {
        const second = b.end === 0 ? chains[b.index] : [...chains[b.index]].reverse();
        chains[a.index] = a.end === 1 ? [...first, ...second] : [...first, ...second].reverse(); chains.splice(b.index, 1);
      }
      stitching = true; break;
    }
  }
  const nondegenerate = rings.filter((ring) => Math.abs(signedArea(ring)) > epsilon * epsilon);
  const areas = nondegenerate.map(signedArea);
  // Only a fully contained, oppositely oriented ring is a cavity. Overlapping
  // independent solids are unioned, including nested solids with matching normals.
  const parents = nondegenerate.map((ring, i) => {
    let parent = -1;
    for (let j = 0; j < nondegenerate.length; j++) {
      if (Math.abs(areas[j]) <= Math.abs(areas[i])) continue;
      const remainder = polygonClipping.difference([ring], [nondegenerate[j]]);
      if (!remainder.length && (parent < 0 || Math.abs(areas[j]) < Math.abs(areas[parent]))) parent = j;
    }
    return parent;
  });
  const isHole = (i: number): boolean => parents[i] >= 0 && Math.sign(areas[parents[i]]) !== Math.sign(areas[i]) && !isHole(parents[i]);
  const polygons: Polygon[] = nondegenerate.flatMap((ring, i) => isHole(i) ? [] : [[ring, ...nondegenerate.filter((_, j) => parents[j] === i && isHole(j))]]);
  let solid: MultiPolygon = polygons.length ? polygonClipping.union(polygons) : [];
  let pending = chains;
  let changed = true;
  while (changed && pending.length) {
    changed = false;
    pending = pending.filter((chain) => {
      const a = chain[0], b = chain[chain.length - 1];
      if (solid.length && supported(a, b, solid, gap, epsilon)) {
        // An internal zero-area line is harmless; an external flat decoration
        // still needs thickness and is not silently dropped.
        if (Math.abs(signedArea(chain)) <= epsilon * epsilon) {
          if (!chain.slice(1).every((point, i) => supported(chain[i], point, solid, 0, epsilon))) return true;
        } else solid = polygonClipping.union(solid, [chain], attachmentStrips(a, b, solid, gap, epsilon));
        bridges.push([b, a]); attachedPaths++; changed = true; return false;
      }
      return true;
    });
  }
  const pieces = solid.map(([outer, ...holes]) => ({ id: '', outer: outer.slice(0, -1), holes: holes.map((hole) => hole.slice(0, -1)),
    areaMm2: Math.abs(signedArea(outer)) - holes.reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0) }));
  const minimum = (piece: SlicePiece, axis: number) => piece.outer.reduce((value, p) => Math.min(value, p[axis]), Infinity);
  pieces.sort((a, b) => minimum(a, 0) - minimum(b, 0) || minimum(a, 1) - minimum(b, 1));
  pieces.forEach((piece, i) => { piece.id = `${layer + 1}.${i + 1}`; });
  return { pieces, closedLoops: rings.length, attachedPaths, shortGaps, unresolvedPaths: pending.length, bridges };
}
