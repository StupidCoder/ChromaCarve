import { useEffect, useState } from 'react';
import { ModelPoseControls } from '../components/ModelPoseControls';
import { ModelViewport } from '../three/ModelViewport';
import { WorkspaceSwitcher } from '../workspaces/WorkspaceSwitcher';
import { navigateWorkspace } from '../workspaces/navigation';
import { removeSlicesHandoff } from './storage';
import { importSlicesModel, initializeSlices, setSlicesPose, useSlicesStore } from './store';
import { DEFAULT_SLICE_SETUP } from './geometry/types';
import { PhysicalSetup } from './PhysicalSetup';
import { LayerInspector } from './LayerInspector';
import { useSlicing } from './useSlicing';

export default function SlicesApp({ handoff }: { handoff: string | null }) {
  const { asset, model, document, busy, error, saveStatus } = useSlicesStore();
  const [showColors, setShowColors] = useState(true);
  const [view, setView] = useState<'source' | 'sections'>('source');
  const setup = document?.setup ?? DEFAULT_SLICE_SETUP;
  const computation = useSlicing(asset, setup, !busy);
  useEffect(() => {
    let active = true;
    void initializeSlices(handoff).then(() => {
      if (active && handoff) {
        // Clean the one-use link only after the model has been read successfully.
        navigateWorkspace('/slices/', true);
        if (useSlicesStore.getState().saveStatus === 'saved') void removeSlicesHandoff(handoff).catch(() => {});
      }
    }).catch(() => { /* The store presents a recoverable error alongside upload. */ });
    return () => { active = false; };
  }, [handoff]);

  const triangles = asset ? (asset.geometry.index?.count ?? asset.geometry.getAttribute('position').count) / 3 : 0;
  return <div className="slices-app">
    <header className="slices-header">
      <img src="/ChromaCarve_small.png" alt="ChromaCarve" />
      <WorkspaceSwitcher active="slices" />
      <span className="slices-header-description">Stacked plywood models</span>
    </header>
    <div className="slices-layout">
      <aside className="slices-sidebar" aria-label="Model settings">
        <h1>Slices</h1>
        <p className="slices-intro">Start with a 3D model.<br />Choose the pose you want to build.</p>
        <ol className="slices-steps" aria-label="Workflow">
          <li aria-current={view === 'source' ? 'step' : undefined}>Model</li>
          <li aria-current={view === 'sections' ? 'step' : undefined}>Slices</li>
          <li>Assembly <span>Coming next</span></li>
          <li>Cutting sheets</li>
        </ol>
        <section className="slices-model-section" aria-labelledby="source-heading">
          <h2 id="source-heading">Source model</h2>
          <label className="slices-upload">
            <span>{document ? 'Replace model' : 'Choose model'}</span>
            <input type="file" accept=".glb,.obj,.stl" disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void importSlicesModel(file).then(() => {
                  if (handoff && !useSlicesStore.getState().error) navigateWorkspace('/slices/', true);
                });
              }} />
          </label>
          <p className="muted">GLB, OBJ or STL. Your model stays in this browser.</p>
          {error && <p className="warn" role="alert">{error}</p>}
          {document && <>
            <p className="slices-filename" title={document.source.name}>{document.source.name}</p>
            <p className="muted">{Math.round(triangles).toLocaleString()} triangles</p>
            {model?.gltf && <ModelPoseControls animations={model.gltf.animations}
              animationIndex={document.pose.animationIndex} animationTime={document.pose.animationTime}
              onChange={setSlicesPose} disabled={busy} />}
            {asset?.materials && <label className="toggle">
              <input type="checkbox" checked={showColors} onChange={(event) => setShowColors(event.target.checked)} />
              Show model colors
            </label>}
            <p className={saveStatus === 'unavailable' ? 'warn' : 'muted'} role="status">
              {saveStatus === 'saving' ? 'Saving in this browser…' : saveStatus === 'saved'
                ? 'Model, pose and setup saved in this browser.'
                : 'Browser storage is unavailable or full. This model is open, but changes may not survive a reload.'}
            </p>
          </>}
        </section>
        <div>{asset && <PhysicalSetup asset={asset} setup={setup} disabled={busy} computation={computation} />}</div>
        <p className="slices-scope-note">The assembled plywood comparison, assembly analysis and cutting-sheet export are coming in the next milestones.</p>
      </aside>
      <main className="slices-preview" aria-label="Model preview" aria-busy={busy}>
        <div className="slices-preview-heading">
          <div className="slices-preview-tabs" role="tablist" aria-label="Preview">
            <button role="tab" id="source-tab" aria-selected={view === 'source'} aria-controls="source-preview"
              onClick={() => setView('source')}>Source model</button>
            <button role="tab" id="sections-tab" aria-selected={view === 'sections'} aria-controls="sections-preview"
              disabled={!asset} onClick={() => setView('sections')}>Cross-sections</button>
          </div>
          <span>{view === 'source' ? '3D preview' : '2D layers'}</span>
        </div>
        {asset && document ? (view === 'source'
          ? <div role="tabpanel" id="source-preview" aria-labelledby="source-tab">
              <ModelViewport asset={asset} viewQuaternion={document.viewQuaternion} showColors={showColors} modelRotationDeg={setup.rotationDeg} />
            </div>
          : <div role="tabpanel" id="sections-preview" aria-labelledby="sections-tab">
              {computation.result ? <LayerInspector result={computation.result} /> : <div className="slices-empty">
                <p role="status">{computation.error ?? (computation.status === 'cancelled' ? 'Slicing cancelled. Use Retry slicing to continue.' : computation.progress?.phase ?? 'Preparing cross-sections…')}</p>
              </div>}
            </div>) :
          <div className="slices-empty">
            <svg viewBox="0 0 160 160" width="144" height="144" aria-hidden="true">
              <path d="M80 18 137 49 80 81 23 49Z M23 70 80 102 137 70 M23 91 80 123 137 91 M23 112 80 144 137 112" />
            </svg>
            <h2>A new way to build your model</h2>
            <p>Choose a model to inspect its shape and pose,<br />or use “Open in Slices” in the Reliefs workspace.</p>
          </div>}
        {busy && <div className="slices-busy" role="status">Opening model…</div>}
        {asset && view === 'source' && <p className="slices-preview-help">Drag to orbit · Scroll to zoom · Right-drag to pan</p>}
      </main>
    </div>
  </div>;
}
