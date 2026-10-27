/** Browser file helpers. Files are read and written locally. Nothing is uploaded. */

export interface PickedFile {
  readonly name: string;
  readonly text: string;
}

/** Opens the system file picker and resolves with the chosen file's text, or null if cancelled. */
export function pickTextFile(accept: string): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      resolve({ name: file.name, text: await file.text() });
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
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
