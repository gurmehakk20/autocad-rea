import { session } from '../state/session';
import { downloadText, pickTextFile } from './files';

export interface ReportContent {
  readonly title: string;
  readonly lines: readonly string[];
}

export const NATIVE_EXTENSION = '.opendraft.json';
const NATIVE_MIME = 'application/json';
const DXF_MIME = 'application/dxf';

/** Returns true when the user may discard unsaved work. */
function confirmDiscard(): boolean {
  if (!session.isDirty) return true;
  return window.confirm('This drawing has unsaved changes. Discard them and continue?');
}

export function newDrawing(): void {
  if (!confirmDiscard()) return;
  session.newDocument();
}

export async function openNative(): Promise<void> {
  if (!confirmDiscard()) return;
  const file = await pickTextFile(`${NATIVE_EXTENSION},.json`);
  if (!file) return;
  session.loadNativeText(file.text, file.name);
}

export async function openDxf(report: (content: ReportContent) => void): Promise<void> {
  if (!confirmDiscard()) return;
  const file = await pickTextFile('.dxf');
  if (!file) return;
  const warnings = session.loadDxfText(file.text, file.name);
  if (warnings.length > 0) report({ title: `Import report: ${file.name}`, lines: warnings });
}

export function saveNative(): void {
  const name = session.fileName ?? `drawing${NATIVE_EXTENSION}`;
  downloadText(name, session.serializeNative(), NATIVE_MIME);
  session.markSaved(name);
}

export function exportDxf(report: (content: ReportContent) => void): void {
  const { text, warnings } = session.exportDxfText();
  const base = (session.fileName ?? 'drawing').replace(/\.opendraft\.json$|\.json$/i, '');
  downloadText(`${base}.dxf`, text, DXF_MIME);
  session.message(`Exported ${base}.dxf.`);
  if (warnings.length > 0) report({ title: 'Export report', lines: warnings });
}
