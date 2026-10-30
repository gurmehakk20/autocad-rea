/**
 * Browser file helpers. Files are read and written locally. Nothing is uploaded.
 *
 * Chromium browsers offer the File System Access API, which lets a page keep a handle to a file and write
 * to it again without a dialog. Other browsers fall back to an `<input type="file">` for opening and a
 * download for saving. Handles stay in the app layer: `src/core` and `src/state` never see them.
 */

/** The part of a file handle this app uses. */
export interface FileHandle {
  readonly name: string;
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<WritableFile>;
  queryPermission?(descriptor: { mode: 'readwrite' }): Promise<string>;
  requestPermission?(descriptor: { mode: 'readwrite' }): Promise<string>;
}

export interface WritableFile {
  write(data: string): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export interface PickerType {
  readonly description: string;
  readonly accept: Record<string, string[]>;
}

/** The two picker functions of the File System Access API. */
export interface FsPickers {
  showOpenFilePicker(options: { types?: PickerType[]; multiple?: boolean }): Promise<FileHandle[]>;
  showSaveFilePicker(options: { suggestedName?: string; types?: PickerType[] }): Promise<FileHandle>;
}

/** The pickers, or null where the browser lacks them or the page is not a secure context. */
export function detectPickers(): FsPickers | null {
  const g = globalThis as Partial<FsPickers> & { isSecureContext?: boolean };
  if (g.isSecureContext === false) return null;
  if (typeof g.showOpenFilePicker !== 'function' || typeof g.showSaveFilePicker !== 'function') return null;
  return { showOpenFilePicker: g.showOpenFilePicker.bind(globalThis), showSaveFilePicker: g.showSaveFilePicker.bind(globalThis) };
}

export interface PickedFile {
  readonly name: string;
  readonly text: string;
  /** Present when the file was opened through the File System Access API, so it can be saved in place. */
  readonly handle: FileHandle | null;
}

/** Cancelling a picker rejects with an AbortError. That is a choice, not a failure. */
function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}

/**
 * Opens a file picker and resolves with the chosen file's text, or null if cancelled. With the File System Access
 * API the result carries a handle. Otherwise it uses an `<input type="file">` and `handle` is null.
 */
export async function openTextFile(
  options: { accept: string; types: PickerType[]; wantHandle: boolean },
  pickers: FsPickers | null = detectPickers(),
): Promise<PickedFile | null> {
  if (options.wantHandle && pickers) {
    try {
      const [handle] = await pickers.showOpenFilePicker({ types: options.types, multiple: false });
      if (!handle) return null;
      const file = await handle.getFile();
      return { name: handle.name, text: await file.text(), handle };
    } catch (error) {
      if (isAbort(error)) return null;
      throw error;
    }
  }
  return pickTextFile(options.accept);
}

/** Opens the system file picker through an `<input>` and resolves with the file's text, or null if cancelled. */
export function pickTextFile(accept: string): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      resolve({ name: file.name, text: await file.text(), handle: null });
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export type SaveResult =
  | { readonly kind: 'saved'; readonly name: string; readonly handle: FileHandle | null }
  | { readonly kind: 'cancelled' };

export interface SaveOptions {
  readonly suggestedName: string;
  readonly text: string;
  readonly mime: string;
  readonly types: PickerType[];
  /** Write here without asking. Ignored when `askForFile` is set. */
  readonly handle: FileHandle | null;
  /** Always show the save dialog, as "Save As" does. */
  readonly askForFile: boolean;
}

export interface SaveDeps {
  readonly pickers: FsPickers | null;
  readonly download: (fileName: string, text: string, mime: string) => void;
}

/**
 * Writes `text` to the chosen file. Resolves `cancelled` when the user dismisses the dialog and rejects when the
 * write fails, so a caller can tell "nothing happened" from "it did not work" and never marks a drawing saved
 * after a failed write.
 */
export async function saveTextFile(
  options: SaveOptions,
  deps: SaveDeps = { pickers: detectPickers(), download: downloadText },
): Promise<SaveResult> {
  if (!deps.pickers) {
    deps.download(options.suggestedName, options.text, options.mime);
    return { kind: 'saved', name: options.suggestedName, handle: null };
  }

  let handle = options.askForFile ? null : options.handle;
  if (!handle) {
    try {
      handle = await deps.pickers.showSaveFilePicker({ suggestedName: options.suggestedName, types: options.types });
    } catch (error) {
      if (isAbort(error)) return { kind: 'cancelled' };
      throw error;
    }
  }

  await ensureWritable(handle);
  const writable = await handle.createWritable();
  try {
    await writable.write(options.text);
    // The file on disk changes when `close` resolves. Until then the old contents are intact.
    await writable.close();
  } catch (error) {
    await writable.abort?.().catch(() => undefined);
    throw error;
  }
  return { kind: 'saved', name: handle.name, handle };
}

/** A handle from an earlier session of the page may have lost its write permission. Ask once, and fail clearly. */
async function ensureWritable(handle: FileHandle): Promise<void> {
  if (!handle.queryPermission) return;
  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return;
  const answer = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
  if (answer !== 'granted') throw new Error(`Permission to write to ${handle.name} was not given.`);
}

/** Triggers a browser download of `text`. */
export function downloadText(fileName: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke after the download has had time to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
