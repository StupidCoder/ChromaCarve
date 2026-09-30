import { useEffect, useRef, useState } from 'react';
import type { ModelAsset } from '../assets/assetStore';
import { snapshotForSlicing } from './geometry/snapshot';
import type { SliceProgress, SliceResult, SliceSetup } from './geometry/types';
import { SliceClient, SlicingCancelled } from './sliceClient';

type Status = 'idle' | 'queued' | 'running' | 'done' | 'cancelled' | 'error';
interface Computation {
  asset?: ModelAsset;
  setup?: SliceSetup;
  status: Status;
  result?: SliceResult;
  error?: string;
  progress?: SliceProgress;
}

/** Changes invalidate old geometry immediately and coalesce into one worker job. */
export function useSlicing(asset: ModelAsset | undefined, setup: SliceSetup, enabled: boolean) {
  const [client] = useState(() => new SliceClient());
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Computation>({ status: 'idle' });
  const cancel = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true;
    if (!asset || !enabled) { setState({ status: 'idle' }); return; }
    const common = { asset, setup };
    setState({ ...common, status: 'queued' });
    const timer = window.setTimeout(() => {
      setState({ ...common, status: 'running' });
      try {
        const input = snapshotForSlicing(asset.geometry, setup);
        void client.run(input, (progress) => {
          if (active) setState({ ...common, status: 'running', progress });
        }).then((result) => {
          if (active) setState({ ...common, status: 'done', result });
        }).catch((error) => {
          if (active) setState({ ...common, status: error instanceof SlicingCancelled ? 'cancelled' : 'error', error: String(error instanceof Error ? error.message : error) });
        });
      } catch (error) {
        if (active) setState({ ...common, status: 'error', error: String(error instanceof Error ? error.message : error) });
      }
    }, 250);
    cancel.current = () => {
      active = false;
      clearTimeout(timer);
      client.cancel();
      setState({ ...common, status: 'cancelled' });
    };
    return () => { active = false; clearTimeout(timer); client.cancel(); };
  }, [asset, setup, enabled, attempt, client]);
  // Do not render a stale result in the render before effect cleanup runs.
  const current: Computation = state.asset === asset && state.setup === setup && enabled ? state
    : { status: asset && enabled ? 'queued' : 'idle' };
  return { ...current, cancel: () => cancel.current(), retry: () => setAttempt((n) => n + 1) };
}
export type SlicingComputation = ReturnType<typeof useSlicing>;
