import { useState, type ComponentProps } from 'react';
import { ComparisonViewport } from './ComparisonViewport';
import { mm } from './PhysicalSetup';

export function AssemblyInspector(props: ComponentProps<typeof ComparisonViewport>) {
  const { result, setup } = props;
  const [view, setView] = useState({ result, gapMm: 0, layersShown: result.layers.length, selectedPiece: -1, highlightWarnings: true });
  const current = view.result === result ? view : { result, gapMm: 0, layersShown: result.layers.length, selectedPiece: -1, highlightWarnings: true };
  const update = (patch: Partial<typeof view>) => setView({ ...current, ...patch });
  const analysis = result.assembly;
  if (!result.valid || !analysis || analysis.error) return <div className="slices-empty"><p role="status">{!result.valid
    ? 'Resolve the cross-section errors before checking assembly.' : analysis?.error ?? 'Assembly analysis is unavailable. Change a setting to recompute.'}</p></div>;
  const warnings = analysis.pieces.filter(piece => piece.warnings.length);
  const selected = analysis.pieces[current.selectedPiece];
  const contacts = selected ? analysis.contacts.filter(c => c.below === selected.id || c.above === selected.id) : [];
  return <ComparisonViewport {...props} inspection={current} controlsSlot={<div className="assembly-controls">
    <p role="status">{analysis.groups} connected {analysis.groups === 1 ? 'group' : 'groups'} · {warnings.length} of {analysis.pieces.length} pieces have size/contact warnings · {analysis.pieces.filter(p => !p.grounded).length} pieces have no connection to the bottom layer</p>
    <div className="assembly-fields">
      <label>Layers shown: {current.layersShown} / {result.layers.length}<input aria-label="Layers shown" type="range" min="1" max={result.layers.length} value={current.layersShown}
        onChange={e => update({ layersShown: Number(e.target.value), selectedPiece: selected && selected.layer >= Number(e.target.value) ? -1 : current.selectedPiece })} /></label>
      <label>Exploded gap: {mm(current.gapMm)} mm<input aria-label="Exploded gap" type="range" min="0" max={setup.thicknessMm * 3} step={setup.thicknessMm / 10} value={current.gapMm}
        onChange={e => update({ gapMm: Number(e.target.value) })} /></label>
    </div>
    <div className="assembly-fields">
      <label>Inspect piece<select aria-label="Inspect assembly piece" value={current.selectedPiece} onChange={e => {
        const index = Number(e.target.value); update({ selectedPiece: index, layersShown: index < 0 ? result.layers.length : analysis.pieces[index].layer + 1 });
      }}><option value="-1">All pieces</option>{analysis.pieces.map((piece,index) => <option key={piece.id} value={index}>
        {piece.warnings.length ? '⚠ ' : ''}Piece {piece.id} · group {piece.group}</option>)}</select></label>
      <label className="toggle"><input type="checkbox" checked={current.highlightWarnings} onChange={e => update({ highlightWarnings: e.target.checked })} />Highlight review pieces</label>
    </div>
    <button disabled={!warnings.length} onClick={() => {
      const next = analysis.pieces.findIndex((piece,index) => index > current.selectedPiece && piece.warnings.length);
      const index = next >= 0 ? next : analysis.pieces.findIndex(piece => piece.warnings.length);
      update({ selectedPiece: index, layersShown: analysis.pieces[index].layer + 1 });
    }}>Next review piece</button>
    {selected && <div className="assembly-detail" role="status"><strong>Piece {selected.id} · group {selected.group}</strong>
      <span>Area {mm(selected.areaMm2)} mm² · contact below {mm(selected.belowMm2)} mm² · above {mm(selected.aboveMm2)} mm²</span>
      <span>{selected.warnings.join(' · ') || 'No geometric warnings for this piece.'}</span>
      <span>Touches: {contacts.length ? contacts.map(c => `${c.below === selected.id ? c.above : c.below} (${mm(c.areaMm2)} mm²)`).join(', ') : 'No other layer pieces'}</span>
    </div>}
    <details><summary>How these checks work</summary><p>Only positive-area contact between adjacent layers counts as a connection. Separate groups cannot be glued into one model without additional connections. No contact below can mean a piece needs to be attached from above.</p>
      <p>Review thresholds: area or glue contact below {mm(analysis.areaThresholdMm2)} mm²; contact below 10% of a piece’s area; width or connecting neck below approximately {mm(analysis.widthThresholdMm)} mm. Width uses an inward offset of half that value. These are thickness-based screening rules, not strength predictions. Grain, glue, kerf and fragile protrusions still need judgment.</p></details>
    <p className="muted">Orange: needs review · Blue: selected. Selecting a piece hides layers above it. Reset view fits the exploded stack.</p>
  </div>} />;
}
