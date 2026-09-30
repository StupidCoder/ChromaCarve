import { createSheetLayout } from './sheets';
import { DEFAULT_SHEETS } from './sheetSettings';
import { DEFAULT_MARKINGS } from './markingSettings';
import { generateMarkings } from './markings';
import { suggestedOmissions, omitPieces } from './omissions';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GltfAsset } from '../../assets/gltfAsset';
import { snapshotForSlicing } from './snapshot';
import { sliceMesh } from './sliceMesh';
import { analyzeAssembly } from './assembly';
import { plywoodGeometry } from './plywood';
import { DEFAULT_SLICE_SETUP } from './types';

// Optional local regression: the copyrighted model is never bundled or checked in.
const filename = process.env.SLICES_CAPTAIN_TOAD_GLB;
it.skipIf(!filename)('repairs the supplied Captain Toad rest pose without losing its separate pieces', async () => {
  const bytes = readFileSync(filename!);
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString());
  // The Node test needs no images. Preserve all geometry, skins, animations and
  // transforms; the browser test exercises the actual textured file separately.
  json.materials = json.materials.map((material: { doubleSided?: boolean }) => ({ doubleSided: material.doubleSided }));
  delete json.images; delete json.textures;
  const text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)]);
  const binary = bytes.subarray(20 + length);
  const glb = Buffer.alloc(20 + padded.length + binary.length);
  bytes.copy(glb, 0, 0, 12); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(glb, 20); binary.copy(glb, 20 + padded.length);
  const parsed = await new GLTFLoader().parseAsync(glb.buffer, '');
  const model = new GltfAsset(parsed.scene, parsed.animations);
  try {
    const asset = model.sample();
    const original = snapshotForSlicing(asset.geometry, DEFAULT_SLICE_SETUP);
    expect(original.positions.length / 9).toBe(2478);
    const strict = sliceMesh(original);
    expect(strict.layers).toHaveLength(50);
    expect(strict.layers.filter((layer) => !layer.valid)).toHaveLength(39);
    const conservative = sliceMesh({ ...original, setup: { ...original.setup, repairMode: 'automatic', repairGapMm: 0.5 } });
    expect(conservative.layers.filter((layer) => !layer.valid).map((layer) => layer.index + 1)).toEqual([26]);
    const repaired = sliceMesh({ ...original, setup: { ...original.setup, repairMode: 'automatic', repairGapMm: 1 } });
    expect(repaired.valid).toBe(true);
    expect(repaired.pieceCount).toBe(90);
    expect(repaired.layers.every((layer) => layer.valid && layer.pieces.length)).toBe(true);
    expect(repaired.layers.reduce((sum, layer) => sum + layer.repair!.shortGaps, 0)).toBe(12);
    expect(repaired.layers.reduce((sum, layer) => sum + layer.repair!.attachedPaths, 0)).toBe(41);
    expect(repaired.layers[16].pieces.some((piece) => piece.holes.length)).toBe(true);
    const assembly = analyzeAssembly(repaired);
    expect(assembly.groups).toBe(3);
    expect(assembly.pieces.filter(piece => !piece.grounded).map(piece => piece.id)).toEqual(['18.2', '18.7']);
    expect(assembly.pieces.filter(piece => piece.warnings.length)).toHaveLength(17);
    repaired.assembly = assembly;
    expect(suggestedOmissions(repaired)).toEqual(['18.1', '18.8']);
    const retained = omitPieces(repaired, suggestedOmissions(repaired));
    expect(retained.pieceCount).toBe(88);
    expect(retained.assembly).toEqual(analyzeAssembly(retained));
    const markings = generateMarkings(retained);
    expect(markings.contacts).toHaveLength(96);
    expect(markings.contacts.filter(c => c.label.length)).toHaveLength(69);
    expect(markings.contacts.filter(c => c.guides.length)).toHaveLength(82);
    expect(markings.contacts.some(c => ['18.1','18.8'].includes(c.below) || ['18.1','18.8'].includes(c.above))).toBe(false);
    const layout = createSheetLayout(retained, DEFAULT_SHEETS, DEFAULT_MARKINGS);
    expect(layout.sheets).toHaveLength(2);
    expect(new Set(layout.sheets.flatMap(s => s.pieces.map(p => p.id))).size).toBe(88);
    expect(layout.sheets.flatMap(s => s.pieces).some(p => p.id === '18.1' || p.id === '18.8')).toBe(false);
    const plywood = plywoodGeometry(repaired);
    expect(plywood.boundingBox!.max.y - plywood.boundingBox!.min.y).toBeCloseTo(150);
    plywood.dispose();
    expect(snapshotForSlicing(asset.geometry, DEFAULT_SLICE_SETUP).positions).toEqual(original.positions);
  } finally { model.dispose(); }
});
