import { useEffect, useState } from 'react';
import { ModelPoseControls } from '../components/ModelPoseControls';
import { ModelViewport } from '../three/ModelViewport';
import { WorkspaceSwitcher } from '../workspaces/WorkspaceSwitcher';
import { navigateWorkspace } from '../workspaces/navigation';
import { removeSlicesHandoff } from './storage';
import { importSlicesModel, initializeSlices, setSlicesPose, useSlicesStore } from './store';

export default function SlicesApp({ handoff }: { handoff: string | null }) {
  const { asset, model, document, busy, error, saveStatus } = useSlicesStore();
  const [showColors, setShowColors] = useState(true);
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
          <li aria-current="step">Model</li>
          <li>Slices <span>Coming next</span></li>
          <li>Assembly</li>
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
                ? 'Model and pose saved in this browser.'
                : 'Browser storage is unavailable or full. This model is open, but changes may not survive a reload.'}
            </p>
          </>}
        </section>
        <p className="slices-scope-note">Model setup is ready. Plywood slicing, comparison and cutting-sheet export are coming in the next milestones.</p>
      </aside>
      <main className="slices-preview" aria-label="Model preview" aria-busy={busy}>
        <div className="slices-preview-heading"><h2>Source model</h2><span>3D preview</span></div>
        {asset && document ? <ModelViewport asset={asset} viewQuaternion={document.viewQuaternion} showColors={showColors} /> :
          <div className="slices-empty">
            <svg viewBox="0 0 160 160" width="144" height="144" aria-hidden="true">
              <path d="M80 18 137 49 80 81 23 49Z M23 70 80 102 137 70 M23 91 80 123 137 91 M23 112 80 144 137 112" />
            </svg>
            <h2>A new way to build your model</h2>
            <p>Choose a model to inspect its shape and pose,<br />or use “Open in Slices” in the Reliefs workspace.</p>
          </div>}
        {busy && <div className="slices-busy" role="status">Opening model…</div>}
        {asset && <p className="slices-preview-help">Drag to orbit · Scroll to zoom · Right-drag to pan</p>}
      </main>
    </div>
  </div>;
}
