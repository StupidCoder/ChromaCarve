import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

/**
 * In-memory registry for binary assets (uploaded images / OBJ models). These
 * are intentionally NOT part of the serializable project; the project only
 * references them by `assetRef` (filename). On JSON import the user re-uploads
 * the files, which repopulates this registry.
 */

export interface ImageAsset {
  image: HTMLImageElement;
  texture: THREE.Texture;
}

export interface ModelAsset {
  /** Geometry centered at the origin (merged into a single buffer geometry). */
  geometry: THREE.BufferGeometry;
  /** Radius of the bounding sphere (for framing cameras). */
  radius: number;
}

const images = new Map<string, ImageAsset>();
const models = new Map<string, ModelAsset>();

export function setImageAsset(ref: string, image: HTMLImageElement): void {
  const existing = images.get(ref);
  if (existing) existing.texture.dispose();
  const texture = new THREE.Texture(image);
  // flipY = true (the upload-time vertical flip) cancels the bottom-up WebGL
  // framebuffer + the top-down readback flip, so the image stays right-side up.
  texture.flipY = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  images.set(ref, { image, texture });
}

export function getImageAsset(ref: string | null): ImageAsset | undefined {
  return ref ? images.get(ref) : undefined;
}

export function getModelAsset(ref: string | null): ModelAsset | undefined {
  return ref ? models.get(ref) : undefined;
}

// Notified when an async asset (e.g. a bundled model) finishes loading, so the
// UI can re-render. Registered by App (avoids an assetStore -> store import cycle).
let onAssetLoaded: () => void = () => {};
export function setAssetLoadedCallback(cb: () => void): void {
  onAssetLoaded = cb;
}

/** Asset-store key for a bundled example model. */
export function bundledModelRef(source: string): string {
  return `bundled:${source}`;
}

const loadingBundles = new Set<string>();

/**
 * Decode a compact binary mesh (see `scripts/obj-to-mesh.mjs`): a header +
 * 16-bit-quantized positions + 32-bit triangle indices. Positions are
 * dequantized over the stored bounding box; normals are recomputed.
 */
function decodeMesh(buffer: ArrayBuffer): THREE.BufferGeometry {
  const head = new Uint32Array(buffer, 0, 4);
  if (head[0] !== 0x48534d43) throw new Error('Unrecognized mesh format.');
  const vCount = head[2];
  const iCount = head[3];
  const bbox = new Float32Array(buffer, 16, 6); // minXYZ, maxXYZ
  const quant = new Uint16Array(buffer, 40, vCount * 3);
  const positions = new Float32Array(vCount * 3);
  for (let i = 0; i < vCount * 3; i++) {
    const k = i % 3;
    positions[i] = bbox[k] + (quant[i] / 65535) * (bbox[k + 3] - bbox[k]);
  }
  const idxByte = 40 + vCount * 3 * 2;
  const indices = new Uint32Array(buffer.slice(idxByte, idxByte + iCount * 4));

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const center = new THREE.Vector3();
  geo.boundingBox!.getCenter(center);
  geo.translate(-center.x, -center.y, -center.z);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Fetch a gzipped binary mesh (once) from `url`, gunzip it via the browser's
 * Compression Streams API, decode + register it under `bundledModelRef(source)`,
 * and notify listeners. Safe to call repeatedly (in-flight/loaded refs skipped).
 */
export function ensureBundledModel(source: string, url: string): void {
  const ref = bundledModelRef(source);
  if (models.has(ref) || loadingBundles.has(ref)) return;
  loadingBundles.add(ref);
  fetch(url)
    .then((r) => {
      if (!r.ok || !r.body) throw new Error(`Failed to fetch model ${url} (${r.status}).`);
      return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    })
    .then((buffer) => {
      const geometry = decodeMesh(buffer);
      models.set(ref, { geometry, radius: geometry.boundingSphere?.radius ?? 1 });
      onAssetLoaded();
    })
    .catch((e) => console.error(e))
    .finally(() => loadingBundles.delete(ref));
}

/** Recompute normals, center the geometry at the origin, compute bounding sphere. */
function centerAndFinalize(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const center = new THREE.Vector3();
  geo.boundingBox!.getCenter(center);
  geo.translate(-center.x, -center.y, -center.z);
  geo.computeBoundingSphere();
  return geo;
}

/** Merge all meshes of an OBJ group into one centered position+normal geometry. */
function mergeGroup(group: THREE.Object3D): THREE.BufferGeometry {
  group.updateMatrixWorld(true);
  const positions: number[] = [];
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    let g = mesh.geometry.clone();
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(mesh.matrixWorld);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return centerAndFinalize(geo);
}

/** Register a parsed geometry under `name`, replacing any existing entry. */
function registerModel(name: string, geometry: THREE.BufferGeometry): string {
  if (geometry.getAttribute('position').count === 0) {
    throw new Error(`No geometry found in ${name}.`);
  }
  models.get(name)?.geometry.dispose();
  models.set(name, { geometry, radius: geometry.boundingSphere?.radius ?? 1 });
  return name;
}

/** Parse an OBJ File, merge + center it, and register under its filename. */
export async function loadObjFile(file: File): Promise<string> {
  return registerModel(file.name, mergeGroup(new OBJLoader().parse(await file.text())));
}

/** Parse an STL File (binary or ASCII), center it, and register under its filename. */
export async function loadStlFile(file: File): Promise<string> {
  const geometry = new STLLoader().parse(await file.arrayBuffer());
  return registerModel(file.name, centerAndFinalize(geometry));
}

/** Load an uploaded model file, dispatching to the OBJ or STL loader by extension. */
export async function loadModelFile(file: File): Promise<string> {
  return /\.stl$/i.test(file.name) ? loadStlFile(file) : loadObjFile(file);
}

/** Load a File into an HTMLImageElement and register it under its filename. */
export async function loadImageFile(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${file.name}`));
      img.src = url;
    });
    setImageAsset(file.name, image);
    return file.name;
  } finally {
    URL.revokeObjectURL(url);
  }
}
