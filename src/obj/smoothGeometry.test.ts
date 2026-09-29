import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MAX_SMOOTH_TRIANGLES, smoothGeometry, smoothingSegments, smoothModel } from './smoothGeometry';

function patch() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3));
  g.setAttribute('normal', g.getAttribute('position').clone());
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  return g;
}

describe('normal-guided geometry subdivision', () => {
  it('curves a coarse sphere patch toward its surface and preserves its corners and UVs', () => {
    const source = patch();
    const result = smoothGeometry(source, 4);
    const p = result.getAttribute('position'); const uv = result.getAttribute('uv');
    expect(p.count).toBe(48);
    const v = new THREE.Vector3();
    let curvedError = 0, flatError = 0;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const b = uv.getX(i), c = uv.getY(i), a = 1 - b - c;
      curvedError += Math.abs(1 - v.length());
      flatError += Math.abs(1 - Math.hypot(a, b, c));
      if (a === 1 || b === 1 || c === 1) expect(v.distanceTo(new THREE.Vector3(a, b, c))).toBeLessThan(1e-6);
    }
    expect(curvedError).toBeLessThan(flatError * 0.5);
    expect(Array.from(source.getAttribute('position').array)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('leaves flat faces planar, including sharp cube corners', () => {
    const cube = new THREE.BoxGeometry();
    const result = smoothGeometry(cube, 4);
    const p = result.getAttribute('position'); const n = result.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      expect(p.getX(i) * n.getX(i) + p.getY(i) * n.getY(i) + p.getZ(i) * n.getZ(i)).toBeCloseTo(0.5, 6);
    }
  });

  it('keeps matching curved edges across split UVs and material groups', () => {
    const source = patch();
    source.setAttribute('position', new THREE.Float32BufferAttribute([1,0,0, 0,1,0, 0,0,1, 0,1,0, 1,0,0, 0,0,-1], 3));
    source.setAttribute('normal', source.getAttribute('position').clone());
    source.setAttribute('uv', new THREE.Float32BufferAttribute([0,0, 1,0, 0,1, 10,0, 11,0, 10,1], 2));
    source.addGroup(0, 3, 0); source.addGroup(3, 3, 1);
    const result = smoothGeometry(source, 4);
    expect(result.groups).toEqual([{start:0,count:48,materialIndex:0},{start:48,count:48,materialIndex:1}]);
    const p = result.getAttribute('position'); const uv = result.getAttribute('uv');
    const edge = (start: number) => {
      const values = new Set<string>();
      for (let i = start; i < start + 48; i++) if (uv.getY(i) === 0) values.add(`${p.getX(i)},${p.getY(i)},${p.getZ(i)}`);
      return [...values].sort();
    };
    expect(edge(0)).toEqual(edge(48));
    expect(uv.getX(48)).toBe(10);
    // A split normal keeps the crease on both tangent planes, without a crack.
    const normal = source.getAttribute('normal');
    normal.setXYZ(3, 0, 0, -1); normal.setXYZ(4, 0, 0, -1);
    const crease = smoothGeometry(source, 4);
    const cp = crease.getAttribute('position'); const cuv = crease.getAttribute('uv');
    const sides = [new Set<string>(), new Set<string>()];
    for (let i = 0; i < cp.count; i++) if (cuv.getY(i) === 0) {
      expect(cp.getZ(i)).toBeCloseTo(0, 6);
      sides[i < 48 ? 0 : 1].add(`${cp.getX(i)},${cp.getY(i)},${cp.getZ(i)}`);
    }
    expect([...sides[0]].sort()).toEqual([...sides[1]].sort());
  });

  it('has a reversible zero-strength result, bounded subdivision, and disposal-aware caching', () => {
    const source = patch();
    const off = smoothGeometry(source, 8, 0);
    expect(Array.from(off.getAttribute('position').array)).toEqual(Array.from(source.getAttribute('position').array));
    const fakeLarge = new THREE.BufferGeometry();
    fakeLarge.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    fakeLarge.setIndex(new THREE.BufferAttribute(new Uint32Array(MAX_SMOOTH_TRIANGLES * 3), 1));
    expect(smoothingSegments(fakeLarge, 8)).toBe(1);
    const asset = {geometry:source,radius:1};
    const a = smoothModel(asset);
    expect(smoothModel(asset)).toBe(a);
    let disposed = false;
    a.geometry.addEventListener('dispose',()=>{disposed=true;});
    source.dispose();
    expect(disposed).toBe(true);
  });

  it('handles degenerate triangles and zero normals without NaNs', () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute('position', new THREE.Float32BufferAttribute(new Array(9).fill(0), 3));
    source.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(9).fill(0), 3));
    const result = smoothGeometry(source, 4);
    for (const attr of Object.values(result.attributes)) expect(Array.from(attr.array).every(Number.isFinite)).toBe(true);
  });
});
