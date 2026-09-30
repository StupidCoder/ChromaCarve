import { downloadFile } from './export/download';
import { sheetFilename, sheetSvg } from './export/svg';
import { assemblyGuide, type ExportContext } from './export/assemblyGuide';
import { exportBasename, exportBundle } from './export/bundle';
import { useEffect, useState } from 'react';
import type { SliceResult } from './geometry/types';
import type { MarkingSettings } from './geometry/markingSettings';
import type { SheetSettings } from './geometry/sheetSettings';
import type { SheetLayout } from './geometry/sheets';
import { mm } from './PhysicalSetup';
const path=(line:number[][],closed=false)=>`M${line.map(p=>p.join(',')).join('L')}${closed?'Z':''}`;

export function CuttingSheets({ result,settings,markingSettings,onSettingsChange,exportContext }: {
  exportContext:ExportContext;result:SliceResult;settings:SheetSettings;markingSettings:MarkingSettings;onSettingsChange:(settings:SheetSettings)=>void;
}) {
  const [exportStatus,setExportStatus]=useState<{layout:SheetLayout;message:string;error:boolean}>();
  const [state,setState]=useState<{source:SliceResult;settings:SheetSettings;markingSettings:MarkingSettings;layout?:SheetLayout;error?:string;progress?:string}>();
  const [attempt,setAttempt]=useState(0);
  const [cancelled,setCancelled]=useState<{source:SliceResult;settings:SheetSettings;markingSettings:MarkingSettings}>();
  const [zoomPiece,setZoomPiece]=useState(false);
  const [sheetIndex,setSheetIndex]=useState(0),[showIds,setShowIds]=useState(true),[selected,setSelected]=useState('');
  useEffect(()=>{
    let worker:Worker;
    const key={source:result,settings,markingSettings};
    if(cancelled?.source===result&&cancelled.settings===settings&&cancelled.markingSettings===markingSettings) {setState({...key,error:'Sheet arrangement cancelled. Use Retry to continue.'});return;}
    setState({...key,progress:'Preparing cutting sheets…'});
    try {worker=new Worker(new URL('./sheetsWorker.ts',import.meta.url),{type:'module'});}
    catch {setState({...key,error:'Could not start sheet arrangement. Use Retry to continue.'});return;}
    worker.onmessage=({data})=>{
      setState({...key,layout:data.result,error:data.error,progress:data.progress});
      if(data.result||data.error) worker.terminate();
    };
    worker.onerror=()=>{setState({...key,error:'Could not arrange sheets. Use Retry or simplify the model.'});worker.terminate();};
    worker.postMessage({result,settings,markingSettings});
    return()=>worker.terminate();
  },[result,settings,markingSettings,attempt,cancelled]);
  const current=state?.source===result&&state.settings===settings&&state.markingSettings===markingSettings?state:undefined;
  const layout=current?.layout;
  const index=layout?Math.min(sheetIndex,layout.sheets.length-1):0;
  const sheet=layout?.sheets[index];
  const picked=sheet?.pieces.find(p=>p.id===selected);
  const viewBox=picked&&zoomPiece?`${picked.x-3} ${picked.y-3} ${picked.width+6} ${picked.height+6}`:`0 0 ${settings.widthMm} ${settings.heightMm}`;
  const labelSize=picked&&zoomPiece?Math.max(0.5,(picked.width+6)/45):settings.widthMm/75;
  const download=(kind:'sheet'|'guide'|'bundle')=>{
    if(!layout)return;
    try {
      const base=exportBasename(exportContext.sourceName);
      if(kind==='sheet')downloadFile(sheetSvg(layout,index,exportContext.sourceName),`${base}-${sheetFilename(index)}`,'image/svg+xml;charset=utf-8');
      else if(kind==='guide')downloadFile(assemblyGuide(result,layout,exportContext),`${base}-assembly-guide.html`,'text/html;charset=utf-8');
      else downloadFile(exportBundle(result,layout,exportContext),`${base}.zip`,'application/zip');
      setExportStatus({layout,message:kind==='bundle'?'ZIP download prepared: all sheets, assembly guide and job settings.':kind==='sheet'?`Sheet ${index+1} SVG download prepared.`:'Printable assembly guide download prepared.',error:false});
    }catch(error){setExportStatus({layout,message:error instanceof Error?error.message:String(error),error:true});}
  };
  const update=(patch:Partial<SheetSettings>)=>{setCancelled(undefined);onSettingsChange({...settings,...patch});};
  const markWarnings=layout?.markings.contacts.filter(c=>c.warnings.length)??[];
  const assemblyWarnings=result.assembly?.pieces.filter(p=>p.warnings.length)??[];
  return <section className="slice-inspector cutting-inspector" aria-label="Cutting sheets">
    <div className="sheet-controls">
      <div className="sheet-fields">
        {([['widthMm','Sheet width (mm)',10,3000,1],['heightMm','Sheet height (mm)',10,3000,1],['marginMm','Edge margin (mm)',0,100,1],['gapMm','Part gap (mm)',0,50,0.5],['kerfMm','Measured kerf (mm)',0,2,0.01]] as const).map(([key,label,min,max,step])=><label key={key}>{label}<input aria-label={label} type="number" min={min} max={max} step={step} value={settings[key]} onChange={e=>update({[key]:e.target.valueAsNumber})}/></label>)}
      </div>
      <div className="sheet-actions">
        <label className="toggle"><input type="checkbox" checked={settings.allowRotation} onChange={e=>update({allowRotation:e.target.checked})}/>Allow quarter-turns</label>
        <label className="toggle"><input type="checkbox" checked={showIds} onChange={e=>setShowIds(e.target.checked)}/>Show piece IDs (preview only)</label>
        {!layout&&!current?.error?<button onClick={()=>setCancelled({source:result,settings,markingSettings})}>Cancel</button>:current?.error?<button onClick={()=>{setCancelled(undefined);setAttempt(n=>n+1);}}>Retry</button>:null}
      </div>
      <p role="status" className={current?.error?'warn':'muted'}>{current?.error??(layout?`${layout.pieceCount} pieces on ${layout.sheets.length} ${layout.sheets.length===1?'sheet':'sheets'} · ${mm(100*layout.sheets.reduce((n,s)=>n+s.usedAreaMm2,0)/(layout.sheets.length*settings.widthMm*settings.heightMm))}% material utilization`:current?.progress??'Preparing cutting sheets…')}</p>
      {layout&&<div className="sheet-actions"><label>Sheet <select aria-label="Cutting sheet" value={index} onChange={e=>{setSheetIndex(Number(e.target.value));setSelected('');}}>{layout.sheets.map((s,i)=><option key={i} value={i}>{i+1} of {layout.sheets.length} · {s.pieces.length} pieces</option>)}</select></label>
        <label>Locate piece <select aria-label="Locate cutting piece" value={picked?.id??''} onChange={e=>{setSelected(e.target.value);const i=layout.sheets.findIndex(s=>s.pieces.some(p=>p.id===e.target.value));if(i>=0)setSheetIndex(i);setZoomPiece(!!e.target.value);}}><option value="">All pieces</option>{layout.sheets.flatMap((s,i)=>s.pieces.map(p=>({id:p.id,sheet:i+1}))).sort((a,b)=>a.id.localeCompare(b.id,'en',{numeric:true})).map(p=><option key={p.id} value={p.id}>{p.id} · sheet {p.sheet}</option>)}</select></label>{picked&&<label className="toggle"><input type="checkbox" checked={zoomPiece} onChange={e=>setZoomPiece(e.target.checked)}/>Enlarge selected piece</label>}</div>}
    </div>
      <div className="sheet-actions sheet-downloads">
        <button disabled={!layout} onClick={()=>download('sheet')}>Download sheet SVG</button>
        <button disabled={!layout} onClick={()=>download('bundle')}>Download all (ZIP)</button>
        <button disabled={!layout} onClick={()=>download('guide')}>Assembly guide</button>
      </div>
      {exportStatus&&exportStatus.layout===layout&&<p role={exportStatus.error?'alert':'status'} className={`sheet-export-status ${exportStatus.error?'warn':'muted'}`}>{exportStatus.message}</p>}
    <div className="slice-drawing sheet-drawing">
      {sheet&&<svg viewBox={viewBox} role="img" aria-label={`Cutting sheet ${index+1}, ${sheet.pieces.length} pieces, ${settings.widthMm} by ${settings.heightMm} millimetres`}>
        <rect width={settings.widthMm} height={settings.heightMm} fill="#242321"/>
        <rect x={settings.marginMm} y={settings.marginMm} width={settings.widthMm-settings.marginMm*2} height={settings.heightMm-settings.marginMm*2} fill="none" stroke="#64676f" strokeDasharray="2 2" strokeWidth="0.3"/>
        {sheet.pieces.map(p=><g key={p.id}>
          <path d={p.material.map(r=>path(r,true)).join(' ')} fill={p.id===selected?'#47667e':'#c8aa7d'} fillOpacity={p.id===selected?0.7:0.16} fillRule="evenodd"/>
          {p.cut.map((r,i)=><path key={`c${i}`} d={path(r,true)} stroke="#ff5c69" strokeWidth="0.8" vectorEffect="non-scaling-stroke" fill="none"/>)}
          {p.marks.map((r,i)=><path key={`m${i}`} d={path(r)} stroke="#40caff" strokeWidth="0.7" vectorEffect="non-scaling-stroke" fill="none"/>)}
          {showIds&&<text x={p.x+p.width/2} y={p.y+p.height/2} textAnchor="middle" dominantBaseline="central" fill="#f5f1e8" fontSize={labelSize} paintOrder="stroke" stroke="#242321" strokeWidth={labelSize/5}>{p.id}</text>}
          <title>Piece {p.id}, layer {p.layer+1}, rotated {p.rotation}°</title>
        </g>)}
      </svg>}
    </div>
    <div className="slice-inspector-notes sheet-notes">
      {picked&&<p>Piece {picked.id} · layer {picked.layer+1} · {picked.rotation}° rotation · top-left {mm(picked.x)}, {mm(picked.y)} mm</p>}
      <p><span className="cut-key">Red: cut</span> · <span className="mark-key">Blue: mark</span>. Export: blue #0000ff to mark first, red #ff0000 to cut. IDs and the dashed margin are preview aids.</p>
      {!!(assemblyWarnings.length||markWarnings.length)&&<p className="warn">{assemblyWarnings.length} pieces have assembly warnings{layout ? `; ${markWarnings.length} contacts have incomplete markings` : ''}. Review Assembly and Markings before cutting.</p>}
      <p className="muted">Import SVGs at 100% scale. Keep marked faces up. The assembly guide identifies unmarked pieces and lists every contact warning.</p>
      <details><summary>Spacing, grain and kerf</summary><p>Part gap is clear material between laser-burn envelopes. Margin includes the burn envelope. Set kerf to zero if your laser software handles compensation; otherwise enter your measured cut width here and disable compensation there. Disallow quarter-turns to keep every piece in the same grain direction.</p>
        <p>Packing tries three piece orders using enclosing rectangles. It does not interlock outlines or use holes as nesting space. Piece shapes and hidden markings always rotate together; pieces are never mirrored.</p></details>
    </div>
  </section>;
}
