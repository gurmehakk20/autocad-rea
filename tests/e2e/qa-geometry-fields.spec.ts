import { expect, test, type Page } from '@playwright/test';

/** QA probes for the geometry fields: a displayed value that rounds a tiny real value to 0. */

const properties = (page: Page) => page.getByRole('region', { name: 'Properties' });
const field = (page: Page, label: string) => properties(page).getByLabel(label, { exact: true });

async function cmd(page: Page, ...texts: string[]): Promise<void> {
  const input = page.getByLabel('Command input');
  for (const text of texts) {
    await input.fill(text);
    await input.press('Enter');
  }
}

test('typing 0 into a field whose real value is 1e-13 (shown as 0) sets it to 0', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.viewport-canvas')).toBeVisible();
  await cmd(page, 'L', '0,0', '10,0.0000000000001', '');
  await page.getByLabel('Command input').press('Escape');
  const box = (await page.locator('.viewport-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + 5 * 20, box.y + box.height / 2);
  await expect(properties(page).getByRole('heading', { name: 'Line' })).toBeVisible();
  await expect(field(page, 'End Y')).toHaveValue('0');
  await field(page, 'End Y').fill('0');
  await field(page, 'End Y').press('Enter');
  // If the edit was applied, one undo reverts it and the line stays. If it was ignored, undo removes the line.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(properties(page).getByRole('heading', { name: 'Line' })).toBeVisible();
});
