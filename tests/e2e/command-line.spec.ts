import { expect, test, type Page } from '@playwright/test';

/** Command-line recall (Up and Down) and Tab completion, in a real browser. */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.viewport-canvas')).toBeVisible();
});

const input = (page: Page) => page.getByLabel('Command input');
const log = (page: Page) => page.locator('.command-history');

/**
 * Presses Tab (or Shift+Tab) in the field and reports whether the page cancelled it. Where Tab is not cancelled the
 * browser moves focus on. Asserting that, not where focus lands, works in every engine: the command field is the last
 * tab stop on the page and Firefox keeps focus on it when there is nowhere further to go.
 */
async function tabWasCancelled(page: Page, text: string, shift = false): Promise<boolean> {
  await input(page).fill(text);
  await page.evaluate(() => {
    const w = window as unknown as { tabCancelled?: boolean };
    w.tabCancelled = undefined;
    window.addEventListener('keydown', (e) => { if (e.key === 'Tab') setTimeout(() => (w.tabCancelled = e.defaultPrevented), 0); });
  });
  await input(page).press(shift ? 'Shift+Tab' : 'Tab');
  await expect.poll(() => page.evaluate(() => (window as unknown as { tabCancelled?: boolean }).tabCancelled)).not.toBeUndefined();
  return page.evaluate(() => (window as unknown as { tabCancelled: boolean }).tabCancelled);
}

async function submit(page: Page, ...texts: string[]): Promise<void> {
  for (const text of texts) {
    await input(page).fill(text);
    await input(page).press('Enter');
  }
}

test.describe('command history', () => {
  test('Up recalls earlier input newest first and Down walks forward to the unsent text', async ({ page }) => {
    await submit(page, 'L', '0,0', '5,5');
    await input(page).fill('half');
    await input(page).press('ArrowUp');
    await expect(input(page)).toHaveValue('5,5');
    await input(page).press('ArrowUp');
    await expect(input(page)).toHaveValue('0,0');
    await input(page).press('ArrowDown');
    await expect(input(page)).toHaveValue('5,5');
    await input(page).press('ArrowDown');
    await expect(input(page)).toHaveValue('half');
  });

  test('a recalled command can be sent again', async ({ page }) => {
    await submit(page, 'GRID');
    await input(page).press('ArrowUp');
    await expect(input(page)).toHaveValue('GRID');
    await input(page).press('Enter');
    await expect(input(page)).toHaveValue('');
    // Two GRID commands were recorded as submitted lines.
    await expect(log(page).locator('.command-line-entry', { hasText: '> GRID' })).toHaveCount(2);
  });

  test('Up with nothing to recall leaves the text alone', async ({ page }) => {
    await input(page).fill('abc');
    await input(page).press('ArrowUp');
    await expect(input(page)).toHaveValue('abc');
  });

  test('Escape clears the field and ends recall', async ({ page }) => {
    await submit(page, 'one', 'two');
    await input(page).press('ArrowUp');
    await input(page).press('Escape');
    await expect(input(page)).toHaveValue('');
    await input(page).press('ArrowUp');
    await expect(input(page)).toHaveValue('two');
  });
});

test.describe('Tab completion', () => {
  test('completes a unique prefix and stays in the field', async ({ page }) => {
    await input(page).fill('cir');
    await input(page).press('Tab');
    await expect(input(page)).toHaveValue('CIRCLE');
    await expect(input(page)).toBeFocused();
  });

  test('lists the candidates when several commands match, and a second Tab is left to the browser', async ({ page }) => {
    await input(page).fill('re');
    await input(page).press('Tab');
    await expect(input(page)).toHaveValue('RE');
    await expect(log(page)).toContainText('RECTANGLE  REDO');
    await expect(input(page)).toBeFocused();
    // The text cannot grow, so a second Tab must not be cancelled or Tab would never leave the field.
    expect(await tabWasCancelled(page, 'RE')).toBe(false);
  });

  test('Tab from an empty field is left to the browser, so the field is not a keyboard trap', async ({ page }) => {
    expect(await tabWasCancelled(page, '')).toBe(false);
  });

  test('Tab after a coordinate, a finished command or an unknown word is left to the browser', async ({ page }) => {
    for (const text of ['3,4', '@5<30', 'LINE', 'nonsense']) {
      expect(await tabWasCancelled(page, text), `Tab after "${text}"`).toBe(false);
    }
  });

  test('Tab that completes a command is the only Tab the page cancels', async ({ page }) => {
    expect(await tabWasCancelled(page, 'cir')).toBe(true);
  });

  test('Shift+Tab is never cancelled and leaves the text alone', async ({ page }) => {
    expect(await tabWasCancelled(page, 'cir', true)).toBe(false);
    await expect(input(page)).toHaveValue('cir');
  });

  test('a completed command runs when sent', async ({ page }) => {
    await input(page).fill('cir');
    await input(page).press('Tab');
    await input(page).press('Enter');
    await expect(page.getByRole('button', { name: /Circle/ }).first()).toHaveAttribute('aria-pressed', 'true');
  });
});
