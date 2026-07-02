import { useEffect, useRef } from 'react';
import { setAssetLoadedCallback } from './assets/assetStore';
import { Footer } from './components/Footer';
import { PreviewPanel } from './components/panels/PreviewPanel';
import { SettingsPanel } from './components/panels/SettingsPanel';
import { ProgressBar } from './components/ProgressBar';
import { Splash } from './components/Splash';
import { updateReliefPreview } from './relief/reliefController';
import { useProjectStore } from './state/store';
import { Viewer3D } from './three/Viewer3D';

export default function App() {
  const project = useProjectStore((s) => s.project);
  const assetVersion = useProjectStore((s) => s.assetVersion);
  const timer = useRef<number | undefined>(undefined);

  // Re-render when an async asset (e.g. a bundled example model) finishes loading.
  useEffect(() => {
    setAssetLoadedCallback(() => useProjectStore.getState().bumpAssets());
  }, []);

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
      <div className="stage">
        <Viewer3D />
      </div>
      <img src="/ChromaCarve_small.png" alt="ChromaCarve" className="app-logo" />
      <SettingsPanel />
      <PreviewPanel />
      <Footer />
      <ProgressBar />
      <Splash />
    </div>
  );
}
