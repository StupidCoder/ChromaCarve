import { useEffect, useState } from 'react';

/**
 * Brief branded splash shown on load. Fades out automatically and can be
 * dismissed early by clicking.
 */
export function Splash() {
  const [hidden, setHidden] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const fade = setTimeout(() => setHidden(true), 1300);
    const remove = setTimeout(() => setGone(true), 1900);
    return () => {
      clearTimeout(fade);
      clearTimeout(remove);
    };
  }, []);

  if (gone) return null;
  return (
    <div
      className={`splash${hidden ? ' splash--hidden' : ''}`}
      onTransitionEnd={() => hidden && setGone(true)}
    >
      <img src="/ChromaCarve.png" alt="ChromaCarve" className="splash__logo" />
    </div>
  );
}
