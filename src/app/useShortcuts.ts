import { useEffect } from 'react';
import { TOOL_INFO } from '../core/tools/factory';
import { session } from '../state/session';
import { type ReportContent, newDrawing, openDxf, openNative, saveNative } from './actions';

/** Keys that switch tools when the command line is not focused. Matches TOOL_INFO shortcuts. */
const TOOL_KEYS = new Map(TOOL_INFO.filter((t) => t.shortcut && t.shortcut !== 'Esc').map((t) => [t.shortcut!.toLowerCase(), t.id]));

/** Fields where keys belong to the field: text entry, dropdowns (type-ahead), editable regions. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
}

function isButton(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.tagName === 'BUTTON';
}

/**
 * App-wide keyboard handling. Single-key shortcuts are ignored while a field has focus.
 * Space and Enter are left to a focused button so that keyboard activation still works.
 */
export function useShortcuts(report: (content: ReportContent) => void): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // A modal dialog owns the keyboard. Drawing shortcuts must not act on the page behind it.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const typing = isTypingTarget(e.target);
      const onButton = isButton(e.target);
      const key = e.key;

      if (mod) {
        const k = key.toLowerCase();
        if (k === 'z' && !e.shiftKey) return handled(e, () => session.undo());
        if (k === 'y' || (k === 'z' && e.shiftKey)) return handled(e, () => session.redo());
        if (k === 'a' && !typing) return handled(e, () => session.selectAll());
        if (k === 's') return handled(e, saveNative);
        if (k === 'o') return handled(e, () => void openNative(report));
        if (k === 'n') return handled(e, newDrawing);
        if (k === 'i') return handled(e, () => void openDxf(report));
        return;
      }

      if (key === ' ' && !typing && !onButton) {
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
      if (key === 'Enter' && !onButton) return handled(e, () => session.confirm());

      const tool = TOOL_KEYS.get(key.toLowerCase());
      if (tool && !e.altKey) handled(e, () => session.setTool(tool));
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') session.setSpaceHeld(false);
    };

    /** If the window loses focus while Space is down, the keyup never arrives. Release it here. */
    const onBlur = () => session.setSpaceHeld(false);

    /**
     * A button clicked with the mouse keeps focus, and a later Enter (to finish a tool) would
     * press that button again. Release focus after mouse clicks, except in dialogs where keyboard
     * focus must stay. Keyboard activation (detail 0) keeps focus.
     */
    const onClick = (e: MouseEvent) => {
      if (e.detail === 0) return;
      const button = (e.target as HTMLElement | null)?.closest<HTMLElement>('button');
      if (button && !button.closest('.dialog')) button.blur();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('click', onClick, true);
    };
  }, [report]);
}

function handled(e: KeyboardEvent, action: () => void): void {
  e.preventDefault();
  action();
}
