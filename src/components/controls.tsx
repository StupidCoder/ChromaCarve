import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  defaultStoneParams,
  defaultWoodParams,
  STONE_PRESETS,
  WOOD_PRESETS,
  type Fill,
  type FillType,
  type MicroRelief,
  type StoneParams,
  type StoneType,
  type WoodMode,
  type WoodParams,
} from '../state/store';

export function Panel({
  title,
  children,
  defaultOpen = true,
  right,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  right?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="panel">
      <div className="panel__header" onClick={() => setOpen((o) => !o)}>
        <span>{open ? '▾' : '▸'}</span>
        <span style={{ flex: 1 }}>{title}</span>
        <span onClick={(e) => e.stopPropagation()}>{right}</span>
      </div>
      {open && <div className="panel__body">{children}</div>}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="field">
      <div className="field__label">
        <span>{label}</span>
        <span className="field__value">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  // Local text state so the field can be cleared / partially typed (e.g. "", "-",
  // "1.") without ever pushing a NaN into the store. Only finite values commit;
  // the value is clamped and normalized on blur.
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  const clamp = (v: number) => {
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  };

  return (
    <div className="field">
      <div className="field__label">
        <span>{label}</span>
      </div>
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          const v = parseFloat(text);
          const c = Number.isFinite(v) ? clamp(v) : value;
          onChange(c);
          setText(String(c));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v); // commit raw while typing; clamp on blur
        }}
      />
    </div>
  );
}

/** Numeric seed field with a dice button that rolls a fresh random seed. */
export function SeedField({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="seed-field">
      <NumberField label="Seed" value={value} step={1} onChange={onChange} />
      <button
        type="button"
        className="dice-btn"
        title="Random seed"
        aria-label="Randomize seed"
        onClick={() => onChange(Math.floor(Math.random() * 1_000_000))}
      >
        🎲
      </button>
    </div>
  );
}

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field">
      <div className="field__label">
        <span>{label}</span>
      </div>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="field">
      <div className="field__label">
        <span>{label}</span>
      </div>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function FileInput({
  label,
  accept,
  fileName,
  onFile,
}: {
  label: string;
  accept: string;
  fileName: string | null;
  onFile: (file: File) => void;
}) {
  return (
    <div className="field">
      <div className="field__label">
        <span>{label}</span>
        <span className="field__value">{fileName ?? 'none'}</span>
      </div>
      <input
        type="file"
        accept={accept}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/** Depth micro-relief toggle + amount (+ optional proud/recessed mode). */
function MicroReliefEditor({
  label,
  micro,
  onChange,
  lockMode,
}: {
  label: string;
  micro: MicroRelief;
  onChange: (m: MicroRelief) => void;
  lockMode?: boolean;
}) {
  return (
    <>
      <Toggle label={label} checked={micro.enabled} onChange={(v) => onChange({ ...micro, enabled: v })} />
      {micro.enabled && (
        <>
          <Slider
            label="Micro-relief amount"
            value={micro.amount}
            min={0}
            max={0.25}
            step={0.005}
            onChange={(v) => onChange({ ...micro, amount: v })}
          />
          {!lockMode && (
            <Select
              label="Micro-relief mode"
              value={micro.mode}
              options={[
                { value: 'add', label: 'Proud (raised)' },
                { value: 'subtract', label: 'Recessed (grooves)' },
              ]}
              onChange={(m) => onChange({ ...micro, mode: m as 'add' | 'subtract' })}
            />
          )}
        </>
      )}
    </>
  );
}

/** Editable list of color stops (add / remove / recolor). */
function ColorList({
  label,
  colors,
  onChange,
  min = 1,
  max = 6,
}: {
  label: string;
  colors: string[];
  onChange: (colors: string[]) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="field">
      <div className="field__label">
        <span>{label}</span>
        <span className="field__value">
          {colors.length > min && (
            <button type="button" onClick={() => onChange(colors.slice(0, -1))}>
              −
            </button>
          )}
          {colors.length < max && (
            <button
              type="button"
              onClick={() => onChange([...colors, colors[colors.length - 1] ?? '#888888'])}
            >
              +
            </button>
          )}
        </span>
      </div>
      <div className="row">
        {colors.map((c, i) => (
          <input
            key={i}
            type="color"
            value={c}
            onChange={(e) => onChange(colors.map((x, j) => (j === i ? e.target.value : x)))}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Controls for the volumetric ("carved from a solid block") wood material. Grain
 * scale/orientation and the two outer color stops live on `Fill`; everything
 * wood-specific lives on `Fill.wood`. See the tuning note: `Depth scale` is the
 * master knob for how "sliced" the grain looks over relief.
 */
function WoodEditor({ fill, onChange }: { fill: Fill; onChange: (fill: Fill) => void }) {
  const wood = fill.wood ?? defaultWoodParams();
  const setFill = (patch: Partial<Fill>) => onChange({ ...fill, ...patch });
  const setWood = (patch: Partial<WoodParams>) => onChange({ ...fill, wood: { ...wood, ...patch } });
  return (
    <>
      <Select
        label="Preset"
        value={'custom'}
        options={[
          { value: 'custom', label: 'Custom…' },
          { value: 'walnut', label: 'Walnut' },
          { value: 'oak', label: 'Oak' },
          { value: 'olive', label: 'Olive (figured)' },
        ]}
        onChange={(k) => {
          if (k !== 'custom') onChange(WOOD_PRESETS[k]());
        }}
      />
      <ColorField label="Earlywood (light)" value={fill.color1} onChange={(c) => setFill({ color1: c })} />
      <ColorField label="Mid tone" value={wood.colorMid} onChange={(c) => setWood({ colorMid: c })} />
      <ColorField label="Latewood (dark)" value={fill.color2} onChange={(c) => setFill({ color2: c })} />

      <Slider
        label="Depth scale (slicing)"
        value={wood.depthScale}
        min={0}
        max={3}
        step={0.05}
        onChange={(v) => setWood({ depthScale: v })}
      />
      <NumberField
        label="Grain scale (mm)"
        value={fill.scaleMm}
        min={0.5}
        step={1}
        onChange={(v) => setFill({ scaleMm: v })}
      />
      <Slider
        label="Grain angle"
        value={fill.angle}
        min={0}
        max={180}
        step={1}
        format={(v) => `${Math.round(v)}°`}
        onChange={(v) => setFill({ angle: v })}
      />
      <Select
        label="Grain layout"
        value={wood.mode}
        options={[
          { value: 'bands', label: 'Bands (flat-sawn)' },
          { value: 'rings', label: 'Rings (end-grain)' },
        ]}
        onChange={(m) => setWood({ mode: m as WoodMode })}
      />
      <Slider
        label="Ring density"
        value={wood.ringDensity}
        min={0.5}
        max={20}
        step={0.1}
        onChange={(v) => setWood({ ringDensity: v })}
      />
      <Slider
        label="Pith depth (flame)"
        value={wood.pithDepth}
        min={0.2}
        max={5}
        step={0.1}
        onChange={(v) => setWood({ pithDepth: v })}
      />
      <Slider
        label="Line sharpness"
        value={wood.contrast}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => setWood({ contrast: v })}
      />

      <div className="row">
        <Slider
          label="Pith wander freq"
          value={wood.warpCoarseFreq}
          min={0}
          max={1}
          step={0.02}
          onChange={(v) => setWood({ warpCoarseFreq: v })}
        />
        <Slider
          label="Pith wander amp"
          value={wood.warpCoarseAmp}
          min={0}
          max={2}
          step={0.05}
          onChange={(v) => setWood({ warpCoarseAmp: v })}
        />
      </div>
      <div className="row">
        <Slider
          label="Grain turbulence freq"
          value={wood.warpFineFreq}
          min={0}
          max={2}
          step={0.05}
          onChange={(v) => setWood({ warpFineFreq: v })}
        />
        <Slider
          label="Grain turbulence amp"
          value={wood.warpFineAmp}
          min={0}
          max={0.5}
          step={0.01}
          onChange={(v) => setWood({ warpFineAmp: v })}
        />
      </div>
      <Slider
        label="Turbulence (boost)"
        value={fill.turbulence}
        min={0}
        max={2}
        step={0.05}
        onChange={(v) => setFill({ turbulence: v })}
      />

      <Slider
        label="Colour zoning"
        value={wood.tintStrength}
        min={0}
        max={1}
        step={0.02}
        onChange={(v) => setWood({ tintStrength: v })}
      />
      <Slider
        label="Pores"
        value={wood.poreStrength}
        min={0}
        max={1}
        step={0.02}
        onChange={(v) => setWood({ poreStrength: v })}
      />
      <Slider
        label="Figure streak"
        value={wood.streakStrength}
        min={0}
        max={1}
        step={0.02}
        onChange={(v) => setWood({ streakStrength: v })}
      />
      <Slider
        label="Ring variation"
        value={wood.fleckStrength}
        min={0}
        max={1}
        step={0.02}
        onChange={(v) => setWood({ fleckStrength: v })}
      />
      <Slider
        label="Saturation"
        value={wood.saturation}
        min={0}
        max={1.2}
        step={0.02}
        onChange={(v) => setWood({ saturation: v })}
      />
      <SeedField value={wood.seed} onChange={(v) => setWood({ seed: v })} />

      <MicroReliefEditor
        label="Emboss grain into depth (micro-relief)"
        micro={wood.microRelief}
        onChange={(m) => setWood({ microRelief: m })}
        lockMode
      />
    </>
  );
}

/**
 * Controls for the volumetric stone material. Feature scale/orientation live on
 * `Fill`; everything stone-specific on `Fill.stone`. Shared controls always show;
 * color + family-specific groups switch on `stone.stoneType`.
 */
function StoneEditor({ fill, onChange }: { fill: Fill; onChange: (fill: Fill) => void }) {
  const stone = fill.stone ?? defaultStoneParams();
  const setFill = (patch: Partial<Fill>) => onChange({ ...fill, ...patch });
  const setStone = (patch: Partial<StoneParams>) => onChange({ ...fill, stone: { ...stone, ...patch } });
  const t = stone.stoneType;
  const usesStrata = t === 'onyx' || t === 'sandstone' || t === 'travertine';
  const usesVoronoi = t === 'granite' || t === 'terrazzo' || t === 'travertine' || t === 'cracked';
  return (
    <>
      <Select
        label="Preset"
        value={'custom'}
        options={[
          { value: 'custom', label: 'Custom…' },
          { value: 'carrara', label: 'Carrara marble' },
          { value: 'calacatta', label: 'Calacatta marble' },
          { value: 'neroMarquina', label: 'Nero Marquina' },
          { value: 'verde', label: 'Verde (green)' },
          { value: 'onyx', label: 'Onyx' },
          { value: 'sandstone', label: 'Sandstone' },
          { value: 'granite', label: 'Granite' },
          { value: 'terrazzo', label: 'Terrazzo' },
          { value: 'travertine', label: 'Travertine' },
          { value: 'cracked', label: 'Cracked' },
        ]}
        onChange={(k) => {
          if (k !== 'custom') onChange(STONE_PRESETS[k]());
        }}
      />
      <Select
        label="Stone type"
        value={t}
        options={[
          { value: 'marble', label: 'Marble' },
          { value: 'onyx', label: 'Onyx' },
          { value: 'sandstone', label: 'Sandstone' },
          { value: 'granite', label: 'Granite' },
          { value: 'terrazzo', label: 'Terrazzo' },
          { value: 'travertine', label: 'Travertine' },
          { value: 'cracked', label: 'Cracked' },
        ]}
        onChange={(v) => setStone({ stoneType: v as StoneType })}
      />

      {/* Colors (per family) */}
      {t === 'marble' && (
        <>
          <ColorField label="Matrix" value={stone.matrixColor} onChange={(c) => setStone({ matrixColor: c })} />
          <ColorField label="Vein" value={stone.veinColor} onChange={(c) => setStone({ veinColor: c })} />
          <Toggle label="Invert (light veins on dark)" checked={stone.invert} onChange={(v) => setStone({ invert: v })} />
        </>
      )}
      {(t === 'granite' || t === 'cracked') && (
        <ColorField
          label={t === 'cracked' ? 'Crack color' : 'Accent mineral'}
          value={stone.veinColor}
          onChange={(c) => setStone({ veinColor: c })}
        />
      )}
      {(t === 'granite' || t === 'terrazzo') && (
        <ColorField label="Matrix" value={stone.matrixColor} onChange={(c) => setStone({ matrixColor: c })} />
      )}
      {t === 'terrazzo' ? (
        <ColorList
          label="Aggregate chips"
          colors={stone.aggregatePalette}
          onChange={(c) => setStone({ aggregatePalette: c })}
        />
      ) : (
        t !== 'marble' && (
          <ColorList label="Color stops" colors={stone.colorStops} onChange={(c) => setStone({ colorStops: c })} />
        )
      )}

      {/* Shared placement / feel */}
      <Slider
        label="Depth scale (slicing)"
        value={stone.depthScale}
        min={0}
        max={3}
        step={0.05}
        onChange={(v) => setStone({ depthScale: v })}
      />
      <NumberField label="Feature scale (mm)" value={fill.scaleMm} min={0.5} step={1} onChange={(v) => setFill({ scaleMm: v })} />
      <Slider
        label="Orientation"
        value={fill.angle}
        min={0}
        max={180}
        step={1}
        format={(v) => `${Math.round(v)}°`}
        onChange={(v) => setFill({ angle: v })}
      />
      <div className="row">
        <Slider label="Warp (coarse) freq" value={stone.warpCoarseFreq} min={0} max={2} step={0.05} onChange={(v) => setStone({ warpCoarseFreq: v })} />
        <Slider label="Warp (coarse) amp" value={stone.warpCoarseAmp} min={0} max={2} step={0.05} onChange={(v) => setStone({ warpCoarseAmp: v })} />
      </div>
      <div className="row">
        <Slider label="Warp (fine) freq" value={stone.warpFineFreq} min={0} max={6} step={0.1} onChange={(v) => setStone({ warpFineFreq: v })} />
        <Slider label="Warp (fine) amp" value={stone.warpFineAmp} min={0} max={1} step={0.02} onChange={(v) => setStone({ warpFineAmp: v })} />
      </div>
      <Slider label="Contrast" value={stone.contrast} min={0} max={1} step={0.05} onChange={(v) => setStone({ contrast: v })} />
      <Slider label="Tint variation" value={stone.tintStrength} min={0} max={1} step={0.02} onChange={(v) => setStone({ tintStrength: v })} />
      <Slider label="Saturation" value={stone.saturation} min={0} max={1.2} step={0.02} onChange={(v) => setStone({ saturation: v })} />

      {/* Marble veins */}
      {t === 'marble' && (
        <>
          <Slider label="Vein frequency" value={stone.veinFreqPrimary} min={0.2} max={8} step={0.1} onChange={(v) => setStone({ veinFreqPrimary: v })} />
          <Slider label="Hairline vein freq" value={stone.veinFreqSecondary} min={0.5} max={20} step={0.5} onChange={(v) => setStone({ veinFreqSecondary: v })} />
          <Slider label="Hairline strength" value={stone.secondaryVeinStrength} min={0} max={1} step={0.02} onChange={(v) => setStone({ secondaryVeinStrength: v })} />
          <Slider label="Vein sharpness" value={stone.veinSharpness} min={0} max={1} step={0.02} onChange={(v) => setStone({ veinSharpness: v })} />
          <div className="row">
            <Slider label="Turbulence freq" value={stone.turbulenceFreq} min={0.1} max={4} step={0.1} onChange={(v) => setStone({ turbulenceFreq: v })} />
            <Slider label="Turbulence amp" value={stone.turbulenceAmp} min={0} max={4} step={0.05} onChange={(v) => setStone({ turbulenceAmp: v })} />
          </div>
        </>
      )}

      {/* Voronoi (granite / terrazzo / travertine / cracked) */}
      {usesVoronoi && (
        <>
          <Slider label={t === 'terrazzo' ? 'Chip size' : 'Cell scale'} value={stone.cellScale} min={1} max={40} step={0.5} onChange={(v) => setStone({ cellScale: v })} />
          {t === 'granite' && (
            <>
              <div className="row">
                <Slider label="Cell scale 2" value={stone.cellScale2} min={1} max={40} step={0.5} onChange={(v) => setStone({ cellScale2: v })} />
                <Slider label="Cell scale 3" value={stone.cellScale3} min={1} max={60} step={0.5} onChange={(v) => setStone({ cellScale3: v })} />
              </div>
              <Slider label="Speckle intensity" value={stone.speckleIntensity} min={0} max={1} step={0.02} onChange={(v) => setStone({ speckleIntensity: v })} />
            </>
          )}
          {(t === 'terrazzo' || t === 'cracked') && (
            <Slider label={t === 'cracked' ? 'Crack width' : 'Matrix line width'} value={stone.edgeWidth} min={0.005} max={0.25} step={0.005} onChange={(v) => setStone({ edgeWidth: v })} />
          )}
          {t === 'cracked' && (
            <Slider label="Crack intensity" value={stone.crackIntensity} min={0} max={1} step={0.02} onChange={(v) => setStone({ crackIntensity: v })} />
          )}
        </>
      )}

      {/* Sedimentary strata (onyx / sandstone / travertine) */}
      {usesStrata && (
        <>
          <Slider label="Strata density" value={stone.strataDensity} min={0.5} max={12} step={0.5} onChange={(v) => setStone({ strataDensity: v })} />
          <Slider label="Strata waviness" value={stone.strataWaviness} min={0} max={2} step={0.05} onChange={(v) => setStone({ strataWaviness: v })} />
          <Select
            label="Strata axis"
            value={String(stone.strataAxis)}
            options={[
              { value: '0', label: 'Z (depth)' },
              { value: '1', label: 'Y (vertical)' },
              { value: '2', label: 'X (horizontal)' },
            ]}
            onChange={(a) => setStone({ strataAxis: Number(a) as 0 | 1 | 2 })}
          />
        </>
      )}

      <SeedField value={stone.seed} onChange={(v) => setStone({ seed: v })} />
      <MicroReliefEditor
        label="Emboss veins/voids into depth (micro-relief)"
        micro={stone.microRelief}
        onChange={(m) => setStone({ microRelief: m })}
      />
    </>
  );
}

export function FillEditor({
  label,
  fill,
  onChange,
}: {
  label: string;
  fill: Fill;
  onChange: (fill: Fill) => void;
}) {
  const set = (patch: Partial<Fill>) => onChange({ ...fill, ...patch });
  return (
    <>
      <Select
        label={label}
        value={fill.type}
        options={[
          { value: 'solid', label: 'Solid color' },
          { value: 'wood', label: 'Wood grain' },
          { value: 'stone', label: 'Stone' },
        ]}
        onChange={(t) => {
          // Populate the material params the first time this fill becomes wood/stone.
          if (t === 'wood') onChange({ ...fill, type: 'wood', wood: fill.wood ?? defaultWoodParams() });
          else if (t === 'stone') onChange({ ...fill, type: 'stone', stone: fill.stone ?? defaultStoneParams() });
          else onChange({ ...fill, type: t as FillType });
        }}
      />
      {fill.type === 'wood' ? (
        <WoodEditor fill={fill} onChange={onChange} />
      ) : fill.type === 'stone' ? (
        <StoneEditor fill={fill} onChange={onChange} />
      ) : (
        <ColorField label="Color" value={fill.color1} onChange={(c) => set({ color1: c })} />
      )}
    </>
  );
}

export function DepthRangeField({
  min,
  max,
  onChange,
}: {
  min: number;
  max: number;
  onChange: (range: { min: number; max: number }) => void;
}) {
  return (
    <div className="row">
      <NumberField
        label="Depth min"
        value={min}
        step={0.01}
        onChange={(v) => onChange({ min: v, max })}
      />
      <NumberField
        label="Depth max"
        value={max}
        step={0.01}
        onChange={(v) => onChange({ min, max: v })}
      />
    </div>
  );
}
