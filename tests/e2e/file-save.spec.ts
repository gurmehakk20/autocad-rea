import { expect, test, type Page } from '@playwright/test';

/**
 * Saving and opening files.
 *
 * Playwright cannot drive the native file dialogs of the File System Access API, so the Chromium tests replace
 * `showSaveFilePicker` and `showOpenFilePicker` with functions that return handles into the browser's
 * origin-private file system. Those are real handle objects with the real `createWritable` behaviour, and the
 * tests read the files back. This proves the app's logic, not the browser's dialog: that is checked by hand.
 */

const saveButton = (page: Page) => page.getByRole('button', { name: 'Save', exact: true });
const saveAsButton = (page: Page) => page.getByRole('button', { name: 'Save as', exact: true });
const fileName = (page: Page) => page.locator('.file-name');
const input = (page: Page) => page.getByLabel('Command input');

async function drawLine(page: Page, from: string, to: string): Promise<void> {
  for (const text of ['L', from, to, '']) {
    await input(page).fill(text);
    await input(page).press('Enter');
  }
}

/** Replaces the pickers with ones backed by the origin-private file system, and counts how often they are used. */
async function installPickers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    w.saveCalls = 0;
    w.openCalls = 0;
    w.nextSaveName = 'plan.opendraft.json';
    w.openName = '';
    w.abortNext = false;
    w.failWrites = false;
    w.holdNext = null;
    const file = async (name: string, create: boolean) => (await navigator.storage.getDirectory()).getFileHandle(name, { create });
    w.showSaveFilePicker = async (options: { suggestedName?: string }) => {
      w.saveCalls++;
      w.lastSuggestedName = options.suggestedName;
      if (w.abortNext) {
        w.abortNext = false;
        throw new DOMException('The user aborted a request.', 'AbortError');
      }
      if (w.holdNext) {
        const wait = w.holdNext as Promise<void>;
        w.holdNext = null;
        await wait;
      }
      const handle = await file(w.nextSaveName, true);
      if (!w.failWrites) return handle;
      return { name: handle.name, getFile: () => handle.getFile(), createWritable: async () => { throw new Error('The disk is full.'); } };
    };
    w.showOpenFilePicker = async () => {
      w.openCalls++;
      return [await file(w.openName, false)];
    };
  });
}

/** Makes the page behave like Firefox and Safari: no File System Access API, so saving downloads. */
async function removePickers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker;
    delete w.showOpenFilePicker;
  });
}

const count = (page: Page, name: 'saveCalls' | 'openCalls') => page.evaluate((n) => (window as unknown as Record<string, number>)[n]!, name);
const readStored = (page: Page, name: string) =>
  page.evaluate(async (n) => (await (await (await navigator.storage.getDirectory()).getFileHandle(n)).getFile()).text(), name);
const storedEntities = async (page: Page, name: string) => JSON.parse(await readStored(page, name)).entities.length as number;

test.describe('saving in place with file handles (Chromium)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'The File System Access API is only in Chromium browsers.');

  test.beforeEach(async ({ page }) => {
    await installPickers(page);
    await page.goto('/');
    await expect(page.locator('.viewport-canvas')).toBeVisible();
  });

  test('the first Save asks for a file, writes it, and shows its name with no unsaved mark', async ({ page }) => {
    await drawLine(page, '0,0', '10,0');
    await expect(fileName(page)).toHaveText('Untitled *');
    await saveButton(page).click();
    await expect(fileName(page)).toHaveText('plan.opendraft.json');
    expect(await count(page, 'saveCalls')).toBe(1);
    expect(await page.evaluate(() => (window as unknown as Record<string, string>).lastSuggestedName)).toBe('drawing.opendraft.json');
    expect(await storedEntities(page, 'plan.opendraft.json')).toBe(1);
  });

  test('later saves write to the same file without asking again', async ({ page }) => {
    await drawLine(page, '0,0', '10,0');
    await saveButton(page).click();
    await expect(fileName(page)).toHaveText('plan.opendraft.json');

    await drawLine(page, '0,5', '10,5');
    await expect(fileName(page)).toHaveText('plan.opendraft.json *');
    await saveButton(page).click();
    await expect(fileName(page)).toHaveText('plan.opendraft.json');
    expect(await count(page, 'saveCalls')).toBe(1);
    expect(await storedEntities(page, 'plan.opendraft.json')).toBe(2);
  });

  test('Ctrl+S saves in place and Ctrl+Shift+S asks for a new file', async ({ page }) => {
    await drawLine(page, '0,0', '10,0');
    await page.keyboard.press('Control+s');
    await expect(fileName(page)).toHaveText('plan.opendraft.json');
    await drawLine(page, '0,5', '10,5');
    await page.keyboard.press('Control+s');
    await expect(fileName(page)).toHaveText('plan.opendraft.json');
    expect(await count(page, 'saveCalls')).toBe(1);

    await page.evaluate(() => { (window as unknown as Record<string, string>).nextSaveName = 'copy.opendraft.json'; });
    await page.keyboard.press('Control+Shift+s');
    await expect(fileName(page)).toHaveText('copy.opendraft.json');
    expect(await count(page, 'saveCalls')).toBe(2);
    expect(await storedEntities(page, 'copy.opendraft.json')).toBe(2);
  });

  test('Save as writes a new file, leaves the old one as it was, and later saves go to the new one', async ({ page }) => {
    await drawLine(page, '0,0', '10,0');
    await saveButton(page).click();
    await expect(fileName(page)).toHaveText('plan.opendraft.json');

    await drawLine(page, '0,5', '10,5');
    await page.evaluate(() => { (window as unknown as Record<string, string>).nextSaveName = 'other.opendraft.json'; });
    await saveAsButton(page).click();
    await expect(fileName(page)).toHaveText('other.opendraft.json');
    expect(await storedEntities(page, 'plan.opendraft.json')).toBe(1);
    expect(await storedEntities(page, 'other.opendraft.json')).toBe(2);

    await drawLine(page, '0,9', '10,9');
    await saveButton(page).click();
    await expect(fileName(page)).toHaveText('other.opendraft.json');
    expect(await storedEntities(page, 'other.opendraft.json')).toBe(3);
    expect(await storedEntities(page, 'plan.opendraft.json')).toBe(1);
  });

  test('dismissing the dialog is not an error: nothing is written, the drawing stays unsaved, no dialog appears', async ({ page }) => {
    await drawLine(page, '0,0', '10,0');
    await page.evaluate(() => { (window as unknown as Record<string, boolean>).abortNext = true; });
    await saveButton(page).click();
    await expect.poll(() => count(page, 'saveCalls')).toBe(1);
    await expect(fileName(page)).toHaveText('Untitled *');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a failed write shows why, keeps the drawing unsaved, and a retry can succeed', async ({ page }) => {
    await drawLine(page, '0,0', '10,0');
    await page.evaluate(() => { (window as unknown as Record<string, boolean>).failWrites = true; });
    await saveButton(page).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Cannot save');
    await expect(dialog).toContainText('The disk is full.');
    await expect(dialog).toContainText('has not been saved');
    await page.keyboard.press('Escape');
    await expect(fileName(page)).toHaveText('Untitled *');

    await page.evaluate(() => { (window as unknown as Record<string, boolean>).failWrites = false; });
    await saveButton(page).click();
    await expect(fileName(page)).toHaveText('plan.opendraft.json');
    expect(await storedEntities(page, 'plan.opendraft.json')).toBe(1);
  });

  test('an edit made while the save dialog is open keeps the drawing unsaved', async ({ page }) => {
    await drawLine(page, '0,0', '10,0');
    await page.evaluate(() => {
      const w = window as unknown as Record<string, any>;
      w.holdNext = new Promise<void>((resolve) => { w.release = resolve; });
    });
    await saveButton(page).click();
    await expect.poll(() => count(page, 'saveCalls')).toBe(1);

    await drawLine(page, '0,5', '10,5'); // while the dialog is "open"
    await page.evaluate(() => (window as unknown as Record<string, () => void>).release!());

    await expect(fileName(page)).toHaveText('plan.opendraft.json *');
    // The file holds the drawing as it was when Save was pressed.
    expect(await storedEntities(page, 'plan.opendraft.json')).toBe(1);
  });

  test('a second Save while the dialog is open does not open a second dialog', async ({ page }) => {
    await drawLine(page, '0,0', '10,0');
    await page.evaluate(() => {
      const w = window as unknown as Record<string, any>;
      w.holdNext = new Promise<void>((resolve) => { w.release = resolve; });
    });
    await saveButton(page).click();
    await expect.poll(() => count(page, 'saveCalls')).toBe(1);
    await saveButton(page).click();
    await page.keyboard.press('Control+s');
    await page.evaluate(() => (window as unknown as Record<string, () => void>).release!());
    await expect(fileName(page)).toHaveText('plan.opendraft.json');
    expect(await count(page, 'saveCalls')).toBe(1);
  });

  test('Open keeps the file handle, so the next Save goes back to that file', async ({ page }) => {
    await drawLine(page, '0,0', '10,0');
    await saveButton(page).click();
    await expect(fileName(page)).toHaveText('plan.opendraft.json');
    await page.evaluate(() => { (window as unknown as Record<string, string>).openName = 'plan.opendraft.json'; });

    await page.reload(); // a fresh page: no handle yet, nothing unsaved
    await expect(page.locator('.viewport-canvas')).toBeVisible();
    await page.evaluate(() => { (window as unknown as Record<string, string>).openName = 'plan.opendraft.json'; });
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(fileName(page)).toHaveText('plan.opendraft.json');
    expect(await count(page, 'openCalls')).toBe(1);

    await drawLine(page, '0,5', '10,5');
    await saveButton(page).click();
    await expect(fileName(page)).toHaveText('plan.opendraft.json');
    expect(await count(page, 'saveCalls')).toBe(0);
    expect(await storedEntities(page, 'plan.opendraft.json')).toBe(2);
  });

  test('New forgets the file: the next Save asks for one instead of overwriting the old file', async ({ page }) => {
    await drawLine(page, '0,0', '10,0');
    await saveButton(page).click();
    await expect(fileName(page)).toHaveText('plan.opendraft.json');

    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(fileName(page)).toHaveText('Untitled');
    await drawLine(page, '0,0', '3,3');
    await page.evaluate(() => { (window as unknown as Record<string, string>).nextSaveName = 'second.opendraft.json'; });
    await saveButton(page).click();
    await expect(fileName(page)).toHaveText('second.opendraft.json');
    expect(await count(page, 'saveCalls')).toBe(2);
    expect(await storedEntities(page, 'plan.opendraft.json')).toBe(1);
  });

  test('importing a DXF forgets the file too, so Save does not overwrite the native file with the import', async ({ page }) => {
    await drawLine(page, '0,0', '10,0');
    await saveButton(page).click();
    await expect(fileName(page)).toHaveText('plan.opendraft.json');

    const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '5', '21', '5', '0', 'ENDSEC', '0', 'EOF'].join('\n');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import DXF' }).click();
    await (await chooser).setFiles({ name: 'part.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) });
    await expect(fileName(page)).toHaveText('Untitled');

    await page.evaluate(() => { (window as unknown as Record<string, string>).nextSaveName = 'imported.opendraft.json'; });
    await saveButton(page).click();
    await expect(fileName(page)).toHaveText('imported.opendraft.json');
    expect(await count(page, 'saveCalls')).toBe(2);
    expect(await storedEntities(page, 'plan.opendraft.json')).toBe(1);
  });

  test('a failed Open leaves the drawing and the file it saves to unchanged', async ({ page }) => {
    await drawLine(page, '0,0', '10,0');
    await saveButton(page).click();
    await expect(fileName(page)).toHaveText('plan.opendraft.json');

    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const bad = await root.getFileHandle('bad.opendraft.json', { create: true });
      const writable = await bad.createWritable();
      await writable.write('this is not a drawing');
      await writable.close();
      (window as unknown as Record<string, string>).openName = 'bad.opendraft.json';
    });
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Cannot open bad.opendraft.json');
    await page.keyboard.press('Escape');
    await expect(fileName(page)).toHaveText('plan.opendraft.json');

    await drawLine(page, '0,5', '10,5');
    await saveButton(page).click();
    await expect(fileName(page)).toHaveText('plan.opendraft.json');
    expect(await count(page, 'saveCalls')).toBe(1);
    expect(await storedEntities(page, 'plan.opendraft.json')).toBe(2);
  });

  test('Export DXF asks for a file and does not change which file Save writes to', async ({ page }) => {
    await drawLine(page, '0,0', '10,0');
    await saveButton(page).click();
    await expect(fileName(page)).toHaveText('plan.opendraft.json');

    await page.evaluate(() => { (window as unknown as Record<string, string>).nextSaveName = 'plan.dxf'; });
    await page.getByRole('button', { name: 'Export DXF' }).click();
    await expect.poll(() => count(page, 'saveCalls')).toBe(2);
    await expect.poll(async () => (await readStored(page, 'plan.dxf')).includes('SECTION')).toBe(true);
    await expect(fileName(page)).toHaveText('plan.opendraft.json');

    await drawLine(page, '0,5', '10,5');
    await saveButton(page).click();
    await expect(fileName(page)).toHaveText('plan.opendraft.json');
    expect(await count(page, 'saveCalls')).toBe(2); // Save did not ask again
    expect(await storedEntities(page, 'plan.opendraft.json')).toBe(2);
  });
});

test.describe('saving by download when there are no file handles (all browsers)', () => {
  test.beforeEach(async ({ page }) => {
    await removePickers(page);
    await page.goto('/');
    await expect(page.locator('.viewport-canvas')).toBeVisible();
  });

  test('Save downloads the drawing, and the drawing counts as saved', async ({ page }) => {
    await drawLine(page, '0,0', '10,0');
    const download = page.waitForEvent('download');
    await saveButton(page).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('drawing.opendraft.json');
    const text = await (await import('node:fs/promises')).readFile((await file.path())!, 'utf8');
    expect(JSON.parse(text).entities).toHaveLength(1);
    await expect(fileName(page)).toHaveText('drawing.opendraft.json');
  });

  test('each Save and Save as downloads again under the same name', async ({ page }) => {
    await drawLine(page, '0,0', '10,0');
    for (const button of [saveButton, saveAsButton, saveButton]) {
      const download = page.waitForEvent('download');
      await button(page).click();
      expect((await download).suggestedFilename()).toBe('drawing.opendraft.json');
    }
  });

  test('Ctrl+S downloads too', async ({ page }) => {
    await drawLine(page, '0,0', '10,0');
    const download = page.waitForEvent('download');
    await page.keyboard.press('Control+s');
    expect((await download).suggestedFilename()).toBe('drawing.opendraft.json');
  });

  test('Export DXF downloads a .dxf file', async ({ page }) => {
    await drawLine(page, '0,0', '10,0');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export DXF' }).click();
    expect((await download).suggestedFilename()).toBe('drawing.dxf');
  });

  test('Open falls back to the file input', async ({ page }) => {
    await drawLine(page, '0,0', '10,0');
    const download = page.waitForEvent('download');
    await saveButton(page).click();
    const saved = await (await import('node:fs/promises')).readFile((await (await download).path())!, 'utf8');

    await page.reload();
    await expect(page.locator('.viewport-canvas')).toBeVisible();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await (await chooser).setFiles({ name: 'back.opendraft.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
    await expect(fileName(page)).toHaveText('back.opendraft.json');
  });
});
