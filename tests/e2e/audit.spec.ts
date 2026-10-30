import { expect, test, type Page } from '@playwright/test';
import { expectField, forceDownloadFallback, geometryField } from './helpers';

/**
 * Platform audit suite. Each test states what a user should be able to rely on.
 * A failure here is a defect to analyse, not a test to weaken.
 */

const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto('/');
  await expect(page.locator('.viewport-canvas')).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? [], 'browser console and page errors').toEqual([]);
});

// ---- helpers ---------------------------------------------------------------

/** Types each text into the command line and presses Enter. */
async function cmd(page: Page, ...texts: string[]): Promise<void> {
  const input = page.getByLabel('Command input');
  for (const text of texts) {
    await input.fill(text);
    await input.press('Enter');
  }
}

/** Canvas pixel for a world point, valid while the camera is at its default (origin centred, 20 px per unit). */
async function px(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('.viewport-canvas').boundingBox();
  if (!box) throw new Error('Canvas not visible');
  return { x: box.x + box.width / 2 + x * 20, y: box.y + box.height / 2 - y * 20 };
}

async function clickWorld(page: Page, x: number, y: number): Promise<void> {
  const p = await px(page, x, y);
  await page.mouse.click(p.x, p.y);
}

async function dragWorld(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const a = await px(page, ...from);
  const b = await px(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

/** Times real pointer-move handling plus the next painted frame, 120 times across the canvas. */
async function pointerFrameMs(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const canvas = document.querySelector('.viewport-canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await nextFrame();
    const start = performance.now();
    const steps = 120;
    for (let i = 0; i < steps; i++) {
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: rect.left + (rect.width * (i + 1)) / (steps + 1),
          clientY: rect.top + rect.height / 2 + Math.sin(i / 7) * 80,
        }),
      );
      await nextFrame();
    }
    return (performance.now() - start) / steps;
  });
}

async function entityCount(page: Page): Promise<number> {
  const dd = page.locator('.sidebar .facts dt', { hasText: 'Entities' }).locator('xpath=following-sibling::dd[1]');
  return Number(await dd.innerText());
}

const properties = (page: Page) => page.getByRole('region', { name: 'Properties' });
const log = (page: Page) => page.locator('.command-history');
const layerRow = (page: Page, name: string) => page.locator('.layer-row').filter({ hasText: name });

/** Draws a line with typed coordinates and returns to the Select tool. */
async function drawLine(page: Page, a: string, b: string): Promise<void> {
  await cmd(page, 'L', a, b, '');
}

async function selectAtCentre(page: Page): Promise<void> {
  await clickWorld(page, 0, 0);
  await expect(properties(page).getByRole('heading', { name: 'Line' })).toBeVisible();
}

async function statusX(page: Page): Promise<string> {
  return (await page.locator('.statusbar .mono').first().innerText()).trim();
}

// ---- viewport ----------------------------------------------------------------

test.describe('viewport', () => {
  test('wheel zoom updates the zoom readout in the status bar', async ({ page }) => {
    const before = await page.locator('.statusbar').innerText();
    expect(before).toContain('Zoom 20.0');
    const c = await px(page, 0, 0);
    await page.mouse.move(c.x, c.y);
    await page.mouse.wheel(0, -300);
    await expect(page.locator('.statusbar')).not.toContainText('Zoom 20.0');
  });

  test('a trackpad-sized wheel delta zooms by a small amount, not a fixed jump', async ({ page }) => {
    const c = await px(page, 0, 0);
    await page.mouse.move(c.x, c.y);
    await page.mouse.wheel(0, -4);
    const text = await page.locator('.statusbar').innerText();
    const zoom = Number(/Zoom ([\d.e+-]+)/.exec(text)?.[1]);
    expect(zoom).toBeGreaterThan(20);
    expect(zoom).toBeLessThan(20.5);
  });

  test('middle-button drag pans the view by the dragged distance', async ({ page }) => {
    const c = await px(page, 0, 0);
    await page.mouse.move(c.x, c.y);
    const before = Number(await statusX(page));
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(c.x + 100, c.y, { steps: 5 });
    await page.mouse.up({ button: 'middle' });
    await page.mouse.move(c.x, c.y);
    const after = Number(await statusX(page));
    // Dragging right by 100 px at 20 px/unit moves the content right, so the point under the cursor moves left by 5 units.
    expect(before - after).toBeCloseTo(5, 1);
  });

  test('Space + drag pans, and releasing Space after the window loses focus does not leave panning stuck', async ({ page }) => {
    const c = await px(page, 0, 0);
    await page.mouse.move(c.x, c.y);
    await page.keyboard.down('Space');
    await page.mouse.down();
    await page.mouse.move(c.x + 60, c.y, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    await page.mouse.move(c.x, c.y);
    expect(Number(await statusX(page))).toBeCloseTo(-3, 1);
    // Panning must not have created any geometry.
    expect(await entityCount(page)).toBe(0);
  });

  test('losing window focus while Space is held cancels the pan modifier', async ({ page }) => {
    await page.keyboard.down('Space');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.keyboard.up('Space');
    await cmd(page, 'L');
    const a = await px(page, -3, 0);
    const b = await px(page, 3, 0);
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    expect(await entityCount(page)).toBe(1);
  });

  test('cursor readout clears when the pointer leaves the canvas', async ({ page }) => {
    const c = await px(page, 0, 0);
    await page.mouse.move(c.x, c.y);
    expect(await statusX(page)).not.toBe('—');
    await page.mouse.move(20, 400); // over the tool palette
    await expect.poll(() => statusX(page)).toBe('—');
  });

  // Pixel check that circles render where expected and nothing joins them. Canvas joins the end of one sub-path to
  // the start of the next arc in the same path, so this catches any future change that shares one path between entities.
  test('neighbouring circles are drawn without a stray line between them', async ({ page }) => {
    await cmd(page, 'C', '-10,0', '2', 'C', '10,0', '2');
    await page.mouse.move(20, 400); // keep the crosshair off the canvas
    const brightness = await page.evaluate(() => {
      const canvas = document.querySelector('.viewport-canvas') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const rect = canvas.getBoundingClientRect();
      const dpr = canvas.width / rect.width;
      const brightest = (worldX: number): number => {
        const x = Math.round((rect.width / 2 + worldX * 20) * dpr);
        const y = Math.round((rect.height / 2) * dpr);
        const data = ctx.getImageData(x - 4, y - 4, 9, 9).data;
        let max = 0;
        for (let i = 0; i < data.length; i += 4) max = Math.max(max, data[i]!);
        return max;
      };
      return { onCircle: brightest(-8), between: brightest(0) };
    });
    expect(brightness.onCircle, 'the circle itself is drawn').toBeGreaterThan(150);
    expect(brightness.between, 'nothing is drawn between the circles').toBeLessThan(120);
  });

  test('canvas backing store matches the device pixel ratio', async ({ browser }) => {
    const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto('http://localhost:5173/');
    const sizes = await page.locator('.viewport-canvas').evaluate((c: HTMLCanvasElement) => ({
      backing: c.width,
      css: c.getBoundingClientRect().width,
    }));
    expect(Math.abs(sizes.backing - sizes.css * 2)).toBeLessThanOrEqual(2);
    await context.close();
  });

  for (const size of [
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
  ]) {
    test(`layout fits a ${size.width}x${size.height} laptop screen without horizontal scroll`, async ({ page }) => {
      await page.setViewportSize(size);
      const m = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        canvasHeight: document.querySelector('.viewport-canvas')!.getBoundingClientRect().height,
      }));
      expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth);
      expect(m.canvasHeight).toBeGreaterThan(300);
    });
  }
});

// ---- selection and editing -------------------------------------------------------

test.describe('selection and editing', () => {
  test('window selection picks fully enclosed lines only, crossing picks touching lines', async ({ page }) => {
    await drawLine(page, '-5,0', '5,0');
    await drawLine(page, '-5,6', '5,6');
    await dragWorld(page, [-6, -1], [6, 1]); // window around the first line only
    await expect(properties(page).getByRole('heading', { name: 'Line' })).toBeVisible();
    await page.keyboard.press('Escape');
    await dragWorld(page, [2, 8], [-2, -2]); // right to left: crosses both lines
    await expect(properties(page).getByRole('heading', { name: '2 objects' })).toBeVisible();
  });

  test('move relocates the selected line and one undo restores it', async ({ page }) => {
    await drawLine(page, '-5,0', '5,0');
    await selectAtCentre(page);
    await page.keyboard.press('m');
    await clickWorld(page, 0, 0);
    await clickWorld(page, 0, 10);
    await expectField(page, 'Start X', -5);
    await expectField(page, 'Start Y', 10);
    await page.keyboard.press('Control+z');
    await expectField(page, 'Start X', -5);
    await expectField(page, 'Start Y', 0);
  });

  test('copy leaves the original and Enter finishes repeated copies', async ({ page }) => {
    await drawLine(page, '-5,0', '5,0');
    await selectAtCentre(page);
    await page.keyboard.press('o');
    await clickWorld(page, 0, 0);
    await clickWorld(page, 0, 4);
    await clickWorld(page, 0, 8);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    expect(await entityCount(page)).toBe(3);
  });

  test('rotate with a typed angle turns the line about the base point', async ({ page }) => {
    await drawLine(page, '-5,0', '5,0');
    await selectAtCentre(page);
    await page.keyboard.press('t');
    // Typed, not clicked: Firefox and WebKit truncate pointer coordinates to whole pixels, so a click lands up to
    // half a pixel (0.025 units at 20 px per unit) from the intended point. The line being rotated is excluded from snapping.
    await cmd(page, '0,0');
    await cmd(page, '90');
    await expectField(page, 'Start X', 0);
    await expectField(page, 'Start Y', -5);
    await expectField(page, 'End X', 0);
    await expectField(page, 'End Y', 5);
  });

  test('Delete removes the selection and one undo restores it', async ({ page }) => {
    await drawLine(page, '-5,0', '5,0');
    await selectAtCentre(page);
    await page.keyboard.press('Delete');
    expect(await entityCount(page)).toBe(0);
    await page.keyboard.press('Control+z');
    expect(await entityCount(page)).toBe(1);
  });

  test('pressing Delete while a dropdown has focus does not delete the selection', async ({ page }) => {
    await drawLine(page, '-5,0', '5,0');
    await selectAtCentre(page);
    await properties(page).getByRole('combobox').focus();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Escape');
    expect(await entityCount(page)).toBe(1);
  });

  test('Backspace on a dropdown or checkbox does not navigate away from the drawing', async ({ page }) => {
    await drawLine(page, '-5,0', '5,0');
    await selectAtCentre(page);
    const url = page.url();
    const controls = [properties(page).getByRole('combobox'), properties(page).getByRole('checkbox', { name: 'By layer' })];
    for (const control of controls) {
      await control.focus();
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(200); // history navigation is asynchronous
      expect(page.url()).toBe(url);
      await expect(properties(page).getByRole('heading', { name: 'Line' })).toBeVisible();
    }
  });

  test('typing a tool letter while a dropdown has focus does not switch tools', async ({ page }) => {
    await drawLine(page, '-5,0', '5,0');
    await selectAtCentre(page);
    await properties(page).getByRole('combobox').focus();
    await page.keyboard.press('c');
    await expect(page.getByRole('button', { name: /Select/ }).first()).toHaveAttribute('aria-pressed', 'true');
  });

  test('Space and Enter on a focused toolbar button activate that button', async ({ page }) => {
    await page.getByRole('button', { name: /Circle/ }).first().focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: /Circle/ }).first()).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: /Arc/ }).first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: /Arc/ }).first()).toHaveAttribute('aria-pressed', 'true');
  });

  test('Escape clears unsent text in the command line and cancels the tool', async ({ page }) => {
    await cmd(page, 'L');
    const input = page.getByLabel('Command input');
    await input.fill('12,');
    await input.press('Escape');
    await expect(input).toHaveValue('');
    await expect(page.getByRole('button', { name: /Select/ }).first()).toHaveAttribute('aria-pressed', 'true');
  });
});

// ---- precision aids ----------------------------------------------------------------

test.describe('precision aids', () => {
  test('ortho (F8) constrains the second point to the dominant axis', async ({ page }) => {
    await page.keyboard.press('F8');
    await cmd(page, 'L');
    await clickWorld(page, 0, 0);
    await clickWorld(page, 5, 1.2);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await clickWorld(page, 2.5, 0);
    // Ortho's guarantee is that the end is level with the start. Firefox and WebKit truncate the base click to a whole
    // pixel, so the start can sit a few hundredths off zero; the line is still exactly horizontal.
    const startY = Number(await geometryField(page, 'Start Y').inputValue());
    expect(Number(await geometryField(page, 'End Y').inputValue())).toBe(startY);
    expect(Math.abs(startY)).toBeLessThan(0.05);
    expect(Number(await geometryField(page, 'End X').inputValue())).toBeCloseTo(5, 1);
  });

  test('grid spacing can be set from the interface and grid snap (F9) uses it', async ({ page }) => {
    await page.getByLabel('Grid spacing').fill('1');
    await page.getByLabel('Grid spacing').press('Enter');
    await page.keyboard.press('Escape');
    await page.keyboard.press('F9');
    await cmd(page, 'L');
    await clickWorld(page, 0.3, 0.2);
    await clickWorld(page, 4.4, 3.6);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await clickWorld(page, 2, 2);
    await expectField(page, 'Start X', 0);
    await expectField(page, 'Start Y', 0);
    await expectField(page, 'End X', 4);
    await expectField(page, 'End Y', 4);
  });

  test('a non-positive grid spacing is rejected with a message', async ({ page }) => {
    const input = page.getByLabel('Grid spacing');
    await input.fill('0');
    await input.press('Enter');
    await expect(log(page)).toContainText('Grid spacing must be positive');
  });

  test('endpoint snap lands exactly on an existing endpoint', async ({ page }) => {
    await drawLine(page, '0,0', '8,0');
    await cmd(page, 'L');
    const p = await px(page, 8, 0);
    await page.mouse.click(p.x + 3, p.y - 3); // a few pixels off the endpoint
    await clickWorld(page, 8, 6);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await clickWorld(page, 8, 3);
    await expectField(page, 'Start X', 8);
    await expectField(page, 'Start Y', 0);
  });
});

// ---- layers ---------------------------------------------------------------------------

test.describe('layers', () => {
  async function addLayer(page: Page, name: string): Promise<void> {
    await page.getByLabel('New layer name').fill(name);
    await page.getByRole('button', { name: 'Add' }).click();
  }

  test('locking the layer of a selected entity clears it from the selection', async ({ page }) => {
    await drawLine(page, '-5,0', '5,0');
    await selectAtCentre(page);
    await layerRow(page, '0').getByRole('button', { name: 'Lock' }).click();
    await expect(properties(page)).toContainText('Nothing selected');
  });

  test('hiding the layer of a selected entity clears it from the selection', async ({ page }) => {
    await drawLine(page, '-5,0', '5,0');
    await selectAtCentre(page);
    await layerRow(page, '0').getByRole('button', { name: 'On' }).click();
    await expect(properties(page)).toContainText('Nothing selected');
  });

  test('drawing on a hidden active layer is refused with a clear message', async ({ page }) => {
    await addLayer(page, 'Ghost');
    await layerRow(page, 'Ghost').getByRole('button', { name: 'On' }).click();
    await drawLine(page, '0,0', '5,0');
    expect(await entityCount(page)).toBe(0);
    await expect(log(page)).toContainText(/hidden/i);
  });

  test('drawing on a locked active layer is refused with a clear message', async ({ page }) => {
    await addLayer(page, 'Fixed');
    await layerRow(page, 'Fixed').getByRole('button', { name: 'Lock' }).click();
    await drawLine(page, '0,0', '5,0');
    expect(await entityCount(page)).toBe(0);
    await expect(log(page)).toContainText(/locked/i);
  });

  test('rename commits on Enter and Escape cancels the rename', async ({ page }) => {
    await addLayer(page, 'Temp');
    await layerRow(page, 'Temp').locator('.layer-select').dblclick();
    await page.getByLabel('Rename layer Temp').fill('Other');
    await page.keyboard.press('Escape');
    await expect(layerRow(page, 'Temp')).toHaveCount(1);
    await expect(layerRow(page, 'Other')).toHaveCount(0);

    await layerRow(page, 'Temp').locator('.layer-select').dblclick();
    await page.getByLabel('Rename layer Temp').fill('Renamed');
    await page.keyboard.press('Enter');
    await expect(layerRow(page, 'Renamed')).toHaveCount(1);
  });

  test('layer names that DXF forbids are rejected', async ({ page }) => {
    await addLayer(page, 'bad<name>');
    await expect(log(page)).toContainText(/cannot contain/i);
    await expect(layerRow(page, 'bad')).toHaveCount(0);
  });

  test('layer names are unique ignoring case, as in DXF', async ({ page }) => {
    await addLayer(page, 'Walls');
    await addLayer(page, 'walls');
    await expect(log(page)).toContainText(/already exists/i);
    await expect(page.locator('.layer-row')).toHaveCount(2);
  });

  test('changing an entity colour in several steps is one undo step', async ({ page }) => {
    await drawLine(page, '-5,0', '5,0');
    await selectAtCentre(page);
    await properties(page).getByLabel('By layer').uncheck();
    const colour = properties(page).getByLabel('Entity colour');
    for (const value of ['#ff0000', '#00ff00', '#0000ff', '#ffff00']) {
      await colour.evaluate((el: HTMLInputElement, v) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
    }
    await page.keyboard.press('Control+z');
    await expect(properties(page).getByLabel('By layer')).toBeChecked();
  });
});

// ---- files -----------------------------------------------------------------------------

test.describe('files', () => {
  // These tests drive the file input and downloads. Chromium would otherwise use its native pickers.
  test.beforeEach(async ({ page }) => {
    await forceDownloadFallback(page);
  });

  async function chooseFile(page: Page, button: string, name: string, content: string): Promise<void> {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: button }).click();
    await (await chooser).setFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content) });
  }

  test('importing a file that is not DXF shows a visible error', async ({ page }) => {
    await chooseFile(page, 'Import DXF', 'bad.dxf', 'hello world');
    await expect(page.getByRole('dialog')).toContainText(/bad\.dxf/);
    await expect(page.getByRole('dialog')).toContainText(/group code|DXF/i);
  });

  test('opening a file that is not a drawing shows a visible error', async ({ page }) => {
    await chooseFile(page, 'Open', 'bad.opendraft.json', 'nope');
    await expect(page.getByRole('dialog')).toContainText(/not valid JSON/);
  });

  test('a saved file whose id counter is behind its entities still allows new drawing', async ({ page }) => {
    const doc = {
      format: 'opendraft-drawing',
      version: 1,
      units: 'mm',
      idSequence: 0,
      layers: [{ name: '0', color: '#e6e6e6', visible: true, locked: false }],
      entities: [{ id: 'e1', type: 'line', layer: '0', color: null, start: { x: 0, y: 0 }, end: { x: 5, y: 0 } }],
    };
    await chooseFile(page, 'Open', 'old.opendraft.json', JSON.stringify(doc));
    await expect(log(page)).toContainText('Opened old.opendraft.json');
    await drawLine(page, '0,3', '5,3');
    expect(await entityCount(page)).toBe(2);
  });

  test('DXF entities with a mirrored extrusion axis import mirrored, as AutoCAD draws them', async ({ page }) => {
    const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'CIRCLE', '8', '0', '10', '10', '20', '0', '40', '2', '210', '0', '220', '0', '230', '-1', '0', 'ENDSEC', '0', 'EOF'].join('\n');
    await chooseFile(page, 'Import DXF', 'mirrored.dxf', dxf);
    await page.keyboard.press('Control+a');
    await expectField(page, 'Centre X', -10);
    await expectField(page, 'Centre Y', 0);
  });

  test('DXF entities on a layer with an empty name import without crashing', async ({ page }) => {
    const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', '', '10', '0', '20', '0', '11', '5', '21', '0', '0', 'ENDSEC', '0', 'EOF'].join('\n');
    await chooseFile(page, 'Import DXF', 'blank-layer.dxf', dxf);
    await expect(log(page)).toContainText('Imported 1 entities');
    expect(await entityCount(page)).toBe(1);
  });

  test('unsaved work prompts before New and can be kept by cancelling', async ({ page }) => {
    await drawLine(page, '0,0', '5,0');
    page.once('dialog', (d) => void d.dismiss());
    await page.getByRole('button', { name: 'New' }).click();
    expect(await entityCount(page)).toBe(1);
  });
});

// ---- scale and accessibility ----------------------------------------------------------

test.describe('scale', () => {
  /** A DXF with a grid of short lines and small circles, laid out over roughly 200 x 200 units. */
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

  test('a 5,000-entity drawing imports, frames, and keeps pointer interaction responsive', async ({ page }) => {
    test.setTimeout(180_000);
    const t0 = Date.now();
    const lap = (label: string) => console.log(`[scale] ${label}: ${Date.now() - t0} ms`);
    const emptyFrameMs = await pointerFrameMs(page);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import DXF' }).click();
    await (await chooser).setFiles({ name: 'big.dxf', mimeType: 'application/dxf', buffer: Buffer.from(bigDxf(5000)) });
    await expect(log(page)).toContainText('Imported 5000 entities', { timeout: 20_000 });
    lap('import done');
    expect(await entityCount(page)).toBe(5000);
    lap('count read');

    await page.getByRole('button', { name: 'Zoom extents' }).click();
    lap('zoom extents');

    const perFrameMs = await pointerFrameMs(page);
    lap('pointer loop done');
    const extraMs = perFrameMs - emptyFrameMs;
    test.info().annotations.push({
      type: 'perf',
      description: `5,000 entities: ${perFrameMs.toFixed(1)} ms per pointer-move frame (${emptyFrameMs.toFixed(1)} ms empty)`,
    });
    // Not a performance claim: a regression guard that fails if the entities make interaction unusable. It bounds
    // the cost the entities add, because an empty canvas already costs 45 ms per frame in Playwright's WebKit.
    expect(extraMs).toBeLessThan(100);

    // The drawing is still editable at this size: select everything and delete it, then undo.
    console.log(`[scale] ${perFrameMs.toFixed(1)} ms per pointer-move frame, ${emptyFrameMs.toFixed(1)} ms with an empty drawing`);
    await page.keyboard.press('Control+a');
    lap('select all');
    await page.keyboard.press('Delete');
    lap('delete');
    expect(await entityCount(page)).toBe(0);
    lap('count after delete');
    await page.keyboard.press('Control+z');
    lap('undo');
    expect(await entityCount(page)).toBe(5000);
  });
});

test.describe('accessibility basics', () => {
  test('every button, field and dropdown has an accessible name', async ({ page }) => {
    await drawLine(page, '-5,0', '5,0');
    await clickWorld(page, 0, 0); // select, so the property controls render too
    const unnamed = await page.evaluate(() => {
      const nameOf = (el: Element): string => {
        const aria = el.getAttribute('aria-label') ?? '';
        const labelledBy = el.getAttribute('aria-labelledby');
        const byId = labelledBy ? (document.getElementById(labelledBy)?.textContent ?? '') : '';
        const labels = 'labels' in el ? Array.from((el as HTMLInputElement).labels ?? []).map((l) => l.textContent ?? '').join(' ') : '';
        return (aria || byId || labels || el.getAttribute('title') || el.textContent || '').trim();
      };
      return Array.from(document.querySelectorAll('button, input, select, textarea'))
        .filter((el) => nameOf(el) === '')
        .map((el) => el.outerHTML.slice(0, 120));
    });
    expect(unnamed).toEqual([]);
  });

  test('the dialog is announced as modal and its Close button takes focus', async ({ page }) => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import DXF' }).click();
    await (await chooser).setFiles({ name: 'bad.dxf', mimeType: 'text/plain', buffer: Buffer.from('nope') });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  });

  test('the dialog can be dismissed with the Escape key', async ({ page }) => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import DXF' }).click();
    await (await chooser).setFiles({ name: 'bad.dxf', mimeType: 'text/plain', buffer: Buffer.from('nope') });
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
