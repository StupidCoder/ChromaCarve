import ClipperLib from 'clipper-lib';
import { polygonBoolean } from './polygonBoolean';
import { signedArea } from './contours';
import type { SlicePiece, SliceResult } from './types';

export interface AssemblyPiece {
  id: string; layer: number; group: number; grounded: boolean;
  belowMm2: number; aboveMm2: number; areaMm2: number; warnings: string[];
}
export interface AssemblyContact { below: string; above: string; areaMm2: number }
export interface AssemblyAnalysis {
  pieces: AssemblyPiece[]; contacts: AssemblyContact[]; groups: number;
  widthThresholdMm: number; areaThresholdMm2: number; error?: string;
}
const polygon = (piece: SlicePiece) => [piece.outer, ...piece.holes];

/** Geometric assembly heuristics, not a material-strength simulation. */
export function analyzeAssembly(result: SliceResult): AssemblyAnalysis {
  if (!result.valid) throw new Error('Resolve the section errors before analyzing assembly.');
  const thickness = result.layers[0].topMm - result.layers[0].bottomMm;
  const epsilon = Math.max(1e-8, ...result.modelSizeMm.map(n => n * 1e-7));
  const boolean = polygonBoolean(epsilon);
  const sources = result.layers.flatMap(layer => layer.pieces.map(piece => ({ piece, layer: layer.index })));
  if (sources.length > 10000) throw new Error('Too many pieces for assembly analysis. Increase thickness or simplify the model.');
  const pieces: AssemblyPiece[] = sources.map(({ piece, layer }) => ({ id: piece.id, layer, group: 0, grounded: false,
    belowMm2: 0, aboveMm2: 0, areaMm2: piece.areaMm2, warnings: [] }));
  const lookup = new Map(pieces.map((piece, i) => [piece.id, i]));
  const parents = pieces.map((_, i) => i);
  const root = (i: number): number => {
    let current = i;
    while (parents[current] !== current) current = parents[current];
    while (parents[i] !== i) { const next = parents[i]; parents[i] = current; i = next; }
    return current;
  };
  const contacts: AssemblyContact[] = [];
  const bounds = new Map(sources.map(({ piece }) => [piece.id, piece.outer.reduce((b,[x,y]) => ({ minX: Math.min(b.minX,x), maxX: Math.max(b.maxX,x), minY: Math.min(b.minY,y), maxY: Math.max(b.maxY,y) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity })]));
  let work = 0;
  for (let i = 1; i < result.layers.length; i++) {
    const lower = result.layers[i - 1], upper = result.layers[i];
    if (Math.abs(lower.topMm - upper.bottomMm) > epsilon) continue;
    for (const a of lower.pieces) for (const b of upper.pieces) {
      if (++work > 2_000_000) throw new Error('Assembly analysis is too complex. Simplify the model or increase thickness.');
      const ba = bounds.get(a.id)!, bb = bounds.get(b.id)!;
      if (ba.maxX <= bb.minX || bb.maxX <= ba.minX || ba.maxY <= bb.minY || bb.maxY <= ba.minY) continue;
      const intersection = boolean.intersection(polygon(a), polygon(b));
      const area = intersection.reduce((sum, [outer, ...holes]) => sum + Math.abs(signedArea(outer)) - holes.reduce((s,h) => s + Math.abs(signedArea(h)),0),0);
      if (area <= epsilon * epsilon * 16) continue; // Point/edge contact cannot hold glue.
      const ai = lookup.get(a.id)!, bi = lookup.get(b.id)!;
      pieces[ai].aboveMm2 += area; pieces[bi].belowMm2 += area;
      parents[root(bi)] = root(ai);
      contacts.push({ below: a.id, above: b.id, areaMm2: area });
    }
  }
  const groups = new Map<number, number>();
  const grounded = new Set(pieces.flatMap((p,i) => p.layer === 0 ? [root(i)] : []));
  pieces.forEach((p,i) => {
    const component = root(i);
    if (!groups.has(component)) groups.set(component, groups.size + 1);
    p.group = groups.get(component)!; p.grounded = grounded.has(component);
    if (!p.grounded) p.warnings.push('No connection to the bottom layer');
    if (p.layer > 0 && p.belowMm2 === 0) p.warnings.push('No contact below — needs a different assembly order or support');
    else if (p.layer > 0 && (p.belowMm2 < thickness * thickness || p.belowMm2 / p.areaMm2 < 0.1)) p.warnings.push('Small glue contact below');
    if (p.areaMm2 < thickness * thickness) p.warnings.push('Tiny piece');
    const piece = sources[i].piece;
    work += piece.outer.length + piece.holes.reduce((s,h) => s+h.length,0);
    if (work > 2_000_000) throw new Error('Assembly analysis is too complex. Simplify the model.');
    const offset = new ClipperLib.ClipperOffset();
    offset.AddPaths(polygon(piece).map((ring, index) => {
      const oriented = (signedArea(ring) > 0) === (index === 0) ? ring : [...ring].reverse();
      return oriented.map(([x,y]) => ({ X: Math.round(x/epsilon), Y: Math.round(y/epsilon) }));
    }), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const tree = new ClipperLib.PolyTree();
    offset.Execute(tree, -thickness / (2 * epsilon));
    const inset = ClipperLib.JS.PolyTreeToExPolygons(tree);
    if (!inset.length) p.warnings.push('Narrow piece');
    else if (inset.length > 1) p.warnings.push('Narrow connecting neck');
  });
  return { pieces, contacts, groups: groups.size, widthThresholdMm: thickness, areaThresholdMm2: thickness * thickness };
}
