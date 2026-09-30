import ClipperLib from 'clipper-lib';
import type { Point2 } from './types';
import { signedArea } from './contours';

export type Polygon = Point2[][];
export type MultiPolygon = Polygon[];
type Geometry = Polygon | MultiPolygon;

/** Integer grid is the numerical welding tolerance, not a fabrication-sized
 * smoothing operation. Nonzero fill unions solids without XOR cancellation. */
export function polygonBoolean(epsilon: number) {
  const multi = (geometry: Geometry): MultiPolygon => !geometry.length ? []
    : typeof geometry[0][0][0] === 'number' ? [geometry as Polygon] : geometry as MultiPolygon;
  const paths = (geometry: Geometry) => multi(geometry).flatMap((polygon) => polygon.map((ring, i) => {
    const oriented = (signedArea(ring) > 0) === (i === 0) ? ring : [...ring].reverse();
    return oriented.map(([x, y]) => ({ X: Math.round(x / epsilon), Y: Math.round(y / epsilon) }));
  }));
  const execute = (subjects: Geometry[], clips: Geometry[], type: ClipperLib.ClipType): MultiPolygon => {
    const clipper = new ClipperLib.Clipper();
    clipper.StrictlySimple = true;
    clipper.AddPaths(subjects.flatMap(paths), ClipperLib.PolyType.ptSubject, true);
    clipper.AddPaths(clips.flatMap(paths), ClipperLib.PolyType.ptClip, true);
    const tree = new ClipperLib.PolyTree();
    if (!subjects.some((geometry) => geometry.length)) return [];
    if (!clipper.Execute(type, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)) throw new Error('Could not resolve polygon boundaries. Change the sampling offset or repair the source mesh.');
    return ClipperLib.JS.PolyTreeToExPolygons(tree).map(({ outer, holes }) => [outer, ...holes].map((ring) => {
      const points: Point2[] = ring.map(({ X, Y }) => [X * epsilon, Y * epsilon]);
      points.push(points[0]); return points;
    }));
  };
  return {
    union: (...geometry: Geometry[]) => execute(geometry, [], ClipperLib.ClipType.ctUnion),
    difference: (subject: Geometry, clip: Geometry) => execute([subject], [clip], ClipperLib.ClipType.ctDifference),
  };
}
