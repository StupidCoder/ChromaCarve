import { useMemo, useState, type ReactNode } from 'react';
import { exportColorPng, exportDepthPng, maxExportTextureSize } from '../../io/exportPng';
import { exportProjectJson, importProjectJson } from '../../io/projectJson';
import { outputResolution, useProjectStore } from '../../state/store';
import { FileInput, NumberField } from '../controls';
import { BackgroundTab, ForegroundTab, FrameTab } from './PartPanels';

/** Project canvas dimensions. */
function ProjectTab() {
  const output = useProjectStore((s) => s.project.output);
  const update = useProjectStore((s) => s.update);
  return (
    <div className="tab-body">
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
      <div className="muted">The canvas size of the exported depth &amp; color maps.</div>
    </div>
  );
}

/** Export resolution + export / save / import actions. */
function ExportTab() {
  const output = useProjectStore((s) => s.project.output);
  const update = useProjectStore((s) => s.update);
  const setProject = useProjectStore((s) => s.setProject);
  const res = outputResolution(output);
  const maxTex = useMemo(() => maxExportTextureSize(), []);
  // Largest px/mm before the longest axis hits the GPU's texture limit.
  const longestMm = Math.max(output.widthMm, output.heightMm, 1);
  const maxPxPerMm = maxTex / longestMm;
  const overCap = Math.max(res.width, res.height) > maxTex;

  return (
    <div className="tab-body">
      <NumberField
        label="Resolution (px / mm)"
        value={output.pixelsPerMm}
        min={0.1}
        max={maxPxPerMm}
        step={0.5}
        onChange={(v) => update((p) => void (p.output.pixelsPerMm = v))}
      />
      <div className={overCap ? 'warn' : 'muted'}>
        Output: {res.width} × {res.height} px{overCap ? ' — exceeds GPU limit, will be capped' : ''}
      </div>
      <div className="muted">
        This GPU's max texture size is {maxTex.toLocaleString()} px (≤ {maxPxPerMm.toFixed(1)} px/mm at{' '}
        {output.widthMm} × {output.heightMm} mm).
      </div>
      <div className="button-stack">
        <button
          onClick={() =>
            exportDepthPng(useProjectStore.getState().project).catch((e) => alert(String(e)))
          }
        >
          Download depth PNG (16-bit)
        </button>
        <button
          onClick={() =>
            exportColorPng(useProjectStore.getState().project).catch((e) => alert(String(e)))
          }
        >
          Download color PNG
        </button>
        <button onClick={() => exportProjectJson(useProjectStore.getState().project)}>
          Save project (JSON)
        </button>
      </div>
      <FileInput
        label="Import settings JSON"
        accept="application/json,.json"
        fileName={null}
        onFile={async (file) => {
          try {
            setProject(await importProjectJson(file));
          } catch (e) {
            alert(String(e instanceof Error ? e.message : e));
          }
        }}
      />
      <div className="muted">Re-upload any referenced images/models after importing.</div>
    </div>
  );
}

interface Tab {
  id: string;
  label: string;
  render: () => ReactNode;
}

const TABS: Tab[] = [
  { id: 'project', label: 'Project', render: () => <ProjectTab /> },
  { id: 'foreground', label: 'Foreground', render: () => <ForegroundTab /> },
  { id: 'background', label: 'Background', render: () => <BackgroundTab /> },
  { id: 'frame', label: 'Frame', render: () => <FrameTab /> },
  { id: 'export', label: 'Export', render: () => <ExportTab /> },
];

/** Left floating panel: a collapsible, tabbed settings menu. */
export function SettingsPanel() {
  const [active, setActive] = useState('project');
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <button
        className="panel-fab panel-fab--left"
        onClick={() => setCollapsed(false)}
        title="Show settings"
        aria-label="Show settings"
      >
        <span className="panel-fab__icon">{'⚙︎'}</span>
        <span className="panel-fab__text">Settings</span>
      </button>
    );
  }

  const activeTab = TABS.find((t) => t.id === active) ?? TABS[0];

  return (
    <div className="floating-panel floating-panel--left panel-enter">
      <div className="panel-topbar">
        <span className="brand">
          <span className="brand__icon">{'⚙︎'}</span>
          Settings
        </span>
        <button
          className="icon-btn"
          onClick={() => setCollapsed(true)}
          title="Collapse"
          aria-label="Collapse settings"
        >
          ‹
        </button>
      </div>
      <div className="tab-bar" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === active}
            className={`tab${t.id === active ? ' tab--active' : ''}`}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="floating-panel__body" key={active}>
        <div className="tab-fade">{activeTab.render()}</div>
      </div>
    </div>
  );
}
