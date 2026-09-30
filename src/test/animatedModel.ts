import { BoxGeometry } from 'three';

/** Small self-contained GLB for import, pose and workspace-isolation tests. */
export function animatedModelFile(name = 'stretch.glb'): File {
  const geometry = new BoxGeometry(1, 1, 1).toNonIndexed();
  const positions = new Float32Array(geometry.getAttribute('position').array);
  const morph = positions.map((value, index) => index % 3 === 0 ? value * 2 : 0);
  const times = new Float32Array([0, 1]);
  const weights = new Float32Array([0, 1]);
  const arrays = [positions, morph, times, weights];
  let byteLength = 0;
  const bufferViews = arrays.map((array) => {
    const view = { buffer: 0, byteOffset: byteLength, byteLength: array.byteLength };
    byteLength += array.byteLength;
    return view;
  });
  const json = JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'Box' }],
    buffers: [{ byteLength }], bufferViews,
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      { bufferView: 1, componentType: 5126, count: morph.length / 3, type: 'VEC3', min: [-1, 0, 0], max: [1, 0, 0] },
      { bufferView: 2, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: 3, componentType: 5126, count: 2, type: 'SCALAR' },
    ],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.15, 0.55, 0.8, 1], metallicFactor: 0, roughnessFactor: 0.7 } }],
    meshes: [{ weights: [0], primitives: [{ attributes: { POSITION: 0 }, material: 0, targets: [{ POSITION: 1 }] }] }],
    animations: [{ name: 'Stretch', samplers: [{ input: 2, output: 3 }], channels: [{ sampler: 0, target: { node: 0, path: 'weights' } }] }],
  });
  const encoded = new TextEncoder().encode(json);
  const jsonSize = Math.ceil(encoded.length / 4) * 4;
  const output = new ArrayBuffer(12 + 8 + jsonSize + 8 + byteLength);
  const view = new DataView(output);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, output.byteLength, true);
  view.setUint32(12, jsonSize, true); view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(output, 20, jsonSize).fill(32);
  new Uint8Array(output, 20, encoded.length).set(encoded);
  const bin = 20 + jsonSize;
  view.setUint32(bin, byteLength, true); view.setUint32(bin + 4, 0x004e4942, true);
  arrays.forEach((array, index) => new Uint8Array(output, bin + 8 + bufferViews[index].byteOffset, array.byteLength).set(new Uint8Array(array.buffer)));
  geometry.dispose();
  return new File([output], name, { type: 'model/gltf-binary' });
}
