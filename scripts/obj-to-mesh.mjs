// Convert a triangulated OBJ into a compact, gzipped binary mesh for the web.
// Only positions + triangle indices are kept (the app recomputes normals).
// Positions are quantized to 16-bit over the bounding box (error is negligible
// for this use). Decoded in the browser with the Compression Streams API.
//
// Layout (little-endian):
//   u32 magic 'CMSH' | u32 version(2) | u32 vertexCount | u32 indexCount
//   f32 bboxMin[3] | f32 bboxMax[3]
//   u16 quantPositions[vertexCount*3] | u32 indices[indexCount]
//
// Optional 3rd arg rotates positions, e.g. 'x90', 'x-90', 'y-90', 'z90'
// (axis + signed degrees, right-handed). Bakes a default orientation.
//
// Usage: node scripts/obj-to-mesh.mjs input.obj output.msh [rotation]
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const [, , inPath, outPath, rot] = process.argv;
if (!inPath || !outPath) throw new Error('usage: obj-to-mesh.mjs input.obj output.msh [rotation]');

/** Rotate [x,y,z] by the optional `axis+deg` spec (right-handed). */
function rotate(x, y, z) {
  if (!rot) return [x, y, z];
  const axis = rot[0];
  const t = (parseFloat(rot.slice(1)) * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  if (axis === 'x') return [x, y * c - z * s, y * s + z * c];
  if (axis === 'y') return [x * c + z * s, y, -x * s + z * c];
  if (axis === 'z') return [x * c - y * s, x * s + y * c, z];
  throw new Error(`bad rotation axis in "${rot}" (use x/y/z)`);
}

const pos = [];
const idx = [];
for (const line of readFileSync(inPath, 'utf8').split('\n')) {
  if (line.startsWith('v ')) {
    const p = line.split(/\s+/);
    pos.push(...rotate(+p[1], +p[2], +p[3]));
  } else if (line.startsWith('f ')) {
    // face tokens may be 'v', 'v/vt' or 'v//vn'; take the vertex index (1-based).
    const v = line.split(/\s+/).slice(1).map((t) => parseInt(t, 10) - 1);
    for (let i = 2; i < v.length; i++) idx.push(v[0], v[i - 1], v[i]); // fan-triangulate
  }
}

const vCount = pos.length / 3;
const iCount = idx.length;
const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < pos.length; i += 3)
  for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], pos[i + k]);
    max[k] = Math.max(max[k], pos[i + k]);
  }

const quant = new Uint16Array(pos.length);
for (let i = 0; i < pos.length; i += 3)
  for (let k = 0; k < 3; k++) {
    const span = max[k] - min[k] || 1;
    quant[i + k] = Math.round(((pos[i + k] - min[k]) / span) * 65535);
  }

const header = new Uint32Array([0x48534d43, 2, vCount, iCount]);
const bbox = new Float32Array([min[0], min[1], min[2], max[0], max[1], max[2]]);
const buf = Buffer.concat([
  Buffer.from(header.buffer),
  Buffer.from(bbox.buffer),
  Buffer.from(quant.buffer),
  Buffer.from(new Uint32Array(idx).buffer),
]);
const gz = gzipSync(buf, { level: 9 });
writeFileSync(outPath, gz);
console.log(`verts=${vCount} tris=${iCount / 3} -> ${outPath}`);
console.log(`raw ${(buf.length / 1e6).toFixed(2)} MB, gzipped ${(gz.length / 1e6).toFixed(2)} MB`);
