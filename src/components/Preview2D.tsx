import { useEffect, useRef } from 'react';
import { renderPreviewComposite } from '../pipeline/composite';
import { useProjectStore } from '../state/store';
import { Viewer3D } from '../three/Viewer3D';

/** Write composite color (rgba float, bottom-up) into a top-down ImageData. */
function drawColor(ctx: CanvasRenderingContext2D, buf: Float32Array, w: number, h: number) {
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;
    const dst = y * w * 4;
    for (let x = 0; x < w * 4; x++) {
      img.data[dst + x] = Math.round(Math.min(1, Math.max(0, buf[src + x])) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Write composite depth (r = depth) as normalized grayscale. */
function drawDepth(
  ctx: CanvasRenderingContext2D,
  buf: Float32Array,
  w: number,
  h: number,
  displayMax: number,
) {
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const srcRow = (h - 1 - y) * w * 4;
    const dstRow = y * w * 4;
    for (let x = 0; x < w; x++) {
      const depth = buf[srcRow + x * 4];
      const g = Math.round(Math.min(1, Math.max(0, depth / displayMax)) * 255);
      const d = dstRow + x * 4;
      img.data[d] = g;
      img.data[d + 1] = g;
      img.data[d + 2] = g;
      img.data[d + 3] = 255; // depth map is fully opaque
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function Preview2D() {
  const project = useProjectStore((s) => s.project);
  const assetVersion = useProjectStore((s) => s.assetVersion);
  const reliefVersion = useProjectStore((s) => s.reliefVersion);
  const depthRef = useRef<HTMLCanvasElement>(null);
  const colorRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const { depth, color, width: w, height: h, displayMax } = renderPreviewComposite(project);

    const depthCanvas = depthRef.current;
    const colorCanvas = colorRef.current;
    if (depthCanvas && (depthCanvas.width !== w || depthCanvas.height !== h)) {
      depthCanvas.width = w;
      depthCanvas.height = h;
    }
    if (colorCanvas && (colorCanvas.width !== w || colorCanvas.height !== h)) {
      colorCanvas.width = w;
      colorCanvas.height = h;
    }

    const depthCtx = depthCanvas?.getContext('2d');
    if (depthCtx) drawDepth(depthCtx, depth, w, h, displayMax);
    const colorCtx = colorCanvas?.getContext('2d');
    if (colorCtx) drawColor(colorCtx, color, w, h);
  }, [project, assetVersion, reliefVersion]);

  return (
    <div className="previews">
      <div className="preview-tile">
        <div className="preview-label">Depth</div>
        <canvas ref={depthRef} className="preview-canvas" />
      </div>
      <div className="preview-tile">
        <div className="preview-label">3D</div>
        <Viewer3D size={360} />
      </div>
      <div className="preview-tile">
        <div className="preview-label">Color</div>
        <canvas ref={colorRef} className="preview-canvas" />
      </div>
    </div>
  );
}
