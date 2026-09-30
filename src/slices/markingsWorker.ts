import { generateMarkings, type MarkingSettings } from './geometry/markings';
import type { SliceResult } from './geometry/types';
self.onmessage = ({ data }: MessageEvent<{ result: SliceResult; settings: MarkingSettings }>) => {
  try { self.postMessage({ result: generateMarkings(data.result, data.settings) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
