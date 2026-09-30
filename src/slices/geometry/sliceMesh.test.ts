import { describe, expect, it } from 'vitest';
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, SphereGeometry, TorusGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sliceMesh, planLayers } from './sliceMesh';
import { snapshotForSlicing } from './snapshot';
import { DEFAULT_SLICE_SETUP, type Point2, type SliceSetup } from './types';
import { buildContours, signedArea } from './contours';
import { animatedModelFile } from '../../test/animatedModel';
import { parseModelFile } from '../../assets/modelFile';

function slice(geometry: BufferGeometry, setup: Partial<SliceSetup> = {}) {
  return sliceMesh(snapshotForSlicing(geometry, { ...DEFAULT_SLICE_SETUP, sizeMm: 10, thicknessMm: 2, ...setup }));
}

describe('physical slice geometry', () => {
  it('creates exact box outlines from indexed and non-indexed meshes, with locked dimensions', () => {
    for (const geometry of [new BoxGeometry(1, 2, 3), new BoxGeometry(1, 2, 3).toNonIndexed()]) {
      const result = slice(geometry, { sizeMm: 30, thicknessMm: 4 });
      expect(result.valid).toBe(true);
      expect(result.modelSizeMm).toEqual([10, 20, 30]);
      expect(result.layers).toHaveLength(5);
      expect(result.occupiedStackMm).toBe(20);
      result.layers.forEach((layer) => {
        expect(layer.valid).toBe(true);
        expect(layer.pieces).toHaveLength(1);
        expect(layer.pieces[0].outer).toHaveLength(4);
        expect(layer.pieces[0].areaMm2).toBeCloseTo(300);
        expect(layer.pieces[0].holes).toHaveLength(0);
        expect(layer.topMm - layer.bottomMm).toBe(4);
      });
    }
  });

  it('centers whole layers and reports quantization without rescaling the model', () => {
    const result = slice(new BoxGeometry(), { sizeMm: 10, thicknessMm: 3 });
    expect(result.modelSizeMm[1]).toBe(10);
    expect(result.plannedStackMm).toBe(12);
    expect(result.occupiedStackMm).toBe(12);
    expect(result.layers.map((layer) => layer.sampleMm)).toEqual([-4.5, -1.5, 1.5, 4.5]);
    expect(result.layers[0].bottomMm).toBe(-6);
    expect(result.layers[3].topMm).toBe(6);
    expect(planLayers(-75, 75 + 1e-12, 3).count).toBe(50);
  });

  it('rotates the slicing direction without changing physical scale', () => {
    const result = slice(new BoxGeometry(1, 2, 3), { sizeMm: 30, rotationDeg: [90, 0, 0], thicknessMm: 5 });
    expect(result.valid).toBe(true);
    expect(result.modelSizeMm[0]).toBeCloseTo(10);
    expect(result.modelSizeMm[1]).toBeCloseTo(30);
    expect(result.modelSizeMm[2]).toBeCloseTo(20);
    expect(result.layers).toHaveLength(6);
    expect(result.layers[2].pieces[0].areaMm2).toBeCloseTo(200);
  });

  it('samples a sphere through an equatorial vertex ring without cracks or duplicate edges', () => {
    const result = slice(new SphereGeometry(1, 64, 32), { thicknessMm: 5, samplingOffsetMm: 2.5 });
    expect(result.valid).toBe(true);
    expect(result.layers[0].sampleMm).toBeCloseTo(0);
    expect(result.layers[0].pieces).toHaveLength(1);
    expect(result.layers[0].pieces[0].areaMm2).toBeCloseTo(Math.PI * 25, 0);
    expect(result.layers[1].pieces).toHaveLength(0); // tangent at the top is not a disk
  });

  it('recognizes a torus hole and preserves opposite contour winding', () => {
    const result = slice(new TorusGeometry(3, 1, 32, 64), { sizeMm: 8, thicknessMm: 0.5, rotationDeg: [90, 0, 0] });
    expect(result.issues).toEqual([]);
    expect(result.layers).toHaveLength(4);
    for (const layer of result.layers) {
      expect(layer.pieces).toHaveLength(1);
      const piece = layer.pieces[0];
      expect(piece.holes).toHaveLength(1);
      expect(signedArea(piece.outer)).toBeGreaterThan(0);
      expect(signedArea(piece.holes[0])).toBeLessThan(0);
      expect(piece.areaMm2).toBeGreaterThan(20);
    }
  });

  it('retains disconnected pieces in the same layer with unique identifiers', () => {
    const geometry = mergeGeometries([new BoxGeometry().translate(-1, 0, 0), new BoxGeometry().translate(1, 0, 0)])!;
    const result = slice(geometry, { sizeMm: 30 });
    expect(result.valid).toBe(true);
    expect(result.layers).toHaveLength(5);
    expect(result.pieceCount).toBe(10);
    expect(new Set(result.layers.flatMap((layer) => layer.pieces.map((piece) => piece.id))).size).toBe(10);
    expect(result.layers[0].pieces.map((piece) => piece.areaMm2)).toEqual([100, 100]);
  });

  it('handles exact coplanar faces with a consistent positive-side convention', () => {
    const bottom = slice(new BoxGeometry(), { thicknessMm: 10, samplingOffsetMm: -5 });
    expect(bottom.valid).toBe(true);
    expect(bottom.layers[0].pieces[0].areaMm2).toBeCloseTo(100);
    const top = slice(new BoxGeometry(), { thicknessMm: 10, samplingOffsetMm: 5 });
    expect(top.layers[0].pieces).toEqual([]);
    expect(top.issues.some((issue) => issue.code === 'no-pieces')).toBe(true);
  });

  it('keeps slab positions fixed when sampling changes, and does not collapse empty layers', () => {
    const result = slice(new BoxGeometry(), { thicknessMm: 3, samplingOffsetMm: 1.5 });
    expect(result.layers).toHaveLength(4);
    expect(result.layers.map((layer) => layer.sampleMm)).toEqual([-3, 0, 3, 6]);
    expect(result.layers[0].bottomMm).toBe(-6);
    expect(result.emptyLayers).toBe(1);
    expect(result.plannedStackMm).toBe(12);
    expect(result.occupiedStackMm).toBe(9);
  });

  it('rejects an open mesh even if its sampled loops happen to close', () => {
    const geometry = new BoxGeometry();
    const indices = [...geometry.index!.array];
    indices.splice(12, 6); // remove the upper cap; middle sections remain closed
    geometry.setIndex(indices);
    const result = slice(geometry);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'open-mesh')).toBe(true);
    expect(result.layers.every((layer) => layer.pieces.length === 1)).toBe(true);
  });

  it('reports open contours without inventing a closing edge', () => {
    const geometry = new BoxGeometry();
    geometry.setIndex([...geometry.index!.array].slice(6)); // open side
    const result = slice(geometry);
    expect(result.valid).toBe(false);
    expect(result.layers[0].valid).toBe(false);
    expect(result.layers[0].pieces).toEqual([]);
    expect(result.layers[0].invalidSegments!.length).toBeGreaterThan(0);
  });

  it('does not turn nested solid components into a false hole', () => {
    const geometry = mergeGeometries([new BoxGeometry(3, 3, 3), new BoxGeometry(1, 1, 1)])!;
    const result = slice(geometry, { sizeMm: 30, thicknessMm: 10 });
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'nested-solids')).toBe(true);
  });

  it('flags crossing components instead of treating them as independent cut pieces', () => {
    const geometry = mergeGeometries([new BoxGeometry(3, 2, 1), new BoxGeometry(1, 2, 3)])!;
    const result = slice(geometry, { sizeMm: 30 });
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'intersecting-contours')).toBe(true);
  });

  it('bakes the selected GLB pose into an independent snapshot', async () => {
    const model = await parseModelFile(animatedModelFile());
    const pose = model.gltf!.sample(0, 1);
    const input = snapshotForSlicing(pose.geometry, { ...DEFAULT_SLICE_SETUP, sizeMm: 30, thicknessMm: 2 });
    model.gltf!.sample(-1);
    model.dispose();
    const result = sliceMesh(input);
    expect(result.valid).toBe(true);
    expect(result.modelSizeMm).toEqual([30, 10, 10]);
    expect(result.layers[0].pieces[0].areaMm2).toBeCloseTo(300);
  });

  it('rejects unbounded work and invalid geometry with actionable errors', () => {
    expect(() => slice(new BoxGeometry(), { sizeMm: 10000, thicknessMm: 0.05 })).toThrow('Increase plywood thickness');
    expect(() => slice(new BoxGeometry(), { thicknessMm: 0 })).toThrow('settings are invalid');
    const invalid = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, NaN, 1, 0, 0, 0, 1, 1], 3));
    expect(() => slice(invalid)).toThrow('invalid vertex coordinates');
  });
});

describe('critical planes and shell topology', () => {
  it('flags a zero-width tangent connection and resolves it with a small sampling offset', () => {
    const torus = new TorusGeometry(3, 1, 32, 64);
    const tangent = slice(torus, { sizeMm: 150, thicknessMm: 3 });
    expect(tangent.layers.filter((layer) => !layer.valid)).toHaveLength(2);
    expect(tangent.valid).toBe(false);
    const shifted = slice(torus, { sizeMm: 150, thicknessMm: 3, samplingOffsetMm: 0.2 });
    expect(shifted.valid).toBe(true);
    expect(shifted.layers[25].pieces).toHaveLength(2);
  });

  it('treats a plane touching only a shared edge as empty, rather than an open path', () => {
    const cube = new BoxGeometry().rotateZ(Math.PI / 4);
    const tangent = slice(cube, { sizeMm: 10, thicknessMm: 10, samplingOffsetMm: -5 });
    expect(tangent.layers[0].valid).toBe(true);
    expect(tangent.layers[0].pieces).toEqual([]);
    expect(tangent.issues.some((issue) => issue.code === 'open-contour')).toBe(false);
  });

  it('preserves a correctly oriented cavity and a separate island inside it', () => {
    const cavity = new BoxGeometry(6, 8, 6);
    const reversed = [...cavity.index!.array];
    for (let i = 0; i < reversed.length; i += 3) [reversed[i], reversed[i + 1]] = [reversed[i + 1], reversed[i]];
    cavity.setIndex(reversed);
    const geometry = mergeGeometries([new BoxGeometry(10, 10, 10), cavity, new BoxGeometry(2, 2, 2)])!;
    const result = slice(geometry);
    expect(result.valid).toBe(true);
    const center = result.layers[2];
    expect(center.pieces).toHaveLength(2);
    expect(center.pieces.flatMap((piece) => piece.holes)).toHaveLength(1);
    expect(center.pieces.reduce((area, piece) => area + piece.areaMm2, 0)).toBeCloseTo(68);
  });

  it('detects duplicate faces and inconsistent winding', () => {
    const duplicate = new BoxGeometry();
    duplicate.setIndex([...duplicate.index!.array, ...duplicate.index!.array.slice(0, 3)]);
    expect(slice(duplicate).issues.some((issue) => issue.code === 'non-manifold')).toBe(true);
    const flipped = new BoxGeometry();
    const indices = [...flipped.index!.array];
    [indices[0], indices[1]] = [indices[1], indices[0]];
    flipped.setIndex(indices);
    expect(slice(flipped).issues.some((issue) => issue.code === 'winding')).toBe(true);
  });
});


it('preserves densely tessellated curves instead of simplifying all their vertices away', () => {
  const points: Point2[] = Array.from({ length: 4096 }, (_, i) => [Math.cos(i * 2 * Math.PI / 4096), Math.sin(i * 2 * Math.PI / 4096)]);
  const segments: [Point2, Point2][] = points.map((p, i) => [p, points[(i + 1) % points.length]]);
  const result = buildContours(segments, 1e-5, 0);
  expect(result.error).toBeUndefined();
  expect(result.pieces).toHaveLength(1);
  expect(result.pieces[0].areaMm2).toBeCloseTo(Math.PI, 5);
});
