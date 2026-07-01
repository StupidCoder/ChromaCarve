import { create } from 'zustand';

/**
 * The full serializable project model. This object IS the JSON export schema
 * (minus binary assets, which are referenced by filename via `assetRef`).
 */

export type FillType = 'solid' | 'wood' | 'stone';

/** Grain layout for the volumetric wood material. */
export type WoodMode = 'bands' | 'rings';

/**
 * Depth-map micro-relief shared by the volumetric materials: emboss the
 * material's feature lines (wood grooves, marble veins, travertine voids, cracks)
 * into the height map. `mode` picks whether the feature sits proud ('add') or
 * recessed ('subtract'). Off by default.
 */
export interface MicroRelief {
  enabled: boolean;
  /** Height perturbation (fraction of normalized relief). */
  amount: number;
  mode: 'add' | 'subtract';
}

export function defaultMicroRelief(mode: 'add' | 'subtract' = 'subtract'): MicroRelief {
  return { enabled: false, amount: 0.06, mode };
}

/**
 * Extra parameters for the volumetric ("carved from a solid block") wood
 * material. Only meaningful when `Fill.type === 'wood'`; kept in a nested object
 * so the other fill types aren't bloated. `Fill.color1`/`color2` are the light
 * earlywood / dark latewood stops, `scaleMm` the grain feature size, `angle` the
 * grain orientation; everything wood-specific lives here.
 */
export interface WoodParams {
  /** Z (depth) scale relative to XY — the master "how sliced" knob. */
  depthScale: number;
  /** Flat-sawn (pith line, cathedral figure) vs concentric end-grain rings. */
  mode: WoodMode;
  /** Growth rings per grain feature (radial ring frequency). */
  ringDensity: number;
  /** Board depth from the pith; small = tight cathedral flame, large = straight grain. */
  pithDepth: number;
  /** Pith-axis wander (overall figure/flow): frequency + amplitude. */
  warpCoarseFreq: number;
  warpCoarseAmp: number;
  /** Radial grain turbulence (organic ring waviness): frequency + amplitude. */
  warpFineFreq: number;
  warpFineAmp: number;
  /** Latewood line sharpness (0 = thick/soft, 1 = thin/crisp lines). */
  contrast: number;
  /** Middle wood color stop (mid heart tone; earlywood -> mid -> latewood). */
  colorMid: string;
  /** Large-scale heart colour-zoning strength. */
  tintStrength: number;
  /** High-frequency pore/fiber detail strength. */
  poreStrength: number;
  /** Bright figure/sap streak strength. */
  streakStrength: number;
  /** Per-ring darkness variation (0 = uniform lines, 1 = strongly mixed). */
  fleckStrength: number;
  /** Color saturation multiplier (<1 reins in for CMYK-ish printing). */
  saturation: number;
  /** Deterministic seed — same value reproduces the same grain. */
  seed: number;
  /** Emboss latewood lines into the depth map as micro-grooves (off by default). */
  microRelief: MicroRelief;
}

export function defaultWoodParams(): WoodParams {
  return {
    depthScale: 0.5,
    mode: 'bands',
    ringDensity: 4.6,
    pithDepth: 1.6,
    warpCoarseFreq: 0.16,
    warpCoarseAmp: 0.6,
    warpFineFreq: 0.55,
    warpFineAmp: 0.12,
    contrast: 0.6,
    colorMid: '#6a492b',
    tintStrength: 0.15,
    poreStrength: 0.13,
    streakStrength: 0.4,
    fleckStrength: 0.5,
    saturation: 0.9,
    seed: 1,
    microRelief: defaultMicroRelief('subtract'),
  };
}

/** Which stone family `generateStone` produces. */
export type StoneType =
  | 'marble'
  | 'onyx'
  | 'sandstone'
  | 'granite'
  | 'terrazzo'
  | 'travertine'
  | 'cracked';

/**
 * Parameters for the volumetric stone material (only used when
 * `Fill.type === 'stone'`). Grain feature size = `Fill.scaleMm`, orientation =
 * `Fill.angle`. Groups: shared, marble veins, Voronoi (granite/terrazzo/
 * travertine/cracked), and sedimentary strata (onyx/sandstone/travertine).
 */
export interface StoneParams {
  stoneType: StoneType;
  // shared
  depthScale: number;
  seed: number;
  warpCoarseFreq: number;
  warpCoarseAmp: number;
  warpFineFreq: number;
  warpFineAmp: number;
  contrast: number;
  tintStrength: number;
  saturation: number;
  /** Primary multi-stop color ramp (onyx/sandstone/travertine/cracked/granite specks). */
  colorStops: string[];
  matrixColor: string;
  veinColor: string;
  microRelief: MicroRelief;
  // marble
  veinFreqPrimary: number;
  veinFreqSecondary: number;
  secondaryVeinStrength: number;
  turbulenceFreq: number;
  turbulenceAmp: number;
  veinSharpness: number;
  invert: boolean;
  // voronoi
  cellScale: number;
  cellScale2: number;
  cellScale3: number;
  speckleIntensity: number;
  edgeWidth: number;
  crackIntensity: number;
  aggregatePalette: string[];
  // strata
  strataDensity: number;
  strataAxis: 0 | 1 | 2; // 0 = Z (default), 1 = Y, 2 = X
  strataWaviness: number;
}

export function defaultStoneParams(): StoneParams {
  return {
    stoneType: 'marble',
    depthScale: 0.5,
    seed: 1,
    warpCoarseFreq: 0.35,
    warpCoarseAmp: 0.4,
    warpFineFreq: 2.5,
    warpFineAmp: 0.12,
    contrast: 0.5,
    tintStrength: 0.12,
    saturation: 0.9,
    colorStops: ['#efece6', '#cfc9bf', '#8f8a80'],
    matrixColor: '#eceae4',
    veinColor: '#7d7a72',
    microRelief: defaultMicroRelief('add'),
    veinFreqPrimary: 2.2,
    veinFreqSecondary: 7,
    secondaryVeinStrength: 0.35,
    turbulenceFreq: 1.2,
    turbulenceAmp: 1.4,
    veinSharpness: 0.6,
    invert: false,
    cellScale: 6,
    cellScale2: 11,
    cellScale3: 20,
    speckleIntensity: 0.8,
    edgeWidth: 0.06,
    crackIntensity: 0.8,
    aggregatePalette: ['#b5b0a6', '#8a5a44', '#4f6b57', '#c9c3b8', '#6b6f76'],
    strataDensity: 3,
    strataAxis: 0,
    strataWaviness: 0.4,
  };
}

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
  /** Volumetric-wood parameters (only used when `type === 'wood'`). */
  wood?: WoodParams;
  /** Volumetric-stone parameters (only used when `type === 'stone'`). */
  stone?: StoneParams;
}

export function solidFill(color: string): Fill {
  return { type: 'solid', color1: color, color2: '#5a4632', scaleMm: 12, turbulence: 0.6, angle: 0 };
}

/**
 * Species presets for the volumetric wood material: a full `Fill` (color stops +
 * grain knobs) tuned per wood. Applied by the material UI when the user picks a
 * preset. Grain scale/angle live on the `Fill`; the rest on `Fill.wood`.
 */
export const WOOD_PRESETS: Record<string, () => Fill> = {
  walnut: () => ({
    type: 'wood',
    color1: '#8f6640', // earlywood (light heart)
    color2: '#2f1d10', // latewood line (dark)
    scaleMm: 26,
    turbulence: 0.6,
    angle: 0,
    wood: {
      ...defaultWoodParams(),
      colorMid: '#6a492b',
      depthScale: 0.6,
      ringDensity: 4.6,
      pithDepth: 1.9,
      warpCoarseFreq: 0.16,
      warpCoarseAmp: 0.55,
      warpFineFreq: 0.55,
      warpFineAmp: 0.12,
      contrast: 0.6,
      tintStrength: 0.35,
      poreStrength: 0.13,
      streakStrength: 0.9,
      fleckStrength: 0.6,
    },
  }),
  oak: () => ({
    type: 'wood',
    color1: '#cdb083', // earlywood (light tan)
    color2: '#6f4f2a', // latewood line
    scaleMm: 34,
    turbulence: 0.4,
    angle: 0,
    wood: {
      ...defaultWoodParams(),
      colorMid: '#a8814f',
      depthScale: 0.4,
      ringDensity: 4.0,
      pithDepth: 1.3, // shallower pith -> stronger cathedral flames
      warpCoarseFreq: 0.18,
      warpCoarseAmp: 0.7,
      warpFineFreq: 0.5,
      warpFineAmp: 0.12,
      contrast: 0.5,
      tintStrength: 0.2,
      poreStrength: 0.35, // open, ring-porous
      streakStrength: 0.3,
      fleckStrength: 0.55,
    },
  }),
  olive: () => ({
    type: 'wood',
    color1: '#cbb78c',
    color2: '#3a2a14',
    scaleMm: 20,
    turbulence: 0.9,
    angle: 0,
    wood: {
      ...defaultWoodParams(),
      colorMid: '#8a6a38',
      depthScale: 1.2,
      ringDensity: 4.5,
      pithDepth: 1.05, // shallow -> wild swirling flame (but not closed loops)
      warpCoarseFreq: 0.35,
      warpCoarseAmp: 1.0,
      warpFineFreq: 0.8,
      warpFineAmp: 0.2,
      contrast: 0.62,
      tintStrength: 0.4, // strong colour variation
      poreStrength: 0.12,
      streakStrength: 0.35,
      fleckStrength: 0.6,
    },
  }),
  mahogany: () => ({
    type: 'wood',
    color1: '#9a5236', // reddish-brown earlywood
    color2: '#431c0f', // dark red latewood line
    scaleMm: 30,
    turbulence: 0.4,
    angle: 0,
    wood: {
      ...defaultWoodParams(),
      colorMid: '#723824',
      depthScale: 0.5,
      ringDensity: 4.2,
      pithDepth: 2.6, // straight, fine grain with only gentle arcs
      warpCoarseFreq: 0.14,
      warpCoarseAmp: 0.4,
      warpFineFreq: 0.5,
      warpFineAmp: 0.1,
      contrast: 0.55,
      tintStrength: 0.2,
      poreStrength: 0.18,
      streakStrength: 0.5, // ribbon/stripe figure
      fleckStrength: 0.4,
      saturation: 0.95,
    },
  }),
  redwood: () => ({
    type: 'wood',
    color1: '#c56a44', // light salmon earlywood
    color2: '#5e2612', // dark red-brown latewood
    scaleMm: 32,
    turbulence: 0.35,
    angle: 0,
    wood: {
      ...defaultWoodParams(),
      colorMid: '#9a4a2c',
      depthScale: 0.5,
      ringDensity: 3.6, // broad, well-defined growth rings
      pithDepth: 2.4,
      warpCoarseFreq: 0.14,
      warpCoarseAmp: 0.45,
      warpFineFreq: 0.45,
      warpFineAmp: 0.1,
      contrast: 0.62, // crisp earlywood/latewood contrast
      tintStrength: 0.25,
      poreStrength: 0.1, // softwood — few pores
      streakStrength: 0.4,
      fleckStrength: 0.55,
      saturation: 1.0,
    },
  }),
  poplar: () => ({
    type: 'wood',
    color1: '#d8cca6', // pale cream
    color2: '#8f8158', // muted greenish-tan (low contrast)
    scaleMm: 30,
    turbulence: 0.3,
    angle: 0,
    wood: {
      ...defaultWoodParams(),
      colorMid: '#b7a880',
      depthScale: 0.4,
      ringDensity: 3.8,
      pithDepth: 3.0, // very straight, bland grain
      warpCoarseFreq: 0.12,
      warpCoarseAmp: 0.35,
      warpFineFreq: 0.4,
      warpFineAmp: 0.08,
      contrast: 0.4, // soft, faint lines
      tintStrength: 0.15,
      poreStrength: 0.08, // diffuse-porous, barely visible
      streakStrength: 0.3,
      fleckStrength: 0.35,
      saturation: 0.7, // pale, desaturated
    },
  }),
};

/** Build a stone `Fill` from stoneType + param overrides (preset helper). */
function stoneFill(over: Partial<StoneParams> & { scaleMm?: number; angle?: number }): Fill {
  const { scaleMm = 40, angle = 0, ...stoneOver } = over;
  return {
    type: 'stone',
    color1: '#ffffff',
    color2: '#000000',
    scaleMm,
    turbulence: 0.5,
    angle,
    stone: { ...defaultStoneParams(), ...stoneOver },
  };
}

/**
 * Stone presets: one starter per stoneType plus curated named marbles. Same
 * shape as `WOOD_PRESETS` (a full `Fill` per entry) so a richer curated presets
 * file can extend or replace this map.
 */
export const STONE_PRESETS: Record<string, () => Fill> = {
  // Starters (one per family)
  marble: () => stoneFill({ stoneType: 'marble' }),
  onyx: () =>
    stoneFill({
      stoneType: 'onyx',
      scaleMm: 60,
      strataDensity: 2.5,
      warpCoarseAmp: 0.7,
      colorStops: ['#d9b98a', '#b5793f', '#8a4a24', '#e6cfa8'],
      veinColor: '#5b3218',
    }),
  sandstone: () =>
    stoneFill({
      stoneType: 'sandstone',
      strataDensity: 5,
      strataWaviness: 0.5,
      colorStops: ['#d8bf95', '#c9a56f', '#b98d55'],
    }),
  granite: () =>
    stoneFill({
      stoneType: 'granite',
      scaleMm: 30,
      matrixColor: '#8a8580',
      veinColor: '#2c2622',
      colorStops: ['#efe9df', '#b76b52', '#3a3430'],
      speckleIntensity: 0.9,
    }),
  terrazzo: () =>
    stoneFill({
      stoneType: 'terrazzo',
      cellScale: 5,
      edgeWidth: 0.05,
      matrixColor: '#e7e3da',
      aggregatePalette: ['#b5b0a6', '#8a5a44', '#4f6b57', '#c9c3b8', '#6b6f76', '#a53f3f'],
    }),
  travertine: () =>
    stoneFill({
      stoneType: 'travertine',
      strataDensity: 4,
      cellScale: 9,
      colorStops: ['#e7d8bf', '#d3bd97', '#b8996f'],
      microRelief: { enabled: false, amount: 0.08, mode: 'subtract' },
    }),
  cracked: () =>
    stoneFill({
      stoneType: 'cracked',
      cellScale: 6,
      crackIntensity: 0.9,
      edgeWidth: 0.05,
      colorStops: ['#9a938a', '#7a736a', '#575049'],
      veinColor: '#1c1814',
      microRelief: { enabled: false, amount: 0.08, mode: 'subtract' },
    }),
  // Curated marbles
  carrara: () =>
    stoneFill({
      stoneType: 'marble',
      matrixColor: '#f2f1ec',
      veinColor: '#9aa0a2',
      veinFreqPrimary: 2.4,
      secondaryVeinStrength: 0.4,
      veinSharpness: 0.55,
      turbulenceAmp: 1.5,
    }),
  calacatta: () =>
    stoneFill({
      stoneType: 'marble',
      matrixColor: '#f6f4ee',
      veinColor: '#a07a3f',
      veinFreqPrimary: 1.6,
      secondaryVeinStrength: 0.5,
      veinSharpness: 0.7,
      turbulenceAmp: 1.8,
      scaleMm: 55,
    }),
  neroMarquina: () =>
    stoneFill({
      stoneType: 'marble',
      matrixColor: '#14140f',
      veinColor: '#eae6dc',
      veinFreqPrimary: 2.0,
      secondaryVeinStrength: 0.3,
      veinSharpness: 0.75,
      turbulenceAmp: 1.3,
      saturation: 0.85,
    }),
  verde: () =>
    stoneFill({
      stoneType: 'marble',
      matrixColor: '#1f3a2c',
      veinColor: '#cfe3d0',
      veinFreqPrimary: 2.6,
      secondaryVeinStrength: 0.6,
      veinSharpness: 0.7,
      turbulenceAmp: 2.0,
      saturation: 0.95,
    }),
};

/**
 * Normalize a raw (possibly legacy) fill from imported JSON. Legacy 2D fills are
 * migrated: `marble` -> volumetric stone (marble), `noise` -> solid. Also fills
 * in the wood `microRelief` object if an older `microReliefAmount` is present.
 */
export function migrateFill(raw: unknown): Fill {
  const f = { ...(raw as Record<string, unknown>) } as unknown as Fill;
  const legacyType = f.type as string;
  if (legacyType === 'marble') {
    return { ...f, type: 'stone', stone: f.stone ?? defaultStoneParams() };
  }
  if (legacyType === 'noise') {
    return { ...f, type: 'solid' };
  }
  // Legacy wood: microReliefAmount -> microRelief object.
  if (f.type === 'wood' && f.wood && (f.wood as { microRelief?: MicroRelief }).microRelief === undefined) {
    const amount = (f.wood as { microReliefAmount?: number }).microReliefAmount ?? 0;
    f.wood = {
      ...(f.wood as WoodParams),
      microRelief: { enabled: amount > 0, amount: amount || 0.06, mode: 'subtract' },
    };
  }
  return f;
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
  /**
   * Bas-relief mode: replace the raw orthographic height field with
   * gradient-domain relief (Weyrich et al. 2007 / Fattal et al. 2002) — dissolve
   * silhouette cliffs and compress large gradients while preserving fine detail.
   * When off, the raw height path is used (unchanged).
   */
  basRelief: boolean;
  /** Fattal exponent in (0,1): lower = stronger form compression + more detail. */
  reliefBeta: number;
  /** alpha = reliefAlphaFactor × mean gradient magnitude (Fattal reference). */
  reliefAlphaFactor: number;
  /** Silhouette emergence: width (mm) over which the relief fades to the base at
   * the outline, so the model emerges smoothly from the background. */
  reliefEmergeMm: number;
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
      enabled: true,
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
        basRelief: false,
        reliefBeta: 0.5,
        reliefAlphaFactor: 0.18,
        reliefEmergeMm: 1.5,
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
      enabled: true,
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
        basRelief: true,
        reliefBeta: 0.5,
        reliefAlphaFactor: 0.18,
        reliefEmergeMm: 1.5,
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
  /**
   * Bumped when the async bas-relief worker finishes and the pipeline's cached
   * relief is updated; the previews include it in their deps so they re-render
   * with the fresh relief.
   */
  reliefVersion: number;
  /** Apply a mutation to a draft of the project (immer-free shallow clone). */
  update: (mutator: (draft: Project) => void) => void;
  /** Replace the whole project (used by JSON import / reset). */
  setProject: (project: Project) => void;
  /** Signal that an asset was loaded so dependents recompute. */
  bumpAssets: () => void;
  /** Signal that a fresh relief was uploaded so the previews re-render. */
  bumpRelief: () => void;
  reset: () => void;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export const useProjectStore = create<ProjectStore>((set) => ({
  project: defaultProject(),
  assetVersion: 0,
  reliefVersion: 0,
  update: (mutator) =>
    set((state) => {
      const draft = clone(state.project);
      mutator(draft);
      return { project: draft };
    }),
  setProject: (project) => set({ project: clone(project) }),
  bumpAssets: () => set((state) => ({ assetVersion: state.assetVersion + 1 })),
  bumpRelief: () => set((state) => ({ reliefVersion: state.reliefVersion + 1 })),
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
