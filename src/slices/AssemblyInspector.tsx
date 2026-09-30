import { useState, type ComponentProps } from 'react';
import { ComparisonViewport } from './ComparisonViewport';
import { suggestedOmissions } from './geometry/omissions';
import type { SliceResult } from './geometry/types';
import { mm } from './PhysicalSetup';

export function AssemblyInspector(props: ComponentProps<typeof ComparisonViewport> & {
  omittedIds: string[]; onOmissionsChange: (ids: string[]) => void; retained: SliceResult;
}) {
  const { result, setup, omittedIds, onOmissionsChange, retained } = props;
  const [showOmitted, setShowOmitted] = useState(true);
  const [view, setView] = useState({ result, gapMm: 0, layersShown: result.layers.length, selectedPiece: -1, highlightWarnings: true });
  const current = view.result === result ? view : { result, gapMm: 0, layersShown: result.layers.length, selectedPiece: -1, highlightWarnings: true };
  const update = (patch: Partial<typeof view>) => setView({ ...current, ...patch });
  const analysis = retained.assembly;
  const original = result.assembly;
  const suggestions = suggestedOmissions(result);
  const omitted = new Set(omittedIds);
  const toggle = (id: string) => onOmissionsChange(omitted.has(id) ? omittedIds.filter(value => value !== id) : [...omittedIds, id]);
  if (!result.valid || !original || !analysis || analysis.error) return <div className="slices-empty"><p role="status">{!result.valid
    ? 'Resolve the cross-section errors before checking assembly.' : analysis?.error ?? 'Assembly analysis is unavailable. Change a setting to recompute.'}</p></div>;
  const warnings = analysis.pieces.filter(piece => piece.warnings.length);
  const originalSelected = original.pieces[current.selectedPiece];
  const selected = analysis.pieces.find(p => p.id === originalSelected?.id) ?? originalSelected;
  const contacts = selected ? analysis.contacts.filter(c => c.below === selected.id || c.above === selected.id) : [];
  return <ComparisonViewport {...props} inspection={{ ...current, omittedIds, showOmitted, reviewIds: warnings.map(p => p.id) }} controlsSlot={<div className="assembly-controls">
    <p role="status">{analysis.groups} connected {analysis.groups === 1 ? 'group' : 'groups'} · {warnings.length} of {analysis.pieces.length} pieces have size/contact warnings · {analysis.pieces.filter(p => !p.grounded).length} pieces have no connection to the bottom layer</p>
    <details open className="assembly-omissions"><summary>Suggested omissions · {suggestions.length} candidates · {omittedIds.length} omitted</summary>
      <p>Very small, narrow details with at most one connection. Check the shape before skipping them.</p>
      <div className="assembly-fields"><button disabled={!suggestions.some(id => !omitted.has(id))} onClick={() => onOmissionsChange([...new Set([...omittedIds, ...suggestions])])}>Skip suggested pieces</button>
        <button disabled={!omittedIds.length} onClick={() => onOmissionsChange([])}>Restore all pieces</button>
        <label className="toggle"><input type="checkbox" checked={showOmitted} onChange={e => setShowOmitted(e.target.checked)} />Show omitted pieces in red</label></div>
      <div className="assembly-fields">{[...new Set([...suggestions, ...omittedIds])].map(id => <div className="toggle" key={id}><label className="toggle"><input type="checkbox" checked={omitted.has(id)} onChange={() => toggle(id)} />Skip {id}</label>
        <button aria-label={`Inspect piece ${id}`} onClick={() => { const index = original.pieces.findIndex(p => p.id === id); if (index >= 0) update({ selectedPiece: index, layersShown: original.pieces[index].layer + 1 }); }}>Inspect</button></div>)}</div>
      {!suggestions.length && <p>No pieces meet the conservative suggestion criteria. You can still omit a selected piece below.</p>}
      <p className="muted">Compare and Cross-sections show only retained pieces. Omissions are saved; changing the pose or slicing settings clears them.</p>
    </details>
    <div className="assembly-fields">
      <label>Layers shown: {current.layersShown} / {result.layers.length}<input aria-label="Layers shown" type="range" min="1" max={result.layers.length} value={current.layersShown}
        onChange={e => update({ layersShown: Number(e.target.value), selectedPiece: selected && selected.layer >= Number(e.target.value) ? -1 : current.selectedPiece })} /></label>
      <label>Exploded gap: {mm(current.gapMm)} mm<input aria-label="Exploded gap" type="range" min="0" max={setup.thicknessMm * 3} step={setup.thicknessMm / 10} value={current.gapMm}
        onChange={e => update({ gapMm: Number(e.target.value) })} /></label>
    </div>
    <div className="assembly-fields">
      <label>Inspect piece<select aria-label="Inspect assembly piece" value={current.selectedPiece} onChange={e => {
        const index = Number(e.target.value); update({ selectedPiece: index, layersShown: index < 0 ? result.layers.length : original.pieces[index].layer + 1 });
      }}><option value="-1">All pieces</option>{original.pieces.map((piece,index) => <option key={piece.id} value={index}>
        {omitted.has(piece.id) ? 'Omitted · ' : ''}Piece {piece.id}</option>)}</select></label>
      <label className="toggle"><input type="checkbox" checked={current.highlightWarnings} onChange={e => update({ highlightWarnings: e.target.checked })} />Highlight review pieces</label>
    </div>
    <button disabled={!warnings.length} onClick={() => {
      const next = original.pieces.findIndex((piece,index) => index > current.selectedPiece && warnings.some(p => p.id === piece.id));
      const index = next >= 0 ? next : original.pieces.findIndex(piece => warnings.some(p => p.id === piece.id));
      update({ selectedPiece: index, layersShown: original.pieces[index].layer + 1 });
    }}>Next review piece</button>
    {selected && <div className="assembly-detail" role="status"><strong>Piece {selected.id} · {omitted.has(selected.id) ? 'omitted (measurements before omission)' : `group ${selected.group}`}</strong>
      <label className="toggle"><input type="checkbox" checked={omitted.has(selected.id)} onChange={() => toggle(selected.id)} />Skip piece {selected.id}</label>
      <span>Area {mm(selected.areaMm2)} mm² · contact below {mm(selected.belowMm2)} mm² · above {mm(selected.aboveMm2)} mm²</span>
      <span>{selected.warnings.join(' · ') || 'No geometric warnings for this piece.'}</span>
      <span>{omitted.has(selected.id) ? 'Retained contacts: ' : 'Touches: '}{contacts.length ? contacts.map(c => `${c.below === selected.id ? c.above : c.below} (${mm(c.areaMm2)} mm²)`).join(', ') : 'No other layer pieces'}</span>
    </div>}
    <details><summary>How these checks work</summary><p>Only positive-area contact between adjacent layers counts as a connection. Separate groups cannot be glued into one model without additional connections. No contact below can mean a piece needs to be attached from above.</p>
      <p>Omission suggestions require area and contact below 10% of thickness squared, a narrow shape, at most one neighbor, and a position above the bottom layer. Visual importance needs your judgment. Manual omissions may disconnect other pieces; the contact checks update immediately.</p><p>Review thresholds: area or glue contact below {mm(analysis.areaThresholdMm2)} mm²; contact below 10% of a piece’s area; width or connecting neck below approximately {mm(analysis.widthThresholdMm)} mm. Width uses an inward offset of half that value. These are thickness-based screening rules, not strength predictions. Grain, glue, kerf and fragile protrusions still need judgment.</p></details>
    <p className="muted">Red stipple: omitted · Orange: needs review · Blue: selected. Hide omitted pieces to see the buildable shape. Selecting a piece hides layers above it. Reset view fits the exploded stack.</p>
  </div>} />;
}
