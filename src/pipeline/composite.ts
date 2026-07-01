import { getPipeline } from './Pipeline';
import { previewProject, type Project } from '../state/store';

/** CPU-side composite result, shared by the 2D previews and the 3D view. */
export interface CompositeBuffers {
  depth: Float32Array; // RGBA float, r = depth, g = coverage (bottom-up rows)
  color: Float32Array; // RGBA float (bottom-up rows)
  width: number;
  height: number;
  displayMax: number;
}

/**
 * Render the pipeline at the (capped) preview resolution and read both
 * composite targets back to the CPU. Called independently by each preview
 * consumer — deliberately NOT funneled through a single shared
 * requestAnimationFrame, which interleaves with the 3D view's render loop and
 * causes severe GPU-readback stalls on some drivers.
 */
export function renderPreviewComposite(project: Project): CompositeBuffers {
  const pipeline = getPipeline();
  const result = pipeline.render(previewProject(project));
  const { width, height } = pipeline.size;
  return {
    depth: pipeline.readFloat(result.depth),
    color: pipeline.readFloat(result.color),
    width,
    height,
    displayMax: result.displayMax,
  };
}
