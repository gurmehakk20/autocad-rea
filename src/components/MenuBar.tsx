import { useState } from 'react';
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
        <button type="button" onClick={() => void openNative(onReport)} title="Open drawing (Ctrl+O)">Open</button>
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
        <GridSpacing value={snap.gridSize} />
      </nav>
      <div className="file-name" title={name}>
        {name}
        {dirty}
      </div>
    </header>
  );
}

/**
 * Grid spacing in drawing units. The text is kept locally while typing and applied on Enter
 * or when the field loses focus. An invalid value is reported and the field reverts.
 */
function GridSpacing({ value }: { value: number }) {
  // Keyed by the accepted value, so the field restarts from it whenever it changes elsewhere.
  return <GridSpacingField key={value} value={value} />;
}

function GridSpacingField({ value }: { value: number }) {
  const [draft, setDraft] = useState(String(value));

  const apply = () => {
    const parsed = Number(draft);
    session.setSnap({ gridSize: parsed });
    // setSnap rejects non-positive values and NaN, so restore the accepted value.
    if (!(parsed > 0)) setDraft(String(session.snap.gridSize));
  };

  return (
    <label className="grid-spacing" title="Grid spacing in drawing units">
      <span>Spacing</span>
      <input
        type="number"
        aria-label="Grid spacing"
        min="0"
        step="any"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply();
          }
        }}
      />
    </label>
  );
}

function Toggle({ label, hint, on, onClick }: { label: string; hint: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={on ? 'toggle on' : 'toggle'} aria-pressed={on} onClick={onClick} title={`${label} (${hint})`}>
      {label}
    </button>
  );
}
