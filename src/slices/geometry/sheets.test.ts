import { describe, expect, it } from 'vitest';
import { analyzeAssembly } from './assembly';
import { omitPieces } from './omissions';
import { compensatedCut, createSheetLayout } from './sheets';
import { DEFAULT_SHEETS } from './sheetSettings';
import { DEFAULT_MARKINGS, generateMarkings } from './markings';
import { signedArea } from './contours';
import type { Point2, SlicePiece, SliceResult } from './types';
export const rectangle=(w:number,h:number):Point2[]=>[[0,0],[w,0],[w,h],[0,h]];
export function sheetFixture(layers:Point2[][][]):SliceResult {
  const r:SliceResult={layers:layers.map((rings,index)=>({index,bottomMm:index*3,topMm:(index+1)*3,sampleMm:index*3+1.5,valid:true,pieces:rings.map((outer,j)=>({id:`${index+1}.${j+1}`,outer,holes:[],areaMm2:Math.abs(signedArea(outer))}))})),bounds:{min:[0,0,0],max:[40,40,layers.length*3]},modelSizeMm:[40,layers.length*3,40],plannedStackMm:layers.length*3,occupiedStackMm:layers.length*3,emptyLayers:0,pieceCount:layers.flat().length,valid:true,issues:[]};
  r.assembly=analyzeAssembly(r);return r;
}
describe('cutting sheet layout',()=>{
  it('packs every retained piece once, respecting burn envelopes, margins and gaps',()=>{
    const r=sheetFixture([Array.from({length:21},(_,i)=>rectangle(10+i%4,15+i%3))]);
    const retained=omitPieces(r,['1.3']);
    const settings={...DEFAULT_SHEETS,widthMm:65,heightMm:50,marginMm:3,gapMm:2,kerfMm:0.2};
    const layout=createSheetLayout(retained,settings,DEFAULT_MARKINGS);
    expect(layout.sheets.length).toBeGreaterThan(1);
    const ids=layout.sheets.flatMap(s=>s.pieces.map(p=>p.id));
    expect(ids).toHaveLength(20);expect(new Set(ids).size).toBe(20);expect(ids).not.toContain('1.3');
    for(const sheet of layout.sheets) for(const [i,p] of sheet.pieces.entries()) {
      expect(p.x-settings.kerfMm/2).toBeGreaterThanOrEqual(settings.marginMm-1e-6);
      expect(p.y-settings.kerfMm/2).toBeGreaterThanOrEqual(settings.marginMm-1e-6);
      expect(p.x+p.width+settings.kerfMm/2).toBeLessThanOrEqual(settings.widthMm-settings.marginMm+1e-6);
      expect(p.y+p.height+settings.kerfMm/2).toBeLessThanOrEqual(settings.heightMm-settings.marginMm+1e-6);
      for(const q of sheet.pieces.slice(i+1)) {
        const separated=p.x+p.width+settings.kerfMm+settings.gapMm<=q.x+1e-6||q.x+q.width+settings.kerfMm+settings.gapMm<=p.x+1e-6
          ||p.y+p.height+settings.kerfMm+settings.gapMm<=q.y+1e-6||q.y+q.height+settings.kerfMm+settings.gapMm<=p.y+1e-6;
        expect(separated).toBe(true);
      }
    }
    expect(createSheetLayout(retained,settings,DEFAULT_MARKINGS)).toEqual(layout);
  });
  it('rotates cut and marking paths together without mirroring the top view',()=>{
    const r=sheetFixture([[rectangle(30,10)],[rectangle(30,10)]]);
    const settings={...DEFAULT_SHEETS,widthMm:16,heightMm:40,marginMm:1,gapMm:1};
    const layout=createSheetLayout(r,settings,DEFAULT_MARKINGS);
    const p=layout.sheets.flatMap(s=>s.pieces).find(p=>p.id==='1.1')!;
    expect(p.rotation).toBe(90);
    const original=generateMarkings(r).contacts[0];
    const marks=[...original.guides,...original.label];
    expect(p.marks.length).toBeGreaterThan(0);
    marks.forEach((line,i)=>line.forEach(([x,y],j)=>expect(p.marks[i][j]).toEqual([p.x+y,p.y+x])));
    expect(()=>createSheetLayout(r,{...settings,allowRotation:false},DEFAULT_MARKINGS)).toThrow('does not fit');
  });
  it('offsets outer contours outward and holes inward by half the kerf',()=>{
    const piece:SlicePiece={id:'1.1',outer:rectangle(10,10),holes:[[[3,3],[3,7],[7,7],[7,3]]],areaMm2:84};
    const [outer,hole]=compensatedCut(piece,0.2,1e-6);
    expect(Math.abs(signedArea(outer))).toBeCloseTo(10.2**2);
    expect(Math.abs(signedArea(hole))).toBeCloseTo(3.8**2);
    expect(()=>compensatedCut({...piece,holes:[[[3,3],[3,3.1],[3.1,3.1],[3.1,3]]]},0.2,1e-6)).toThrow('topology');
  });
  it('rejects invalid settings and empty or invalid geometry',()=>{
    const r=sheetFixture([[rectangle(20,20)]]);
    expect(()=>createSheetLayout(r,{...DEFAULT_SHEETS,marginMm:300},DEFAULT_MARKINGS)).toThrow('Invalid sheet');
    expect(()=>createSheetLayout({...r,valid:false},DEFAULT_SHEETS,DEFAULT_MARKINGS)).toThrow('Resolve');
    expect(()=>createSheetLayout(omitPieces(r,['1.1']),DEFAULT_SHEETS,DEFAULT_MARKINGS)).toThrow('No retained');
  });
});
