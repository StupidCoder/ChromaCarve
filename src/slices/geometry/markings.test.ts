import { describe, expect, it } from 'vitest';
import { analyzeAssembly } from './assembly';
import { omitPieces } from './omissions';
import { generateMarkings, numberPaths, DEFAULT_MARKINGS } from './markings';
import { polygonBoolean } from './polygonBoolean';
import { signedArea } from './contours';
import type { Point2, SlicePiece, SliceResult } from './types';
const square = (x: number,y: number,size: number): Point2[] => [[x,y],[x+size,y],[x+size,y+size],[x,y+size]];
const piece = (outer: Point2[], holes: Point2[][] = []): SlicePiece => ({ id:'',outer,holes,areaMm2:Math.abs(signedArea(outer))-holes.reduce((s,h)=>s+Math.abs(signedArea(h)),0) });
function result(layers: SlicePiece[][]): SliceResult {
  const r: SliceResult = { layers:layers.map((pieces,index)=>({index,bottomMm:index*3,topMm:(index+1)*3,sampleMm:index*3+1.5,valid:true,pieces:pieces.map((p,j)=>({...p,id:`${index+1}.${j+1}`}))})),bounds:{min:[0,0,0],max:[40,40,layers.length*3]},modelSizeMm:[40,layers.length*3,40],plannedStackMm:layers.length*3,occupiedStackMm:layers.length*3,emptyLayers:0,pieceCount:layers.flat().length,valid:true,issues:[] };
  r.assembly=analyzeAssembly(r); return r;
}
const boolean = polygonBoolean(1e-6);
function assertCovered(r: SliceResult) {
  const markings = generateMarkings(r);
  const pieces = new Map(r.layers.flatMap(l=>l.pieces.map(p=>[p.id,p] as const)));
  for(const c of markings.contacts) {
    for(const id of [c.below,c.above]) {
      const p=pieces.get(id)!;
      if(c.labelBox) expect(boolean.difference([c.labelBox],[p.outer,...p.holes])).toHaveLength(0);
      // Test the entire guide stroke against material, not just segment endpoints.
      for(const line of c.guides) for(let i=1;i<line.length;i++) {
        const [a,b]=[line[i-1],line[i]], length=Math.hypot(b[0]-a[0],b[1]-a[1]);
        if(!length) continue;
        const dx=-(b[1]-a[1])/length*0.05,dy=(b[0]-a[0])/length*0.05;
        const strip:Point2[]=[[a[0]+dx,a[1]+dy],[b[0]+dx,b[1]+dy],[b[0]-dx,b[1]-dy],[a[0]-dx,a[1]-dy]];
        expect(boolean.difference([strip],[p.outer,...p.holes])).toHaveLength(0);
      }
    }
  }
  return markings;
}
describe('hidden assembly markings',()=>{
  it('places both IDs and hidden guides for identical layers without marking the exposed top',()=>{
    const r=result([[piece(square(0,0,30))],[piece(square(0,0,30))]]);
    const m=assertCovered(r);
    expect(m.contacts).toHaveLength(1);
    expect(m.contacts[0].label.length).toBeGreaterThan(0);
    expect(m.contacts[0].guides.length).toBeGreaterThan(0);
    expect(m.contacts[0].warnings).toEqual([]);
    expect(m.unmarkedPieceIds).toEqual(['2.1']);
  });
  it('keeps marks inside overlap around holes and concave edges',()=>{
    const r=result([[piece(square(0,0,35),[square(8,8,12).reverse()])],[piece([[5,0],[35,0],[35,35],[20,35],[20,15],[5,15]])]]);
    const m=assertCovered(r);
    expect(m.contacts[0].guides.length).toBeGreaterThan(0);
    expect(m.contacts[0].label.length).toBeGreaterThan(0);
  });
  it('numbers split and merged contacts separately and respects omissions',()=>{
    const r=result([[piece(square(0,0,40))],[piece(square(0,0,18)),piece(square(22,0,18))],[piece(square(0,0,40))]]);
    const m=assertCovered(r);
    expect(m.contacts.map(c=>`${c.below}>${c.above}`)).toEqual(['1.1>2.1','1.1>2.2','2.1>3.1','2.2>3.1']);
    expect(m.contacts.every(c=>c.label.length)).toBe(true);
    const kept=generateMarkings(omitPieces(r,['2.1']));
    expect(kept.contacts.map(c=>`${c.below}>${c.above}`)).toEqual(['1.1>2.2','2.2>3.1']);
  });
  it('does not fabricate labels for tiny contacts or bridge empty layers',()=>{
    const r=result([[piece(square(0,0,20))],[piece(square(0,0,0.3))],[],[piece(square(0,0,20))]]);
    const m=generateMarkings(r);
    expect(m.contacts).toHaveLength(1);
    expect(m.contacts[0].guides).toEqual([]);
    expect(m.contacts[0].label).toEqual([]);
    expect(m.contacts[0].warnings.length).toBeGreaterThan(0);
  });
  it('uses vector strokes and validates physical dimensions',()=>{
    expect(numberPaths('18.3',2.5).paths.length).toBeGreaterThan(10);
    expect(()=>generateMarkings(result([[piece(square(0,0,20))]]),{...DEFAULT_MARKINGS,labelHeightMm:NaN})).toThrow();
  });
});

it('rotates complete ID pairs to fit a tall, narrow contact',()=>{
  const rect: Point2[]=[[0,0],[9,0],[9,24],[0,24]];
  const r=result([[piece(rect)],[piece(rect)]]);
  r.layers[0].pieces[0].id='19.111'; r.layers[1].pieces[0].id='20.111';
  r.assembly=analyzeAssembly(r);
  const m=assertCovered(r).contacts[0];
  expect(m.label.length).toBeGreaterThan(0);
  const box=m.labelBox!;
  expect(box[2][1]-box[0][1]).toBeGreaterThan(box[1][0]-box[0][0]);
});
it('never substitutes a lower boundary when the next piece overhangs every edge',()=>{
  const r=result([[piece(square(5,5,20))],[piece(square(0,0,30))]]);
  const c=generateMarkings(r).contacts[0];
  expect(c.label.length).toBeGreaterThan(0);
  expect(c.guides).toEqual([]);
  expect(c.warnings).toContain('No hidden next-piece edge is available for alignment.');
});
