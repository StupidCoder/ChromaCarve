import { create } from 'zustand';
import type { ModelAsset } from '../assets/assetStore';
import { parseModelFile, type LoadedModel } from '../assets/modelFile';
import { readSlicesDocument, saveSlicesDocument, type SlicePose, type SlicesDocument } from './storage';
import { DEFAULT_SLICE_SETUP, validSliceSetup, type SliceSetup } from './geometry/types';

interface SlicesState {
  document?: SlicesDocument;
  model?: LoadedModel;
  asset?: ModelAsset;
  initialized: boolean;
  busy: boolean;
  error?: string;
  saveStatus: 'saved' | 'saving' | 'unavailable';
}

export const useSlicesStore = create<SlicesState>(() => ({ initialized: false, busy: false, saveStatus: 'saved' }));
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
let operation = 0;
let saveRevision = 0;
const pending = new Map<string, Promise<void>>();

async function persist(document: SlicesDocument) {
  const revision = ++saveRevision;
  useSlicesStore.setState({ saveStatus: 'saving' });
  try {
    await saveSlicesDocument(document);
    if (revision === saveRevision) useSlicesStore.setState({ saveStatus: 'saved' });
  } catch {
    if (revision === saveRevision) useSlicesStore.setState({ saveStatus: 'unavailable' });
  }
}

function sample(model: LoadedModel, pose: SlicePose): ModelAsset {
  return model.gltf?.sample(pose.animationIndex, pose.animationTime) ?? model.asset;
}

async function install(document: SlicesDocument, token: number): Promise<void> {
  const model = await parseModelFile(new File([document.source.data], document.source.name));
  if (token !== operation) { model.dispose(); return; }
  const clip = model.gltf?.animations[document.pose.animationIndex];
  const pose = {
    animationIndex: clip ? document.pose.animationIndex : -1,
    animationTime: clip ? Math.min(document.pose.animationTime, clip.duration) : 0,
  };
  let asset: ModelAsset;
  try { asset = sample(model, pose); }
  catch (error) { model.dispose(); throw error; }
  const previous = useSlicesStore.getState().model;
  const next = { ...document, pose, setup: document.setup ?? { ...DEFAULT_SLICE_SETUP, rotationDeg: [0, 0, 0] as [number, number, number] } };
  useSlicesStore.setState({ model, asset, document: next, initialized: true, busy: false, error: undefined });
  previous?.dispose();
  await persist(next);
}

/** Shared promise makes React StrictMode and repeated mounts safe. */
export function initializeSlices(handoff: string | null): Promise<void> {
  const key = handoff ?? 'current';
  const existing = pending.get(key);
  if (existing) return existing;
  if (!handoff && useSlicesStore.getState().initialized) return Promise.resolve();
  const token = ++operation;
  useSlicesStore.setState({ busy: true, error: undefined });
  const task = (async () => {
    try {
      const document = await readSlicesDocument(handoff);
      if (token !== operation) return;
      if (handoff && !document) throw new Error('This model handoff is no longer available. Open it from Reliefs again, or choose a model file.');
      if (document) await install(document, token);
      else useSlicesStore.setState({ initialized: true, busy: false });
    } catch (error) {
      if (token === operation) useSlicesStore.setState({ initialized: true, busy: false, error: message(error) });
      throw error;
    }
  })();
  pending.set(key, task);
  void task.then(() => pending.delete(key), () => pending.delete(key));
  return task;
}

export async function importSlicesModel(file: File) {
  const token = ++operation;
  useSlicesStore.setState({ busy: true, error: undefined });
  try {
    await install({
      version: 1, source: { name: file.name, data: file },
      pose: { animationIndex: -1, animationTime: 0 }, viewQuaternion: [0, 0, 0, 1],
    }, token);
  } catch (error) {
    if (token === operation) useSlicesStore.setState({ busy: false, error: message(error) });
  }
}

export function setSlicesPose(pose: SlicePose) {
  const { model, document, busy } = useSlicesStore.getState();
  if (!model || !document || busy) return;
  const clip = model.gltf?.animations[pose.animationIndex];
  const normalized = {
    animationIndex: clip ? pose.animationIndex : -1,
    animationTime: clip && Number.isFinite(pose.animationTime) ? Math.max(0, Math.min(pose.animationTime, clip.duration)) : 0,
  };
  const next = { ...document, pose: normalized };
  useSlicesStore.setState({ document: next, asset: sample(model, normalized) });
  void persist(next);
}

export function setSliceSetup(patch: Partial<SliceSetup>) {
  const { document, busy } = useSlicesStore.getState();
  if (!document || busy) return;
  const setup = { ...(document.setup ?? DEFAULT_SLICE_SETUP), ...patch };
  setup.samplingOffsetMm = Math.max(-setup.thicknessMm / 2, Math.min(setup.thicknessMm / 2, setup.samplingOffsetMm));
  if (!validSliceSetup(setup)) return;
  const previous = document.setup;
  if (previous && previous.sizeMm === setup.sizeMm && previous.thicknessMm === setup.thicknessMm
    && previous.samplingOffsetMm === setup.samplingOffsetMm
    && previous.repairMode === setup.repairMode && previous.repairGapMm === setup.repairGapMm
    && previous.rotationDeg.every((angle, i) => angle === setup.rotationDeg[i])) return;
  const next = { ...document, setup };
  useSlicesStore.setState({ document: next });
  void persist(next);
}
