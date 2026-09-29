import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { studioMaterial } from '../three/studioEnvironment';
import { posedNormals } from './posedNormals';
import type { ModelAsset } from './assetStore';

/** Retains the animated source; consumers receive a static, centered pose. */
export class GltfAsset {
  readonly mixer: THREE.AnimationMixer;
  private pose: ModelAsset | undefined;
  private key = '';
  private studio = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  readonly materials = new Map<THREE.Material, THREE.MeshBasicMaterial>();

  constructor(readonly scene: THREE.Object3D, readonly animations: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(scene);
  }

  get hasPbrMaterials(): boolean { return this.studio.size > 0; }

  sample(animation = -1, time = 0): ModelAsset {
    const clip = this.animations[animation];
    const t = clip && Number.isFinite(time) ? Math.max(0, Math.min(time, clip.duration)) : 0;
    const key = `${clip ? animation : -1}:${t}`;
    if (this.pose && this.key === key) return this.pose;
    this.mixer.stopAllAction(); // restores properties from the previous clip
    if (clip) {
      const action = this.mixer.clipAction(clip);
      action.reset().setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      this.mixer.setTime(t);
    }
    this.scene.updateMatrixWorld(true);
    const pieces: THREE.BufferGeometry[] = [];
    const materials: THREE.MeshBasicMaterial[] = [];
    const studioMaterials: (THREE.MeshBasicMaterial | THREE.MeshStandardMaterial)[] = [];
    let hasPbr = false;
    const vertex = new THREE.Vector3();
    this.scene.traverseVisible((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const source = object.geometry;
      const pos = source.getAttribute('position');
      const posed = source.clone();
      const positions = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        object.getVertexPosition(i, vertex).applyMatrix4(object.matrixWorld);
        vertex.toArray(positions, i * 3);
      }
      posed.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const normals = posedNormals(object);
      if (normals) posed.setAttribute('normal', normals);
      else posed.computeVertexNormals();
      posed.morphAttributes = {};
      const flat = posed.index ? posed.toNonIndexed() : posed;
      if (flat !== posed) posed.dispose();
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      const groups = Array.isArray(object.material) ? source.groups : [{ start: 0, count: flat.getAttribute('position').count, materialIndex: 0 }];
      for (const group of groups) {
        const material = sourceMaterials[group.materialIndex ?? 0];
        if (!material?.visible) continue;
        const start = Math.max(group.start, source.drawRange.start);
        const end = Math.min(group.start + group.count, source.drawRange.start + source.drawRange.count, flat.getAttribute('position').count);
        if (end <= start) continue;
        const piece = new THREE.BufferGeometry();
        // Common attributes permit merging meshes with differing UV/color layouts.
        for (const [name, size, fallback] of [['position', 3, 0], ['normal', 3, 0], ['uv', 2, 0], ['uv1', 2, 0], ['color', 4, 1]] as const) {
          const attr = flat.getAttribute(name);
          const data = new Float32Array((end - start) * size).fill(fallback);
          if (attr) for (let i = start; i < end; i++) for (let c = 0; c < Math.min(size, attr.itemSize); c++) {
            data[(i - start) * size + c] = attr.getComponent(i, c);
          }
          piece.setAttribute(name, new THREE.BufferAttribute(data, size));
        }
        // Preserve winding under mirrored node transforms.
        if (object.matrixWorld.determinant() < 0) {
          for (const attr of Object.values(piece.attributes)) for (let i = 0; i + 2 < attr.count; i += 3) {
            for (let c = 0; c < attr.itemSize; c++) {
              const a = attr.getComponent(i, c);
              attr.setComponent(i, c, attr.getComponent(i + 2, c));
              attr.setComponent(i + 2, c, a);
            }
          }
        }
        pieces.push(piece);
        let basic = this.materials.get(material);
        if (!basic) {
          const m = material as THREE.MeshStandardMaterial;
          basic = new THREE.MeshBasicMaterial({
            color: m.color ?? new THREE.Color(1, 1, 1), map: m.map ?? null,
            alphaMap: m.alphaMap ?? null, opacity: m.opacity,
            // Height maps represent one surface: treat blended alpha as a cutout.
            alphaTest: Math.max(m.alphaTest, m.transparent ? 0.5 : 0),
            side: m.side, vertexColors: m.vertexColors, toneMapped: false,
          });
          this.materials.set(material, basic);
        }
        materials.push(basic);
        if (material instanceof THREE.MeshStandardMaterial) {
          let pbr = this.studio.get(material);
          if (!pbr) {
            pbr = studioMaterial(material);
            this.studio.set(material, pbr);
          }
          studioMaterials.push(pbr);
          hasPbr = true;
        } else {
          studioMaterials.push(basic); // KHR_materials_unlit remains unlit.
        }
      }
      flat.dispose();
    });
    if (!pieces.length) throw new Error('No visible mesh geometry found in this GLB.');
    const geometry = mergeGeometries(pieces, true)!;
    pieces.forEach((g) => g.dispose());
    geometry.computeBoundingBox();
    const center = geometry.boundingBox!.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.computeBoundingSphere();
    this.pose?.geometry.dispose();
    this.pose = { geometry, radius: geometry.boundingSphere!.radius, materials, studioMaterials: hasPbr ? studioMaterials : undefined };
    this.key = key;
    return this.pose;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.scene);
    this.pose?.geometry.dispose();
    this.materials.forEach((m) => m.dispose());
    this.studio.forEach((m) => m.dispose());
    const textures = new Set<THREE.Texture>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    });
    materials.forEach((m) => {
      Object.values(m).forEach((v) => { if (v instanceof THREE.Texture) textures.add(v); });
      m.dispose();
    });
    textures.forEach((t) => { t.dispose(); if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) t.image.close(); });
  }
}
