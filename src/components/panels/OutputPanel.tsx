import { useProjectStore, outputResolution, previewProject } from '../../state/store';
import { NumberField, Panel } from '../controls';

export function OutputPanel() {
  const project = useProjectStore((s) => s.project);
  const output = project.output;
  const update = useProjectStore((s) => s.update);
  const res = outputResolution(output);
  const previewRes = outputResolution(previewProject(project).output);

  return (
    <Panel title="Output">
      <div className="row">
        <NumberField
          label="Width (mm)"
          value={output.widthMm}
          min={1}
          onChange={(v) => update((p) => void (p.output.widthMm = v))}
        />
        <NumberField
          label="Height (mm)"
          value={output.heightMm}
          min={1}
          onChange={(v) => update((p) => void (p.output.heightMm = v))}
        />
      </div>
      <NumberField
        label="Resolution (px / mm)"
        value={output.pixelsPerMm}
        min={0.1}
        step={0.5}
        onChange={(v) => update((p) => void (p.output.pixelsPerMm = v))}
      />
      <NumberField
        label="Preview max depth (mm)"
        value={output.previewMaxDepthMm}
        min={0.1}
        step={0.5}
        onChange={(v) => update((p) => void (p.output.previewMaxDepthMm = v))}
      />
      <NumberField
        label="Preview resolution (px / mm)"
        value={output.previewPixelsPerMm}
        min={1}
        step={1}
        onChange={(v) => update((p) => void (p.output.previewPixelsPerMm = v))}
      />
      <div className="muted">
        Output: {res.width} × {res.height} px · preview: {previewRes.width} × {previewRes.height} px
      </div>
    </Panel>
  );
}
