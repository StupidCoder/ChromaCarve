import type { AnimationClip } from 'three';

/** The same pose picker serves both fabrication workspaces. */
export function ModelPoseControls({ animations, animationIndex, animationTime, onChange, disabled = false }: {
  animations: AnimationClip[];
  animationIndex: number;
  animationTime: number;
  onChange: (pose: { animationIndex: number; animationTime: number }) => void;
  disabled?: boolean;
}) {
  const clip = animations[animationIndex];
  if (!animations.length) return <p className="muted">This model has no animations.</p>;
  return <>
    <label className="field">
      <span className="field__label">Animation</span>
      <select disabled={disabled} value={animationIndex}
        onChange={(event) => onChange({ animationIndex: Number(event.target.value), animationTime: 0 })}>
        <option value={-1}>Rest pose</option>
        {animations.map((animation, index) => <option key={index} value={index}>
          {animation.name || `Animation ${index + 1}`}
        </option>)}
      </select>
    </label>
    {clip && clip.duration > 0 && <label className="field">
      <span className="field__label"><span>Pose time</span><span className="field__value">
        {Math.min(animationTime, clip.duration).toFixed(3)} / {clip.duration.toFixed(3)} s
      </span></span>
      <input type="range" disabled={disabled} min={0} max={clip.duration} step={0.001}
        value={Math.min(animationTime, clip.duration)}
        onChange={(event) => onChange({ animationIndex, animationTime: Number(event.target.value) })} />
    </label>}
  </>;
}
