import { useEffect } from 'react';
import { TOOL_INFO } from '../core/tools/factory';
import { session } from '../state/session';
import { type ReportContent, newDrawing, openDxf, openNative, saveNative } from './actions';

/** Keys that switch tools when the command line is not focused. Matches TOOL_INFO shortcuts. */
const TOOL_KEYS = new Map(TOOL_INFO.filter((t) => t.shortcut && t.shortcut !== 'Esc').map((t) => [t.shortcut!.toLowerCase(), t.id]));

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
}

/** App-wide keyboard handling. Single-key tool shortcuts are ignored while typing in a field. */
export function useShortcuts(report: (content: ReportContent) => void): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const typing = isTypingTarget(e.target);
      const key = e.key;

      if (mod) {
        const k = key.toLowerCase();
        if (k === 'z' && !e.shiftKey) return handled(e, () => session.undo());
        if ((k === 'y') || (k === 'z' && e.shiftKey)) return handled(e, () => session.redo());
        if (k === 'a' && !typing) return handled(e, () => session.selectAll());
        if (k === 's') return handled(e, saveNative);
        if (k === 'o') return handled(e, () => void openNative());
        if (k === 'n') return handled(e, newDrawing);
        if (k === 'i') return handled(e, () => void openDxf(report));
        return;
      }

      if (key === ' ' && !typing) {
        session.setSpaceHeld(true);
        e.preventDefault();
        return;
      }
      if (key === 'Escape') return handled(e, () => session.cancel());
      if (key === 'F3') return handled(e, () => session.setSnap({ objectSnap: !session.snap.objectSnap }));
      if (key === 'F7') return handled(e, () => session.toggleGrid());
      if (key === 'F8') return handled(e, () => session.setSnap({ ortho: !session.snap.ortho }));
      if (key === 'F9') return handled(e, () => session.setSnap({ grid: !session.snap.grid }));

      if (typing) return;
      if (key === 'Delete' || key === 'Backspace') return handled(e, () => session.deleteSelection());
      if (key === 'Enter') return handled(e, () => session.confirm());

      const tool = TOOL_KEYS.get(key.toLowerCase());
      if (tool && !e.altKey) handled(e, () => session.setTool(tool));
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') session.setSpaceHeld(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [report]);
}

function handled(e: KeyboardEvent, action: () => void): void {
  e.preventDefault();
  action();
}
