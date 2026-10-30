import { session } from '../state/session';
import { type FileHandle, type PickerType, openTextFile, saveTextFile } from './files';

export interface ReportContent {
  readonly title: string;
  readonly lines: readonly string[];
  /** Replaces the default explanation under the title. */
  readonly intro?: string;
}

const FAILED_LOAD_INTRO = 'Nothing was changed. Your current drawing is still open.';
const FAILED_SAVE_INTRO = 'Your drawing has not been saved and is still open. Try again, or use Save As to choose another file.';

export const NATIVE_EXTENSION = '.opendraft.json';
const NATIVE_MIME = 'application/json';
const DXF_MIME = 'application/dxf';
const NATIVE_TYPES: PickerType[] = [{ description: 'OpenDraft drawing', accept: { [NATIVE_MIME]: ['.json'] } }];
const DXF_TYPES: PickerType[] = [{ description: 'DXF drawing', accept: { [DXF_MIME]: ['.dxf'] } }];

/**
 * The file the current drawing was opened from or last saved to, where the browser allows saving in place.
 * It belongs to the document: New and DXF import clear it, and a failed Open leaves it as it was.
 */
let currentHandle: FileHandle | null = null;
let saving = false;

function reasonOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'The browser refused the request.';
}

/** Returns true when the user may discard unsaved work. */
function confirmDiscard(): boolean {
  if (!session.isDirty) return true;
  return window.confirm('This drawing has unsaved changes. Discard them and continue?');
}

export function newDrawing(): void {
  if (!confirmDiscard()) return;
  session.newDocument();
  currentHandle = null;
}

export async function openNative(report: (content: ReportContent) => void): Promise<void> {
  if (!confirmDiscard()) return;
  let file;
  try {
    file = await openTextFile({ accept: `${NATIVE_EXTENSION},.json`, types: NATIVE_TYPES, wantHandle: true });
  } catch (error) {
    report({ title: 'Cannot open a file', lines: [reasonOf(error)], intro: FAILED_LOAD_INTRO });
    return;
  }
  if (!file) return;
  const error = session.loadNativeText(file.text, file.name);
  if (error) report({ title: `Cannot open ${file.name}`, lines: [error], intro: FAILED_LOAD_INTRO });
  else currentHandle = file.handle;
}

export async function openDxf(report: (content: ReportContent) => void): Promise<void> {
  if (!confirmDiscard()) return;
  const file = await openTextFile({ accept: '.dxf', types: DXF_TYPES, wantHandle: false });
  if (!file) return;
  const { warnings, error } = session.loadDxfText(file.text, file.name);
  if (error) {
    report({ title: `Cannot import ${file.name}`, lines: [error], intro: FAILED_LOAD_INTRO });
    return;
  }
  // An imported drawing is a new, unsaved document. It must not be saved over the file it came from, or over a native file.
  currentHandle = null;
  if (warnings.length > 0) report({ title: `Import report: ${file.name}`, lines: warnings });
}

/**
 * Saves the drawing. With a file handle it writes in place, otherwise it asks for a file (Chromium browsers) or
 * downloads (others). The drawing counts as saved only after the write has finished, and only up to the state
 * that was written: edits made while a permission prompt or save dialog was open keep it unsaved.
 */
export async function saveNative(report: (content: ReportContent) => void, options: { saveAs?: boolean } = {}): Promise<void> {
  if (saving) return; // a second save would open a second dialog
  saving = true;
  const suggestedName = session.fileName ?? `drawing${NATIVE_EXTENSION}`;
  try {
    const snapshot = session.snapshotForSave();
    const result = await saveTextFile({
      suggestedName,
      text: snapshot.text,
      mime: NATIVE_MIME,
      types: NATIVE_TYPES,
      handle: currentHandle,
      askForFile: options.saveAs === true,
    });
    if (result.kind === 'cancelled') return;
    if (snapshot.history === session.history) currentHandle = result.handle;
    session.markSaved(result.name, snapshot);
  } catch (error) {
    report({ title: `Cannot save ${suggestedName}`, lines: [reasonOf(error)], intro: FAILED_SAVE_INTRO });
  } finally {
    saving = false;
  }
}

/** Exports DXF through a save dialog where available. It never changes which native file the drawing is saved to. */
export async function exportDxf(report: (content: ReportContent) => void): Promise<void> {
  const { text, warnings } = session.exportDxfText();
  const base = (session.fileName ?? 'drawing').replace(/\.opendraft\.json$|\.json$/i, '');
  try {
    const result = await saveTextFile({
      suggestedName: `${base}.dxf`,
      text,
      mime: DXF_MIME,
      types: DXF_TYPES,
      handle: null,
      askForFile: true,
    });
    if (result.kind === 'cancelled') return;
    session.message(`Exported ${result.name}.`);
    if (warnings.length > 0) report({ title: 'Export report', lines: warnings });
  } catch (error) {
    report({ title: `Cannot export ${base}.dxf`, lines: [reasonOf(error)], intro: 'Nothing was exported.' });
  }
}
