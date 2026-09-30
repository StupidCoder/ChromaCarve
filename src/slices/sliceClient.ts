import type { SliceInput, SliceProgress, SliceResult } from './geometry/types';
import type { SliceWorkerResponse } from './sliceWorker';

export class SlicingCancelled extends Error {
  constructor() { super('Slicing cancelled.'); }
}

/** Termination cancels CPU work immediately, including geometry preparation. */
export class SliceClient {
  private pending?: { worker: Worker; reject: (reason: Error) => void };
  constructor(private createWorker = () => new Worker(new URL('./sliceWorker.ts', import.meta.url), { type: 'module' })) {}

  cancel() {
    if (!this.pending) return;
    this.pending.worker.terminate();
    this.pending.reject(new SlicingCancelled());
    this.pending = undefined;
  }

  run(input: SliceInput, progress: (value: SliceProgress) => void): Promise<SliceResult> {
    this.cancel();
    return new Promise((resolve, reject) => {
      const worker = this.createWorker();
      this.pending = { worker, reject };
      const finish = () => {
        worker.terminate();
        if (this.pending?.worker === worker) this.pending = undefined;
      };
      worker.onmessage = (event: MessageEvent<SliceWorkerResponse>) => {
        if (this.pending?.worker !== worker) return;
        const response = event.data;
        if (response.type === 'progress') progress(response.progress);
        else {
          finish();
          if (response.type === 'result') resolve(response.result);
          else reject(new Error(response.message));
        }
      };
      worker.onerror = (event) => { finish(); reject(new Error(event.message || 'The slicing worker failed. Please try again.')); };
      worker.onmessageerror = () => { finish(); reject(new Error('The slicing result could not be read. Please try again.')); };
      try {
        worker.postMessage(input, [input.positions.buffer as ArrayBuffer, ...(input.indices ? [input.indices.buffer as ArrayBuffer] : [])]);
      } catch (error) { finish(); reject(error); }
    });
  }
}
