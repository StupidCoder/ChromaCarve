import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importSlicesModel, initializeSlices, setSlicesPose, setSliceSetup, useSlicesStore } from './store';
import * as storage from './storage';
import { animatedModelFile } from '../test/animatedModel';

beforeEach(() => {
  vi.restoreAllMocks();
  useSlicesStore.getState().model?.dispose();
  useSlicesStore.setState({ initialized: false, busy: false, saveStatus: 'saved', model: undefined, asset: undefined, document: undefined, error: undefined }, true);
});

describe('Slices workspace lifecycle', () => {
  it('restores the original file and selected animated pose in a fresh workspace', async () => {
    const file = animatedModelFile();
    const id = await storage.saveSlicesHandoff({ version: 1, source: { name: file.name, data: file }, pose: { animationIndex: 0, animationTime: 0.75 }, viewQuaternion: [0, 0, 0, 1] });
    const first = initializeSlices(id);
    expect(initializeSlices(id)).toBe(first);
    await first;
    expect(useSlicesStore.getState().asset!.geometry.boundingBox!.max.x).toBeCloseTo(1.25);
    useSlicesStore.getState().model!.dispose();
    useSlicesStore.setState({ initialized: false, model: undefined, asset: undefined, document: undefined });
    await initializeSlices(null);
    expect(useSlicesStore.getState().document?.pose.animationTime).toBe(0.75);
    expect(useSlicesStore.getState().asset!.geometry.boundingBox!.max.x).toBeCloseTo(1.25);
  });

  it('keeps the current model after a failed replacement', async () => {
    await importSlicesModel(animatedModelFile());
    const previous = useSlicesStore.getState().model;
    await importSlicesModel(new File([''], 'empty.obj'));
    expect(useSlicesStore.getState().model).toBe(previous);
    expect(useSlicesStore.getState().busy).toBe(false);
    expect(useSlicesStore.getState().error).toContain('no usable mesh');
  });

  it('keeps imports usable when browser storage fails', async () => {
    vi.spyOn(storage, 'saveSlicesDocument').mockRejectedValue(new Error('Quota exceeded'));
    await importSlicesModel(animatedModelFile());
    expect(useSlicesStore.getState().asset).toBeDefined();
    expect(useSlicesStore.getState().saveStatus).toBe('unavailable');
    setSlicesPose({ animationIndex: 0, animationTime: 1 });
    expect(useSlicesStore.getState().asset!.geometry.boundingBox!.max.x).toBeCloseTo(1.5);
    await vi.waitFor(() => expect(useSlicesStore.getState().saveStatus).toBe('unavailable'));
  });

  it('reports missing handoffs without silently opening an unrelated project', async () => {
    await expect(initializeSlices('missing')).rejects.toThrow('no longer available');
    expect(useSlicesStore.getState().asset).toBeUndefined();
    expect(useSlicesStore.getState().busy).toBe(false);
  });
});


it('keeps physical setup through pose edits and bounds offsets to the measured thickness', async () => {
  await importSlicesModel(animatedModelFile());
  setSliceSetup({ sizeMm: 200, samplingOffsetMm: 1 });
  setSliceSetup({ thicknessMm: 1 });
  expect(useSlicesStore.getState().document?.setup?.samplingOffsetMm).toBe(0.5);
  setSlicesPose({ animationIndex: 0, animationTime: 1 });
  expect(useSlicesStore.getState().document?.setup?.sizeMm).toBe(200);
  setSliceSetup({ thicknessMm: NaN });
  expect(useSlicesStore.getState().document?.setup?.thicknessMm).toBe(1);
  await vi.waitFor(() => expect(useSlicesStore.getState().saveStatus).toBe('saved'));
});
