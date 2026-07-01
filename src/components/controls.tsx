import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Fill, FillType } from '../state/store';

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
          { value: 'marble', label: 'Marble' },
          { value: 'noise', label: 'Noise' },
        ]}
        onChange={(t) => set({ type: t as FillType })}
      />
      <ColorField
        label={fill.type === 'solid' ? 'Color' : 'Color 1'}
        value={fill.color1}
        onChange={(c) => set({ color1: c })}
      />
      {fill.type !== 'solid' && (
        <>
          <ColorField label="Color 2" value={fill.color2} onChange={(c) => set({ color2: c })} />
          <NumberField
            label="Scale (mm)"
            value={fill.scaleMm}
            min={0.5}
            step={1}
            onChange={(v) => set({ scaleMm: v })}
          />
          <Slider
            label="Turbulence"
            value={fill.turbulence}
            min={0}
            max={2}
            step={0.05}
            onChange={(v) => set({ turbulence: v })}
          />
          <Slider
            label="Angle"
            value={fill.angle}
            min={0}
            max={180}
            step={1}
            format={(v) => `${Math.round(v)}°`}
            onChange={(v) => set({ angle: v })}
          />
        </>
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
