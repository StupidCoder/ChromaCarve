import { create } from 'zustand';

/**
 * Global progress for the async bas-relief solve (runs in a worker). The client
 * updates it; the ProgressBar overlay reads it. `label` distinguishes preview
 * updates from exports.
 */
interface ProgressState {
  active: boolean;
  /** Completion fraction in [0,1]. */
  frac: number;
  /** Estimated seconds remaining (Infinity until enough samples). */
  etaSec: number;
  label: string;
  begin: (label: string) => void;
  update: (frac: number, etaSec: number) => void;
  end: () => void;
}

export const useProgressStore = create<ProgressState>((set) => ({
  active: false,
  frac: 0,
  etaSec: Infinity,
  label: '',
  begin: (label) => set({ active: true, frac: 0, etaSec: Infinity, label }),
  update: (frac, etaSec) => set({ frac, etaSec }),
  end: () => set({ active: false, frac: 1, etaSec: 0 }),
}));
