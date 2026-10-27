import { expect, test, type Page } from '@playwright/test';

/** Number shown next to "Entities" in the properties panel when nothing is selected. */
async function entityCount(page: Page): Promise<number> {
  const label = page.locator('.sidebar .facts dt', { hasText: 'Entities' });
  const value = await label.locator('xpath=following-sibling::dd[1]').innerText();
  return Number(value);
}

/** Draws in canvas pixel coordinates; the default camera maps the origin to the canvas centre. */
async function clickCanvas(page: Page, dx: number, dy: number): Promise<void> {
  const box = await page.locator('.viewport-canvas').boundingBox();
  if (!box) throw new Error('Canvas not visible');
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.viewport-canvas')).toBeVisible();
});

test('shows the empty drawing state and the tool palette', async ({ page }) => {
  await expect(page.getByText('Empty drawing')).toBeVisible();
  await expect(page.getByRole('button', { name: /Line/ }).first()).toBeVisible();
  expect(await entityCount(page)).toBe(0);
});

test('draws a line with pointer clicks and undoes it with Ctrl+Z', async ({ page }) => {
  await page.keyboard.press('l');
  await clickCanvas(page, -100, 0);
  await clickCanvas(page, 100, 0);
  await page.keyboard.press('Enter');
  expect(await entityCount(page)).toBe(1);
  await expect(page.getByText('Empty drawing')).toHaveCount(0);

  await page.keyboard.press('Control+z');
  expect(await entityCount(page)).toBe(0);
  await page.keyboard.press('Control+y');
  expect(await entityCount(page)).toBe(1);
});

test('draws with typed coordinates in the command line', async ({ page }) => {
  const input = page.getByLabel('Command input');
  await input.fill('C');
  await input.press('Enter');
  await input.fill('0,0');
  await input.press('Enter');
  await input.fill('25');
  await input.press('Enter');
  expect(await entityCount(page)).toBe(1);
  await expect(page.locator('.command-history')).toContainText('> 25');
});

test('Escape cancels an in-progress line without creating geometry', async ({ page }) => {
  await page.keyboard.press('l');
  await clickCanvas(page, 0, 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  expect(await entityCount(page)).toBe(0);
  await expect(page.getByRole('button', { name: /Select/ }).first()).toHaveAttribute('aria-pressed', 'true');
});

test('saves a native drawing file that reports the expected format', async ({ page }) => {
  await page.getByLabel('Command input').fill('L');
  await page.getByLabel('Command input').press('Enter');
  await page.getByLabel('Command input').fill('0,0');
  await page.getByLabel('Command input').press('Enter');
  await page.getByLabel('Command input').fill('@10,0');
  await page.getByLabel('Command input').press('Enter');
  await page.getByLabel('Command input').press('Enter');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  const text = await (await import('node:fs/promises')).readFile(path!, 'utf8');
  const doc = JSON.parse(text);
  expect(doc).toMatchObject({ format: 'opendraft-drawing', version: 1, units: 'unitless' });
  expect(doc.entities).toHaveLength(1);
});

test('exports DXF and the export report stays quiet when nothing is lost', async ({ page }) => {
  await page.getByLabel('Command input').fill('C');
  await page.getByLabel('Command input').press('Enter');
  await page.getByLabel('Command input').fill('0,0');
  await page.getByLabel('Command input').press('Enter');
  await page.getByLabel('Command input').fill('10');
  await page.getByLabel('Command input').press('Enter');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export DXF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('drawing.dxf');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('reports unsupported entities in an import dialog', async ({ page }) => {
  const dxf = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '5', '21', '0',
    '0', 'TEXT', '8', '0', '10', '0', '20', '0', '40', '2', '1', 'HI',
    '0', 'ENDSEC', '0', 'EOF',
  ].join('\n');
  await page.locator('input[type=file]').count();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import DXF' }).click();
  const fc = await chooser;
  await fc.setFiles({ name: 'sample.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) });
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('TEXT x1');
  await page.getByRole('button', { name: 'Close' }).click();
  expect(await entityCount(page)).toBe(1);
});

test('saves a drawing and reopens it through the file chooser', async ({ page }) => {
  const input = page.getByLabel('Command input');
  await input.fill('C');
  await input.press('Enter');
  await input.fill('0,0');
  await input.press('Enter');
  await input.fill('30');
  await input.press('Enter');
  expect(await entityCount(page)).toBe(1);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save' }).click();
  const path = await (await downloadPromise).path();
  const fs = await import('node:fs/promises');
  const saved = await fs.readFile(path!, 'utf8');

  // Start a new drawing, then reopen the saved file. Confirm the discard prompt first.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'New' }).click();
  expect(await entityCount(page)).toBe(0);

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open' }).click();
  await (await chooser).setFiles({ name: 'saved.opendraft.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
  await expect(page.locator('.command-history')).toContainText('Opened saved.opendraft.json');
  expect(await entityCount(page)).toBe(1);
});

test('refuses to open a file that is not a drawing and keeps the current drawing', async ({ page }) => {
  const input = page.getByLabel('Command input');
  await input.fill('C');
  await input.press('Enter');
  await input.fill('0,0');
  await input.press('Enter');
  await input.fill('5');
  await input.press('Enter');

  // Save first so the drawing is clean and Open goes straight to the file chooser.
  const saved = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save' }).click();
  await saved;

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open' }).click();
  await (await chooser).setFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"hello": 1}') });
  await expect(page.locator('.command-history')).toContainText('Cannot open bad.json');
  expect(await entityCount(page)).toBe(1);
});
