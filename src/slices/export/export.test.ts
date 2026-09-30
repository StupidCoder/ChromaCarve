import { describe, expect, it } from 'vitest';
import { sheetSvg, sheetFilename, svgPath } from './svg';
import { assemblyGuide, projectSummary, type ExportContext } from './assemblyGuide';
import { exportBundle, exportBasename } from './bundle';
import { crc32, zipFiles } from './zip';
import { createSheetLayout } from '../geometry/sheets';
import { analyzeAssembly } from '../geometry/assembly';
import { DEFAULT_SHEETS } from '../geometry/sheetSettings';
import { DEFAULT_MARKINGS } from '../geometry/markingSettings';
import { DEFAULT_SLICE_SETUP, type SliceResult, type Point2 } from '../geometry/types';
const outer:Point2[]=[[0,0],[30,0],[30,30],[0,30]];
const hole:Point2[]=[[3,3],[3,8],[8,8],[8,3]];
function fixture() {
  const r:SliceResult={layers:[0,1].map(index=>({index,bottomMm:index*3,topMm:(index+1)*3,sampleMm:index*3+1.5,valid:true,pieces:[{id:`${index+1}.1`,outer,holes:[hole],areaMm2:875}]})),bounds:{min:[0,0,0],max:[30,30,6]},modelSizeMm:[30,6,30],plannedStackMm:6,occupiedStackMm:6,emptyLayers:0,pieceCount:2,valid:true,issues:[]};
  r.assembly=analyzeAssembly(r);
  const layout=createSheetLayout(r,{...DEFAULT_SHEETS,widthMm:45,heightMm:45,kerfMm:0.1},DEFAULT_MARKINGS);
  const context:ExportContext={sourceName:'test<&".glb',setup:DEFAULT_SLICE_SETUP,omittedIds:['18.1']};
  return{r,layout,context};
}
/** Independent ZIP reader checks headers, offsets, lengths and CRCs. */
function unzipStored(bytes:Uint8Array) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),end=bytes.length-22;
  expect(view.getUint32(end,true)).toBe(0x06054b50);
  const count=view.getUint16(end+10,true),central=view.getUint32(end+16,true);
  const files=new Map<string,string>(),decoder=new TextDecoder();let offset=central;
  for(let i=0;i<count;i++) {
    expect(view.getUint32(offset,true)).toBe(0x02014b50);
    expect(view.getUint16(offset+10,true)).toBe(0);
    const size=view.getUint32(offset+24,true),length=view.getUint16(offset+28,true),local=view.getUint32(offset+42,true);
    const name=decoder.decode(bytes.subarray(offset+46,offset+46+length));
    expect(view.getUint32(local,true)).toBe(0x04034b50);
    const start=local+30+view.getUint16(local+26,true),data=bytes.subarray(start,start+size);
    expect(crc32(data)).toBe(view.getUint32(offset+16,true));
    files.set(name,decoder.decode(data));offset+=46+length;
  }
  expect(offset-central).toBe(view.getUint32(end+12,true));return files;
}
describe('laser and assembly exports',()=>{
  it('exports millimetre units, two operation colors, closed cuts and no preview geometry or fonts',()=>{
    const {layout,context}=fixture(),svg=sheetSvg(layout,0,context.sourceName);
    expect(svg).toContain('width="45mm" height="45mm" viewBox="0 0 45 45"');
    expect(svg).toContain('stroke="#0000ff"');expect(svg).toContain('stroke="#ff0000"');
    expect(svg.indexOf('id="mark"')).toBeLessThan(svg.indexOf('id="cut"'));
    expect(svg.indexOf('id="hole-')).toBeLessThan(svg.indexOf('id="outline-'));
    expect(svg).not.toMatch(/<(?:text|rect|image|script)\b|transform=/);
    expect(svg).toContain('test&lt;&amp;&quot;.glb');
    const cuts=[...svg.matchAll(/id="(?:hole|outline)-[^\"]+"[^>]*d="([^\"]+)"/g)];
    expect(cuts).toHaveLength(2);expect(cuts.every(c=>c[1].endsWith('Z'))).toBe(true);
  });
  it('exports a valid multi-sheet ZIP with its guide, settings and exact sheet SVGs',()=>{
    const {r,layout,context}=fixture(),files=unzipStored(exportBundle(r,layout,context));
    expect([...files.keys()]).toEqual(['sheet-01.svg','sheet-02.svg','assembly-guide.html','project-summary.json','README.txt']);
    for(let i=0;i<layout.sheets.length;i++)expect(files.get(sheetFilename(i))).toBe(sheetSvg(layout,i,context.sourceName));
    const summary=JSON.parse(files.get('project-summary.json')!);
    expect(summary.pieceCount).toBe(2);expect(summary.omittedPieceIds).toEqual(['18.1']);
    expect(summary.inventory.map((p:{id:string})=>p.id)).toEqual(['1.1','2.1']);
    expect(files.get('assembly-guide.html')).toContain('No hidden number on this top face.');
  });
  it('escapes source names in the guide and refuses stale inventories or out-of-bounds paths',()=>{
    const {r,layout,context}=fixture();
    const guide=assemblyGuide(r,layout,{...context,sourceName:'<script>alert(1)</script>'});
    expect(guide).not.toContain('<script>');expect(guide).toContain('&lt;script&gt;');
    const stale=structuredClone(layout);stale.sheets[0].pieces[0].id='999.1';
    expect(()=>projectSummary(r,stale,context)).toThrow('inventory');
    const outside=structuredClone(layout);outside.sheets[0].pieces[0].cut[0][0][0]=-2;
    expect(()=>sheetSvg(outside,0,context.sourceName)).toThrow('outside');
  });
  it('keeps filenames safe and rejects invalid paths and archive names',()=>{
    expect(exportBasename('../../test <x>.glb')).toBe('test-x-slices');
    expect(()=>svgPath([[NaN,0],[0,1]])).toThrow('non-finite');
    expect(()=>zipFiles([{name:'../bad',contents:''}])).toThrow('filename');
    expect(()=>zipFiles([{name:'a',contents:''},{name:'a',contents:''}])).toThrow('filename');
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(unzipStored(zipFiles([{name:'utf8.txt',contents:'plywood → 木'}])).get('utf8.txt')).toBe('plywood → 木');
  });
});
