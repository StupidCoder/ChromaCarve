import * as THREE from 'three';
import { getModelAsset, type ModelAsset } from '../assets/assetStore';
import type { ModelSettings } from '../state/store';

/** Procedural primitives are built on demand and cached by their parameters. */
const cache = new Map<string, ModelAsset>();
const MAX_CACHE = 16;

/** Only the fields that affect the resolved geometry. */
type GeoParams = Pick<
  ModelSettings,
  'source' | 'assetRef' | 'procTube' | 'procP' | 'procQ' | 'procSquash' | 'procBoxW' | 'procBoxD'
>;

const clampNum = (v: number, lo: number, hi: number, fallback: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** Stable cache/dependency key for a model's geometry-affecting params. */
export function geometryKey(m: GeoParams): string {
  if (m.source === 'obj') return `obj|${m.assetRef ?? ''}`;
  return `${m.source}|${m.procTube}|${m.procP}|${m.procQ}|${m.procSquash}|${m.procBoxW}|${m.procBoxD}`;
}

function buildProcedural(m: GeoParams): ModelAsset {
  // Sanitize params so a stray value can never produce NaN vertices.
  const tube = clampNum(m.procTube, 0.01, 0.49, 0.18);
  const p = Math.round(clampNum(m.procP, 1, 32, 2));
  const q = Math.round(clampNum(m.procQ, 1, 32, 3));
  const squash = clampNum(m.procSquash, 0.1, 5, 1);
  const boxW = clampNum(m.procBoxW, 0.1, 5, 1);
  const boxD = clampNum(m.procBoxD, 0.1, 5, 1);

  let geometry: THREE.BufferGeometry;
  if (m.source === 'sphere') {
    geometry = new THREE.SphereGeometry(0.5, 64, 48);
    geometry.scale(1, squash, 1); // squash the footprint -> oblate/prolate ellipsoid
  } else if (m.source === 'torus') {
    geometry = new THREE.TorusGeometry(0.5, tube, 32, 96);
  } else if (m.source === 'torusknot') {
    geometry = new THREE.TorusKnotGeometry(0.36, tube, 220, 32, p, q);
  } else {
    geometry = new THREE.BoxGeometry(boxW, 1, boxD);
  }
  geometry.computeBoundingSphere();
  return { geometry, radius: geometry.boundingSphere?.radius ?? 1 };
}

/** Resolve a model's geometry: the loaded OBJ, or a procedural primitive. */
export function resolveModel(m: GeoParams): ModelAsset | undefined {
  if (m.source === 'obj') return getModelAsset(m.assetRef);

  const key = geometryKey(m);
  const existing = cache.get(key);
  if (existing) {
    cache.delete(key); // LRU bump
    cache.set(key, existing);
    return existing;
  }
  const asset = buildProcedural(m);
  cache.set(key, asset);
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value as string;
    cache.get(oldest)?.geometry.dispose();
    cache.delete(oldest);
  }
  return asset;
}
