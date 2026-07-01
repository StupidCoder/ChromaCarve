import { useEffect, useRef } from 'react';
import { Preview2D } from './components/Preview2D';
import { OutputPanel } from './components/panels/OutputPanel';
import {
  BackgroundPanel,
  BorderPanel,
  ForegroundPanel,
} from './components/panels/PartPanels';
import { ExportPanel } from './components/panels/ExportPanel';
import { ProgressBar } from './components/ProgressBar';
import { Splash } from './components/Splash';
import { updateReliefPreview } from './relief/reliefController';
import { useProjectStore } from './state/store';

export default function App() {
  const project = useProjectStore((s) => s.project);
  const assetVersion = useProjectStore((s) => s.assetVersion);
  const timer = useRef<number | undefined>(undefined);

  // Debounce the (async, worker-driven) relief solve so rapid slider drags
  // coalesce into a single solve after the user pauses. The synchronous preview
  // still updates immediately with the last computed relief.
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      updateReliefPreview(project).catch((e) => console.error(e));
    }, 200);
    return () => clearTimeout(timer.current);
  }, [project, assetVersion]);

  return (
    <div className="app">
      <Splash />
      <div className="pane pane--left">
        <div className="app-title">ChromaCarve</div>
        <OutputPanel />
        <BackgroundPanel />
        <BorderPanel />
        <ForegroundPanel />
        <ExportPanel />
      </div>

      <div className="pane pane--center">
        <Preview2D />
      </div>
      <ProgressBar />
    </div>
  );
}
