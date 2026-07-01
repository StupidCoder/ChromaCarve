import { getPipeline } from '../pipeline/Pipeline';
import { reliefClient, ReliefCancelled } from './reliefClient';
import { previewProject, useProjectStore, type Project } from '../state/store';

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

/** Solve the full-resolution relief before an export; awaits completion. */
export function updateReliefExport(project: Project): Promise<void> {
  return run(project, true);
}
