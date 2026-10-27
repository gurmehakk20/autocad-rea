import { useSyncExternalStore } from 'react';
import { EditorSession } from './EditorSession';

/** Single editor instance for the app. Tests construct their own `EditorSession`. */
export const session = new EditorSession();

/** Re-renders the component whenever UI-visible session state changes. Pointer movement does not trigger it. */
export function useSessionVersion(): number {
  return useSyncExternalStore(
    (listener) => session.subscribeUi(listener),
    () => session.getUiVersion(),
  );
}
