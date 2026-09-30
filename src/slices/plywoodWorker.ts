import { plywoodGeometry } from './geometry/plywood';
import type { SliceResult } from './geometry/types';
self.onmessage = ({ data }: MessageEvent<SliceResult>) => {
  try {
    const geometry = plywoodGeometry(data);
    const positions = geometry.getAttribute('position').array as Float32Array;
    const normals = geometry.getAttribute('normal').array as Float32Array;
    const pieceIds = geometry.getAttribute('slicePiece').array as Float32Array;
    const layerIds = geometry.getAttribute('sliceLayer').array as Float32Array;
    self.postMessage({ positions, normals, pieceIds, layerIds }, { transfer: [positions.buffer, normals.buffer, pieceIds.buffer, layerIds.buffer] });
    geometry.dispose();
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Could not build the plywood preview.' });
  }
};
