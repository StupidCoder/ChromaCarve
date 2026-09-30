import * as THREE from 'three';
import type { SliceResult, SliceSetup } from './types';

/** The source uses exactly the same centering, scale and XYZ rotation as the slicer. */
export function physicalModelMatrix(geometry: THREE.BufferGeometry, setup: SliceSetup) {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const scale = setup.sizeMm / Math.max(size.x, size.y, size.z);
  return new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
    ...setup.rotationDeg.map(THREE.MathUtils.degToRad) as [number, number, number], 'XYZ',
  )).multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
}

/** Exact cut contours, full measured thickness, no decorative bevels or gaps. */
export function plywoodGeometry(result: SliceResult): THREE.BufferGeometry {
  if (!result.valid) throw new Error('Resolve the cross-section errors before previewing the assembled model.');
  if (!result.pieceCount) throw new Error('No pieces intersect these sampling planes. Adjust the sampling offset or plywood thickness.');
  const chunks: { positions: Float32Array; normals: Float32Array; piece: number; layer: number }[] = [];
  let length = 0;
  // Upper bound on cap + wall vertices, checked before allocating extrusion data.
  const contourPoints = result.layers.reduce((sum, layer) => sum + layer.pieces.reduce((n, piece) =>
    n + piece.outer.length + piece.holes.reduce((m, hole) => m + hole.length + 2, 0), 0), 0);
  if (contourPoints * 36 > 18_000_000) throw new Error('This preview is too detailed. Increase the plywood thickness or simplify the model.');
  let pieceIndex = 0;
  for (const layer of result.layers) for (const piece of layer.pieces) {
      const shape = new THREE.Shape(piece.outer.map(([x, y]) => new THREE.Vector2(x, y)));
      shape.holes = piece.holes.map((ring) => new THREE.Path(ring.map(([x, y]) => new THREE.Vector2(x, y))));
    const slab = new THREE.ExtrudeGeometry(shape, { depth: layer.topMm - layer.bottomMm, bevelEnabled: false, steps: 1, curveSegments: 1 });
    // Slice frame (u,v,w) becomes world (u,w,-v).
    slab.rotateX(-Math.PI / 2);
    slab.translate(0, layer.bottomMm, 0);
    const p = slab.getAttribute('position'), n = slab.getAttribute('normal');
    chunks.push({ positions: p.array as Float32Array, normals: n.array as Float32Array, piece: pieceIndex++, layer: layer.index });
    length += p.array.length;
    slab.dispose();
  }
  const positions = new Float32Array(length), normals = new Float32Array(length);
  const pieceIds = new Float32Array(length / 3), layerIds = new Float32Array(length / 3);
  let offset = 0;
  for (const chunk of chunks) {
    positions.set(chunk.positions, offset); normals.set(chunk.normals, offset);
    pieceIds.fill(chunk.piece, offset / 3, (offset + chunk.positions.length) / 3);
    layerIds.fill(chunk.layer, offset / 3, (offset + chunk.positions.length) / 3);
    offset += chunk.positions.length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('slicePiece', new THREE.BufferAttribute(pieceIds, 1));
  geometry.setAttribute('sliceLayer', new THREE.BufferAttribute(layerIds, 1));
  geometry.computeBoundingBox();
  return geometry;
}
