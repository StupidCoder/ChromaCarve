import type { ModelAsset } from '../assets/assetStore';
import { NumberField } from '../components/controls';
import type { Point3, SliceSetup } from './geometry/types';
import { setSliceSetup } from './store';
import type { SlicingComputation } from './useSlicing';

export const mm = (value: number) => Number(value.toFixed(2)).toLocaleString();

export function PhysicalSetup({ asset, setup, disabled, computation }: {
  asset: ModelAsset; setup: SliceSetup; disabled: boolean; computation: SlicingComputation;
}) {
  if (!asset.geometry.boundingBox) asset.geometry.computeBoundingBox();
  const box = asset.geometry.boundingBox!;
  const original = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
  const longest = Math.max(...original);
  const dimensions = original.map((value) => longest > 0 ? value / longest * setup.sizeMm : 0);
  return <section className="slices-model-section slices-physical" aria-labelledby="physical-heading">
    <h2 id="physical-heading">Physical setup</h2>
    <fieldset disabled={disabled}>
      <NumberField label="Longest side (mm)" value={setup.sizeMm} min={0.1} max={10000} step={1}
        onChange={(sizeMm) => setSliceSetup({ sizeMm })} />
      <p className="muted">{dimensions.map(mm).join(' × ')} mm (width × height × depth before rotation). Proportions stay locked.</p>
      <NumberField label="Measured plywood thickness (mm)" value={setup.thicknessMm} min={0.05} max={100} step={0.1}
        onChange={(thicknessMm) => setSliceSetup({ thicknessMm })} />
      <div className="field">
        <span className="field__label">Slice direction</span>
        <div className="slices-direction" aria-label="Slice direction presets">
          {([{ label: 'Horizontal', rotation: [0, 0, 0] }, { label: 'Front to back', rotation: [90, 0, 0] }, { label: 'Side to side', rotation: [0, 0, 90] }] as { label: string; rotation: Point3 }[]).map(({ label, rotation }) =>
            <button key={label} aria-pressed={rotation.every((angle, i) => angle === setup.rotationDeg[i])}
              onClick={() => setSliceSetup({ rotationDeg: rotation })}>{label}</button>)}
        </div>
      </div>
      <div className="row">
        {(['X', 'Y', 'Z'] as const).map((axis, i) => <NumberField key={axis} label={`Rotate ${axis} (°)`}
          value={setup.rotationDeg[i]} min={-180} max={180} step={1} onChange={(value) => {
            const rotationDeg: Point3 = [...setup.rotationDeg]; rotationDeg[i] = value;
            setSliceSetup({ rotationDeg });
          }} />)}
      </div>
      <p className="muted">Rotate the model above. Layers are horizontal, stacked along the preview’s vertical Y axis.</p>
      <NumberField label="Sampling offset (mm)" value={setup.samplingOffsetMm}
        min={-setup.thicknessMm / 2} max={setup.thicknessMm / 2} step={0.05}
        onChange={(samplingOffsetMm) => setSliceSetup({ samplingOffsetMm })} />
      <p className="muted">Zero samples each layer’s midpoint. Offset moves the sample within the fixed plywood layer (±{mm(setup.thicknessMm / 2)} mm).</p>
    </fieldset>
    <SliceSummary computation={computation} thickness={setup.thicknessMm} />
  </section>;
}

export function SliceSummary({ computation, thickness }: { computation: SlicingComputation; thickness: number }) {
  const { status, result, error, progress, cancel, retry } = computation;
  if (status === 'queued' || status === 'running') return <div className="slices-computation">
    <p role="status">{progress?.phase ?? 'Preparing cross-sections…'}</p>
    <progress aria-label="Slicing progress" max={1} value={progress?.fraction ?? 0} />
    <button onClick={cancel}>Cancel slicing</button>
  </div>;
  if (status === 'cancelled' || status === 'error') return <div className="slices-computation">
    <p className={error ? 'warn' : 'muted'} role={error ? 'alert' : 'status'}>{error ?? 'Slicing cancelled.'}</p>
    <button onClick={retry}>Retry slicing</button>
  </div>;
  if (!result) return null;
  return <div className="slices-summary">
    <p className={result.valid ? 'slices-ready' : 'warn'} role="status">
      {result.valid ? 'Cross-sections ready' : 'Mesh or contours need attention'}
    </p>
    <dl>
      <div><dt>Layers / pieces</dt><dd>{result.layers.length} / {result.pieceCount}</dd></div>
      <div><dt>Rotated model</dt><dd>{result.modelSizeMm.map(mm).join(' × ')} mm</dd></div>
      <div><dt>Planned stack</dt><dd>{mm(result.plannedStackMm)} mm</dd></div>
      <div><dt>Height difference</dt><dd>{mm(result.plannedStackMm - result.modelSizeMm[1])} mm</dd></div>
      {result.emptyLayers > 0 && <><div><dt>Empty layers</dt><dd>{result.emptyLayers}</dd></div>
        <div><dt>Span of usable layers</dt><dd>{mm(result.occupiedStackMm)} mm</dd></div></>}
    </dl>
    <p className="muted">{result.layers.length} full layers × {mm(thickness)} mm, centered on the model. The height difference is shared equally above and below.</p>
    {result.issues.filter((issue) => issue.layer === undefined).map((issue) =>
      <p className="warn" key={issue.code}>{issue.message}</p>)}
    {result.layers.some((layer) => !layer.valid) && <p className="warn">{result.layers.filter((layer) => !layer.valid).length} layers have invalid contours. Inspect them in Cross-sections.</p>}
  </div>;
}
