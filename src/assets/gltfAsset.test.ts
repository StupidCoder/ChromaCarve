import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GltfAsset } from './gltfAsset';

function triangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  return g;
}

describe('GLB pose snapshots', () => {
  it('samples morphs at the exact endpoint, restores rest pose, and caches repeated samples', () => {
    const g = triangle();
    g.morphAttributes.position = [new THREE.Float32BufferAttribute([0, 0, 0, 3, 0, 0, 0, 1, 0], 3)];
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    mesh.name = 'subject';
    const clip = new THREE.AnimationClip('stretch', 1, [new THREE.NumberKeyframeTrack('subject.morphTargetInfluences[0]', [0, 1], [0, 1])]);
    const asset = new GltfAsset(mesh, [clip]);
    expect(asset.sample(0, 0).geometry.boundingBox!.max.x).toBeCloseTo(0.5);
    const end = asset.sample(0, 1);
    expect(end.geometry.boundingBox!.max.x).toBeCloseTo(1.5);
    expect(asset.sample(0, 1)).toBe(end);
    expect(asset.sample(-1).geometry.boundingBox!.max.x).toBeCloseTo(0.5);
    asset.dispose();
  });

  it('bakes bone animation and switches clips without retaining earlier transforms', () => {
    const g = triangle();
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const root = new THREE.Bone();
    const bone = new THREE.Bone(); bone.name = 'tip'; root.add(bone);
    const mesh = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial()); mesh.add(root);
    mesh.bind(new THREE.Skeleton([root, bone]));
    const clips = [
      new THREE.AnimationClip('wide', 1, [new THREE.VectorKeyframeTrack('tip.position', [0, 1], [0, 0, 0, 2, 0, 0])]),
      new THREE.AnimationClip('tall', 1, [new THREE.VectorKeyframeTrack('tip.position', [0, 1], [0, 0, 0, 0, 3, 0])]),
    ];
    const asset = new GltfAsset(mesh, clips);
    expect(asset.sample(0, 1).geometry.boundingBox!.max.x).toBeCloseTo(1.5);
    const tall = asset.sample(1, 1).geometry.boundingBox!;
    expect(tall.max.x).toBeCloseTo(0.5);
    expect(tall.max.y).toBeCloseTo(1.5);
    asset.dispose();
  });

  it('keeps material groups, UVs, texture references and vertex alpha across node transforms', () => {
    const scene = new THREE.Group();
    const map = new THREE.Texture();
    const a = new THREE.Mesh(triangle(), new THREE.MeshBasicMaterial({ map, alphaTest: 0.3, vertexColors: true }));
    a.geometry.setAttribute('color', new THREE.Float32BufferAttribute([1, 0, 0, 0.7, 1, 0, 0, 1, 1, 0, 0, 1], 4));
    const b = new THREE.Mesh(triangle(), new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
    b.position.x = 4; scene.add(a, b);
    const asset = new GltfAsset(scene, []);
    const pose = asset.sample();
    expect(pose.geometry.groups.map((g) => g.materialIndex)).toEqual([0, 1]);
    expect(pose.geometry.boundingBox!.max.x).toBeCloseTo(2.5);
    expect(pose.geometry.getAttribute('uv').getX(1)).toBe(1);
    expect(pose.geometry.getAttribute('color').getW(0)).toBeCloseTo(0.7);
    expect(pose.geometry.getAttribute('color').getW(3)).toBe(1);
    expect(pose.materials![0].map).toBe(map);
    expect(pose.materials![0].alphaTest).toBe(0.3);
    asset.dispose();
  });
  it('preserves PBR textures and smooth normals for studio reflections', () => {
    const g = triangle();
    const n = new THREE.Vector3(1, 1, 1).normalize();
    g.setAttribute('normal', new THREE.Float32BufferAttribute([...n, ...n, ...n], 3));
    const map = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ metalness: 0.95, roughness: 0.2,
      metalnessMap: map, roughnessMap: map, normalMap: map });
    const mesh = new THREE.Mesh(g, material);
    mesh.scale.set(2, 1, 0.5);
    mesh.rotation.y = 0.4;
    const asset = new GltfAsset(mesh, []);
    const pose = asset.sample();
    const pbr = pose.studioMaterials![0] as THREE.MeshStandardMaterial;
    expect(pbr.metalness).toBe(0.95);
    expect(pbr.roughness).toBe(0.2);
    expect(pbr.metalnessMap).toBe(map);
    expect(pbr.roughnessMap).toBe(map);
    expect(pbr.normalMap).toBe(map);
    const expected = n.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld));
    const actual = new THREE.Vector3().fromBufferAttribute(pose.geometry.getAttribute('normal'), 0);
    expect(actual.distanceTo(expected)).toBeLessThan(1e-6);
    asset.dispose();
  });

  it('rotates smooth normals with the animated skeleton', () => {
    const g = triangle();
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(12).fill(0), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const bone = new THREE.Bone(); bone.name = 'bone';
    const mesh = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial()); mesh.add(bone);
    mesh.bind(new THREE.Skeleton([bone]));
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const clip = new THREE.AnimationClip('turn', 1, [new THREE.QuaternionKeyframeTrack('bone.quaternion', [0, 1], [0, 0, 0, 1, ...q])]);
    const asset = new GltfAsset(mesh, [clip]);
    const normal = new THREE.Vector3().fromBufferAttribute(asset.sample(0, 1).geometry.getAttribute('normal'), 0);
    expect(normal.distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(1e-6);
    asset.dispose();
  });

});
