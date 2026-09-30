import type { BufferGeometry } from 'three';
import { MAX_SLICE_TRIANGLES } from './sliceMesh';
import type { SliceInput, SliceSetup } from './types';

/** GLB assets already bake skinning, morphs and node transforms into this pose. */
export function snapshotForSlicing(geometry: BufferGeometry, setup: SliceSetup): SliceInput {
  const source = geometry.getAttribute('position');
  if ((geometry.index?.count ?? source.count) / 3 > MAX_SLICE_TRIANGLES) {
    throw new Error(`Simplify this model to ${MAX_SLICE_TRIANGLES.toLocaleString()} triangles or fewer before slicing.`);
  }
  const positions = new Float64Array(source.count * 3);
  for (let i = 0; i < source.count; i++) {
    positions[i * 3] = source.getX(i);
    positions[i * 3 + 1] = source.getY(i);
    positions[i * 3 + 2] = source.getZ(i);
  }
  const indices = geometry.index ? new Uint32Array(geometry.index.array) : undefined;
  return { positions, indices, setup: { ...setup, rotationDeg: [...setup.rotationDeg] } };
}
