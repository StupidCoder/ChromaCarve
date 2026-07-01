# ChromaCarve

A browser tool for compositing a **color map** + a **depth/height map** for CNC relief
carving (depth only) and full-color 3D printing (depth + color). The composite is built
from three independently-optional parts and previewed in a lit, orbitable 3D view.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build
```

## How it works

The "image" is composited from three parts, combined by **priority replace**
(`foreground ?? border ?? background` per pixel):

- **Background** — either an uploaded **image** (Gaussian blur + brightness/contrast/
  desaturation; depth is a flat constant) or an **OBJ model tiled** across the canvas at a
  chosen interval, with overlaps taking the per-pixel **max** height (e.g. dragon scales).
- **Border** — a Catmull-Rom **spline profile** applied to the edge band (drag points;
  double-click to add, double-click a point to remove).
- **Foreground** — an uploaded **OBJ model**, freely rotated; the depth map is the
  orthographic projection from the angle you orbit to ("what you see is what you get").

Each part has its own depth `min`/`max` (relative height units). Output size is physical
(mm + px/mm). The 3D preview's `previewMaxDepthMm` only scales the on-screen relief.

### Export

- **Depth PNG** — 16-bit grayscale, normalized so the used range spans full black→white
  (max resolution; the PNG carries no physical scale — set that in your CAM/slicer).
- **Color PNG** — 8-bit RGBA.
- **Settings JSON** — all parameters (binary assets are referenced by filename; re-upload
  them after importing).

## Architecture

- `src/state/store.ts` — Zustand project model (= the JSON export schema).
- `src/pipeline/` — offscreen Three.js render-target pipeline: per-part color/depth/mask
  stages + the priority-replace compositor, all on float targets.
- `src/obj/ModelDepthPass.ts` — orthographic model→height-map renderer (shared by the
  foreground and the background tile).
- `src/spline/profile.ts` — Catmull-Rom profile sampling for the border LUT.
- `src/three/Viewer3D.tsx` — displacement mesh, in-shader normals, orbiting point light +
  specular.
- `src/io/` — PNG (`fast-png`) and project-JSON export/import.
