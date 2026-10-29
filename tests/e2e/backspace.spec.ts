import { expect, test } from '@playwright/test';

/**
 * The shortcut handler cancels Backspace on controls that do not take text (dropdowns, checkboxes), because WebKit
 * navigates back there. These tests check it still edits text in every field that does take text.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.viewport-canvas')).toBeVisible();
});

test('Backspace edits the command line', async ({ page }) => {
  const input = page.getByLabel('Command input');
  await input.click();
  await page.keyboard.type('12,34');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect(input).toHaveValue('12,');
  await page.keyboard.press('Control+Backspace');
  await expect(input).not.toHaveValue('12,');
});

test('Backspace edits the new layer name field', async ({ page }) => {
  const field = page.getByLabel('New layer name');
  await field.click();
  await page.keyboard.type('Walls');
  await page.keyboard.press('Backspace');
  await expect(field).toHaveValue('Wall');
});

test('Backspace edits the layer rename field', async ({ page }) => {
  const field = page.getByLabel('New layer name');
  await field.fill('Walls');
  await field.press('Enter');
  await page.getByRole('button', { name: /Walls/ }).first().dblclick();
  const rename = page.getByLabel('Rename layer Walls');
  await expect(rename).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await expect(rename).toHaveValue('Wall');
});

test('Backspace edits the grid spacing number field', async ({ page }) => {
  const spacing = page.getByLabel('Grid spacing');
  await spacing.click();
  await spacing.fill('125');
  await page.keyboard.press('Backspace');
  await expect(spacing).toHaveValue('12');
});

test('Backspace in a text field never deletes the selected entity', async ({ page }) => {
  const input = page.getByLabel('Command input');
  await input.fill('L');
  await input.press('Enter');
  await input.fill('-5,0');
  await input.press('Enter');
  await input.fill('5,0');
  await input.press('Enter');
  await input.press('Escape');
  await page.keyboard.press('Control+a');
  await input.click();
  await page.keyboard.type('x');
  await page.keyboard.press('Backspace');
  await expect(input).toHaveValue('');
  await expect(page.locator('.properties, [aria-label="Properties"]').first()).toContainText(/Line|Selection|1/);
});
