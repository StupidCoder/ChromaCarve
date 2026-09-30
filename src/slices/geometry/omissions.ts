import { assemblyFromContacts } from './assemblyContacts';
import type { SliceResult } from './types';

/** Conservative candidates only: tiny, narrow terminal details with a small glue face.
 * Visual importance is deliberately left for the user to judge in the preview. */
export function suggestedOmissions(result: SliceResult): string[] {
  const analysis = result.assembly;
  if (!analysis || analysis.error) return [];
  const degree = new Map<string, number>();
  for (const c of analysis.contacts) {
    degree.set(c.below, (degree.get(c.below) ?? 0) + 1);
    degree.set(c.above, (degree.get(c.above) ?? 0) + 1);
  }
  return analysis.pieces.filter(p => p.layer > 0 && p.areaMm2 < analysis.areaThresholdMm2 * 0.1
    && p.warnings.includes('Narrow piece') && (degree.get(p.id) ?? 0) <= 1
    && Math.max(p.aboveMm2, p.belowMm2) < analysis.areaThresholdMm2 * 0.1).map(p => p.id);
}

/** Preserve IDs and physical layer positions for assembly instructions and later export. */
export function omitPieces(result: SliceResult, omittedIds: readonly string[]): SliceResult {
  if (!omittedIds.length) return result;
  const omitted = new Set(omittedIds);
  const layers = result.layers.map(layer => ({ ...layer, pieces: layer.pieces.filter(p => !omitted.has(p.id)) }));
  const occupied = layers.filter(l => l.pieces.length);
  const assembly = result.assembly;
  return { ...result, layers, pieceCount: layers.reduce((n,l) => n + l.pieces.length, 0),
    emptyLayers: layers.length - occupied.length,
    occupiedStackMm: occupied.length ? occupied[occupied.length - 1].topMm - occupied[0].bottomMm : 0,
    assembly: assembly && !assembly.error ? assemblyFromContacts(assembly.pieces.filter(p => !omitted.has(p.id)), assembly.contacts, assembly.widthThresholdMm) : assembly };
}
