import { expect, type Page } from '@playwright/test';

/**
 * Makes the page behave like Firefox and Safari: no File System Access API. Open then goes through
 * `<input type="file">` and Save and Export download. Chromium has the API, so without this its Open and Save
 * would use native dialogs that Playwright cannot drive. Tests of the in-place path stand in their own pickers
 * (see `file-save.spec.ts`); the older tests here exercise the fallback.
 */
export async function forceDownloadFallback(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker;
    delete w.showOpenFilePicker;
  });
}

/** The geometry field with this label in the Properties panel. */
export const geometryField = (page: Page, label: string) =>
  page.getByRole('region', { name: 'Properties' }).getByLabel(label, { exact: true });

/**
 * Waits for a geometry field to hold `value`, to the four decimals the old read-only display showed. Clicks land on
 * pixels, so a value such as 5 can arrive as 4.99999999999 and must still count as 5.
 */
export async function expectField(page: Page, label: string, value: number): Promise<void> {
  const field = geometryField(page, label);
  await expect(field, label).toBeVisible();
  await expect.poll(async () => Number(await field.inputValue()), { message: `${label} should be ${value}` }).toBeCloseTo(value, 4);
}
