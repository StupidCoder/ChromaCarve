import ClipperLib from 'clipper-lib';
import { signedArea } from './contours';
import { generateMarkings, type MarkingResult } from './markings';
import type { MarkingSettings } from './markingSettings';
import { validSheetSettings, type SheetSettings } from './sheetSettings';
import type { Point2, SlicePiece, SliceResult } from './types';

export interface PackedPiece {
  id: string; layer: number; rotation: 0 | 90;
  /** Sheet coordinates: millimetres, X right, Y down. Marks and cuts use the same transform. */
  x: number; y: number; width: number; height: number;
  cut: Point2[][]; material: Point2[][]; marks: Point2[][]; areaMm2: number;
}
export interface CuttingSheet { pieces: PackedPiece[]; usedAreaMm2: number; usedWidthMm: number; usedHeightMm: number }
export interface SheetLayout { sheets: CuttingSheet[]; settings: SheetSettings; markings: MarkingResult; pieceCount: number }
interface Rect { x: number; y: number; w: number; h: number }
interface Prepared { piece: SlicePiece; layer: number; cut: Point2[][]; bounds: Rect; marks: Point2[][] }
const bounds = (ring: Point2[]): Rect => {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const [x,y] of ring) { minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y); }
  return {x:minX,y:minY,w:maxX-minX,h:maxY-minY};
};
const intersects = (a: Rect,b: Rect) => a.x < b.x+b.w-1e-8 && a.x+a.w > b.x+1e-8 && a.y < b.y+b.h-1e-8 && a.y+a.h > b.y+1e-8;

/** Move the laser centreline outwards by half the measured kerf; holes shrink.
 * Refuse topology loss rather than silently filling small holes. */
export function compensatedCut(piece: SlicePiece, kerf: number, epsilon: number): Point2[][] {
  if (!kerf) return [piece.outer,...piece.holes];
  const offset = new ClipperLib.ClipperOffset();
  offset.AddPaths([piece.outer,...piece.holes].map((ring,i) => {
    const oriented = (signedArea(ring)>0) === (i===0) ? ring : [...ring].reverse();
    return oriented.map(([x,y])=>({X:Math.round(x/epsilon),Y:Math.round(y/epsilon)}));
  }),ClipperLib.JoinType.jtMiter,ClipperLib.EndType.etClosedPolygon);
  const tree = new ClipperLib.PolyTree(); offset.Execute(tree,kerf/(2*epsilon));
  const polygons=ClipperLib.JS.PolyTreeToExPolygons(tree);
  if(polygons.length!==1 || polygons[0].holes.length!==piece.holes.length)
    throw new Error(`Kerf compensation changes holes or topology in piece ${piece.id}. Reduce kerf or revise this piece.`);
  return [polygons[0].outer,...polygons[0].holes].map(r=>r.map(({X,Y}):Point2=>[X*epsilon,Y*epsilon]));
}

/** MaxRects: split every intersected free rectangle and discard contained ones. */
function consume(free: Rect[], used: Rect): Rect[] {
  const next: Rect[]=[];
  for(const r of free) {
    if(!intersects(r,used)) {next.push(r);continue;}
    if(used.x>r.x) next.push({...r,w:used.x-r.x});
    if(used.x+used.w<r.x+r.w) next.push({...r,x:used.x+used.w,w:r.x+r.w-used.x-used.w});
    if(used.y>r.y) next.push({...r,h:used.y-r.y});
    if(used.y+used.h<r.y+r.h) next.push({...r,y:used.y+used.h,h:r.y+r.h-used.y-used.h});
  }
  if(next.length>4000) throw new Error('Sheet layout is too complex. Reduce the number of pieces.');
  return next.filter((r,i)=>r.w>1e-8&&r.h>1e-8&&!next.some((q,j)=>i!==j
    &&q.x<=r.x&&q.y<=r.y&&q.x+q.w>=r.x+r.w&&q.y+q.h>=r.y+r.h
    &&(j<i||q.x!==r.x||q.y!==r.y||q.w!==r.w||q.h!==r.h)));
}

export function createSheetLayout(result: SliceResult, settings: SheetSettings, markingSettings: MarkingSettings,
  progress: (message: string)=>void = ()=>{}): SheetLayout {
  if(!validSheetSettings(settings)) throw new Error('Invalid sheet dimensions, margins, gap or kerf.');
  if(!result.valid || !result.assembly || result.assembly.error) throw new Error('Resolve section and assembly errors before arranging cutting sheets.');
  if(!result.pieceCount) throw new Error('No retained pieces to cut. Restore pieces in Assembly.');
  if(result.pieceCount>2000) throw new Error('Sheet packing supports up to 2,000 pieces. Increase layer thickness or simplify the model.');
  progress('Preparing hidden markings');
  const markings=generateMarkings(result,markingSettings);
  const markMap=new Map<string,Point2[][]>();
  for(const c of markings.contacts) markMap.set(c.below,[...(markMap.get(c.below)??[]),...c.guides,...c.label]);
  const epsilon=Math.max(1e-8,...result.modelSizeMm.map(n=>n*1e-7));
  const prepared:Prepared[]=result.layers.flatMap(l=>l.pieces.map(piece=>{
    const cut=compensatedCut(piece,settings.kerfMm,epsilon);
    return {piece,layer:l.index,cut,bounds:bounds(cut[0]),marks:markMap.get(piece.id)??[]};
  }));
  const extra=settings.gapMm+settings.kerfMm;
  const W=settings.widthMm-2*settings.marginMm+settings.gapMm;
  const H=settings.heightMm-2*settings.marginMm+settings.gapMm;
  for(const p of prepared) {
    const w=p.bounds.w+extra,h=p.bounds.h+extra;
    if(!(w<=W+1e-8&&h<=H+1e-8)&&!(settings.allowRotation&&h<=W+1e-8&&w<=H+1e-8))
      throw new Error(`Piece ${p.piece.id} (${p.bounds.w.toFixed(2)} × ${p.bounds.h.toFixed(2)} mm cut bounds) does not fit this sheet with the selected margin and kerf. Enlarge the sheet${settings.allowRotation?'':' or allow quarter-turns'}.`);
  }
  const orders=[
    (p:Prepared)=>p.bounds.w*p.bounds.h,
    (p:Prepared)=>Math.max(p.bounds.w,p.bounds.h),
    (p:Prepared)=>p.bounds.h,
  ];
  let best:CuttingSheet[]|undefined;
  let work=0;
  for(let attempt=0;attempt<orders.length;attempt++) {
    progress(`Arranging sheets (${attempt+1}/${orders.length})`);
    const sheets:{free:Rect[];sheet:CuttingSheet}[]=[];
    const ordered=[...prepared].sort((a,b)=>orders[attempt](b)-orders[attempt](a)||a.piece.id.localeCompare(b.piece.id,'en',{numeric:true}));
    for(const p of ordered) {
      let placement:{sheet:number;rect:Rect;rotated:boolean;score:number}|undefined;
      // Prefer filling an existing sheet, then the tightest short-side fit.
      for(let si=0;si<sheets.length;si++) {
        for(const r of sheets[si].free) for(const rotated of settings.allowRotation?[false,true]:[false]) {
          if(++work>5_000_000) throw new Error('Packing search is too complex. Reduce the number of pieces.');
          const w=(rotated?p.bounds.h:p.bounds.w)+extra,h=(rotated?p.bounds.w:p.bounds.h)+extra;
          if(w>r.w+1e-8||h>r.h+1e-8) continue;
          const score=Math.min(r.w-w,r.h-h)*10000+Math.max(r.w-w,r.h-h);
          if(!placement||score<placement.score) placement={sheet:si,rect:{x:r.x,y:r.y,w,h},rotated,score};
        }
        if(placement) break;
      }
      if(!placement) {
        if(sheets.length>=200) throw new Error('More than 200 sheets would be required. Increase sheet size or reduce the model.');
        const rotated=!(p.bounds.w+extra<=W+1e-8&&p.bounds.h+extra<=H+1e-8);
        placement={sheet:sheets.length,rect:{x:0,y:0,w:(rotated?p.bounds.h:p.bounds.w)+extra,h:(rotated?p.bounds.w:p.bounds.h)+extra},rotated,score:0};
        sheets.push({free:[{x:0,y:0,w:W,h:H}],sheet:{pieces:[],usedAreaMm2:0,usedWidthMm:0,usedHeightMm:0}});
      }
      const {rect,rotated}=placement;
      const sheet=sheets[placement.sheet];sheet.free=consume(sheet.free,rect);
      const x=rect.x+settings.marginMm+settings.kerfMm/2,y=rect.y+settings.marginMm+settings.kerfMm/2;
      // Convert the source top view (Y up) to SVG Y down exactly once; rotate
      // both cut paths and marks as a rigid pair. No physical piece is mirrored.
      const transform=(ring:Point2[])=>ring.map(([u,v]):Point2=>rotated
        ? [x+v-p.bounds.y,y+u-p.bounds.x]
        : [x+u-p.bounds.x,y+p.bounds.y+p.bounds.h-v]);
      const packed:PackedPiece={id:p.piece.id,layer:p.layer,rotation:rotated?90:0,x,y,
        width:rect.w-extra,height:rect.h-extra,cut:p.cut.map(transform),material:[p.piece.outer,...p.piece.holes].map(transform),marks:p.marks.map(transform),areaMm2:p.piece.areaMm2};
      sheet.sheet.pieces.push(packed);sheet.sheet.usedAreaMm2+=p.piece.areaMm2;
      sheet.sheet.usedWidthMm=Math.max(sheet.sheet.usedWidthMm,x+packed.width+settings.kerfMm/2);
      sheet.sheet.usedHeightMm=Math.max(sheet.sheet.usedHeightMm,y+packed.height+settings.kerfMm/2);
    }
    const candidate=sheets.map(s=>s.sheet);
    const footprint=(list:CuttingSheet[])=>list.reduce((n,s)=>n+s.usedWidthMm*s.usedHeightMm,0);
    if(!best||candidate.length<best.length||(candidate.length===best.length&&footprint(candidate)<footprint(best))) best=candidate;
  }
  return {sheets:best!,settings,markings,pieceCount:result.pieceCount};
}
