import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { readSlicesDocument, saveSlicesDocument, saveSlicesHandoff, removeSlicesHandoff, type SlicesDocument } from './storage';

function document(name: string): SlicesDocument {
  return { version: 1, source: { name, data: new Blob(['source bytes']) }, pose: { animationIndex: 2, animationTime: 0.75 }, viewQuaternion: [0, 0, 0, 1] };
}

describe('browser project storage', () => {
  it('preserves source bytes and pose without consuming or overwriting the current project', async () => {
    await saveSlicesDocument(document('current.glb'));
    const id = await saveSlicesHandoff(document('incoming.glb'));
    const incoming = await readSlicesDocument(id);
    expect(incoming?.source.name).toBe('incoming.glb');
    expect(await incoming!.source.data.text()).toBe('source bytes');
    expect(incoming?.pose).toEqual({ animationIndex: 2, animationTime: 0.75 });
    expect((await readSlicesDocument())?.source.name).toBe('current.glb');
    expect((await readSlicesDocument(id))?.source.name).toBe('incoming.glb');
    await removeSlicesHandoff(id);
    expect(await readSlicesDocument(id)).toBeUndefined();
    expect((await readSlicesDocument())?.source.name).toBe('current.glb');
  });

  it('fails clearly for an incompatible or damaged saved project', async () => {
    const invalid = document('bad.glb');
    invalid.pose.animationTime = NaN;
    await saveSlicesDocument(invalid);
    await expect(readSlicesDocument()).rejects.toThrow('cannot be read');
  });
});


describe('physical setup persistence', () => {
  it('migrates milestone-1 projects to physical defaults', async () => {
    await saveSlicesDocument(document('legacy.glb'));
    expect((await readSlicesDocument())?.setup).toEqual({ sizeMm: 150, thicknessMm: 3, rotationDeg: [0, 0, 0], samplingOffsetMm: 0 });
  });

  it('restores measured thickness, rotation and sampling offset', async () => {
    const project = document('physical.glb');
    project.setup = { sizeMm: 234, thicknessMm: 2.85, rotationDeg: [45, -20, 10], samplingOffsetMm: -0.4 };
    await saveSlicesDocument(project);
    expect((await readSlicesDocument())?.setup).toEqual(project.setup);
  });

  it('rejects corrupt physical settings instead of silently changing the geometry', async () => {
    const project = document('broken.glb');
    project.setup = { sizeMm: 150, thicknessMm: 0, rotationDeg: [0, 0, 0], samplingOffsetMm: 0 };
    await saveSlicesDocument(project);
    await expect(readSlicesDocument()).rejects.toThrow('physical model settings are invalid');
  });
});
