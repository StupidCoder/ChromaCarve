import { loadImageFile, loadObjFile } from '../../assets/assetStore';
import { BUNDLED_MODELS } from '../../obj/bundledModels';
import { useProjectStore, type ModelSettings, type ModelSource } from '../../state/store';
import { ObjRotationViewport } from '../ObjRotationViewport';
import { SplineEditor } from '../SplineEditor';
import {
  DepthRangeField,
  FileInput,
  FillEditor,
  NumberField,
  Panel,
  Select,
  Slider,
  Toggle,
} from '../controls';

/** Run an async asset load, surfacing any failure to the user. */
function guard(load: () => Promise<void>) {
  load().catch((e) => alert(String(e instanceof Error ? e.message : e)));
}

const PRIMITIVE_OPTIONS: { value: ModelSource; label: string }[] = [
  { value: 'torus', label: 'Torus' },
  { value: 'sphere', label: 'Sphere' },
  { value: 'torusknot', label: 'Torus knot' },
  { value: 'cube', label: 'Cube' },
];

type SetModel = (mut: (m: ModelSettings) => void) => void;

/** Model source selector (OBJ upload or procedural primitive) + rotation gizmo. */
function ModelSourcePicker({
  model,
  setModel,
  bumpAssets,
}: {
  model: ModelSettings;
  setModel: SetModel;
  bumpAssets: () => void;
}) {
  // Size the orbit gizmo to the output aspect so its orthographic framing matches
  // the depth/color maps exactly (same projection, same zoom — "what you see…").
  const output = useProjectStore((s) => s.project.output);
  const outAspect = Math.max(0.4, Math.min(2.5, output.widthMm / output.heightMm));
  const MAX_W = 248;
  const MAX_H = 220;
  let gizmoW = MAX_W;
  let gizmoH = MAX_W / outAspect;
  if (gizmoH > MAX_H) {
    gizmoH = MAX_H;
    gizmoW = MAX_H * outAspect;
  }
  return (
    <>
      <div className="field">
        <div className="field__label"><span>Model</span></div>
        <select
          value={model.source}
          onChange={(e) => setModel((m) => void (m.source = e.target.value as ModelSource))}
        >
          <option value="obj">OBJ model</option>
          <optgroup label="Primitives">
            {PRIMITIVE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </optgroup>
          <optgroup label="Models">
            {BUNDLED_MODELS.map((mdl) => (
              <option key={mdl.source} value={mdl.source}>{mdl.label}</option>
            ))}
          </optgroup>
        </select>
      </div>
      {model.source === 'obj' && (
        <FileInput
          label="Model (OBJ)"
          accept=".obj"
          fileName={model.assetRef}
          onFile={(file) =>
            guard(async () => {
              const ref = await loadObjFile(file);
              setModel((m) => void (m.assetRef = ref));
              bumpAssets();
            })
          }
        />
      )}
      {(model.source !== 'obj' || model.assetRef) && (
        <>
          <ObjRotationViewport
            model={model}
            onQuat={(q) => setModel((m) => void (m.rotationQuat = q))}
            onScale={(s) => setModel((m) => void (m.scale = s))}
            width={Math.round(gizmoW)}
            height={Math.round(gizmoH)}
          />
          <Slider
            label="Roll"
            value={model.roll ?? 0}
            min={-180}
            max={180}
            step={1}
            format={(v) => `${Math.round(v)}°`}
            onChange={(v) => setModel((m) => void (m.roll = v))}
          />
        </>
      )}
      {(model.source === 'torus' || model.source === 'torusknot') && (
        <Slider
          label="Tube thickness"
          value={model.procTube}
          min={0.02}
          max={0.4}
          step={0.01}
          onChange={(v) => setModel((m) => void (m.procTube = v))}
        />
      )}
      {model.source === 'torusknot' && (
        <div className="row">
          <NumberField
            label="Winding p"
            value={model.procP}
            min={1}
            max={12}
            step={1}
            onChange={(v) => setModel((m) => void (m.procP = Math.round(v)))}
          />
          <NumberField
            label="Winding q"
            value={model.procQ}
            min={1}
            max={12}
            step={1}
            onChange={(v) => setModel((m) => void (m.procQ = Math.round(v)))}
          />
        </div>
      )}
      {model.source === 'sphere' && (
        <Slider
          label="Squash"
          value={model.procSquash}
          min={0.2}
          max={3}
          step={0.05}
          onChange={(v) => setModel((m) => void (m.procSquash = v))}
        />
      )}
      {model.source === 'cube' && (
        <div className="row">
          <NumberField
            label="Width"
            value={model.procBoxW}
            min={0.1}
            max={5}
            step={0.1}
            onChange={(v) => setModel((m) => void (m.procBoxW = v))}
          />
          <NumberField
            label="Depth"
            value={model.procBoxD}
            min={0.1}
            max={5}
            step={0.1}
            onChange={(v) => setModel((m) => void (m.procBoxD = v))}
          />
        </div>
      )}
    </>
  );
}

/**
 * Shared AO + curvature ("Shading") controls used by the foreground model and
 * the tiled background model — identical knobs on `ModelSettings`.
 */
function ShadingSection({ model, setModel }: { model: ModelSettings; setModel: SetModel }) {
  return (
    <Panel title="Shading">
      <Slider
        label="AO shading"
        value={model.aoStrength}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => setModel((m) => void (m.aoStrength = v))}
      />
      <NumberField
        label="AO radius (mm)"
        value={model.aoRadiusMm}
        min={0.5}
        step={0.5}
        onChange={(v) => setModel((m) => void (m.aoRadiusMm = v))}
      />
      <Slider
        label="Surface detail"
        value={model.surfaceShade}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => setModel((m) => void (m.surfaceShade = v))}
      />
      <NumberField
        label="Surface radius (mm)"
        value={model.surfaceShadeRadiusMm}
        min={0.2}
        step={0.5}
        onChange={(v) => setModel((m) => void (m.surfaceShadeRadiusMm = v))}
      />
    </Panel>
  );
}

/** Enable/disable header row shown at the top of a part tab. */
function EnableRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="enable-row">
      <Toggle label={label} checked={checked} onChange={onChange} />
    </div>
  );
}

export function ForegroundTab() {
  const fg = useProjectStore((s) => s.project.foreground);
  const update = useProjectStore((s) => s.update);
  const bumpAssets = useProjectStore((s) => s.bumpAssets);
  const setModel: SetModel = (mut) => update((p) => mut(p.foreground.model));
  const m = fg.model;
  return (
    <div className="tab-body">
      <EnableRow
        label="Enable foreground"
        checked={fg.enabled}
        onChange={(v) => update((p) => void (p.foreground.enabled = v))}
      />

      <Panel title="Model">
        <ModelSourcePicker model={m} setModel={setModel} bumpAssets={bumpAssets} />
        <Slider
          label="Scale"
          value={m.scale}
          min={0.1}
          max={5}
          step={0.05}
          onChange={(v) => setModel((d) => void (d.scale = v))}
        />
        <div className="row">
          <NumberField
            label="Offset X (mm)"
            value={m.offsetXmm}
            step={1}
            onChange={(v) => update((p) => void (p.foreground.model.offsetXmm = v))}
          />
          <NumberField
            label="Offset Y (mm)"
            value={m.offsetYmm}
            step={1}
            onChange={(v) => update((p) => void (p.foreground.model.offsetYmm = v))}
          />
        </div>
        <Select
          label="Geometry mode"
          value={m.basRelief ? 'relief' : 'raw'}
          options={[
            { value: 'relief', label: 'Bas-relief' },
            { value: 'raw', label: 'Pure depth' },
          ]}
          onChange={(v) => setModel((d) => void (d.basRelief = v === 'relief'))}
        />
        {m.basRelief && (
          <>
            <Slider
              label="Compression / detail (β)"
              value={m.reliefBeta}
              min={0.2}
              max={0.95}
              step={0.01}
              onChange={(v) => setModel((d) => void (d.reliefBeta = v))}
            />
            <Slider
              label="Detail level (α)"
              value={m.reliefAlphaFactor}
              min={0.05}
              max={0.4}
              step={0.01}
              onChange={(v) => setModel((d) => void (d.reliefAlphaFactor = v))}
            />
            <NumberField
              label="Edge emergence (mm)"
              value={m.reliefEmergeMm}
              min={0}
              step={0.5}
              onChange={(v) => setModel((d) => void (d.reliefEmergeMm = v))}
            />
          </>
        )}
      </Panel>

      <Panel title="Depth">
        <DepthRangeField
          min={m.depth.min}
          max={m.depth.max}
          onChange={(r) => setModel((d) => void (d.depth = r))}
        />
        <Toggle
          label="Maximize depth range"
          checked={m.normalizeDepth}
          onChange={(v) => setModel((d) => void (d.normalizeDepth = v))}
        />
        <Slider
          label="Detail (unsharp)"
          value={m.detail}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => setModel((d) => void (d.detail = v))}
        />
        <Slider
          label="Depth curve (γ)"
          value={m.gamma}
          min={0.3}
          max={3}
          step={0.05}
          onChange={(v) => setModel((d) => void (d.gamma = v))}
        />
        <Toggle
          label="Supersample (2×)"
          checked={m.supersample}
          onChange={(v) => setModel((d) => void (d.supersample = v))}
        />
        {!m.basRelief && (
          <NumberField
            label="Edge falloff (mm)"
            value={m.edgeFalloffMm}
            min={0}
            step={0.5}
            onChange={(v) => setModel((d) => void (d.edgeFalloffMm = v))}
          />
        )}
      </Panel>

      <Panel title="Color">
        <FillEditor
          label="Fill"
          fill={m.fill}
          onChange={(f) => setModel((d) => void (d.fill = f))}
        />
      </Panel>

      <ShadingSection model={m} setModel={setModel} />
    </div>
  );
}

export function BackgroundTab() {
  const bg = useProjectStore((s) => s.project.background);
  const update = useProjectStore((s) => s.update);
  const bumpAssets = useProjectStore((s) => s.bumpAssets);
  const setModel: SetModel = (mut) => update((p) => mut(p.background.model));

  return (
    <div className="tab-body">
      <EnableRow
        label="Enable background"
        checked={bg.enabled}
        onChange={(v) => update((p) => void (p.background.enabled = v))}
      />

      <Panel title="Model">
        <Select
          label="Source"
          value={bg.type}
          options={[
            { value: 'image', label: 'Image' },
            { value: 'model', label: 'Model (tiled)' },
            { value: 'solid', label: 'Solid color' },
          ]}
          onChange={(v) => update((p) => void (p.background.type = v))}
        />
        {bg.type === 'image' && (
          <FileInput
            label="Image"
            accept="image/*"
            fileName={bg.image.assetRef}
            onFile={(file) =>
              guard(async () => {
                const ref = await loadImageFile(file);
                update((p) => void (p.background.image.assetRef = ref));
                bumpAssets();
              })
            }
          />
        )}
        {bg.type === 'model' && (
          <>
            <ModelSourcePicker model={bg.model} setModel={setModel} bumpAssets={bumpAssets} />
            <Slider
              label="Tile zoom"
              value={bg.model.scale}
              min={0.1}
              max={5}
              step={0.05}
              onChange={(v) => setModel((d) => void (d.scale = v))}
            />
            <NumberField
              label="Tile size (mm)"
              value={bg.model.tileSizeMm}
              min={0.5}
              step={1}
              onChange={(v) => update((p) => void (p.background.model.tileSizeMm = v))}
            />
            <div className="row">
              <NumberField
                label="Interval X (mm)"
                value={bg.model.intervalXmm}
                min={0.5}
                step={1}
                onChange={(v) => update((p) => void (p.background.model.intervalXmm = v))}
              />
              <NumberField
                label="Interval Y (mm)"
                value={bg.model.intervalYmm}
                min={0.5}
                step={1}
                onChange={(v) => update((p) => void (p.background.model.intervalYmm = v))}
              />
            </div>
          </>
        )}
      </Panel>

      <Panel title="Depth">
        {bg.type === 'solid' && (
          <NumberField
            label="Depth (constant)"
            value={bg.solidDepth}
            step={0.01}
            onChange={(v) => update((p) => void (p.background.solidDepth = v))}
          />
        )}
        {bg.type === 'image' && (
          <NumberField
            label="Depth (constant)"
            value={bg.image.depth.min}
            step={0.01}
            onChange={(v) =>
              update((p) => void (p.background.image.depth = { min: v, max: v }))
            }
          />
        )}
        {bg.type === 'model' && (
          <>
            <DepthRangeField
              min={bg.model.depth.min}
              max={bg.model.depth.max}
              onChange={(r) => setModel((d) => void (d.depth = r))}
            />
            <Toggle
              label="Maximize depth range"
              checked={bg.model.normalizeDepth}
              onChange={(v) => setModel((d) => void (d.normalizeDepth = v))}
            />
            <Slider
              label="Detail (unsharp)"
              value={bg.model.detail}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => setModel((d) => void (d.detail = v))}
            />
            <Slider
              label="Depth curve (γ)"
              value={bg.model.gamma}
              min={0.3}
              max={3}
              step={0.05}
              onChange={(v) => setModel((d) => void (d.gamma = v))}
            />
            <Toggle
              label="Supersample (2×)"
              checked={bg.model.supersample}
              onChange={(v) => setModel((d) => void (d.supersample = v))}
            />
            <NumberField
              label="Edge falloff (mm)"
              value={bg.model.edgeFalloffMm}
              min={0}
              step={0.5}
              onChange={(v) => setModel((d) => void (d.edgeFalloffMm = v))}
            />
          </>
        )}
      </Panel>

      <Panel title="Color">
        {bg.type === 'solid' && (
          <FillEditor
            label="Fill"
            fill={bg.solidFill}
            onChange={(f) => update((p) => void (p.background.solidFill = f))}
          />
        )}
        {bg.type === 'image' && (
          <>
            <Slider
              label="Blur (% of size)"
              value={bg.image.blur}
              min={0}
              max={0.1}
              step={0.002}
              format={(v) => `${(v * 100).toFixed(1)}%`}
              onChange={(v) => update((p) => void (p.background.image.blur = v))}
            />
            <Slider
              label="Brightness"
              value={bg.image.brightness}
              min={-1}
              max={1}
              onChange={(v) => update((p) => void (p.background.image.brightness = v))}
            />
            <Slider
              label="Contrast"
              value={bg.image.contrast}
              min={-1}
              max={1}
              onChange={(v) => update((p) => void (p.background.image.contrast = v))}
            />
            <Slider
              label="Desaturation"
              value={bg.image.desaturation}
              min={0}
              max={1}
              onChange={(v) => update((p) => void (p.background.image.desaturation = v))}
            />
          </>
        )}
        {bg.type === 'model' && (
          <FillEditor
            label="Fill"
            fill={bg.model.fill}
            onChange={(f) => setModel((d) => void (d.fill = f))}
          />
        )}
      </Panel>

      {bg.type === 'model' && <ShadingSection model={bg.model} setModel={setModel} />}
    </div>
  );
}

export function FrameTab() {
  const border = useProjectStore((s) => s.project.border);
  const update = useProjectStore((s) => s.update);
  return (
    <div className="tab-body">
      <EnableRow
        label="Enable frame"
        checked={border.enabled}
        onChange={(v) => update((p) => void (p.border.enabled = v))}
      />
      <div className="field__label">
        <span>Profile (outer → inner edge)</span>
      </div>
      <SplineEditor
        points={border.profilePoints}
        onChange={(pts) => update((p) => void (p.border.profilePoints = pts))}
      />
      <NumberField
        label="Border width (mm)"
        value={border.widthMm}
        min={0.5}
        step={1}
        onChange={(v) => update((p) => void (p.border.widthMm = v))}
      />
      <FillEditor
        label="Fill"
        fill={border.fill}
        onChange={(f) => update((p) => void (p.border.fill = f))}
      />
      <DepthRangeField
        min={border.depth.min}
        max={border.depth.max}
        onChange={(r) => update((p) => void (p.border.depth = r))}
      />
    </div>
  );
}
