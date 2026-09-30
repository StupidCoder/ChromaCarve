import type { CuttingSheet, SheetLayout } from '../geometry/sheets';
import type { Point2 } from '../geometry/types';
export const xml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export const number=(value:number)=>{
  if(!Number.isFinite(value)) throw new Error('Cannot export non-finite coordinates.');
  return String(Number(value.toFixed(5)));
};
export function svgPath(ring:Point2[],closed=false):string {
  const points=closed&&ring.length>1&&ring[0][0]===ring[ring.length-1][0]&&ring[0][1]===ring[ring.length-1][1]?ring.slice(0,-1):ring;
  if(points.length<(closed?3:2)) throw new Error('Cannot export an incomplete path.');
  return `M${points.map(([x,y])=>`${number(x)},${number(y)}`).join('L')}${closed?'Z':''}`;
}
export const sheetFilename=(index:number)=>`sheet-${String(index+1).padStart(2,'0')}.svg`;

export function validateSheet(sheet:CuttingSheet,layout:SheetLayout) {
  const {widthMm,heightMm,marginMm,kerfMm}=layout.settings;
  const edge=marginMm+kerfMm/2-1e-4;
  const ids=new Set<string>();
  for(const p of sheet.pieces) {
    if(ids.has(p.id)) throw new Error(`Duplicate piece ${p.id} in sheet.`);ids.add(p.id);
    if(!p.cut.length) throw new Error(`Piece ${p.id} has no cut outline.`);
    for(const ring of [...p.cut,...p.marks]) for(const [x,y] of ring) {
      if(!Number.isFinite(x)||!Number.isFinite(y)||x<edge||y<edge||x>widthMm-edge||y>heightMm-edge)
        throw new Error(`Piece ${p.id} has a path outside the usable sheet.`);
    }
  }
}
/** Standalone SVG, baked sheet coordinates, millimetres, no fonts or transforms.
 * Mark before cutting; put all hole cuts ahead of all outside contours. */
export function sheetSvg(layout:SheetLayout,index:number,sourceName:string):string {
  const sheet=layout.sheets[index];
  if(!sheet) throw new Error('The selected sheet is unavailable.');
  validateSheet(sheet,layout);
  const mark=sheet.pieces.flatMap(p=>p.marks.map((line,i)=>`    <path id="mark-${xml(p.id)}-${i}" data-piece="${xml(p.id)}" d="${svgPath(line)}"/>`));
  const holes=sheet.pieces.flatMap(p=>p.cut.slice(1).map((ring,i)=>`    <path id="hole-${xml(p.id)}-${i}" data-piece="${xml(p.id)}" d="${svgPath(ring,true)}"/>`));
  const outlines=sheet.pieces.map(p=>`    <path id="outline-${xml(p.id)}" data-piece="${xml(p.id)}" d="${svgPath(p.cut[0],true)}"/>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${number(layout.settings.widthMm)}mm" height="${number(layout.settings.heightMm)}mm" viewBox="0 0 ${number(layout.settings.widthMm)} ${number(layout.settings.heightMm)}">
  <title>${xml(sourceName)} — sheet ${index+1} of ${layout.sheets.length}</title>
  <desc>ChromaCarve Slices. Millimetres; import at 100% scale. Blue #0000ff: mark first. Red #ff0000: cut holes before outside contours. Kerf compensation already applied: ${number(layout.settings.kerfMm)} mm. Top faces up; do not mirror. See assembly-guide.html for piece identification and warnings.</desc>
  <g id="mark" inkscape:groupmode="layer" inkscape:label="01 Mark (blue)" fill="none" stroke="#0000ff" stroke-width="0.1" stroke-linecap="round" stroke-linejoin="round">
${mark.join('\n')}
  </g>
  <g id="cut" inkscape:groupmode="layer" inkscape:label="02 Cut (red)" fill="none" stroke="#ff0000" stroke-width="0.1" stroke-linejoin="round">
${holes.join('\n')}
${outlines.join('\n')}
  </g>
</svg>
`;
}
