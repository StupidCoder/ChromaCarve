import { useEffect, useState } from 'react';

const REPO_URL = 'https://github.com/StupidCoder/ChromaCarve';
const ISSUES_URL = `${REPO_URL}/issues`;

/** Centered, dismissable getting-started guide. */
function HelpModal({ onClose }: { onClose: () => void }) {
  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="help-overlay" onClick={onClose}>
      <div
        className="help-modal panel-enter"
        role="dialog"
        aria-modal="true"
        aria-label="Getting started guide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="help-modal__header">
          <span className="brand">
            <span className="brand__icon">?</span>
            Getting started
          </span>
          <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close guide">
            ✕
          </button>
        </div>
        <div className="help-modal__body">
          <p className="help-lead">
            ChromaCarve turns a 3D model or image into a matched <strong>depth map</strong> and{' '}
            <strong>color map</strong> — the two textures a CNC or 3D-relief workflow needs to carve
            and color a piece.
          </p>

          <h4>Quick start</h4>
          <ol className="help-steps">
            <li>
              Open <strong>Settings</strong> (top-left) and pick a tab: <em>Foreground</em> is your
              main model, <em>Background</em> is the surface behind it, <em>Frame</em> adds a border.
            </li>
            <li>
              In <em>Foreground</em>, choose a <strong>Model</strong> — upload an <code>.obj</code>{' '}
              or pick a primitive — then orbit the small gizmo to set the viewing angle. What you see
              there is what gets carved.
            </li>
            <li>
              Under <strong>Color</strong>, choose a <strong>Fill</strong>: a solid color or a
              procedural <em>Wood grain</em> / <em>Stone</em> material with per-species presets.
            </li>
            <li>
              Tune <strong>Depth</strong> (range, curve, detail) to control how much relief the piece
              has, and watch the live 3D preview.
            </li>
            <li>
              Open <strong>Preview</strong> (top-right) to inspect the depth &amp; color maps, then
              use the <strong>Export</strong> tab to save them as PNGs.
            </li>
          </ol>

          <h4>3D preview controls</h4>
          <ul className="help-list">
            <li>
              <strong>Drag</strong> to orbit, <strong>scroll</strong> to zoom, <strong>right-drag</strong>{' '}
              to pan.
            </li>
            <li>
              In the model gizmo, the <strong>scroll wheel</strong> sets the zoom and the{' '}
              <strong>Roll</strong> slider rotates about the view axis.
            </li>
            <li>
              Toggle <strong>Rotate light source</strong> in the Preview panel to sweep the light or
              hold it in place.
            </li>
          </ul>

          <div className="help-foot">
            Stuck or found a bug?{' '}
            <a href={ISSUES_URL} target="_blank" rel="noreferrer noopener">
              Report it on the GitHub issue tracker ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Bottom-center footer: a help ("?") button that opens the getting-started guide
 * and a link to the GitHub issue tracker for reporting problems.
 */
export function Footer() {
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <>
      <footer className="app-footer">
        <button
          className="help-btn"
          onClick={() => setHelpOpen(true)}
          title="Getting started guide"
          aria-label="Open getting started guide"
        >
          ?
        </button>
        <span className="app-footer__sep" aria-hidden="true">
          •
        </span>
        <span className="app-footer__text">
          Having problems?{' '}
          <a
            className="app-footer__link"
            href={ISSUES_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            Report an issue on GitHub ↗
          </a>
        </span>
      </footer>
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </>
  );
}
