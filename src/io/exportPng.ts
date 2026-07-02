import { encode } from 'fast-png';
import { getPipeline, type Pipeline } from '../pipeline/Pipeline';
import { solveReliefExport } from '../relief/reliefController';
import { outputResolution, type Project } from '../state/store';

/**
 * Solve the full-resolution relief and upload it, then return `pipeline.render`'s
 * result — all synchronous after the (awaited) solve, so a concurrent preview
 * render can't resize the shared pipeline between the upload and the read-back
 * (which would otherwise export the raw depth instead of the bas-relief).
 */
async function renderForExport(pipeline: Pipeline, project: Project) {
  const relief = await solveReliefExport(project);
  if (relief) {
    pipeline.uploadRelief(relief.data, relief.mask, relief.w, relief.h, relief.model, relief.min, relief.max);
  }
  return pipeline.render(project);
}

/**
 * The GPU's max texture dimension (px). Exports can't exceed this on either axis
 * (a render target larger than it can't be allocated). Used by the UI to bound
 * the resolution input. Falls back to a conservative value if the GL context
 * isn't up yet.
 */
export function maxExportTextureSize(): number {
  try {
    return getPipeline().renderer.capabilities.maxTextureSize;
  } catch {
    return 8192;
  }
}

function download(data: Uint8Array, filename: string, type = 'image/png') {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Cap the export resolution to the GPU's max texture size. Render targets larger
 * than `MAX_TEXTURE_SIZE` can't be allocated, so we uniformly reduce density and
 * warn the user. (Tiled render-and-stitch for arbitrarily large maps is not yet
 * implemented; the procedural fills are mm-based so they'd tile seamlessly.)
 */
function clampToMaxTexture(project: Project): Project {
  const { maxTextureSize } = getPipeline().renderer.capabilities;
  const res = outputResolution(project.output);
  const longest = Math.max(res.width, res.height);
  if (longest <= maxTextureSize) return project;
  const scale = maxTextureSize / longest;
  alert(
    `Export resolution ${res.width}×${res.height}px exceeds this GPU's limit ` +
      `(${maxTextureSize}px). Capping to ~${Math.round(res.width * scale)}×` +
      `${Math.round(res.height * scale)}px. Tiled rendering for larger maps is not yet implemented.`,
  );
  return { ...project, output: { ...project.output, pixelsPerMm: project.output.pixelsPerMm * scale } };
}

/**
 * Export the composite depth as a 16-bit grayscale PNG. The used depth range is
 * normalized to span the full 0..65535 for maximum carving/printing resolution;
 * the PNG carries no physical scale (the user sets that in their CAM/slicer).
 */
export async function exportDepthPng(project: Project, filename = 'depth.png') {
  const pipeline = getPipeline();
  project = clampToMaxTexture(project);
  const result = await renderForExport(pipeline, project);
  const { width, height } = pipeline.size;
  const buf = pipeline.readFloat(result.depth);

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < width * height; i++) {
    const v = buf[i * 4];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;

  const out = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width; // flip bottom-up framebuffer -> top-down PNG
    const dst = y * width;
    for (let x = 0; x < width; x++) {
      out[dst + x] = Math.round(((buf[(src + x) * 4] - min) / range) * 65535);
    }
  }
  download(encode({ width, height, data: out, channels: 1, depth: 16 }), filename);
}

/** Export the composite color as an 8-bit RGBA PNG. */
export async function exportColorPng(project: Project, filename = 'color.png') {
  const pipeline = getPipeline();
  project = clampToMaxTexture(project);
  const result = await renderForExport(pipeline, project);
  const { width, height } = pipeline.size;
  const buf = pipeline.readFloat(result.color);

  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4;
    const dst = y * width * 4;
    for (let i = 0; i < width * 4; i++) {
      out[dst + i] = Math.round(Math.min(1, Math.max(0, buf[src + i])) * 255);
    }
  }
  download(encode({ width, height, data: out, channels: 4, depth: 8 }), filename);
}
