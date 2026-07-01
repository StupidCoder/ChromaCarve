import { loadImageFile, loadObjFile } from '../../assets/assetStore';
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

const MODEL_OPTIONS: { value: ModelSource; label: string }[] = [
  { value: 'obj', label: 'OBJ file' },
  { value: 'torus', label: 'Torus' },
  { value: 'sphere', label: 'Sphere' },
  { value: 'torusknot', label: 'Torus knot' },
  { value: 'cube', label: 'Cube' },
];

/** Model source selector (OBJ upload or procedural primitive) + rotation gizmo. */
function ModelSourcePicker({
  model,
  setModel,
  bumpAssets,
}: {
  model: ModelSettings;
  setModel: (mut: (m: ModelSettings) => void) => void;
  bumpAssets: () => void;
}) {
  return (
    <>
      <Select
        label="Model"
        value={model.source}
        options={MODEL_OPTIONS}
        onChange={(s) => setModel((m) => void (m.source = s))}
      />
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
        <ObjRotationViewport
          model={model}
          onQuat={(q) => setModel((m) => void (m.rotationQuat = q))}
        />
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
 * M0 placeholder panels: enable toggles + depth ranges only. Functional
 * controls (upload, blur, spline, rotation, tiling) are added in later
 * milestones.
 */

export function BackgroundPanel() {
  const bg = useProjectStore((s) => s.project.background);
  const update = useProjectStore((s) => s.update);
  const bumpAssets = useProjectStore((s) => s.bumpAssets);

  return (
    <Panel
      title="Background"
      right={
        <Toggle
          label=""
          checked={bg.enabled}
          onChange={(v) => update((p) => void (p.background.enabled = v))}
        />
      }
    >
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

      {bg.type === 'solid' && (
        <>
          <FillEditor
            label="Fill"
            fill={bg.solidFill}
            onChange={(f) => update((p) => void (p.background.solidFill = f))}
          />
          <NumberField
            label="Depth (constant)"
            value={bg.solidDepth}
            step={0.01}
            onChange={(v) => update((p) => void (p.background.solidDepth = v))}
          />
        </>
      )}

      {bg.type === 'image' && (
        <>
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
          <NumberField
            label="Depth (constant)"
            value={bg.image.depth.min}
            step={0.01}
            onChange={(v) =>
              update((p) => void (p.background.image.depth = { min: v, max: v }))
            }
          />
        </>
      )}

      {bg.type === 'model' && (
        <>
          <ModelSourcePicker
            model={bg.model}
            setModel={(mut) => update((p) => mut(p.background.model))}
            bumpAssets={bumpAssets}
          />
          <Slider
            label="Tile zoom"
            value={bg.model.scale}
            min={0.1}
            max={5}
            step={0.05}
            onChange={(v) => update((p) => void (p.background.model.scale = v))}
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
          <FillEditor
            label="Fill"
            fill={bg.model.fill}
            onChange={(f) => update((p) => void (p.background.model.fill = f))}
          />
          <DepthRangeField
            min={bg.model.depth.min}
            max={bg.model.depth.max}
            onChange={(r) => update((p) => void (p.background.model.depth = r))}
          />
          <Toggle
            label="Maximize depth range"
            checked={bg.model.normalizeDepth}
            onChange={(v) => update((p) => void (p.background.model.normalizeDepth = v))}
          />
          <Slider
            label="Detail (unsharp)"
            value={bg.model.detail}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => update((p) => void (p.background.model.detail = v))}
          />
          <Slider
            label="Depth curve (γ)"
            value={bg.model.gamma}
            min={0.3}
            max={3}
            step={0.05}
            onChange={(v) => update((p) => void (p.background.model.gamma = v))}
          />
          <Toggle
            label="Supersample (2×)"
            checked={bg.model.supersample}
            onChange={(v) => update((p) => void (p.background.model.supersample = v))}
          />
          <NumberField
            label="Edge falloff (mm)"
            value={bg.model.edgeFalloffMm}
            min={0}
            step={0.5}
            onChange={(v) => update((p) => void (p.background.model.edgeFalloffMm = v))}
          />
          <Slider
            label="AO shading"
            value={bg.model.aoStrength}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => update((p) => void (p.background.model.aoStrength = v))}
          />
          <NumberField
            label="AO radius (mm)"
            value={bg.model.aoRadiusMm}
            min={0.5}
            step={0.5}
            onChange={(v) => update((p) => void (p.background.model.aoRadiusMm = v))}
          />
          <Slider
            label="Surface detail"
            value={bg.model.surfaceShade}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => update((p) => void (p.background.model.surfaceShade = v))}
          />
          <NumberField
            label="Surface radius (mm)"
            value={bg.model.surfaceShadeRadiusMm}
            min={0.2}
            step={0.5}
            onChange={(v) => update((p) => void (p.background.model.surfaceShadeRadiusMm = v))}
          />
        </>
      )}
    </Panel>
  );
}

export function BorderPanel() {
  const border = useProjectStore((s) => s.project.border);
  const update = useProjectStore((s) => s.update);
  return (
    <Panel
      title="Border"
      right={
        <Toggle
          label=""
          checked={border.enabled}
          onChange={(v) => update((p) => void (p.border.enabled = v))}
        />
      }
    >
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
    </Panel>
  );
}

export function ForegroundPanel() {
  const fg = useProjectStore((s) => s.project.foreground);
  const update = useProjectStore((s) => s.update);
  const bumpAssets = useProjectStore((s) => s.bumpAssets);
  return (
    <Panel
      title="Foreground"
      right={
        <Toggle
          label=""
          checked={fg.enabled}
          onChange={(v) => update((p) => void (p.foreground.enabled = v))}
        />
      }
    >
      <ModelSourcePicker
        model={fg.model}
        setModel={(mut) => update((p) => mut(p.foreground.model))}
        bumpAssets={bumpAssets}
      />
      <Slider
        label="Scale"
        value={fg.model.scale}
        min={0.1}
        max={5}
        step={0.05}
        onChange={(v) => update((p) => void (p.foreground.model.scale = v))}
      />
      <div className="row">
        <NumberField
          label="Offset X (mm)"
          value={fg.model.offsetXmm}
          step={1}
          onChange={(v) => update((p) => void (p.foreground.model.offsetXmm = v))}
        />
        <NumberField
          label="Offset Y (mm)"
          value={fg.model.offsetYmm}
          step={1}
          onChange={(v) => update((p) => void (p.foreground.model.offsetYmm = v))}
        />
      </div>
      <FillEditor
        label="Fill"
        fill={fg.model.fill}
        onChange={(f) => update((p) => void (p.foreground.model.fill = f))}
      />
      <DepthRangeField
        min={fg.model.depth.min}
        max={fg.model.depth.max}
        onChange={(r) => update((p) => void (p.foreground.model.depth = r))}
      />
      <Toggle
        label="Maximize depth range"
        checked={fg.model.normalizeDepth}
        onChange={(v) => update((p) => void (p.foreground.model.normalizeDepth = v))}
      />
      <Slider
        label="Detail (unsharp)"
        value={fg.model.detail}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => update((p) => void (p.foreground.model.detail = v))}
      />
      <Slider
        label="Depth curve (γ)"
        value={fg.model.gamma}
        min={0.3}
        max={3}
        step={0.05}
        onChange={(v) => update((p) => void (p.foreground.model.gamma = v))}
      />
      <Toggle
        label="Bas-relief (dissolve cliffs)"
        checked={fg.model.basRelief}
        onChange={(v) => update((p) => void (p.foreground.model.basRelief = v))}
      />
      {fg.model.basRelief && (
        <>
          <Slider
            label="Compression / detail (β)"
            value={fg.model.reliefBeta}
            min={0.2}
            max={0.95}
            step={0.01}
            onChange={(v) => update((p) => void (p.foreground.model.reliefBeta = v))}
          />
          <Slider
            label="Detail level (α)"
            value={fg.model.reliefAlphaFactor}
            min={0.05}
            max={0.4}
            step={0.01}
            onChange={(v) => update((p) => void (p.foreground.model.reliefAlphaFactor = v))}
          />
          <NumberField
            label="Edge emergence (mm)"
            value={fg.model.reliefEmergeMm}
            min={0}
            step={0.5}
            onChange={(v) => update((p) => void (p.foreground.model.reliefEmergeMm = v))}
          />
        </>
      )}
      <Toggle
        label="Supersample (2×)"
        checked={fg.model.supersample}
        onChange={(v) => update((p) => void (p.foreground.model.supersample = v))}
      />
      <NumberField
        label="Edge falloff (mm)"
        value={fg.model.edgeFalloffMm}
        min={0}
        step={0.5}
        onChange={(v) => update((p) => void (p.foreground.model.edgeFalloffMm = v))}
      />
      <Slider
        label="AO shading"
        value={fg.model.aoStrength}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => update((p) => void (p.foreground.model.aoStrength = v))}
      />
      <NumberField
        label="AO radius (mm)"
        value={fg.model.aoRadiusMm}
        min={0.5}
        step={0.5}
        onChange={(v) => update((p) => void (p.foreground.model.aoRadiusMm = v))}
      />
      <Slider
        label="Surface detail"
        value={fg.model.surfaceShade}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => update((p) => void (p.foreground.model.surfaceShade = v))}
      />
      <NumberField
        label="Surface radius (mm)"
        value={fg.model.surfaceShadeRadiusMm}
        min={0.2}
        step={0.5}
        onChange={(v) => update((p) => void (p.foreground.model.surfaceShadeRadiusMm = v))}
      />
    </Panel>
  );
}
