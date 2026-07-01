import { useProjectStore } from '../../state/store';
import { exportColorPng, exportDepthPng } from '../../io/exportPng';
import { exportProjectJson, importProjectJson } from '../../io/projectJson';
import { FileInput, Panel } from '../controls';

export function ExportPanel() {
  const setProject = useProjectStore((s) => s.setProject);

  return (
    <Panel title="Export / Import">
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
        Download settings JSON
      </button>
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
    </Panel>
  );
}
