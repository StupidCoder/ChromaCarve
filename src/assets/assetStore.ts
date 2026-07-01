import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

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
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const center = new THREE.Vector3();
  geo.boundingBox!.getCenter(center);
  geo.translate(-center.x, -center.y, -center.z);
  geo.computeBoundingSphere();
  return geo;
}

/** Parse an OBJ File, merge + center it, and register under its filename. */
export async function loadObjFile(file: File): Promise<string> {
  const text = await file.text();
  const group = new OBJLoader().parse(text);
  const geometry = mergeGroup(group);
  if (geometry.getAttribute('position').count === 0) {
    throw new Error(`No geometry found in ${file.name}.`);
  }
  const radius = geometry.boundingSphere?.radius ?? 1;
  const existing = models.get(file.name);
  if (existing) existing.geometry.dispose();
  models.set(file.name, { geometry, radius });
  return file.name;
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
