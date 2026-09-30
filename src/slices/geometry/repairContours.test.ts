import { describe, expect, it } from 'vitest';
import { BoxGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { repairContours } from './repairContours';
import { sliceMesh } from './sliceMesh';
import { snapshotForSlicing } from './snapshot';
import { DEFAULT_SLICE_SETUP, type Point2 } from './types';

type Segment = [Point2, Point2];
const path = (points: Point2[]): Segment[] => points.slice(1).map((p, i) => [points[i], p]);
const ring = (points: Point2[]): Segment[] => path([...points, points[0]]);
const square = (x: number, y: number, size: number): Point2[] => [[x,y],[x+size,y],[x+size,y+size],[x,y+size]];
const fix = (segments: Segment[], gap = 0.5) => repairContours(segments, 1e-6, 0, gap);
const area = (result: ReturnType<typeof fix>) => result.pieces.reduce((sum,p) => sum+p.areaMm2,0);

describe('conservative section repair', () => {
  it('unions crossing and nested solids without XOR holes', () => {
    const result = fix([...ring(square(0,0,10)), ...ring(square(5,0,10)), ...ring(square(6,2,2))]);
    expect(result.pieces).toHaveLength(1);
    expect(result.pieces[0].holes).toHaveLength(0);
    expect(area(result)).toBeCloseTo(150);
  });
  it('preserves true cavities and islands', () => {
    const result = fix([...ring(square(0,0,10)), ...ring(square(2,2,6).reverse()), ...ring(square(4,4,2))]);
    expect(result.pieces).toHaveLength(2);
    expect(result.pieces[0].holes).toHaveLength(1);
    expect(area(result)).toBeCloseTo(68);
  });
  it('closes a long opening only when its entire closing edge is supported by a solid', () => {
    const patch: Point2[] = [[1,9],[1,12],[9,12],[9,9]];
    const result = fix([...ring(square(0,0,10)), ...path(patch)],0);
    expect(result.unresolvedPaths).toBe(0);
    expect(result.attachedPaths).toBe(1);
    expect(result.pieces).toHaveLength(1);
    expect(area(result)).toBeCloseTo(116);
  });
  it('fills a narrow gap so a supported patch is attached, not a floating island', () => {
    const segments = [...ring(square(0,0,10)), ...path([[1,10.4],[1,12],[9,12],[9,10.4]])];
    expect(fix(segments,0.3).unresolvedPaths).toBe(1);
    const result = fix(segments,0.5);
    expect(result.unresolvedPaths).toBe(0);
    expect(result.pieces).toHaveLength(1);
    expect(area(result)).toBeCloseTo(116,3);
  });
  it('does not fill a large unsupported opening, even with endpoints inside separate solids', () => {
    const result = fix([...ring(square(0,0,2)), ...ring(square(10,0,2)), ...path([[1,1],[1,5],[11,5],[11,1]])]);
    expect(result.unresolvedPaths).toBe(1);
    expect(area(result)).toBeCloseTo(8);
  });
  it('stitches small seams across paths rather than closing each long chain independently', () => {
    const result = fix([...path([[0,0],[10,0],[10,10]]), ...path([[10,10.01],[0,10],[0,0.01]])],0.02);
    expect(result.unresolvedPaths).toBe(0);
    expect(result.shortGaps).toBe(2);
    expect(result.pieces).toHaveLength(1);
    expect(area(result)).toBeCloseTo(100.05,3);
  });
  it('leaves an isolated open sheet unresolved and rejects branching paths', () => {
    expect(fix(path([[0,0],[2,2],[4,0]])).unresolvedPaths).toBe(1);
    expect(() => fix([[[0,0],[1,0]],[[1,0],[2,0]],[[1,0],[1,1]]])).toThrow('Branching');
  });
  it('enforces complexity limits without silently discarding contours', () => {
    expect(() => fix(Array.from({length:25001},(): Segment => [[0,0],[1,0]]))).toThrow('too complex');
  });
  it('keeps strict mode unchanged, but uses repaired pieces for the actual slice result', () => {
    const a = new BoxGeometry(10,10,10), b = new BoxGeometry(10,10,10).translate(5,0,0);
    const mesh = mergeGeometries([a,b]);
    const setup = {...DEFAULT_SLICE_SETUP,sizeMm:15};
    expect(sliceMesh(snapshotForSlicing(mesh,setup)).valid).toBe(false);
    const result = sliceMesh(snapshotForSlicing(mesh,{...setup,repairMode:'automatic'}));
    expect(result.valid).toBe(true);
    expect(result.layers.every(l=>l.pieces.length===1 && Math.abs(l.pieces[0].areaMm2-150)<1e-3)).toBe(true);
    expect(result.layers[0].repair?.originalSegments.length).toBeGreaterThan(0);
    a.dispose(); b.dispose(); mesh.dispose();
  });
});
