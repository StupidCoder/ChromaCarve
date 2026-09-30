import { useEffect, useState } from 'react';
import type { MarkingResult } from './geometry/markings';
import { MARK_STROKE_MM, type MarkingSettings } from './geometry/markingSettings';
import type { Point2, SliceResult } from './geometry/types';
import { mm } from './PhysicalSetup';
const path = (line: Point2[], closed = false) => `M${line.map(p => p.join(',')).join('L')}${closed ? 'Z' : ''}`;

export function MarkingsInspector({ result, settings, onSettingsChange }: {
  result: SliceResult; settings: MarkingSettings; onSettingsChange: (settings: MarkingSettings) => void;
}) {
  const [layout, setLayout] = useState<{ source: SliceResult; settings: MarkingSettings; result?: MarkingResult; error?: string }>();
  const [selection, setSelection] = useState({ source: result, layer: 0, piece: '' });
  const current = selection.source === result ? selection : { source: result, layer: 0, piece: '' };
  const [coverage, setCoverage] = useState(false);
  useEffect(() => {
    let worker: Worker;
    try { worker = new Worker(new URL('./markingsWorker.ts', import.meta.url), { type: 'module' }); }
    catch { setLayout({ source: result, settings, error: 'Could not start marking generation. Reload to try again.' }); return; }
    worker.onmessage = ({ data }) => { setLayout({ source: result, settings, ...data }); worker.terminate(); };
    worker.onerror = () => { setLayout({ source: result, settings, error: 'Could not generate markings. Reload to try again.' }); worker.terminate(); };
    worker.postMessage({ result, settings });
    return () => worker.terminate();
  }, [result, settings]);
  const ready = layout?.source === result && layout.settings === settings ? layout : undefined;
  const generated = ready?.result;
  const layer = result.layers[current.layer];
  const pieces = layer.pieces.filter(p => !current.piece || p.id === current.piece);
  const contacts = generated?.contacts.filter(c => c.layer === current.layer && (!current.piece || c.below === current.piece)) ?? [];
  const issues = generated?.contacts.filter(c => c.warnings.length) ?? [];
  const points = pieces.flatMap(p => p.outer);
  const bounds = points.reduce((b,[x,y]) => [Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)], [Infinity,Infinity,-Infinity,-Infinity]);
  const [minX,minY,maxX,maxY] = points.length ? bounds : [result.bounds.min[0],result.bounds.min[1],result.bounds.max[0],result.bounds.max[1]];
  const pad = Math.max(maxX-minX,maxY-minY)*0.08 || 1;
  const next = result.layers[current.layer+1];
  const changeLayer = (index: number) => setSelection({ source: result, layer: index, piece: '' });
  return <section className="slice-inspector markings-inspector" aria-label="Assembly markings">
    <div className="slice-inspector-toolbar">
      <div className="marking-settings">
        <label>Hidden margin (mm)<input aria-label="Hidden margin (mm)" type="number" min="0.1" max="5" step="0.1" value={settings.clearanceMm}
          onChange={e => onSettingsChange({ ...settings, clearanceMm: e.target.valueAsNumber })} /></label>
        <label>Number height (mm)<input aria-label="Number height (mm)" type="number" min="1" max="8" step="0.5" value={settings.labelHeightMm}
          onChange={e => onSettingsChange({ ...settings, labelHeightMm: e.target.valueAsNumber })} /></label>
        <label>Piece<select aria-label="Inspect marking piece" value={current.piece} onChange={e => setSelection({ ...current, piece: e.target.value })}>
          <option value="">Whole layer</option>{layer.pieces.map(p => <option key={p.id} value={p.id}>Piece {p.id}</option>)}</select></label>
      </div>
      <label className="field"><span className="field__label"><span>Layer</span><span className="field__value">{current.layer+1} of {result.layers.length}</span></span>
        <input aria-label="Marking layer" type="range" min="1" max={result.layers.length} value={current.layer+1} onChange={e => changeLayer(Number(e.target.value)-1)} /></label>
      <div className="marking-actions"><label className="toggle"><input type="checkbox" checked={coverage} onChange={e => setCoverage(e.target.checked)} />Show next layer coverage</label>
        <select aria-label="Review marking contact" value="" disabled={!issues.length} onChange={e => { const c = issues[Number(e.target.value)]; if (c) setSelection({ source: result, layer: c.layer, piece: c.below }); }}>
          <option value="">{!generated ? 'Markings not ready' : issues.length ? `Review ${issues.length} contacts…` : 'No marking warnings'}</option>
          {issues.map((c,i) => <option value={i} key={`${c.below}-${c.above}`}>{c.below} → {c.above}</option>)}</select></div>
      <p className="muted" role="status">{ready?.error ?? (!generated ? 'Finding hidden marking locations…' : `${generated.contacts.filter(c => c.label.length).length} of ${generated.contacts.length} contacts numbered · ${issues.length} contacts need review`)}</p>
    </div>
    <div className="slice-drawing marking-drawing">
      <svg viewBox={`${minX-pad} ${-maxY-pad} ${maxX-minX+2*pad} ${maxY-minY+2*pad}`} role="img" aria-label={`Layer ${current.layer+1} cutting contours and hidden assembly markings`}>
        <g transform="scale(1,-1)" strokeLinejoin="round" strokeLinecap="round">
          {pieces.map(p => <path key={p.id} d={[p.outer,...p.holes].map(r => path(r,true)).join(' ')} fill="#c8aa7d" fillOpacity="0.13" fillRule="evenodd" stroke="#ff5c69" strokeWidth={MARK_STROKE_MM}><title>Cut piece {p.id}</title></path>)}
          {coverage && next?.pieces.map(p => <path key={p.id} d={[p.outer,...p.holes].map(r => path(r,true)).join(' ')} fill="#bac3cc" fillOpacity="0.10" fillRule="evenodd" stroke="#a2aab5" strokeDasharray="1 1" strokeWidth="0.12"><title>Next piece {p.id}</title></path>)}
          {contacts.map(c => <g key={`${c.below}-${c.above}`} fill="none" stroke="#40caff" strokeWidth={MARK_STROKE_MM}>
            <title>Mark {c.below}, then attach {c.above}</title>
            {c.guides.map((line,i) => <path key={`g${i}`} d={path(line)} />)}
            {c.label.map((line,i) => <path key={`n${i}`} d={path(line)} />)}
          </g>)}
        </g>
      </svg>
      {!layer.pieces.length && <p className="slice-no-pieces">No retained pieces in this layer.</p>}
    </div>
    <div className="slice-inspector-notes marking-notes">
      <p><span className="cut-key">Red: cut</span> · <span className="mark-key">Blue: mark</span> · Grey: next layer coverage</p>
      <p className="muted">Top face, viewed from above. First number: this piece. “&gt;” number: next piece. Guides follow the next piece’s edge, inset by {mm(settings.clearanceMm + MARK_STROKE_MM/2)} mm into its material to their centerline. Allow that offset when aligning outer edges and holes.</p>
      {contacts.filter(c => c.warnings.length).map(c => <p className="warn" key={`${c.below}-${c.above}`}>{c.below} → {c.above}: {c.warnings.join(' ')}</p>)}
      {generated && pieces.filter(p => !contacts.some(c => c.below === p.id)).map(p => <p className="muted" key={p.id}>Piece {p.id}: no retained piece above; top face stays unmarked.</p>)}
      <p className="muted">Select a piece to enlarge it. No exposed numbers are added when space is insufficient. Arrange and download cutting sheets in Sheets.</p>
    </div>
  </section>;
}
