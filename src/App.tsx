import { Preview2D } from './components/Preview2D';
import { OutputPanel } from './components/panels/OutputPanel';
import {
  BackgroundPanel,
  BorderPanel,
  ForegroundPanel,
} from './components/panels/PartPanels';
import { ExportPanel } from './components/panels/ExportPanel';
import { Splash } from './components/Splash';

export default function App() {
  return (
    <div className="app">
      <Splash />
      <div className="pane pane--left">
        <div className="app-title">ChromaCarve</div>
        <OutputPanel />
        <BackgroundPanel />
        <BorderPanel />
        <ForegroundPanel />
        <ExportPanel />
      </div>

      <div className="pane pane--center">
        <Preview2D />
      </div>
    </div>
  );
}
