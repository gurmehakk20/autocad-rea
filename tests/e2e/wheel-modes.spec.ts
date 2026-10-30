import { expect, test, type Page } from '@playwright/test';

/**
 * Wheel events carry their delta in pixels, lines or pages (`deltaMode` 0, 1, 2). Firefox sends lines for a mouse
 * wheel, Chromium and Safari send pixels, so the line path never ran in the Chromium-only audit. Playwright's own
 * `mouse.wheel` always sends pixels, so these tests dispatch the events themselves.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.viewport-canvas')).toBeVisible();
});

async function zoom(page: Page): Promise<number> {
  const text = await page.locator('.statusbar').innerText();
  return Number(/Zoom\s+([\d.e+-]+)\s*px\/unit/.exec(text)![1]);
}

async function wheel(page: Page, deltaY: number, deltaMode: 0 | 1 | 2): Promise<boolean> {
  return page.evaluate(
    ({ delta, mode }) => {
      const canvas = document.querySelector('.viewport-canvas') as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const event = new WheelEvent('wheel', {
        deltaY: delta,
        deltaMode: mode,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
        cancelable: true,
      });
      canvas.dispatchEvent(event);
      return event.defaultPrevented;
    },
    { delta: deltaY, mode: deltaMode },
  );
}

test('a wheel notch in lines (Firefox) zooms in, and is the same as 16 pixels per line', async ({ page }) => {
  const start = await zoom(page);
  await wheel(page, -3, 1);
  const zoomed = await zoom(page);
  expect(zoomed).toBeGreaterThan(start * 1.05);
  expect(zoomed).toBeLessThan(start * 1.3);

  // 3 lines are 48 pixels. The opposite 48 pixels must undo it exactly.
  await wheel(page, 48, 0);
  expect(await zoom(page)).toBeCloseTo(start, 1);
});

test('lines and pixels give the same zoom for the same distance', async ({ page }) => {
  await wheel(page, -5, 1);
  const byLines = await zoom(page);
  await page.reload();
  await expect(page.locator('.viewport-canvas')).toBeVisible();
  await wheel(page, -80, 0);
  expect(await zoom(page)).toBeCloseTo(byLines, 1);
});

test('a wheel in pages zooms further than the same number of lines, and stays within the clamp', async ({ page }) => {
  const start = await zoom(page);
  await wheel(page, -1, 2);
  const byPage = await zoom(page);
  expect(byPage).toBeGreaterThan(start);
  // However large the delta, one event cannot zoom by more than the clamp allows (a factor well under 10).
  expect(byPage).toBeLessThan(start * 10);
});

test('the page does not scroll or zoom the browser for a wheel over the canvas', async ({ page }) => {
  expect(await wheel(page, -3, 1)).toBe(true);
  expect(await wheel(page, 100, 0)).toBe(true);
});

test('zooming in by lines and out by lines returns to the same zoom', async ({ page }) => {
  const start = await zoom(page);
  for (let i = 0; i < 6; i++) await wheel(page, -2, 1);
  // 6 events of 2 lines (32 px each) are 192 px, which is about a third more zoom.
  const zoomedIn = await zoom(page);
  expect(zoomedIn).toBeGreaterThan(start * 1.25);
  expect(zoomedIn).toBeLessThan(start * 1.5);
  for (let i = 0; i < 6; i++) await wheel(page, 2, 1);
  expect(await zoom(page)).toBeCloseTo(start, 0);
});
