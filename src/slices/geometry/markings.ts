import ClipperLib from 'clipper-lib';
import { signedArea } from './contours';
import { polygonBoolean, type MultiPolygon, type Polygon } from './polygonBoolean';
import type { Point2, SliceResult } from './types';

import { DEFAULT_MARKINGS, MARK_STROKE_MM, validMarkingSettings, type MarkingSettings } from './markingSettings';
export { DEFAULT_MARKINGS, MARK_STROKE_MM, validMarkingSettings, type MarkingSettings } from './markingSettings';
export interface ContactMarking {
  below: string; above: string; layer: number;
  guides: Point2[][]; label: Point2[][]; labelBox?: Point2[]; warnings: string[];
}
export interface MarkingResult { contacts: ContactMarking[]; unmarkedPieceIds: string[]; settings: MarkingSettings }

const segments: [Point2, Point2][] = [
  [[0,1],[0.6,1]], [[0.6,1],[0.6,0.5]], [[0.6,0.5],[0.6,0]],
  [[0,0],[0.6,0]], [[0,0.5],[0,0]], [[0,1],[0,0.5]], [[0,0.5],[0.6,0.5]],
];
const digits = ['012345','12','01643','01236','1256','02563','023456','012','0123456','012356'];
/** Single-stroke numeric lettering: no installed font or SVG text conversion required. */
export function numberPaths(text: string, height: number): { paths: Point2[][]; width: number } {
  let x = 0;
  const paths: Point2[][] = [];
  for (const char of text) {
    const strokes: Point2[][] = char === '.' ? [[[0,0.02],[0.04,0.02]]]
      : char === '>' ? [[[0,0.85],[0.55,0.5],[0,0.15]]]
      : [...(digits[Number(char)] ?? '')].map(i => segments[Number(i)]);
    paths.push(...strokes.map(line => line.map(([u,v]): Point2 => [(u + x) * height, v * height])));
    x += char === '.' ? 0.3 : 0.85;
  }
  return { paths, width: Math.max(0, x - 0.25) * height };
}

const area = (polygons: MultiPolygon) => polygons.reduce((s,[outer,...holes]) => s + Math.abs(signedArea(outer)) - holes.reduce((n,h) => n + Math.abs(signedArea(h)),0),0);
const box = (ring: Point2[]) => ring.reduce((b,[x,y]) => ({ minX: Math.min(b.minX,x), maxX: Math.max(b.maxX,x), minY: Math.min(b.minY,y), maxY: Math.max(b.maxY,y) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

export function generateMarkings(result: SliceResult, settings: MarkingSettings = DEFAULT_MARKINGS): MarkingResult {
  if (!validMarkingSettings(settings)) throw new Error('Invalid marking dimensions.');
  if (!result.valid || !result.assembly || result.assembly.error) throw new Error('Resolve section and assembly analysis errors before generating markings.');
  const epsilon = Math.max(1e-8, ...result.modelSizeMm.map(n => n * 1e-7));
  const boolean = polygonBoolean(epsilon);
  const source = new Map(result.layers.flatMap(layer => layer.pieces.map(piece => [piece.id, { piece, layer: layer.index }] as const)));
  if (result.assembly.contacts.length > 10000) throw new Error('Too many contacts for marking generation. Simplify the model.');
  let work = 0;
  const budget = (n: number) => { work += n; if (work > 5_000_000) throw new Error('Marking layout is too complex. Simplify the model or increase layer thickness.'); };
  const paths = (polygons: MultiPolygon) => polygons.flatMap(polygon => polygon.map((ring,i) => {
    const oriented = (signedArea(ring) > 0) === (i === 0) ? ring : [...ring].reverse();
    return oriented.map(([x,y]) => ({ X: Math.round(x/epsilon), Y: Math.round(y/epsilon) }));
  }));
  const inset = (polygon: Polygon, distance: number): MultiPolygon => {
    const offset = new ClipperLib.ClipperOffset();
    offset.AddPaths(paths([polygon]), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const tree = new ClipperLib.PolyTree(); offset.Execute(tree, -distance/epsilon);
    return ClipperLib.JS.PolyTreeToExPolygons(tree).map(({outer,holes}) => [outer,...holes].map(ring => ring.map(({X,Y}): Point2 => [X*epsilon,Y*epsilon])));
  };
  const safe = new Map<string, MultiPolygon>();
  const safePiece = (id: string) => {
    if (!safe.has(id)) {
      const {piece} = source.get(id)!;
      budget(piece.outer.length + piece.holes.reduce((n,h) => n+h.length,0));
      // Include half the marking stroke, plus numerical rounding clearance.
      safe.set(id, inset([piece.outer,...piece.holes], settings.clearanceMm + MARK_STROKE_MM/2 + epsilon*4));
    }
    return safe.get(id)!;
  };
  const contacts: ContactMarking[] = [];
  for (const contact of result.assembly.contacts) {
    if (!source.has(contact.below) || !source.has(contact.above)) continue;
    const lower = source.get(contact.below)!;
    const a = safePiece(contact.below), b = safePiece(contact.above);
    const marking: ContactMarking = { below: contact.below, above: contact.above, layer: lower.layer, guides: [], label: [], warnings: [] };
    contacts.push(marking);
    if (!a.length || !b.length) { marking.warnings.push('Contact is too narrow for hidden markings.'); continue; }
    // Clip only the next piece's inset boundary, not the artificial overlap boundary.
    const clipper = new ClipperLib.Clipper();
    clipper.AddPaths(paths(b).map(ring => [...ring,ring[0]]), ClipperLib.PolyType.ptSubject, false);
    clipper.AddPaths(paths(a), ClipperLib.PolyType.ptClip, true);
    const tree = new ClipperLib.PolyTree();
    if (!clipper.Execute(ClipperLib.ClipType.ctIntersection, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)) throw new Error('Could not clip alignment guides.');
    marking.guides = ClipperLib.Clipper.OpenPathsFromPolyTree(tree).map(ring => ring.map(({X,Y}): Point2 => [X*epsilon,Y*epsilon]));
    if (!marking.guides.length) marking.warnings.push('No hidden next-piece edge is available for alignment.');
    // Extra space keeps lettering clear of the inset guide and its stroke.
    const region = boolean.intersection(a,b).flatMap(p => inset(p, MARK_STROKE_MM + 0.2));
    const top = numberPaths(contact.below, settings.labelHeightMm), bottom = numberPaths(`>${contact.above}`, settings.labelHeightMm);
    const width = Math.max(top.width,bottom.width), height = settings.labelHeightMm * 2.4;
    const label = [...top.paths.map(line => line.map(([x,y]): Point2 => [x,y+settings.labelHeightMm*1.4])), ...bottom.paths];
    for (const polygon of [...region].sort((x,y) => area([y])-area([x]))) {
      if (marking.label.length) break;
      const bounds = box(polygon[0]);
      const complexity = polygon.reduce((n,ring) => n+ring.length,0);
      for (const rotated of [false,true]) {
        const w = rotated ? height : width, h = rotated ? width : height;
        if (bounds.maxX-bounds.minX < w || bounds.maxY-bounds.minY < h) continue;
        const candidates: Point2[] = [[(bounds.minX+bounds.maxX)/2, (bounds.minY+bounds.maxY)/2]];
        for (let y=0;y<=10;y++) for (let x=0;x<=10;x++) candidates.push([
          bounds.minX+w/2+(bounds.maxX-bounds.minX-w)*x/10,
          bounds.minY+h/2+(bounds.maxY-bounds.minY-h)*y/10,
        ]);
        for (const [cx,cy] of candidates) {
          budget(complexity);
          const rectangle: Point2[] = [[cx-w/2,cy-h/2],[cx+w/2,cy-h/2],[cx+w/2,cy+h/2],[cx-w/2,cy+h/2]];
          // Full rectangle containment protects glyphs from holes and concave boundaries.
          if (area(boolean.difference([rectangle],polygon)) > epsilon*epsilon*16) continue;
          marking.labelBox = rectangle;
          marking.label = label.map(line => line.map(([x,y]): Point2 => rotated
            ? [cx-(y-height/2),cy+(x-width/2)] : [cx+x-width/2,cy+y-height/2]));
          break;
        }
        if (marking.label.length) break;
      }
    }
    if (!marking.label.length) marking.warnings.push(`Could not place both IDs in covered space at ${settings.labelHeightMm} mm. Try smaller lettering or assemble this contact manually.`);
  }
  const marked = new Set(contacts.filter(c => c.label.length || c.guides.length).map(c => c.below));
  return { contacts, unmarkedPieceIds: [...source.keys()].filter(id => !marked.has(id)), settings };
}
