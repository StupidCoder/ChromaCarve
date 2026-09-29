import * as THREE from 'three';

/** Matches Three's morph + skin normal transforms before baking world space. */
export function posedNormals(mesh: THREE.Mesh): THREE.BufferAttribute | undefined {
  const base = mesh.geometry.getAttribute('normal');
  if (!base) return undefined;
  const result = new Float32Array(base.count * 3);
  const n = new THREE.Vector3();
  const original = new THREE.Vector3();
  const morph = new THREE.Vector3();
  const world = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const skin = new THREE.Matrix4();
  const bone = new THREE.Matrix4();
  const skinNormal = new THREE.Matrix3();
  for (let i = 0; i < base.count; i++) {
    original.fromBufferAttribute(base, i);
    n.copy(original);
    mesh.geometry.morphAttributes.normal?.forEach((attr, j) => {
      const weight = mesh.morphTargetInfluences?.[j] ?? 0;
      if (!weight) return;
      morph.fromBufferAttribute(attr, i);
      if (!mesh.geometry.morphTargetsRelative) morph.sub(original);
      n.addScaledVector(morph, weight);
    });
    if (mesh instanceof THREE.SkinnedMesh) {
      skin.elements.fill(0);
      for (let j = 0; j < 4; j++) {
        const weight = mesh.geometry.getAttribute('skinWeight').getComponent(i, j);
        if (!weight) continue;
        const index = mesh.geometry.getAttribute('skinIndex').getComponent(i, j);
        bone.multiplyMatrices(mesh.skeleton.bones[index].matrixWorld, mesh.skeleton.boneInverses[index]);
        for (let k = 0; k < 16; k++) skin.elements[k] += bone.elements[k] * weight;
      }
      skin.premultiply(mesh.bindMatrixInverse).multiply(mesh.bindMatrix);
      // w=0, matching skinnormal_vertex (translation must not affect normals).
      n.applyMatrix3(skinNormal.setFromMatrix4(skin));
    }
    n.applyNormalMatrix(world).toArray(result, i * 3);
  }
  return new THREE.BufferAttribute(result, 3);
}
