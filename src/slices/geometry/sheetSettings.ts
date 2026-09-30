export interface SheetSettings {
  widthMm: number; heightMm: number; marginMm: number; gapMm: number; kerfMm: number; allowRotation: boolean;
}
export const DEFAULT_SHEETS: SheetSettings = {
  widthMm: 600, heightMm: 400, marginMm: 5, gapMm: 2, kerfMm: 0, allowRotation: true,
};
export function validSheetSettings(value: unknown): value is SheetSettings {
  const s = value as SheetSettings | undefined;
  return !!s && [s.widthMm,s.heightMm,s.marginMm,s.gapMm,s.kerfMm].every(Number.isFinite)
    && s.widthMm >= 10 && s.widthMm <= 3000 && s.heightMm >= 10 && s.heightMm <= 3000
    && s.marginMm >= 0 && s.marginMm <= 100 && s.marginMm*2 < Math.min(s.widthMm,s.heightMm)
    && s.gapMm >= 0 && s.gapMm <= 50 && s.kerfMm >= 0 && s.kerfMm <= 2 && typeof s.allowRotation === 'boolean';
}
