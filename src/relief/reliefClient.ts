import type { BasReliefParams } from './basRelief';
import type { ReliefWorkerResponse } from './reliefWorker';
import { useProgressStore } from '../state/progress';

export interface ReliefResult {
  data: Float32Array;
  min: number;
  max: number;
}

export interface ReliefInputs {
  height: Float32Array;
  mask: Float32Array;
  w: number;
  h: number;
  params: BasReliefParams;
  cap: number;
}

/** Thrown to the requester when a solve is superseded by a newer one. */
export class ReliefCancelled extends Error {
  constructor() {
    super('relief solve superseded');
  }
}

interface Job {
  id: number;
  key: string;
  label: string;
  promise: Promise<ReliefResult>;
  resolve: (r: ReliefResult) => void;
  reject: (e: unknown) => void;
  onProgress?: (frac: number) => void;
  startTime: number;
}

/**
 * Runs the bas-relief solve in a single dedicated web worker so the UI thread
 * never blocks. Caches the last result by key, dedupes concurrent identical
 * requests (the 2D + 3D previews both render the same frame), supersedes stale
 * requests (a newer edit terminates the running solve), and streams progress +
 * ETA to the progress store.
 */
class ReliefClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private job: Job | null = null;
  private cacheKey: string | null = null;
  private cacheResult: ReliefResult | null = null;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./reliefWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<ReliefWorkerResponse>) => this.onMessage(e.data);
    }
    return this.worker;
  }

  private onMessage(msg: ReliefWorkerResponse): void {
    const job = this.job;
    if (!job || msg.id !== job.id) return; // stale message from a terminated solve
    if (msg.type === 'progress') {
      job.onProgress?.(msg.frac);
      const elapsed = Date.now() - job.startTime;
      const eta = msg.frac > 0.03 ? ((elapsed / msg.frac) * (1 - msg.frac)) / 1000 : Infinity;
      useProgressStore.getState().update(msg.frac, eta);
    } else {
      const result: ReliefResult = { data: new Float32Array(msg.data), min: msg.min, max: msg.max };
      this.cacheKey = job.key;
      this.cacheResult = result;
      this.job = null;
      useProgressStore.getState().end();
      job.resolve(result);
    }
  }

  /**
   * Solve for `key`. `build` lazily produces the inputs (a GPU readback) and is
   * only called when a fresh solve is actually dispatched — cache hits and
   * dedupes skip it. Rejects with ReliefCancelled if superseded.
   */
  solve(
    key: string,
    build: () => ReliefInputs,
    label: string,
    onProgress?: (frac: number) => void,
  ): Promise<ReliefResult> {
    if (key === this.cacheKey && this.cacheResult) return Promise.resolve(this.cacheResult);
    if (this.job && this.job.key === key) return this.job.promise;

    // Supersede any different in-flight solve: reject it and terminate the
    // worker so the running computation actually stops.
    if (this.job) {
      this.job.reject(new ReliefCancelled());
      this.worker?.terminate();
      this.worker = null;
      this.job = null;
    }

    const inputs = build();
    const id = this.nextId++;
    const worker = this.ensureWorker();
    let resolve!: (r: ReliefResult) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<ReliefResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.job = { id, key, label, promise, resolve, reject, onProgress, startTime: Date.now() };
    useProgressStore.getState().begin(label);
    // Transfer the height buffer (not needed again on the main thread); the mask
    // is structured-cloned so the caller keeps it for the coverage (G) channel.
    worker.postMessage(
      {
        id,
        height: inputs.height.buffer,
        mask: inputs.mask.buffer,
        w: inputs.w,
        h: inputs.h,
        params: inputs.params,
        cap: inputs.cap,
      },
      [inputs.height.buffer],
    );
    return promise;
  }
}

export const reliefClient = new ReliefClient();
