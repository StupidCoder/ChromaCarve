import type { SheetLayout } from '../geometry/sheets';
import type { SliceResult, SliceSetup } from '../geometry/types';
import { svgPath, xml, number } from './svg';
export interface ExportContext { sourceName:string;setup:SliceSetup;omittedIds:readonly string[] }

export function projectSummary(result:SliceResult,layout:SheetLayout,context:ExportContext) {
  const inventory=layout.sheets.flatMap((sheet,i)=>sheet.pieces.map(p=>({id:p.id,layer:p.layer+1,sheet:i+1,rotationDeg:p.rotation,xMm:p.x,yMm:p.y,widthMm:p.width,heightMm:p.height,
    assemblyWarnings:result.assembly?.pieces.find(a=>a.id===p.id)?.warnings??[],markingWarnings:layout.markings.contacts.filter(c=>c.below===p.id&&c.warnings.length).map(c=>({next:c.above,warnings:c.warnings}))})));
  const expected=new Set(result.layers.flatMap(l=>l.pieces.map(p=>p.id)));
  if(inventory.length!==expected.size||new Set(inventory.map(p=>p.id)).size!==expected.size||inventory.some(p=>!expected.has(p.id)))throw new Error('The sheet inventory does not match the retained model. Regenerate the layout.');
  return {version:1,sourceName:context.sourceName,slicing:context.setup,sheets:layout.settings,markings:layout.markings.settings,omittedPieceIds:context.omittedIds,
    layerCount:result.layers.length,pieceCount:layout.pieceCount,sheetCount:layout.sheets.length,connectedGroups:result.assembly?.groups??0,inventory};
}

export function assemblyGuide(result:SliceResult,layout:SheetLayout,context:ExportContext):string {
  const summary=projectSummary(result,layout,context);
  const inventory=new Map(summary.inventory.map(p=>[p.id,p]));
  const material=(rings:number[][][])=>rings.map(r=>svgPath(r as [number,number][],true)).join(' ');
  const mapFont=layout.settings.widthMm/75;
  const needsDetail=(p:{width:number;height:number;id:string})=>p.width<mapFont*p.id.length*0.6||p.height<mapFont*1.2;
  const maps=layout.sheets.map((sheet,i)=>`<section class="sheet-map"><h2>Sheet ${i+1} · ${sheet.pieces.length} pieces</h2><p>${layout.settings.widthMm} × ${layout.settings.heightMm} mm. Click a piece for its assembly details. This map is a reference, not a laser file. Tiny and narrow pieces have enlarged sheet-location details below.</p><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.settings.widthMm} ${layout.settings.heightMm}" role="img" aria-label="Sheet ${i+1} piece map">
    ${sheet.pieces.map(p=>`<a href="#piece-${xml(p.id)}"><path d="${material(p.material)}" fill="#e6dfce" fill-rule="evenodd" stroke="#555" stroke-width="0.3"/>${needsDetail(p)?'':`<text x="${number(p.x+p.width/2)}" y="${number(p.y+p.height/2)}" text-anchor="middle" dominant-baseline="central" font-size="${number(layout.settings.widthMm/75)}" paint-order="stroke" stroke="#fff" stroke-width="1.2" fill="#111">${xml(p.id)}</text>`}<title>Piece ${xml(p.id)}</title></a>`).join('\n')}</svg></section>`).join('\n');
  const layers=result.layers.map(layer=>{
    const cards=layer.pieces.map(p=>{
      const entry=inventory.get(p.id)!;
      const bounds=p.outer.reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
      const [x,y]=bounds,w=bounds[2]-x,h=bounds[3]-y,pad=Math.max(w,h)*0.07||1;
      const marks=layout.markings.contacts.filter(c=>c.below===p.id);
      const packed=layout.sheets[entry.sheet-1].pieces.find(piece=>piece.id===p.id)!;
      const detail=needsDetail(packed)?`<figure><figcaption>On sheet ${entry.sheet} (highlighted)</figcaption><svg xmlns="http://www.w3.org/2000/svg" viewBox="${number(packed.x-6)} ${number(packed.y-6)} ${number(packed.width+12)} ${number(packed.height+12)}" role="img" aria-label="Sheet location of piece ${xml(p.id)}">${layout.sheets[entry.sheet-1].pieces.filter(q=>q.x<packed.x+packed.width+6&&q.x+q.width>packed.x-6&&q.y<packed.y+packed.height+6&&q.y+q.height>packed.y-6).map(q=>`<path d="${material(q.material)}" fill="${q.id===p.id?'#75b3e3':'#eee8da'}" fill-rule="evenodd" stroke="${q.id===p.id?'#0056b3':'#777'}" stroke-width="0.15"/>`).join('')}</svg></figure>`:'';
      const contacts=result.assembly?.contacts.filter(c=>c.below===p.id||c.above===p.id)??[];
      return `<article id="piece-${xml(p.id)}"><h3>Piece ${xml(p.id)}</h3><p>Sheet ${entry.sheet} · ${entry.rotationDeg}° rotation on sheet · top-left ${number(entry.xMm)}, ${number(entry.yMm)} mm</p>
        <div class="piece-views"><figure><figcaption>Top face for assembly</figcaption><svg xmlns="http://www.w3.org/2000/svg" viewBox="${number(x-pad)} ${number(-y-h-pad)} ${number(w+2*pad)} ${number(h+2*pad)}" role="img" aria-label="Piece ${xml(p.id)} top view"><g transform="scale(1,-1)"><path d="${material([p.outer,...p.holes])}" fill="#eee8da" fill-rule="evenodd" stroke="#b52c30" stroke-width="1" vector-effect="non-scaling-stroke"/>${marks.flatMap(c=>[...c.guides,...c.label]).map(line=>`<path d="${svgPath(line)}" fill="none" stroke="#0056b3" stroke-width="0.1"/>`).join('')}</g></svg></figure>${detail}</div>
        <p>Below: ${contacts.filter(c=>c.above===p.id).map(c=>xml(c.below)).join(', ')||'none'}. Above: ${contacts.filter(c=>c.below===p.id).map(c=>xml(c.above)).join(', ')||'none'}.</p>
        ${!marks.some(c=>c.label.length)?'<p>No hidden number on this top face. Identify it using the sheet map and this shape.</p>':''}
        ${entry.assemblyWarnings.map(w=>`<p class="warning">${xml(w)}</p>`).join('')}
        ${entry.markingWarnings.map(c=>`<p class="warning">To ${xml(c.next)}: ${xml(c.warnings.join(' '))}</p>`).join('')}
      </article>`;
    }).join('\n');
    return `<section class="layer"><h2>Layer ${layer.index+1} · Y ${number(layer.bottomMm)} to ${number(layer.topMm)} mm</h2>${cards?`<div class="cards">${cards}</div>`:'<p>No retained pieces. This physical layer gap has not been collapsed.</p>'}</section>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${xml(context.sourceName)} — assembly guide</title>
<style>body{font:15px/1.5 system-ui,sans-serif;color:#202020;max-width:1000px;margin:32px auto;padding:0 24px}h1{font-size:28px}h2{margin:28px 0 10px}h3{margin:0;font-size:18px}p{margin:8px 0}a{color:#0056b3}svg{display:block;width:100%}.sheet-map svg{border:1px solid #888;max-height:680px}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}article{border:1px solid #bbb;border-radius:6px;padding:14px;break-inside:avoid}article svg{height:180px}.piece-views{display:flex;gap:12px}.piece-views figure{margin:0;flex:1;min-width:0}figcaption{font-size:11px;color:#555}article p{font-size:12px}.warning{color:#8b241c}.layer>h2{break-after:avoid}.sheet-map{break-inside:avoid}@media(max-width:600px){.cards{grid-template-columns:1fr}}@media print{@page{margin:12mm}body{margin:0;padding:0;font-size:11px;max-width:none}.sheet-map{break-after:page}.sheet-map svg{max-height:215mm}.cards{grid-template-columns:repeat(2,minmax(0,1fr))}article svg{height:35mm}article p{font-size:10px}h2{font-size:17px}.no-print{display:none}}</style></head><body>
<h1>${xml(context.sourceName)} — assembly guide</h1>
<p>${summary.pieceCount} pieces · ${summary.layerCount} layers · ${summary.sheetCount} sheets · ${number(context.setup.thicknessMm)} mm material · ${summary.connectedGroups} connected groups.</p>
<p>Omitted pieces: ${context.omittedIds.length?context.omittedIds.map(xml).join(', '):'none'}.</p>
<p class="no-print">Save this file with your SVG sheets. Print it using your browser’s Print command. Thumbnails and numbered sheet maps are not to scale.</p>
<ol><li>Import each sheet SVG at 100% scale: ${layout.settings.widthMm} × ${layout.settings.heightMm} mm. Blue (#0000ff) means mark; red (#ff0000) means cut. Mark first, then cut holes before outer contours. Check operation order in your laser software.</li>
<li>Kerf compensation in these files: ${number(layout.settings.kerfMm)} mm. ${layout.settings.kerfMm?'Do not add compensation again in the laser software.':'No kerf compensation has been applied.'} The displayed 0.1 mm SVG stroke is nominal, not a laser power or measured burn-width setting.</li>
<li>Keep the marked face up. Use the numbered maps to identify pieces without hidden numbers. Do not mirror parts. Quarter-turns shown in the inventory are packing rotations; return pieces to the top-view orientation below for assembly.</li>
<li>The first engraved number identifies this piece; the “&gt;” number identifies the piece above it. Guides are inset ${number(layout.markings.settings.clearanceMm+0.05)} mm into the next piece’s material. Allow this offset when aligning outer edges and holes.</li>
<li>Dry-fit before gluing. Layer numbers give vertical position, not a guaranteed assembly order. Pieces with no contact below may need attachment from above; disconnected groups require an additional connection. Review the warnings below. Missing or partial guides may require manual alignment.</li></ol>
${result.issues.filter(i=>i.severity==='warning').map(i=>`<p class="warning">${xml(i.message)}</p>`).join('')}
<h2>Find your pieces</h2>${maps}<h2>Assembly by layer</h2>${layers}
</body></html>`;
}
