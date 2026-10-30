import { expect, test, type Page } from '@playwright/test';

/**
 * 50,000 entities in a real browser. This is a measurement with a loose safety bound, not a speed claim: it records
 * how much a pointer-move frame costs once the drawing is that large, fitted so that every entity is on screen. A
 * fit-all view draws everything, so the spatial index cannot help the renderer there. These numbers say whether
 * rendering is the next bottleneck.
 */

function bigDxf(count: number): string {
  const side = Math.ceil(Math.sqrt(count));
  const out: string[] = ['0', 'SECTION', '2', 'ENTITIES'];
  for (let i = 0; i < count; i++) {
    const x = (i % side) * 3;
    const y = Math.floor(i / side) * 3;
    if (i % 2 === 0) out.push('0', 'LINE', '8', '0', '10', String(x), '20', String(y), '11', String(x + 2), '21', String(y + 1));
    else out.push('0', 'CIRCLE', '8', '0', '10', String(x + 1), '20', String(y + 1), '40', '0.8');
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n');
}

async function pointerFrameMs(page: Page, steps = 60): Promise<number> {
  return page.evaluate(async (n) => {
    const canvas = document.querySelector('.viewport-canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await nextFrame();
    const start = performance.now();
    for (let i = 0; i < n; i++) {
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: rect.left + (rect.width * (i + 1)) / (n + 1),
          clientY: rect.top + rect.height / 2 + Math.sin(i / 7) * 80,
        }),
      );
      await nextFrame();
    }
    return (performance.now() - start) / n;
  }, steps);
}

test('a 50,000-entity drawing loads, fits on screen, and stays editable', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await expect(page.locator('.viewport-canvas')).toBeVisible();
  const emptyMs = await pointerFrameMs(page);

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import DXF' }).click();
  await (await chooser).setFiles({ name: 'big.dxf', mimeType: 'application/dxf', buffer: Buffer.from(bigDxf(50_000)) });
  await expect(page.locator('.command-history')).toContainText('Imported 50000 entities', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Zoom extents' }).click();

  // Fit-all: every entity is on screen and drawn.
  const fitMs = await pointerFrameMs(page);

  // Zoomed in to a small area: the index lets the renderer skip almost everything.
  const box = (await page.locator('.viewport-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -300);
  const zoomedMs = await pointerFrameMs(page);

  const note = `50,000 entities: ${fitMs.toFixed(1)} ms per frame fitted, ${zoomedMs.toFixed(1)} ms zoomed in, ${emptyMs.toFixed(1)} ms empty`;
  test.info().annotations.push({ type: 'perf', description: note });
  console.log(`[scale-50k] ${note}`);

  // Loose bound: only a collapse of interaction fails this. The numbers above are the finding.
  expect(zoomedMs - emptyMs, 'zoomed in, the index keeps the cost small').toBeLessThan(150);
  expect(fitMs - emptyMs, 'fitted, every entity is drawn').toBeLessThan(2000);

  // Still editable at this size: select everything, delete it, bring it back.
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await expect(page.locator('.sidebar .facts dt', { hasText: 'Entities' }).locator('xpath=following-sibling::dd[1]')).toHaveText('0', { timeout: 30_000 });
  await page.keyboard.press('Control+z');
  await expect(page.locator('.sidebar .facts dt', { hasText: 'Entities' }).locator('xpath=following-sibling::dd[1]')).toHaveText('50000', { timeout: 30_000 });
});
