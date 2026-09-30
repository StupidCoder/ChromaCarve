import { describe, expect, it, vi } from 'vitest';
import { SliceClient, SlicingCancelled } from './sliceClient';
import { DEFAULT_SLICE_SETUP, type SliceInput, type SliceResult } from './geometry/types';

class WorkerStub {
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message: string }) => void;
  onmessageerror?: () => void;
  terminate = vi.fn();
  postMessage = vi.fn();
}
const input = (): SliceInput => ({ positions: new Float64Array(9), indices: new Uint32Array([0, 1, 2]), setup: DEFAULT_SLICE_SETUP });

describe('slicing worker lifecycle', () => {
  it('terminates superseded work and ignores late results or progress', async () => {
    const workers: WorkerStub[] = [];
    const client = new SliceClient(() => { const worker = new WorkerStub(); workers.push(worker); return worker as unknown as Worker; });
    const firstProgress = vi.fn(), nextProgress = vi.fn();
    const first = client.run(input(), firstProgress);
    const cancelled = expect(first).rejects.toBeInstanceOf(SlicingCancelled);
    const second = client.run(input(), nextProgress);
    await cancelled;
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    workers[0].onmessage?.({ data: { type: 'progress', progress: { fraction: 1, phase: 'stale' } } });
    workers[0].onmessage?.({ data: { type: 'result', result: { stale: true } } });
    expect(firstProgress).not.toHaveBeenCalled();
    expect(nextProgress).not.toHaveBeenCalled();
    const result = { valid: true } as SliceResult;
    workers[1].onmessage?.({ data: { type: 'result', result } });
    await expect(second).resolves.toBe(result);
    expect(workers[1].terminate).toHaveBeenCalledOnce();
  });

  it('transfers only copied buffers and can explicitly cancel a job', async () => {
    const worker = new WorkerStub();
    const client = new SliceClient(() => worker as unknown as Worker);
    const copied = input();
    const job = client.run(copied, () => {});
    expect(worker.postMessage).toHaveBeenCalledWith(copied, [copied.positions.buffer, copied.indices!.buffer]);
    const cancelled = expect(job).rejects.toBeInstanceOf(SlicingCancelled);
    client.cancel();
    await cancelled;
    client.cancel();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('reports crashes and frees the worker', async () => {
    const worker = new WorkerStub();
    const client = new SliceClient(() => worker as unknown as Worker);
    const job = client.run(input(), () => {});
    worker.onerror?.({ message: 'worker unavailable' });
    await expect(job).rejects.toThrow('worker unavailable');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
