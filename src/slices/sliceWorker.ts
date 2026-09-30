import { sliceMesh } from './geometry/sliceMesh';
import type { SliceInput, SliceProgress, SliceResult } from './geometry/types';

export type SliceWorkerResponse = { type: 'progress'; progress: SliceProgress }
  | { type: 'result'; result: SliceResult } | { type: 'error'; message: string };

self.onmessage = (event: MessageEvent<SliceInput>) => {
  let lastProgress = -1;
  try {
    const result = sliceMesh(event.data, (progress) => {
      if (progress.fraction - lastProgress >= 0.01 || progress.fraction === 1) {
        self.postMessage({ type: 'progress', progress } satisfies SliceWorkerResponse);
        lastProgress = progress.fraction;
      }
    });
    self.postMessage({ type: 'result', result } satisfies SliceWorkerResponse);
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) } satisfies SliceWorkerResponse);
  }
};
