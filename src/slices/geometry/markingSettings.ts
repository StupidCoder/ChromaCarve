export interface MarkingSettings { clearanceMm: number; labelHeightMm: number }
export const DEFAULT_MARKINGS: MarkingSettings = { clearanceMm: 0.5, labelHeightMm: 2.5 };
export const MARK_STROKE_MM = 0.1;
export function validMarkingSettings(value: unknown): value is MarkingSettings {
  const s = value as MarkingSettings | undefined;
  return !!s && Number.isFinite(s.clearanceMm) && s.clearanceMm >= 0.1 && s.clearanceMm <= 5
    && Number.isFinite(s.labelHeightMm) && s.labelHeightMm >= 1 && s.labelHeightMm <= 8;
}
