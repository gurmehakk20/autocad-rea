import { session } from '../state/session';
import { type ReportContent, exportDxf, newDrawing, openDxf, openNative, saveNative } from '../app/actions';
import { useSessionVersion } from '../state/session';

interface Props {
  readonly onReport: (content: ReportContent) => void;
}

/** Top bar: document actions, history, and snap/grid toggles with their current state. */
export function MenuBar({ onReport }: Props) {
  useSessionVersion();
  const { snap, gridVisible } = session;
  const name = session.fileName ?? 'Untitled';
  const dirty = session.isDirty ? ' *' : '';

  return (
    <header className="menubar">
      <div className="brand" title="OpenDraft">
        OpenDraft
      </div>
      <nav className="button-group" aria-label="Document">
        <button type="button" onClick={newDrawing} title="New drawing (Ctrl+N)">New</button>
        <button type="button" onClick={() => void openNative()} title="Open drawing (Ctrl+O)">Open</button>
        <button type="button" onClick={saveNative} title="Save drawing (Ctrl+S)">Save</button>
        <button type="button" onClick={() => void openDxf(onReport)} title="Import DXF (Ctrl+I)">Import DXF</button>
        <button type="button" onClick={() => exportDxf(onReport)} title="Export DXF">Export DXF</button>
      </nav>
      <nav className="button-group" aria-label="Edit">
        <button type="button" onClick={() => session.undo()} disabled={!session.history.canUndo} title="Undo (Ctrl+Z)">Undo</button>
        <button type="button" onClick={() => session.redo()} disabled={!session.history.canRedo} title="Redo (Ctrl+Y)">Redo</button>
        <button type="button" onClick={() => session.deleteSelection()} title="Delete selection (Del)">Delete</button>
        <button type="button" onClick={() => session.zoomExtents()} title="Zoom to extents (ZE)">Zoom extents</button>
      </nav>
      <nav className="button-group" aria-label="Drafting aids">
        <Toggle label="Grid" hint="F7" on={gridVisible} onClick={() => session.toggleGrid()} />
        <Toggle label="Snap" hint="F9" on={snap.grid} onClick={() => session.setSnap({ grid: !snap.grid })} />
        <Toggle label="Object snap" hint="F3" on={snap.objectSnap} onClick={() => session.setSnap({ objectSnap: !snap.objectSnap })} />
        <Toggle label="Ortho" hint="F8" on={snap.ortho} onClick={() => session.setSnap({ ortho: !snap.ortho })} />
      </nav>
      <div className="file-name" title={name}>
        {name}
        {dirty}
      </div>
    </header>
  );
}

function Toggle({ label, hint, on, onClick }: { label: string; hint: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={on ? 'toggle on' : 'toggle'} aria-pressed={on} onClick={onClick} title={`${label} (${hint})`}>
      {label}
    </button>
  );
}
