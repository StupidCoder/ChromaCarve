import { getPipeline } from '../pipeline/Pipeline';
import { reliefClient, ReliefCancelled } from './reliefClient';
import { previewProject, useProjectStore, type ModelSettings, type Project } from '../state/store';

/**
 * Drive the async bas-relief solve. The pipeline renders the foreground height
 * field (GPU) and reads it back, the worker solves off-thread, and the result is
 * uploaded into the pipeline's relief texture; `bumpRelief` then triggers the
 * previews to re-render with the fresh relief. Concurrent identical requests
 * (2D + 3D previews) are deduped and stale ones superseded by the client.
 */
async function run(project: Project, fullRes: boolean): Promise<void> {
  const pipeline = getPipeline();
  const assetVersion = useProjectStore.getState().assetVersion;
  const inputs = pipeline.prepareReliefInputs(project, fullRes, assetVersion);
  if (!inputs) return;
  try {
    const result = await reliefClient.solve(
      inputs.key,
      () => inputs,
      fullRes ? 'Rendering relief for export' : 'Updating relief',
    );
    pipeline.uploadRelief(
      result.data,
      inputs.mask,
      inputs.w,
      inputs.h,
      inputs.model,
      result.min,
      result.max,
    );
    useProjectStore.getState().bumpRelief();
  } catch (e) {
    if (!(e instanceof ReliefCancelled)) throw e;
  }
}

/** Update the cached relief for the interactive preview (capped resolution). */
export function updateReliefPreview(project: Project): Promise<void> {
  return run(previewProject(project), false);
}

export interface ReliefExportData {
  data: Float32Array;
  mask: Float32Array;
  w: number;
  h: number;
  model: ModelSettings;
  min: number;
  max: number;
}

/**
 * Solve the full-resolution relief for an export and RETURN it (rather than
 * uploading + bumping the previews). The caller uploads and renders it
 * synchronously, so a concurrent preview render can't resize the shared pipeline
 * between the solve and the export read-back. Returns null if bas-relief is off.
 */
export async function solveReliefExport(project: Project): Promise<ReliefExportData | null> {
  const pipeline = getPipeline();
  const assetVersion = useProjectStore.getState().assetVersion;
  const inputs = pipeline.prepareReliefInputs(project, true, assetVersion);
  if (!inputs) return null;
  try {
    const result = await reliefClient.solve(inputs.key, () => inputs, 'Rendering relief for export');
    return {
      data: result.data,
      mask: inputs.mask,
      w: inputs.w,
      h: inputs.h,
      model: inputs.model,
      min: result.min,
      max: result.max,
    };
  } catch (e) {
    if (e instanceof ReliefCancelled) return null;
    throw e;
  }
}
