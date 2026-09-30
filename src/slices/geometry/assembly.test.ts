import { describe, expect, it } from 'vitest';
import { analyzeAssembly } from './assembly';
import { omitPieces, suggestedOmissions } from './omissions';
import { plywoodGeometry } from './plywood';
import type { Point2, SlicePiece, SliceResult } from './types';
const square = (x: number, y: number, size: number): Point2[] => [[x,y],[x+size,y],[x+size,y+size],[x,y+size]];
const piece = (outer: Point2[], holes: Point2[][] = []): SlicePiece => ({ id:'',outer,holes,areaMm2:Math.abs(area(outer))-holes.reduce((sum,h)=>sum+Math.abs(area(h)),0) });
const area = (ring: Point2[]) => ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0)/2;
function result(layers: SlicePiece[][]): SliceResult {
  return { layers: layers.map((pieces,index)=>({index,bottomMm:index*3,topMm:(index+1)*3,sampleMm:index*3+1.5,valid:true,pieces:pieces.map((p,j)=>({...p,id:`${index+1}.${j+1}`}))})),
    bounds:{min:[0,0,0],max:[30,30,layers.length*3]},modelSizeMm:[30,layers.length*3,30],plannedStackMm:layers.length*3,occupiedStackMm:layers.length*3,emptyLayers:layers.filter(l=>!l.length).length,pieceCount:layers.flat().length,valid:true,issues:[] };
}
describe('assembly contacts and screening',()=>{
  it('measures face overlap and keeps cavities empty',()=>{
    const analysis=analyzeAssembly(result([[piece(square(0,0,10),[square(2,2,6).reverse()])],[piece(square(0,0,10))]]));
    expect(analysis.contacts[0].areaMm2).toBeCloseTo(64,3);
    expect(analysis.groups).toBe(1);
    expect(analysis.pieces.every(p=>p.grounded)).toBe(true);
  });
  it('does not count point contact, edge contact or a piece inside a cavity',()=>{
    const analysis=analyzeAssembly(result([[piece(square(0,0,10),[square(2,2,6).reverse()])],[piece(square(10,0,2)),piece(square(10,10,2)),piece(square(3,3,2))]]));
    expect(analysis.contacts).toHaveLength(0);
    expect(analysis.groups).toBe(4);
    expect(analysis.pieces.slice(1).every(p=>!p.grounded)).toBe(true);
  });
  it('never bridges an empty layer',()=>{
    const analysis=analyzeAssembly(result([[piece(square(0,0,10))],[],[piece(square(0,0,10))]]));
    expect(analysis.groups).toBe(2);
    expect(analysis.pieces[1].grounded).toBe(false);
  });
  it('distinguishes a hanging piece connected through a higher layer from a floating group',()=>{
    const analysis=analyzeAssembly(result([[piece(square(0,0,10))],[piece(square(0,0,10)),piece(square(15,0,5))],[piece([[0,0],[20,0],[20,10],[0,10]])]]));
    expect(analysis.groups).toBe(1);
    expect(analysis.pieces[2].grounded).toBe(true);
    expect(analysis.pieces[2].warnings.some(w=>w.startsWith('No contact below'))).toBe(true);
  });
  it('flags tiny parts, narrow parts, small glue areas and narrow connecting necks',()=>{
    const dumbbell: Point2[]=[[0,0],[6,0],[6,2],[10,2],[10,0],[16,0],[16,6],[10,6],[10,4],[6,4],[6,6],[0,6]];
    const analysis=analyzeAssembly(result([[piece(square(0,0,10)),piece(dumbbell.map(([x,y])=>[x,y+20]))],[piece(square(9.8,0,2))]]));
    expect(analysis.pieces[1].warnings).toContain('Narrow connecting neck');
    expect(analysis.pieces[2].warnings).toContain('Tiny piece');
    expect(analysis.pieces[2].warnings).toContain('Narrow piece');
    expect(analysis.pieces[2].warnings).toContain('Small glue contact below');
  });
  it('preserves per-piece and layer identity in the shared preview geometry',()=>{
    const r=result([[piece(square(0,0,5)),piece(square(10,0,5))],[],[piece(square(0,0,5))]]);
    const geometry=plywoodGeometry(r), p=geometry.getAttribute('position'), ids=geometry.getAttribute('slicePiece'), layers=geometry.getAttribute('sliceLayer');
    expect(new Set(Array.from(ids.array))).toEqual(new Set([0,1,2]));
    for(let i=0;i<p.count;i++) {
      const id=ids.getX(i), layer=layers.getX(i);
      expect(layer).toBe(id===2?2:0);
      expect(p.getY(i)).toBeGreaterThanOrEqual(layer*3-1e-6);
      expect(p.getY(i)).toBeLessThanOrEqual(layer*3+3+1e-6);
    }
    geometry.dispose();
  });
  it('refuses incomplete geometry rather than issuing a reassuring partial analysis',()=>{
    expect(()=>analyzeAssembly({...result([[piece(square(0,0,10))]]),valid:false})).toThrow('Resolve');
  });
});

it('suggests only tiny terminal details, preserving bases and bridges', () => {
  const r = result([[piece(square(0,0,10))], [piece(square(0,0,0.5)),piece(square(5,5,0.5)),piece(square(8,8,2))], [piece(square(0,0,0.5))]]);
  r.assembly = analyzeAssembly(r);
  expect(suggestedOmissions(r)).toEqual(['2.2', '3.1']);
  const kept = omitPieces(r, ['2.1']);
  expect(kept.assembly).toEqual(analyzeAssembly(kept));
  expect(kept.assembly!.pieces.find(p => p.id === '3.1')!.grounded).toBe(false);
  expect(kept.layers[1].pieces.map(p => p.id)).toEqual(['2.2','2.3']);
  expect(r.pieceCount).toBe(5);
  expect(kept.pieceCount).toBe(4);
  expect(omitPieces(r, []).pieceCount).toBe(5);
  const empty = omitPieces(r, r.assembly.pieces.map(p => p.id));
  expect(empty.assembly!.groups).toBe(0);
  expect(empty.occupiedStackMm).toBe(0);
});
