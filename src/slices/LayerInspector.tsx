import { useState } from 'react';
import type { Point2, SliceResult } from './geometry/types';
import { mm } from './PhysicalSetup';

const ringPath = (ring: Point2[]) => `M${ring.map((point) => point.join(',')).join('L')}Z`;

export function LayerInspector({ result }: { result: SliceResult }) {
  const [fraction, setFraction] = useState(0.5);
  const index = Math.round(fraction * (result.layers.length - 1));
  const layer = result.layers[index];
  const { min, max } = result.bounds;
  const width = max[0] - min[0], height = max[1] - min[1];
  const pad = Math.max(width, height) * 0.08 || 1;
  const issues = result.issues.filter((issue) => issue.layer === index);
  return <section className="slice-inspector" aria-label="Cross-section inspector">
    <div className="slice-inspector-toolbar">
      <label className="field">
        <span className="field__label"><span>Layer</span><span className="field__value">{index + 1} of {result.layers.length}</span></span>
        <input aria-label="Layer" type="range" min={1} max={result.layers.length} step={1} value={index + 1}
          onChange={(event) => setFraction((Number(event.target.value) - 1) / Math.max(1, result.layers.length - 1))} />
      </label>
      <div className="slice-layer-meta">
        <span>{layer.pieces.length} {layer.pieces.length === 1 ? 'piece' : 'pieces'}</span>
        <span>Sample Y: {mm(layer.sampleMm)} mm</span>
        <span>Slab: {mm(layer.bottomMm)} to {mm(layer.topMm)} mm</span>
      </div>
      {result.layers.some((candidate) => !candidate.valid) && <select aria-label="Jump to problem layer" value=""
        onChange={(event) => {
          if (event.target.value !== '') setFraction(Number(event.target.value) / Math.max(1, result.layers.length - 1));
        }}>
        <option value="">Inspect a problem layer…</option>
        {result.layers.filter((candidate) => !candidate.valid).map((candidate) =>
          <option key={candidate.index} value={candidate.index}>Layer {candidate.index + 1} — invalid contours</option>)}
      </select>}
    </div>
    <div className="slice-drawing">
      <svg viewBox={`${min[0] - pad} ${-max[1] - pad} ${width + pad * 2} ${height + pad * 2}`}
        role="img" aria-label={`Layer ${index + 1} cross-section: ${layer.pieces.length} pieces${layer.valid ? '' : ', invalid contours'}`}>
        <g transform="scale(1,-1)">
          {layer.pieces.map((piece) => <path key={piece.id} className="slice-piece"
            d={[ringPath(piece.outer), ...piece.holes.map(ringPath)].join(' ')} fillRule="evenodd" vectorEffect="non-scaling-stroke">
            <title>Piece {piece.id}: {mm(piece.areaMm2)} mm²; {piece.holes.length} holes</title>
          </path>)}
          {layer.invalidSegments && <path className="slice-invalid" vectorEffect="non-scaling-stroke"
            d={layer.invalidSegments.map(([a, b]) => `M${a.join(',')}L${b.join(',')}`).join(' ')} />}
        </g>
      </svg>
      {layer.valid && !layer.pieces.length && <p className="slice-no-pieces">No material at this sampling plane.</p>}
    </div>
    <div className="slice-inspector-notes">
      {!result.valid && <p className="warn">Diagnostic preview only. Resolve the reported geometry problems before fabrication.</p>}
      {issues.map((issue) => <p className="warn" key={issue.code}>{issue.message}</p>)}
      <p className="muted">Top view of each layer. All layers share the same scale and origin. Holes stay empty; disconnected regions stay separate.</p>
    </div>
  </section>;
}
