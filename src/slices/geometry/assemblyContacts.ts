import type { AssemblyPiece, AssemblyContact, AssemblyAnalysis } from './assembly';

/** Reuse exact face intersections when pieces are omitted; no new geometry operation is needed. */
export function assemblyFromContacts(source: AssemblyPiece[], contacts: AssemblyContact[], thickness: number): AssemblyAnalysis {
  const pieces = source.map(p => ({ ...p, group: 0, grounded: false, belowMm2: 0, aboveMm2: 0,
    warnings: p.warnings.filter(w => w === 'Tiny piece' || w.startsWith('Narrow ')) }));
  const lookup = new Map(pieces.map(p => [p.id, p]));
  const neighbors = new Map(pieces.map(p => [p.id, [] as string[]]));
  const kept = contacts.filter(c => lookup.has(c.below) && lookup.has(c.above));
  for (const c of kept) {
    lookup.get(c.below)!.aboveMm2 += c.areaMm2;
    lookup.get(c.above)!.belowMm2 += c.areaMm2;
    neighbors.get(c.below)!.push(c.above); neighbors.get(c.above)!.push(c.below);
  }
  let groups = 0;
  for (const p of pieces) {
    if (p.group) continue;
    const group = ++groups, stack = [p], component: AssemblyPiece[] = [];
    p.group = group;
    while (stack.length) {
      const current = stack.pop()!; component.push(current);
      for (const id of neighbors.get(current.id)!) {
        const next = lookup.get(id)!;
        if (!next.group) { next.group = group; stack.push(next); }
      }
    }
    const grounded = component.some(p => p.layer === 0);
    component.forEach(p => { p.grounded = grounded; });
  }
  for (const p of pieces) {
    const contactWarnings: string[] = [];
    if (!p.grounded) contactWarnings.push('No connection to the bottom layer');
    if (p.layer > 0 && p.belowMm2 === 0) contactWarnings.push('No contact below — needs a different assembly order or support');
    else if (p.layer > 0 && (p.belowMm2 < thickness * thickness || p.belowMm2 / p.areaMm2 < 0.1)) contactWarnings.push('Small glue contact below');
    p.warnings.unshift(...contactWarnings);
  }
  return { pieces, contacts: kept, groups, widthThresholdMm: thickness, areaThresholdMm2: thickness * thickness };
}
