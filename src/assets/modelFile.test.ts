import { describe, expect, it } from 'vitest';
import { parseModelFile } from './modelFile';
import { getModelFile, getModelAsset, loadModelFile } from './assetStore';
import { animatedModelFile } from '../test/animatedModel';

const triangle = 'v 0 0 0\nv 2 0 0\nv 0 2 0\nf 1 2 3\n';

describe('shared model imports', () => {
  it('keeps GLB pose sampling and disposal independent between workspaces', async () => {
    const file = animatedModelFile();
    const relief = await parseModelFile(file);
    const slices = await parseModelFile(file);
    const original = relief.gltf!.sample(0, 1);
    expect(original.geometry.boundingBox!.max.x).toBeCloseTo(1.5);
    expect(slices.gltf!.sample(0, 0).geometry.boundingBox!.max.x).toBeCloseTo(0.5);
    expect(relief.gltf!.sample(0, 1)).toBe(original);
    slices.dispose();
    expect(relief.gltf!.sample(0, 1)).toBe(original);
    relief.dispose();
  });

  it('retains the original upload and does not replace it when a new import fails', async () => {
    const file = new File([triangle], 'source.obj');
    await loadModelFile(file);
    const asset = getModelAsset(file.name);
    expect(getModelFile(file.name)).toBe(file);
    await expect(loadModelFile(new File([''], file.name))).rejects.toThrow('no usable mesh');
    expect(getModelFile(file.name)).toBe(file);
    expect(getModelAsset(file.name)).toBe(asset);
  });

  it('rejects unsupported formats and empty files', async () => {
    await expect(parseModelFile(new File([triangle], 'model.txt'))).rejects.toThrow('GLB, OBJ or STL');
    await expect(parseModelFile(new File([''], 'empty.obj'))).rejects.toThrow('no usable mesh');
  });

  it('imports and centers an ASCII STL', async () => {
    const file = new File(['solid model\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 2 0 0\nvertex 0 2 0\nendloop\nendfacet\nendsolid model'], 'model.stl');
    const model = await parseModelFile(file);
    expect(model.asset.geometry.getAttribute('position').count).toBe(3);
    expect(model.asset.geometry.boundingBox!.min.x).toBe(-1);
    model.dispose();
  });
});
