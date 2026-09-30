import { useState } from 'react';
import { Mesh } from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { getModelFile } from '../assets/assetStore';
import { resolveModel } from '../obj/modelSource';
import type { ModelSettings } from '../state/store';
import { navigateWorkspace } from '../workspaces/navigation';
import { saveSlicesHandoff } from './storage';

export function OpenInSlices({ model }: { model: ModelSettings }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const available = !!resolveModel(model);
  async function open() {
    setBusy(true);
    setError('');
    try {
      let file = model.source === 'obj' ? getModelFile(model.assetRef) : undefined;
      const hasSource = !!file;
      if (!file) {
        const asset = resolveModel({ ...model, smoothGeometry: false });
        if (!asset) throw new Error('Load a model before opening it in Slices.');
        const mesh = new Mesh(asset.geometry);
        const binary = new STLExporter().parse(mesh, { binary: true });
        (mesh.material as import('three').Material).dispose();
        file = new File([new Uint8Array(binary.buffer as ArrayBuffer)], `${model.source}.stl`);
      }
      const handoff = await saveSlicesHandoff({
        version: 1, source: { name: file.name, data: file },
        pose: { animationIndex: hasSource ? model.animationIndex ?? -1 : -1, animationTime: hasSource ? model.animationTime ?? 0 : 0 },
        viewQuaternion: [...model.rotationQuat],
      });
      navigateWorkspace(`/slices/?handoff=${encodeURIComponent(handoff)}`);
    } catch (error) {
      setError(`Could not transfer this model: ${error instanceof Error ? error.message : String(error)}. You can also open Slices and choose the file directly.`);
    } finally { setBusy(false); }
  }
  return <>
    <button disabled={!available || busy} onClick={() => void open()}>
      {busy ? 'Opening in Slices…' : 'Open in Slices'}
    </button>
    {error && <p className="warn" role="alert">{error}</p>}
  </>;
}
