import { encode } from 'fast-png';
import { getPipeline } from '../pipeline/Pipeline';
import { updateReliefExport } from '../relief/reliefController';
import type { Project } from '../state/store';

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
 * Export the composite depth as a 16-bit grayscale PNG. The used depth range is
 * normalized to span the full 0..65535 for maximum carving/printing resolution;
 * the PNG carries no physical scale (the user sets that in their CAM/slicer).
 */
export async function exportDepthPng(project: Project, filename = 'depth.png') {
  const pipeline = getPipeline();
  await updateReliefExport(project); // full-resolution relief solve (worker) first
  const result = pipeline.render(project);
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
  await updateReliefExport(project); // full-resolution relief solve (worker) first
  const result = pipeline.render(project);
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
