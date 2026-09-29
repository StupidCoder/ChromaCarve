import * as THREE from 'three';
import type { ModelAsset } from '../assets/assetStore';

export const MAX_SMOOTH_TRIANGLES = 500_000;

/** Use one subdivision rate across the mesh, including material/UV seams. */
export function smoothingSegments(geometry: THREE.BufferGeometry, requested = 4): number {
  const triangles = (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
  const desired = Number.isFinite(requested) ? Math.min(8, Math.max(2, Math.round(requested))) : 4;
  return Math.max(1, Math.min(desired, Math.floor(Math.sqrt(MAX_SMOOTH_TRIANGLES / Math.max(1, triangles)))));
}

interface Edge {
  a: THREE.Vector3;
  b: THREE.Vector3;
  na: THREE.Vector3;
  nb: THREE.Vector3;
  ab: THREE.Vector3;
  ba: THREE.Vector3;
  hardA: boolean;
  hardB: boolean;
}

/** Cubic PN position patches (Vlachos et al., 2001), with quadratic normals.
 * https://doi.org/10.1145/364338.364387
 * Tessellates a static pose. UV/color attributes stay barycentric within each
 * source triangle; material groups and split attributes are never welded.
 * Coincident edges use shared controls. At split normals, edge tangents are
 * constrained to both tangent planes. This keeps creases sharp and connected
 * while allowing curved boundaries such as a cylindrical headband.
 */
export function smoothGeometry(source: THREE.BufferGeometry, requested = 4, strength = 1): THREE.BufferGeometry {
  const segments = smoothingSegments(source, requested);
  const amount = Number.isFinite(strength) ? THREE.MathUtils.clamp(strength, 0, 1) : 1;
  if (segments === 1 || amount === 0) return source.clone();
  const flat = source.index ? source.toNonIndexed() : source.clone();
  if (!flat.getAttribute('normal')) flat.computeVertexNormals();
  const position = flat.getAttribute('position');
  const normal = flat.getAttribute('normal');
  const count = position.count;
  flat.computeBoundingBox();
  const size = flat.boundingBox!.getSize(new THREE.Vector3()).length();
  const tolerance = Math.max(size * 1e-7, 1e-10);
  const key = (p: THREE.Vector3) => `${Math.round(p.x / tolerance)},${Math.round(p.y / tolerance)},${Math.round(p.z / tolerance)}`;
  const edges = new Map<string, Edge>();
  const points = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const normals = points.map(() => new THREE.Vector3());
  const face = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  const edgePairs = [[0, 1], [1, 2], [2, 0]] as const;
  const readTriangle = (start: number) => {
    for (let i = 0; i < 3; i++) points[i].fromBufferAttribute(position, start + i);
    face.subVectors(points[1], points[0]).cross(scratch.subVectors(points[2], points[0])).normalize();
    if (face.lengthSq() === 0) face.set(0, 0, 1);
    for (let i = 0; i < 3; i++) {
      normals[i].fromBufferAttribute(normal, start + i).normalize();
      if (normals[i].lengthSq() === 0) normals[i].copy(face);
    }
  };
  const control = (a: THREE.Vector3, b: THREE.Vector3, n: THREE.Vector3) =>
    a.clone().multiplyScalar(2).add(b).addScaledVector(n, -scratch.subVectors(b, a).dot(n)).multiplyScalar(1 / 3);
  const constrain = (p: THREE.Vector3, q: THREE.Vector3, n: THREE.Vector3,
    other: THREE.Vector3, c: THREE.Vector3, constrained: boolean) => {
    if (n.dot(other) >= 0.9999) return constrained;
    if (constrained) {
      // More than two incident tangent planes: keep a valid common tangent,
      // or collapse this handle at a non-manifold corner.
      if (Math.abs(scratch.subVectors(c, p).dot(other)) > tolerance) c.copy(p);
    } else {
      const tangent = n.clone().cross(other);
      if (tangent.lengthSq() < 1e-12) return false; // opposite normals share a plane
      tangent.normalize();
      const length = scratch.subVectors(q, p).dot(tangent) / 3;
      c.copy(p).addScaledVector(tangent, length);
    }
    return true;
  };
  for (let start = 0; start < count; start += 3) {
    readTriangle(start);
    for (const [i, j] of edgePairs) {
      const ki = key(points[i]); const kj = key(points[j]);
      const [a, b] = ki < kj ? [i, j] : [j, i];
      const edgeKey = ki < kj ? `${ki}|${kj}` : `${kj}|${ki}`;
      const old = edges.get(edgeKey);
      if (old) {
        old.hardA = constrain(old.a, old.b, old.na, normals[a], old.ab, old.hardA);
        old.hardB = constrain(old.b, old.a, old.nb, normals[b], old.ba, old.hardB);
      } else {
        edges.set(edgeKey, { a: points[a].clone(), b: points[b].clone(),
          na: normals[a].clone(), nb: normals[b].clone(),
          ab: control(points[a], points[b], normals[a]), ba: control(points[b], points[a], normals[b]), hardA: false, hardB: false });
      }
    }
  }

  const result = new THREE.BufferGeometry();
  const outputCount = count * segments * segments;
  const attributes = Object.entries(flat.attributes).map(([name, attr]) => {
    const out = new THREE.BufferAttribute(new Float32Array(outputCount * attr.itemSize), attr.itemSize);
    result.setAttribute(name, out);
    return { name, attr, out };
  });
  const outPosition = result.getAttribute('position');
  const outNormal = result.getAttribute('normal');
  const center = new THREE.Vector3();
  const p = new THREE.Vector3();
  const linear = new THREE.Vector3();
  const n = new THREE.Vector3();
  const normalEdges = edgePairs.map(() => new THREE.Vector3());
  const controls: THREE.Vector3[] = [];
  let output = 0;
  for (let start = 0; start < count; start += 3) {
    readTriangle(start);
    center.set(0, 0, 0);
    edgePairs.forEach(([a, b], index) => {
      const ka = key(points[a]); const kb = key(points[b]);
      const e = edges.get(ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`)!;
      controls[index * 2] = ka < kb ? e.ab : e.ba;
      controls[index * 2 + 1] = ka < kb ? e.ba : e.ab;
      center.add(e.ab).add(e.ba);
      const direction = scratch.subVectors(points[b], points[a]);
      const sum = normalEdges[index].copy(normals[a]).add(normals[b]);
      const v = direction.lengthSq() > 1e-20 ? 2 * direction.dot(sum) / direction.lengthSq() : 0;
      sum.addScaledVector(direction, -v).normalize();
    });
    // b111 = 1.5 * average(edge controls) - 0.5 * average(vertices).
    center.multiplyScalar(0.25).addScaledVector(points[0], -1 / 6)
      .addScaledVector(points[1], -1 / 6).addScaledVector(points[2], -1 / 6);
    const emit = (i: number, j: number) => {
      const v = i / segments, w = j / segments, u = 1 - v - w;
      for (const { name, attr, out } of attributes) {
        if (name === 'position' || name === 'normal') continue;
        for (let c = 0; c < attr.itemSize; c++) out.setComponent(output, c,
          attr.getComponent(start, c) * u + attr.getComponent(start + 1, c) * v + attr.getComponent(start + 2, c) * w);
      }
      linear.copy(points[0]).multiplyScalar(u).addScaledVector(points[1], v).addScaledVector(points[2], w);
      p.copy(points[0]).multiplyScalar(u * u * u).addScaledVector(points[1], v * v * v).addScaledVector(points[2], w * w * w)
        .addScaledVector(controls[0], 3 * u * u * v).addScaledVector(controls[1], 3 * u * v * v)
        .addScaledVector(controls[2], 3 * v * v * w).addScaledVector(controls[3], 3 * v * w * w)
        .addScaledVector(controls[4], 3 * w * w * u).addScaledVector(controls[5], 3 * w * u * u)
        .addScaledVector(center, 6 * u * v * w);
      p.lerp(linear, 1 - amount);
      outPosition.setXYZ(output, p.x, p.y, p.z);
      n.copy(normals[0]).multiplyScalar(u * u).addScaledVector(normals[1], v * v).addScaledVector(normals[2], w * w)
        .addScaledVector(normalEdges[0], 2 * u * v).addScaledVector(normalEdges[1], 2 * v * w).addScaledVector(normalEdges[2], 2 * w * u);
      linear.copy(normals[0]).multiplyScalar(u).addScaledVector(normals[1], v).addScaledVector(normals[2], w).normalize();
      n.normalize().lerp(linear, 1 - amount).normalize();
      if (n.lengthSq() === 0) n.copy(face);
      outNormal.setXYZ(output, n.x, n.y, n.z);
      output++;
    };
    for (let i = 0; i < segments; i++) for (let j = 0; j < segments - i; j++) {
      emit(i, j); emit(i + 1, j); emit(i, j + 1);
      if (i + j < segments - 1) { emit(i + 1, j); emit(i + 1, j + 1); emit(i, j + 1); }
    }
  }
  const multiplier = segments * segments;
  for (const group of source.groups) result.addGroup(group.start * multiplier, group.count * multiplier, group.materialIndex);
  result.setDrawRange(source.drawRange.start * multiplier, source.drawRange.count * multiplier);
  result.computeBoundingBox();
  result.computeBoundingSphere();
  flat.dispose();
  return result;
}

// Cache one smoothing variant per posed geometry. Animation replacement disposes
// the base geometry, which also releases its subdivision and GPU buffers.
const cache = new WeakMap<THREE.BufferGeometry, { key: string; asset: ModelAsset }>();
export function smoothModel(asset: ModelAsset, segments = 4, strength = 1): ModelAsset {
  if (strength <= 0 || smoothingSegments(asset.geometry, segments) === 1) return asset;
  const key = `${segments}:${strength}`;
  const existing = cache.get(asset.geometry);
  if (existing?.key === key) return existing.asset;
  const geometry = smoothGeometry(asset.geometry, segments, strength);
  const result = { ...asset, geometry, radius: geometry.boundingSphere?.radius ?? asset.radius };
  existing?.asset.geometry.dispose();
  if (!existing) asset.geometry.addEventListener('dispose', () => {
    cache.get(asset.geometry)?.asset.geometry.dispose();
    cache.delete(asset.geometry);
  });
  cache.set(asset.geometry, { key, asset: result });
  return result;
}
