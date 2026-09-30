import type { SliceResult } from '../geometry/types';
import type { SheetLayout } from '../geometry/sheets';
import { assemblyGuide, projectSummary, type ExportContext } from './assemblyGuide';
import { sheetFilename, sheetSvg } from './svg';
import { zipFiles } from './zip';
export const exportBasename=(name:string)=>(name.replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'model')+'-slices';
export function exportBundle(result:SliceResult,layout:SheetLayout,context:ExportContext):Uint8Array {
  const summary=projectSummary(result,layout,context);
  const readme=`ChromaCarve Slices — ${context.sourceName}\n\nOpen assembly-guide.html for the printable piece maps, contact list and review warnings.\nImport sheet-XX.svg files at 100% scale (${layout.settings.widthMm} x ${layout.settings.heightMm} mm).\nBlue #0000ff: mark first. Red #ff0000: cut holes, then outside contours.\nCheck the operation order in your laser software. Preview IDs and borders are not cut.\nKerf compensation already applied: ${layout.settings.kerfMm} mm. Avoid applying compensation twice.\nKeep marked faces up; do not mirror. Assembly-guide thumbnails are not to scale.\nproject-summary.json records physical settings, omissions, piece locations and warnings.\nThe source model is not included.\n`;
  return zipFiles([...layout.sheets.map((_,i)=>({name:sheetFilename(i),contents:sheetSvg(layout,i,context.sourceName)})),
    {name:'assembly-guide.html',contents:assemblyGuide(result,layout,context)},
    {name:'project-summary.json',contents:JSON.stringify(summary,null,2)},
    {name:'README.txt',contents:readme}]);
}
