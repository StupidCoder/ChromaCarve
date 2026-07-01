/// <reference lib="webworker" />
import { solveReliefCapped } from './reliefSolve';
import type { BasReliefParams } from './basRelief';

export interface ReliefWorkerRequest {
  id: number;
  height: ArrayBuffer;
  mask: ArrayBuffer;
  w: number;
  h: number;
  params: BasReliefParams;
  cap: number;
}

export type ReliefWorkerResponse =
  | { id: number; type: 'progress'; frac: number }
  | { id: number; type: 'done'; data: ArrayBuffer; min: number; max: number };

const ctx = self as unknown as Worker;

ctx.onmessage = (e: MessageEvent<ReliefWorkerRequest>) => {
  const { id, height, mask, w, h, params, cap } = e.data;
  const res = solveReliefCapped(
    new Float32Array(height),
    new Float32Array(mask),
    w,
    h,
    params,
    cap,
    (frac) => ctx.postMessage({ id, type: 'progress', frac } satisfies ReliefWorkerResponse),
  );
  const buf = res.data.buffer as ArrayBuffer;
  ctx.postMessage(
    { id, type: 'done', data: buf, min: res.min, max: res.max } satisfies ReliefWorkerResponse,
    [buf],
  );
};
