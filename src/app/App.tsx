import { useEffect, useState } from 'react';
import { CommandLine } from '../components/command-line/CommandLine';
import { ReportDialog } from '../components/dialogs/ReportDialog';
import { LayerPanel } from '../components/panels/LayerPanel';
import { PropertiesPanel } from '../components/panels/PropertiesPanel';
import { MenuBar } from '../components/MenuBar';
import { StatusBar } from '../components/StatusBar';
import { Toolbar } from '../components/Toolbar';
import { CanvasViewport } from '../viewport/CanvasViewport';
import { session, useSessionVersion } from '../state/session';
import { type ReportContent } from './actions';
import { useShortcuts } from './useShortcuts';

export function App() {
  const [report, setReport] = useState<ReportContent | null>(null);
  const version = useSessionVersion();

  useShortcuts(setReport);

  useEffect(() => {
    // Warn before closing the tab with unsaved work.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!session.isDirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const empty = session.drawing.entityCount === 0;

  return (
    <div className="app" data-version={version}>
      <MenuBar onReport={setReport} />
      <div className="workspace">
        <Toolbar />
        <main className="stage">
          <CanvasViewport />
          {empty && (
            <div className="empty-hint" role="note">
              <p className="empty-title">Empty drawing</p>
              <p>
                Press <kbd>L</kbd> for a line, <kbd>C</kbd> for a circle, <kbd>REC</kbd> for a rectangle, or type a command below.
              </p>
              <p className="muted">Pan with the middle mouse button or Space + drag. Zoom with the wheel.</p>
            </div>
          )}
        </main>
        <aside className="sidebar">
          <LayerPanel />
          <PropertiesPanel />
        </aside>
      </div>
      <CommandLine />
      <StatusBar />
      {report && <ReportDialog content={report} onClose={() => setReport(null)} />}
    </div>
  );
}
