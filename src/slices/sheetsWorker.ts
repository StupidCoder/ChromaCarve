import { createSheetLayout } from './geometry/sheets';
import type { SheetSettings } from './geometry/sheetSettings';
import type { MarkingSettings } from './geometry/markingSettings';
import type { SliceResult } from './geometry/types';
self.onmessage=({data}:MessageEvent<{result:SliceResult;settings:SheetSettings;markingSettings:MarkingSettings}>)=>{
  try { self.postMessage({result:createSheetLayout(data.result,data.settings,data.markingSettings,progress=>self.postMessage({progress}))}); }
  catch(error) {self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
