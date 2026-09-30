import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { physicalModelMatrix, plywoodGeometry } from './plywood';
import { sliceMesh } from './sliceMesh';
import { snapshotForSlicing } from './snapshot';
import { DEFAULT_SLICE_SETUP, type SliceResult } from './types';

const ring = (x: number, y: number, size: number): [number, number][] => [[x,y],[x+size,y],[x+size,y+size],[x,y+size]];
function fixture(): SliceResult {
  return { valid: true, layers: [
    { index: 0, bottomMm: -3, topMm: 0, sampleMm: -1.5, valid: true, pieces: [
      { id: '1.1', outer: ring(0,0,10), holes: [ring(2,2,6).reverse()], areaMm2: 64 },
      { id: '1.2', outer: ring(20,0,2), holes: [], areaMm2: 4 },
    ] },
    { index: 1, bottomMm: 0, topMm: 3, sampleMm: 1.5, valid: true, pieces: [] },
    { index: 2, bottomMm: 3, topMm: 6, sampleMm: 4.5, valid: true, pieces: [
      { id: '3.1', outer: ring(0,0,1), holes: [], areaMm2: 1 },
    ] },
  ], bounds: { min:[0,0,-3], max:[22,10,6] }, modelSizeMm:[22,9,10], plannedStackMm:9, occupiedStackMm:9, emptyLayers:1, pieceCount:3, issues:[] };
}

describe('faithful plywood preview', () => {
  it('preserves holes, separated pieces, empty-layer gaps and physical slab thickness', () => {
    const geometry = plywoodGeometry(fixture());
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld();
    const hit = (x: number, y: number, z: number, direction: THREE.Vector3) => new THREE.Raycaster(new THREE.Vector3(x,y,z),direction).intersectObject(mesh);
    expect(geometry.boundingBox!.min.toArray()).toEqual([0,-3,-10]);
    geometry.boundingBox!.max.toArray().forEach((v,i) => expect(v).toBeCloseTo([22,6,0][i],6));
    expect(hit(5,10,-5,new THREE.Vector3(0,-1,0))).toHaveLength(0); // hole
    expect(hit(21,10,-1,new THREE.Vector3(0,-1,0))[0].point.y).toBeCloseTo(0); // separate piece
    expect(hit(-5,1.5,-0.5,new THREE.Vector3(1,0,0))).toHaveLength(0); // retained empty slab
    expect(hit(-5,4.5,-0.5,new THREE.Vector3(1,0,0))[0].point.x).toBeCloseTo(0);
    geometry.dispose(); mesh.material.dispose();
  });
  it('moves sampling planes without moving the plywood slabs', () => {
    const a = fixture(), b = fixture(); b.layers.forEach((layer) => { layer.sampleMm += 1; });
    const ga = plywoodGeometry(a), gb = plywoodGeometry(b);
    expect(gb.getAttribute('position').array).toEqual(ga.getAttribute('position').array);
    ga.dispose(); gb.dispose();
  });
  it('places an offset source at the same physical scale and rotated frame as the slicer', () => {
    const source = new THREE.BoxGeometry(1,2,3).translate(5,-7,4);
    const setup = { ...DEFAULT_SLICE_SETUP, sizeMm:30, rotationDeg:[23,41,-16] as [number,number,number] };
    const result = sliceMesh(snapshotForSlicing(source,setup));
    const transformed = source.clone().applyMatrix4(physicalModelMatrix(source,setup));
    transformed.computeBoundingBox();
    const { min, max } = transformed.boundingBox!;
    [min.x, -max.z, min.y].forEach((v,i) => expect(v).toBeCloseTo(result.bounds.min[i],4));
    [max.x, -min.z, max.y].forEach((v,i) => expect(v).toBeCloseTo(result.bounds.max[i],4));
    source.dispose(); transformed.dispose();
  });
  it('reports a setup with no sampled pieces', () => {
    expect(() => plywoodGeometry({ ...fixture(), layers: [], pieceCount: 0 })).toThrow('No pieces');
  });
  it('never presents incomplete geometry as a finished model', () => {
    expect(() => plywoodGeometry({ ...fixture(), valid:false })).toThrow('Resolve');
  });
});
