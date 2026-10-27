import { useEffect, useRef } from 'react';
import { session, useSessionVersion } from '../state/session';

const fmt = (n: number) => n.toFixed(3);

const SNAP_LABELS: Record<string, string> = {
  endpoint: 'Endpoint',
  midpoint: 'Midpoint',
  center: 'Centre',
  intersection: 'Intersection',
  grid: 'Grid',
};

/**
 * Status bar. The cursor readout is written to the DOM directly from the view
 * channel, so pointer movement never causes a React re-render.
 */
export function StatusBar() {
  useSessionVersion();
  const xRef = useRef<HTMLSpanElement>(null);
  const yRef = useRef<HTMLSpanElement>(null);
  const snapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const update = () => {
      const p = session.snapResult?.point ?? session.cursor;
      if (xRef.current) xRef.current.textContent = p ? fmt(p.x) : '—';
      if (yRef.current) yRef.current.textContent = p ? fmt(p.y) : '—';
      const kind = session.snapResult?.kind ?? 'none';
      if (snapRef.current) snapRef.current.textContent = SNAP_LABELS[kind] ?? '';
    };
    update();
    return session.subscribeView(update);
  }, []);

  const { snap, gridVisible } = session;
  return (
    <footer className="statusbar">
      <span className="status-item" title="Cursor X, Y in drawing units">
        X <span ref={xRef} className="mono">—</span> Y <span ref={yRef} className="mono">—</span>
      </span>
      <span className="status-item status-snap" ref={snapRef} aria-label="Active snap" />
      <span className="status-item">Units: {session.drawing.units}</span>
      <span className="status-item">Grid {snap.gridSize} {gridVisible ? '' : '(hidden)'}</span>
      <span className="status-item">Zoom {(session.camera.zoom).toPrecision(3)} px/unit</span>
      <span className="status-item muted">Tool: {session.tool.id}</span>
    </footer>
  );
}
