import { validMarkingSettings, type MarkingSettings } from './geometry/markingSettings';
import { DEFAULT_SLICE_SETUP, validSliceSetup, type SliceSetup } from './geometry/types';

export interface SlicePose {
  animationIndex: number;
  animationTime: number;
}

export interface SlicesDocument {
  version: 1;
  source: { name: string; data: Blob };
  pose: SlicePose;
  viewQuaternion: [number, number, number, number];
  /** Optional only for milestone-1 projects and incoming model handoffs. */
  setup?: SliceSetup;
  omittedPieceIds?: string[];
  markingSettings?: MarkingSettings;
}

const CURRENT = 'current';
let database: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('chromacarve-slices', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('projects');
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other ChromaCarve tabs and try again.'));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); database = undefined; };
        resolve(db);
      };
    }).catch((error) => { database = undefined; throw error; });
  }
  return database;
}

async function write(key: string, document: SlicesDocument): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('projects', 'readwrite');
    transaction.objectStore('projects').put(document, key);
    // Resolve on commit, not request success: quota failures can abort later.
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Browser storage could not save this model.'));
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function readSlicesDocument(handoff?: string | null): Promise<SlicesDocument | undefined> {
  const db = await openDatabase();
  const result = await new Promise<unknown>((resolve, reject) => {
    const request = db.transaction('projects').objectStore('projects').get(handoff ? `handoff:${handoff}` : CURRENT);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (result === undefined) return undefined;
  const doc = result as SlicesDocument;
  if (doc.version !== 1 || !doc.source || typeof doc.source.name !== 'string' || !(doc.source.data instanceof Blob)
    || !Number.isInteger(doc.pose?.animationIndex) || doc.pose.animationIndex < -1
    || !Number.isFinite(doc.pose.animationTime) || doc.pose.animationTime < 0
    || !Array.isArray(doc.viewQuaternion) || doc.viewQuaternion.length !== 4
    || !doc.viewQuaternion.every(Number.isFinite) || Math.hypot(...doc.viewQuaternion) < 0.001) {
    throw new Error('This saved Slices project cannot be read. Please choose the model file again.');
  }
  if (doc.setup !== undefined && !validSliceSetup(doc.setup)) {
    throw new Error('The saved physical model settings are invalid. Please choose the model file again.');
  }
  if (doc.markingSettings !== undefined && !validMarkingSettings(doc.markingSettings)) throw new Error('The saved marking settings are invalid.');
  if (doc.omittedPieceIds !== undefined && (!Array.isArray(doc.omittedPieceIds)
    || doc.omittedPieceIds.length > 10000 || !doc.omittedPieceIds.every(id => typeof id === 'string' && /^\d+\.\d+$/.test(id)))) {
    throw new Error('The saved piece omissions are invalid. Please choose the model file again.');
  }
  return { ...doc, setup: doc.setup ?? { ...DEFAULT_SLICE_SETUP, rotationDeg: [0, 0, 0] } };
}

export const saveSlicesDocument = (document: SlicesDocument) => write(CURRENT, document);

export async function saveSlicesHandoff(document: SlicesDocument): Promise<string> {
  const id = crypto.randomUUID();
  await write(`handoff:${id}`, document);
  return id;
}

export async function removeSlicesHandoff(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').delete(`handoff:${id}`);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}
