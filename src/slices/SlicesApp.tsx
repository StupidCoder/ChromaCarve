import { CuttingSheets } from './CuttingSheets';
import { DEFAULT_SHEETS } from './geometry/sheetSettings';
import { MarkingsInspector } from './MarkingsInspector';
import { DEFAULT_MARKINGS } from './geometry/markingSettings';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ModelPoseControls } from '../components/ModelPoseControls';
import { ModelViewport } from '../three/ModelViewport';
import { WorkspaceSwitcher } from '../workspaces/WorkspaceSwitcher';
import { navigateWorkspace } from '../workspaces/navigation';
import { removeSlicesHandoff } from './storage';
import { importSlicesModel, initializeSlices, setOmittedPieces, setMarkingSettings, setSheetSettings, setSlicesPose, useSlicesStore } from './store';
import { DEFAULT_SLICE_SETUP } from './geometry/types';
import { PhysicalSetup } from './PhysicalSetup';
import { LayerInspector } from './LayerInspector';
import { ComparisonViewport, type ComparisonView } from './ComparisonViewport';
import { AssemblyInspector } from './AssemblyInspector';
import { omitPieces } from './geometry/omissions';
import { useSlicing } from './useSlicing';

export default function SlicesApp({ handoff }: { handoff: string | null }) {
  const { asset, model, document, busy, error, saveStatus } = useSlicesStore();
  const [showColors, setShowColors] = useState(true);
  const [view, setView] = useState<'source' | 'sections' | 'compare' | 'assembly' | 'markings' | 'sheets'>('compare');
  const comparisonView = useRef<ComparisonView | undefined>(undefined);
  useEffect(() => { comparisonView.current = undefined; }, [document?.source]);
  const setup = document?.setup ?? DEFAULT_SLICE_SETUP;
  const computation = useSlicing(asset, setup, !busy);
  const retained = useMemo(() => computation.result && omitPieces(computation.result, document?.omittedPieceIds ?? []), [computation.result, document?.omittedPieceIds]);
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
          <li aria-current={view === 'sections' || view === 'compare' ? 'step' : undefined}>Slices</li>
          <li aria-current={view === 'assembly' || view === 'markings' ? 'step' : undefined}>Assembly</li>
          <li aria-current={view === 'sheets' ? 'step' : undefined}>Cutting sheets</li>
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
                ? 'Project saved in this browser.'
                : 'Browser storage is unavailable or full. This model is open, but changes may not survive a reload.'}
            </p>
          </>}
        </section>
        {!!document?.omittedPieceIds?.length && <p className="muted">{document.omittedPieceIds.length} pieces omitted · {retained?.pieceCount ?? '…'} retained. Manage omissions in Assembly.</p>}
        <div>{asset && <PhysicalSetup asset={asset} setup={setup} disabled={busy} computation={computation} />}</div>
        <p className="slices-scope-note">Inspect the plywood shape before building. Inspect assembly contacts in the Assembly view. Review hidden guides and numbers in Markings. Arrange and export retained pieces in Sheets.</p>
      </aside>
      <main className="slices-preview" aria-label="Model preview" aria-busy={busy}>
        <div className="slices-preview-heading">
          <div className="slices-preview-tabs" role="tablist" aria-label="Preview">
            <button role="tab" id="source-tab" aria-selected={view === 'source'} aria-controls="source-preview"
              onClick={() => setView('source')}>Source model</button>
            <button role="tab" id="compare-tab" aria-selected={view === 'compare'} aria-controls="compare-preview"
              disabled={!asset} onClick={() => setView('compare')}>Compare</button>
            <button role="tab" id="sections-tab" aria-selected={view === 'sections'} aria-controls="sections-preview"
              disabled={!asset} onClick={() => setView('sections')}>Cross-sections</button>
            <button role="tab" id="assembly-tab" aria-selected={view === 'assembly'} aria-controls="assembly-preview"
              disabled={!asset} onClick={() => setView('assembly')}>Assembly</button>
            <button role="tab" id="markings-tab" aria-selected={view === 'markings'} aria-controls="markings-preview"
              disabled={!asset} onClick={() => setView('markings')}>Markings</button>
            <button role="tab" id="sheets-tab" aria-selected={view === 'sheets'} aria-controls="sheets-preview"
              disabled={!asset} onClick={() => setView('sheets')}>Sheets</button>
          </div>
          <span>{view === 'sections' || view === 'markings' || view === 'sheets' ? '2D layers' : '3D preview'}</span>
        </div>
        {asset && document ? (view === 'source'
          ? <div role="tabpanel" id="source-preview" aria-labelledby="source-tab">
              <ModelViewport asset={asset} viewQuaternion={document.viewQuaternion} showColors={showColors} modelRotationDeg={setup.rotationDeg} />
            </div>
          : view === 'sheets' ? <div role="tabpanel" id="sheets-preview" aria-labelledby="sheets-tab">
              {retained ? <CuttingSheets exportContext={{ sourceName: document.source.name, setup, omittedIds: document.omittedPieceIds ?? [] }} result={retained} settings={document.sheetSettings ?? DEFAULT_SHEETS} markingSettings={document.markingSettings ?? DEFAULT_MARKINGS} onSettingsChange={setSheetSettings} />
                : <div className="slices-empty"><p role="status">{computation.error ?? 'Generate slices to arrange cutting sheets.'}</p></div>}
            </div>
          : view === 'markings' ? <div role="tabpanel" id="markings-preview" aria-labelledby="markings-tab">
              {retained ? <MarkingsInspector result={retained} settings={document.markingSettings ?? DEFAULT_MARKINGS} onSettingsChange={setMarkingSettings} />
                : <div className="slices-empty"><p role="status">{computation.error ?? 'Generate slices to prepare assembly markings.'}</p></div>}
            </div>
          : view === 'compare' || view === 'assembly' ? <div role="tabpanel" id={view === 'assembly' ? 'assembly-preview' : 'compare-preview'} aria-labelledby={view === 'assembly' ? 'assembly-tab' : 'compare-tab'}>
              {computation.result ? (view === 'assembly' ? <AssemblyInspector omittedIds={document.omittedPieceIds ?? []} onOmissionsChange={setOmittedPieces} retained={retained!} savedView={comparisonView} asset={asset} setup={setup}
                result={computation.result} showColors={showColors} viewQuaternion={document.viewQuaternion} /> : <ComparisonViewport savedView={comparisonView} asset={asset} setup={setup}
                result={retained!} showColors={showColors} viewQuaternion={document.viewQuaternion} />)
                : <div className="slices-empty"><p role="status">{computation.error ?? (computation.status === 'cancelled'
                  ? 'Slicing cancelled. Use Retry slicing to continue.' : computation.progress?.phase ?? 'Preparing comparison…')}</p></div>}
            </div>
          : <div role="tabpanel" id="sections-preview" aria-labelledby="sections-tab">
              {computation.result ? <LayerInspector result={retained!} /> : <div className="slices-empty">
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
