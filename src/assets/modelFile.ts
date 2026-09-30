import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GltfAsset } from './gltfAsset';
import type { ModelAsset } from './assetStore';

/** A workspace owns its parsed model, including all geometry and materials. */
export interface LoadedModel {
  asset: ModelAsset;
  gltf?: GltfAsset;
  dispose: () => void;
}

function validateGeometry(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute('position');
  if (!positions?.count || !positions.array.every(Number.isFinite)) {
    throw new Error('The file contains no usable mesh geometry.');
  }
}

/** Recompute normals, center the geometry at the origin, compute bounding sphere. */
function centerAndFinalize(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  try { validateGeometry(geo); }
  catch (error) { geo.dispose(); throw error; }
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
    if (g.index) {
      const indexed = g;
      g = g.toNonIndexed();
      indexed.dispose();
    }
    g.applyMatrix4(mesh.matrixWorld);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    g.dispose();
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return centerAndFinalize(geo);
}

/** Shared parser; no global registry mutations or workspace settings. */
export async function parseModelFile(file: File): Promise<LoadedModel> {
  if (!/\.(glb|obj|stl)$/i.test(file.name)) {
    throw new Error('Choose a GLB, OBJ or STL model.');
  }
  if (/\.glb$/i.test(file.name)) {
    const source = await new GLTFLoader().parseAsync(await file.arrayBuffer(), '');
    const gltf = new GltfAsset(source.scene, source.animations);
    try {
      const asset = gltf.sample();
      validateGeometry(asset.geometry);
      return { asset, gltf, dispose: () => gltf.dispose() };
    } catch (error) {
      gltf.dispose();
      throw error;
    }
  }
  const geometry = /\.stl$/i.test(file.name)
    ? centerAndFinalize(new STLLoader().parse(await file.arrayBuffer()))
    : mergeGroup(new OBJLoader().parse(await file.text()));
  return {
    asset: { geometry, radius: geometry.boundingSphere?.radius ?? 1 },
    dispose: () => geometry.dispose(),
  };
}
