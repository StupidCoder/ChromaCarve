import { useEffect, useRef, useState } from 'react';
import type { SplinePoint } from '../state/store';
import { evalProfile } from '../spline/profile';

const W = 248;
const H = 150;
const PAD = 12;

const toPx = (p: SplinePoint) => ({
  x: PAD + p.x * (W - 2 * PAD),
  y: H - PAD - p.y * (H - 2 * PAD),
});
const toData = (px: number, py: number): SplinePoint => ({
  x: Math.min(1, Math.max(0, (px - PAD) / (W - 2 * PAD))),
  y: Math.min(1, Math.max(0, (H - PAD - py) / (H - 2 * PAD))),
});

/**
 * Profile editor: drag control points, double-click empty space to add a
 * point, double-click a point to remove it. The x axis is normalized distance
 * across the border band (outer edge -> inner), y is normalized height.
 */
export function SplineEditor({
  points,
  onChange,
}: {
  points: SplinePoint[];
  onChange: (points: SplinePoint[]) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const localPos = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  useEffect(() => {
    if (drag === null) return;
    const move = (e: PointerEvent) => {
      const { x, y } = localPos(e);
      const next = points.map((p, i) => (i === drag ? toData(x, y) : p));
      onChange(next);
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, points, onChange]);

  // Curve path sampled from the spline.
  const N = 64;
  let d = '';
  for (let i = 0; i < N; i++) {
    const x = i / (N - 1);
    const yy = Math.min(1, Math.max(0, evalProfile(points, x)));
    const px = toPx({ x, y: yy });
    d += `${i === 0 ? 'M' : 'L'}${px.x.toFixed(1)},${px.y.toFixed(1)} `;
  }

  const addPoint = (e: React.MouseEvent) => {
    const { x, y } = localPos(e);
    const p = toData(x, y);
    onChange([...points, p].sort((a, b) => a.x - b.x));
  };

  return (
    <svg
      ref={svgRef}
      width={W}
      height={H}
      style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 4 }}
      onDoubleClick={addPoint}
    >
      <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} fill="none" stroke="#3a3d42" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {points.map((p, i) => {
        const px = toPx(p);
        return (
          <circle
            key={i}
            cx={px.x}
            cy={px.y}
            r={6}
            fill="#e3e5e8"
            stroke="var(--accent)"
            strokeWidth={2}
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => {
              e.preventDefault();
              setDrag(i);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (points.length > 2) onChange(points.filter((_, j) => j !== i));
            }}
          />
        );
      })}
    </svg>
  );
}
