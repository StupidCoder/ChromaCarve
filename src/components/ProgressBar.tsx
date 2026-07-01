import { useProgressStore } from '../state/progress';

/** Overlay shown while the bas-relief worker is solving (percentage + ETA). */
export function ProgressBar() {
  const active = useProgressStore((s) => s.active);
  const frac = useProgressStore((s) => s.frac);
  const etaSec = useProgressStore((s) => s.etaSec);
  const label = useProgressStore((s) => s.label);
  if (!active) return null;

  const pct = Math.round(Math.min(1, Math.max(0, frac)) * 100);
  const eta = Number.isFinite(etaSec)
    ? `~${Math.max(0, Math.ceil(etaSec))}s remaining`
    : 'estimating…';

  return (
    <div className="progress-overlay">
      <div className="progress-card">
        <div className="progress-row">
          <span>{label}</span>
          <span className="progress-meta">
            {pct}% · {eta}
          </span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
