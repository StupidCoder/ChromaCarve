export type Point2 = [number, number];
export type Point3 = [number, number, number];

export interface SliceSetup {
  /** Longest model dimension before rotation. Proportions are locked. */
  sizeMm: number;
  thicknessMm: number;
  /** XYZ Euler rotation of the model; layers are perpendicular to world Y. */
  rotationDeg: Point3;
  /** Sample within each fixed slab; zero is its midpoint. */
  samplingOffsetMm: number;
  /** Optional for previously saved projects; strict slicing remains the default. */
  repairMode?: 'strict' | 'automatic';
  repairGapMm?: number;
}

export const DEFAULT_SLICE_SETUP: SliceSetup = {
  sizeMm: 150, thicknessMm: 3, rotationDeg: [0, 0, 0], samplingOffsetMm: 0,
};

export function validSliceSetup(value: unknown): value is SliceSetup {
  const s = value as SliceSetup | undefined;
  return !!s && Number.isFinite(s.sizeMm) && s.sizeMm >= 0.1 && s.sizeMm <= 10000
    && Number.isFinite(s.thicknessMm) && s.thicknessMm >= 0.05 && s.thicknessMm <= 100
    && Array.isArray(s.rotationDeg) && s.rotationDeg.length === 3
    && s.rotationDeg.every((angle) => Number.isFinite(angle) && Math.abs(angle) <= 180)
    && (s.repairMode === undefined || s.repairMode === 'strict' || s.repairMode === 'automatic')
    && (s.repairGapMm === undefined || (Number.isFinite(s.repairGapMm) && s.repairGapMm >= 0 && s.repairGapMm <= 10))
    && Number.isFinite(s.samplingOffsetMm) && Math.abs(s.samplingOffsetMm) <= s.thicknessMm / 2;
}

export interface SliceInput {
  /** Owned copies of the static pose, never the live renderer's buffers. */
  positions: Float64Array;
  indices?: Uint32Array;
  setup: SliceSetup;
}

export interface SliceIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  layer?: number;
}

export interface SlicePiece {
  id: string;
  /** Coordinates are millimetres in the layer plane: X and -Z. */
  outer: Point2[];
  holes: Point2[][];
  areaMm2: number;
}

export interface SliceLayer {
  index: number;
  bottomMm: number;
  topMm: number;
  sampleMm: number;
  pieces: SlicePiece[];
  valid: boolean;
  /** Failed contours are shown as lines, never silently closed or filled. */
  invalidSegments?: [Point2, Point2][];
  repair?: {
    originalSegments: [Point2, Point2][];
    bridges: [Point2, Point2][];
    closedLoops: number;
    attachedPaths: number;
    shortGaps: number;
    unresolvedPaths: number;
  };
}

export interface SliceResult {
  layers: SliceLayer[];
  /** Bounds in the slice frame (X, -Z, Y), after physical scaling and rotation. */
  bounds: { min: Point3; max: Point3 };
  /** Physical width, height, depth after rotation. */
  modelSizeMm: Point3;
  plannedStackMm: number;
  occupiedStackMm: number;
  emptyLayers: number;
  pieceCount: number;
  valid: boolean;
  issues: SliceIssue[];
}

export interface SliceProgress { fraction: number; phase: string }
