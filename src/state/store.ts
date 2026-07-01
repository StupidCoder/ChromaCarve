import { create } from 'zustand';

/**
 * The full serializable project model. This object IS the JSON export schema
 * (minus binary assets, which are referenced by filename via `assetRef`).
 */

export type FillType = 'solid' | 'wood' | 'marble' | 'noise';

/** A solid color or a procedural texture, evaluated in canvas XY (mm). */
export interface Fill {
  type: FillType;
  color1: string;
  color2: string;
  /** Feature size in mm (ring/vein/blob spacing). */
  scaleMm: number;
  /** Warp / vein turbulence amount. */
  turbulence: number;
  /** Pattern rotation in degrees. */
  angle: number;
}

export function solidFill(color: string): Fill {
  return { type: 'solid', color1: color, color2: '#5a4632', scaleMm: 12, turbulence: 0.6, angle: 0 };
}

export interface DepthRange {
  /** Relative height value for the part's floor. */
  min: number;
  /** Relative height value for the part's peak. */
  max: number;
}

export interface OutputSettings {
  widthMm: number;
  heightMm: number;
  pixelsPerMm: number;
  /** Z scale for the 3D preview only; does NOT affect the exported PNG. */
  previewMaxDepthMm: number;
  /** Density cap for the interactive previews (exports use `pixelsPerMm`). */
  previewPixelsPerMm: number;
}

export interface BackgroundImageSettings {
  assetRef: string | null;
  /** Gaussian blur radius as a fraction of the image's shorter side (0..~0.1),
   * so the blur looks the same in the low-res preview and the full-res export. */
  blur: number;
  brightness: number;
  contrast: number;
  desaturation: number;
  /** Background image depth is a flat constant equal to `depth.min`. */
  depth: DepthRange;
}

export type ModelSource = 'obj' | 'torus' | 'sphere' | 'torusknot' | 'cube';

export interface ModelSettings {
  /** Where the geometry comes from: a loaded OBJ or a procedural primitive. */
  source: ModelSource;
  assetRef: string | null;
  /** Procedural params: tube thickness (torus, knot) and knot winding (p, q). */
  procTube: number;
  procP: number;
  procQ: number;
  /** Sphere z-squash (ellipsoid) and cube width/depth proportions. */
  procSquash: number;
  procBoxW: number;
  procBoxD: number;
  /** Rotation as a quaternion [x, y, z, w]. */
  rotationQuat: [number, number, number, number];
  scale: number;
  fill: Fill;
  depth: DepthRange;
  /**
   * Stretch the actual rendered depth range (1st–99th percentile) to fill the
   * layer's full [min,max] for maximum depth perception.
   */
  normalizeDepth: boolean;
  /** Unsharp-mask amount to emphasize fine surface relief (0 = off). */
  detail: number;
  /** Gamma curve on the normalized depth (1 = linear, <1 lifts low relief). */
  gamma: number;
  /** Render the model depth at 2x and downsample to reduce edge aliasing. */
  supersample: boolean;
  /**
   * Feather the silhouette: ramp the depth down to the layer floor over this
   * distance (mm) so edges aren't vertical cliffs (a.k.a. max cliff angle).
   */
  edgeFalloffMm: number;
  /** Ambient-occlusion shading baked into the color map (0 = off). */
  aoStrength: number;
  /** Radius (mm) of the AO cavity sampling. */
  aoRadiusMm: number;
  /** Fine curvature shading: darken concave creases / lighten convex ridges. */
  surfaceShade: number;
  /** Radius (mm) of the curvature sampling (small = fine surface detail). */
  surfaceShadeRadiusMm: number;
}

export interface BackgroundModelSettings extends ModelSettings {
  /** Physical size of one tile (the repeated depth map) in mm. */
  tileSizeMm: number;
  /** Spacing between tile centers; smaller than tileSizeMm => overlap. */
  intervalXmm: number;
  intervalYmm: number;
}

export interface ForegroundModelSettings extends ModelSettings {
  offsetXmm: number;
  offsetYmm: number;
}

export interface BackgroundSettings {
  enabled: boolean;
  type: 'image' | 'model' | 'solid';
  image: BackgroundImageSettings;
  model: BackgroundModelSettings;
  /** "Solid" background: a fill (solid color or texture) with a constant depth. */
  solidFill: Fill;
  solidDepth: number;
}

export interface SplinePoint {
  /** Normalized distance across the border band, 0..1 (outer edge -> inner). */
  x: number;
  /** Normalized height 0..1. */
  y: number;
}

export interface BorderSettings {
  enabled: boolean;
  profilePoints: SplinePoint[];
  widthMm: number;
  fill: Fill;
  depth: DepthRange;
}

export interface ForegroundSettings {
  enabled: boolean;
  model: ForegroundModelSettings;
}

export interface Project {
  output: OutputSettings;
  background: BackgroundSettings;
  border: BorderSettings;
  foreground: ForegroundSettings;
}

export const PROJECT_SCHEMA_VERSION = 1;

export function defaultProject(): Project {
  return {
    output: {
      widthMm: 100,
      heightMm: 100,
      pixelsPerMm: 25,
      previewMaxDepthMm: 5,
      previewPixelsPerMm: 5,
    },
    background: {
      enabled: false,
      type: 'image',
      image: {
        assetRef: null,
        blur: 0,
        brightness: 0,
        contrast: 0,
        desaturation: 0,
        depth: { min: 0, max: 0.2 },
      },
      model: {
        source: 'obj',
        assetRef: null,
        procTube: 0.18,
        procP: 2,
        procQ: 3,
        procSquash: 1,
        procBoxW: 1,
        procBoxD: 1,
        rotationQuat: [0, 0, 0, 1],
        scale: 1,
        fill: solidFill('#888888'),
        depth: { min: 0, max: 0.5 },
        normalizeDepth: true,
        detail: 0,
        gamma: 1,
        supersample: false,
        edgeFalloffMm: 0,
        aoStrength: 0.5,
        aoRadiusMm: 4,
        surfaceShade: 0.5,
        surfaceShadeRadiusMm: 1.5,
        tileSizeMm: 30,
        intervalXmm: 20,
        intervalYmm: 20,
      },
      solidFill: solidFill('#808080'),
      solidDepth: 0,
    },
    border: {
      enabled: false,
      profilePoints: [
        { x: 0, y: 0 },
        { x: 0.5, y: 1 },
        { x: 1, y: 0 },
      ],
      widthMm: 10,
      fill: solidFill('#aaaaaa'),
      depth: { min: 0, max: 0.5 },
    },
    foreground: {
      enabled: false,
      model: {
        source: 'obj',
        assetRef: null,
        procTube: 0.18,
        procP: 2,
        procQ: 3,
        procSquash: 1,
        procBoxW: 1,
        procBoxD: 1,
        rotationQuat: [0, 0, 0, 1],
        scale: 1,
        fill: solidFill('#cccccc'),
        depth: { min: 0, max: 1 },
        normalizeDepth: true,
        detail: 0,
        gamma: 1,
        supersample: false,
        edgeFalloffMm: 0,
        aoStrength: 0.5,
        aoRadiusMm: 4,
        surfaceShade: 0.5,
        surfaceShadeRadiusMm: 1.5,
        offsetXmm: 0,
        offsetYmm: 0,
      },
    },
  };
}

interface ProjectStore {
  project: Project;
  /**
   * Bumped whenever a binary asset (image/model) is (re)loaded. Lives outside
   * `project` so it is never serialized; the preview includes it in its deps.
   */
  assetVersion: number;
  /** Apply a mutation to a draft of the project (immer-free shallow clone). */
  update: (mutator: (draft: Project) => void) => void;
  /** Replace the whole project (used by JSON import / reset). */
  setProject: (project: Project) => void;
  /** Signal that an asset was loaded so dependents recompute. */
  bumpAssets: () => void;
  reset: () => void;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export const useProjectStore = create<ProjectStore>((set) => ({
  project: defaultProject(),
  assetVersion: 0,
  update: (mutator) =>
    set((state) => {
      const draft = clone(state.project);
      mutator(draft);
      return { project: draft };
    }),
  setProject: (project) => set({ project: clone(project) }),
  bumpAssets: () => set((state) => ({ assetVersion: state.assetVersion + 1 })),
  reset: () => set({ project: defaultProject() }),
}));

/** Output resolution in pixels derived from physical size + density. */
export function outputResolution(output: OutputSettings): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(output.widthMm * output.pixelsPerMm)),
    height: Math.max(1, Math.round(output.heightMm * output.pixelsPerMm)),
  };
}

/**
 * The interactive previews (2D + 3D) render at a capped resolution so editing
 * stays fast, while exports use the project's full `pixelsPerMm`. Compositing
 * is resolution-independent (mm-based), so the preview is just a lower-density
 * sampling of the same result.
 */
/** Hard safety cap on preview dimension regardless of the user's setting. */
export const PREVIEW_MAX_DIM = 3000;

/** A copy of the project whose output density is reduced for fast previews. */
export function previewProject(project: Project): Project {
  const { output } = project;
  const longestMm = Math.max(output.widthMm, output.heightMm);
  const ppmm = Math.min(
    output.pixelsPerMm,
    output.previewPixelsPerMm,
    PREVIEW_MAX_DIM / longestMm,
  );
  return { ...project, output: { ...output, pixelsPerMm: ppmm } };
}
