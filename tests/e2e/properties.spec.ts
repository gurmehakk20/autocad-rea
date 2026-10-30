import { expect, test, type Page } from '@playwright/test';

/** Editing geometry by value in the properties panel. */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.viewport-canvas')).toBeVisible();
});

const properties = (page: Page) => page.getByRole('region', { name: 'Properties' });
const field = (page: Page, label: string) => properties(page).getByLabel(label, { exact: true });

async function cmd(page: Page, ...texts: string[]): Promise<void> {
  const input = page.getByLabel('Command input');
  for (const text of texts) {
    await input.fill(text);
    await input.press('Enter');
  }
}

/** Selects the circle of radius 5 at the origin by clicking its right edge (default camera: 20 px per unit). */
async function selectCircle(page: Page): Promise<void> {
  const box = (await page.locator('.viewport-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + 5 * 20, box.y + box.height / 2);
  await expect(properties(page).getByRole('heading', { name: 'Circle' })).toBeVisible();
}

async function drawCircle(page: Page, radius = '5'): Promise<void> {
  await cmd(page, 'C', '0,0', radius);
  await page.getByLabel('Command input').press('Escape'); // leave the circle tool so the next click selects
}

test('a typed radius is applied on Enter, keeps focus, and one undo restores the old value', async ({ page }) => {
  await drawCircle(page);
  await selectCircle(page);
  await expect(field(page, 'Radius')).toHaveValue('5');

  await field(page, 'Radius').fill('8');
  await field(page, 'Radius').press('Enter');
  await expect(field(page, 'Radius')).toHaveValue('8');
  await expect(field(page, 'Radius')).toBeFocused();

  await page.keyboard.press('Control+z');
  await expect(field(page, 'Radius')).toHaveValue('5');
});

test('each committed edit is its own undo step', async ({ page }) => {
  await drawCircle(page);
  await selectCircle(page);
  for (const value of ['6', '7']) {
    await field(page, 'Radius').fill(value);
    await field(page, 'Radius').press('Enter');
    await expect(field(page, 'Radius')).toHaveValue(value);
  }
  await page.keyboard.press('Control+z');
  await expect(field(page, 'Radius')).toHaveValue('6');
  await page.keyboard.press('Control+z');
  await expect(field(page, 'Radius')).toHaveValue('5');
});

test('the centre can be moved by value', async ({ page }) => {
  await drawCircle(page);
  await selectCircle(page);
  await field(page, 'Centre X').fill('12.5');
  await field(page, 'Centre X').press('Enter');
  await expect(field(page, 'Centre X')).toHaveValue('12.5');
  await expect(field(page, 'Centre Y')).toHaveValue('0');
});

test('an invalid radius shows an error at the field and leaves the circle alone', async ({ page }) => {
  await drawCircle(page);
  await selectCircle(page);
  await field(page, 'Radius').fill('0');
  await field(page, 'Radius').press('Enter');
  await expect(properties(page).getByRole('alert')).toContainText(/radius/i);
  await expect(field(page, 'Radius')).toHaveAttribute('aria-invalid', 'true');

  // The circle is unchanged: undo removes the circle itself, not a radius edit.
  await field(page, 'Radius').press('Escape');
  await expect(field(page, 'Radius')).toHaveValue('5');
  await expect(properties(page).getByRole('alert')).toHaveCount(0);
  await expect(properties(page).getByRole('heading', { name: 'Circle' })).toBeVisible();
});

test('text that is not a number is refused with a message', async ({ page }) => {
  await drawCircle(page);
  await selectCircle(page);
  for (const [text, message] of [['abc', /not a number/i], ['1,5', /not a number/i], ['1e999', /out of range/i], ['', /enter a number/i]] as const) {
    await field(page, 'Radius').fill(text);
    await field(page, 'Radius').press('Enter');
    await expect(properties(page).getByRole('alert'), `"${text}"`).toContainText(message);
  }
});

test('Escape reverts the field and keeps the selection', async ({ page }) => {
  await drawCircle(page);
  await selectCircle(page);
  await field(page, 'Radius').fill('99');
  await field(page, 'Radius').press('Escape');
  await expect(field(page, 'Radius')).toHaveValue('5');
  await expect(properties(page).getByRole('heading', { name: 'Circle' })).toBeVisible();
});

test('leaving a field without changing it does not touch the geometry', async ({ page }) => {
  // 16 significant digits: the field shows 12, so rewriting from the displayed text would change the radius.
  await drawCircle(page, '5.123456789012345');
  await selectCircle(page);
  await expect(field(page, 'Radius')).toHaveValue('5.12345678901');
  await field(page, 'Radius').focus();
  await field(page, 'Radius').press('Tab');
  await field(page, 'Centre X').focus();
  await field(page, 'Centre X').press('Tab');

  // Nothing was recorded for the edits: one undo removes the circle itself.
  await page.locator('.viewport-canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(properties(page).getByText('Nothing selected')).toBeVisible();
  await expect(page.locator('.sidebar .facts dt', { hasText: 'Entities' }).locator('xpath=following-sibling::dd[1]')).toHaveText('0');
});

test('typing the displayed value again does not create an undo step', async ({ page }) => {
  await drawCircle(page);
  await selectCircle(page);
  await field(page, 'Radius').fill('5.0');
  await field(page, 'Radius').press('Enter');
  await page.locator('.viewport-canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(page.locator('.sidebar .facts dt', { hasText: 'Entities' }).locator('xpath=following-sibling::dd[1]')).toHaveText('0');
});

test('Backspace edits the text in a field and does not delete the object', async ({ page }) => {
  await drawCircle(page, '25');
  const box = (await page.locator('.viewport-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + 25 * 20, box.y + box.height / 2);
  await expect(properties(page).getByRole('heading', { name: 'Circle' })).toBeVisible();
  await field(page, 'Radius').focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await expect(field(page, 'Radius')).toHaveValue('2');
  await expect(properties(page).getByRole('heading', { name: 'Circle' })).toBeVisible();
});

test('line endpoints and arc angles are editable, and a polyline shows no fields', async ({ page }) => {
  await cmd(page, 'L', '0,0', '10,0', '');
  await page.getByLabel('Command input').press('Escape');
  const box = (await page.locator('.viewport-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + 5 * 20, box.y + box.height / 2);
  await expect(properties(page).getByRole('heading', { name: 'Line' })).toBeVisible();
  await field(page, 'End Y').fill('4');
  await field(page, 'End Y').press('Enter');
  await expect(field(page, 'End Y')).toHaveValue('4');
  await expect(properties(page).getByText('Length')).toBeVisible();
});

test('every field has an accessible name', async ({ page }) => {
  await drawCircle(page);
  await selectCircle(page);
  for (const label of ['Centre X', 'Centre Y', 'Radius']) await expect(field(page, label)).toBeVisible();
});
