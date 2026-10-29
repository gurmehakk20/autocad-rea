import { describe, expect, it } from 'vitest';
import { fitBounds, MAX_ZOOM, MIN_ZOOM, panByPixels, screenToWorld, worldToScreen, zoomAtPixel, type Camera } from '../../src/viewport/camera';
import { parseInput } from '../../src/state/input-parse';
import { vec2 } from '../../src/core/geometry/vector';

const size = { width: 800, height: 600 };
const cam: Camera = { cx: 10, cy: -5, zoom: 20 };

describe('camera transforms', () => {
  it('maps the viewport centre to the camera centre', () => {
    expect(screenToWorld(cam, size, 400, 300)).toEqual({ x: 10, y: -5 });
    expect(worldToScreen(cam, size, 10, -5)).toEqual({ x: 400, y: 300 });
  });

  it('has Y pointing up in world space and down on screen', () => {
    const up = screenToWorld(cam, size, 400, 200);
    expect(up.y).toBeGreaterThan(cam.cy);
    expect(worldToScreen(cam, size, 10, -4).y).toBeLessThan(300);
  });

  it('round-trips screen and world coordinates across zoom levels', () => {
    for (const zoom of [1e-3, 0.5, 20, 5000]) {
      const c = { ...cam, zoom };
      const w = screenToWorld(c, size, 123.25, 456.5);
      const s = worldToScreen(c, size, w.x, w.y);
      expect(s.x).toBeCloseTo(123.25, 6);
      expect(s.y).toBeCloseTo(456.5, 6);
    }
  });

  it('keeps the world point under the cursor fixed while zooming', () => {
    const anchorPx = { x: 150, y: 480 };
    const before = screenToWorld(cam, size, anchorPx.x, anchorPx.y);
    const after = zoomAtPixel(cam, size, anchorPx.x, anchorPx.y, 3);
    const still = screenToWorld(after, size, anchorPx.x, anchorPx.y);
    expect(still.x).toBeCloseTo(before.x, 9);
    expect(still.y).toBeCloseTo(before.y, 9);
    expect(after.zoom).toBeCloseTo(60, 9);
  });

  it('clamps zoom to the supported range', () => {
    expect(zoomAtPixel(cam, size, 0, 0, 1e30).zoom).toBe(MAX_ZOOM);
    expect(zoomAtPixel(cam, size, 0, 0, 1e-30).zoom).toBe(MIN_ZOOM);
  });

  it('pans so the drawing follows the pointer', () => {
    const p = panByPixels(cam, 40, 0);
    // Dragging right by 40 px moves the view left in world units by 2.
    expect(p.cx).toBeCloseTo(8, 12);
    const w = screenToWorld(p, size, 440, 300);
    expect(w.x).toBeCloseTo(10, 12);
  });

  it('fits bounds with margin and centres them', () => {
    const f = fitBounds({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, size, 50);
    expect(f.cx).toBe(50);
    expect(f.cy).toBe(25);
    expect(f.zoom).toBeCloseTo(Math.min(700 / 100, 500 / 50), 12);
  });

  it('handles very large and very small coordinates', () => {
    const big = { cx: 1e9, cy: -1e9, zoom: 1e-4 };
    const w = screenToWorld(big, size, 0, 0);
    expect(Number.isFinite(w.x) && Number.isFinite(w.y)).toBe(true);
    expect(worldToScreen(big, size, 1e9, -1e9)).toEqual({ x: 400, y: 300 });
  });
});

describe('command-line input', () => {
  it('parses absolute coordinates', () => {
    expect(parseInput('12.5, -3', null)).toEqual({ kind: 'point', point: vec2(12.5, -3) });
  });

  it('parses relative coordinates from the base point', () => {
    expect(parseInput('@10,5', vec2(100, 100))).toEqual({ kind: 'point', point: vec2(110, 105) });
    expect(parseInput('@10,5', null)).toEqual({ kind: 'point', point: vec2(10, 5) });
  });

  it('parses polar offsets with angles in degrees', () => {
    const r = parseInput('@10<90', vec2(0, 0));
    expect(r.kind).toBe('point');
    if (r.kind !== 'point') return;
    expect(r.point.x).toBeCloseTo(0, 12);
    expect(r.point.y).toBeCloseTo(10, 12);
  });

  it('parses plain numbers, including negatives and exponents', () => {
    expect(parseInput('42', null)).toEqual({ kind: 'number', value: 42 });
    expect(parseInput('-0.5', null)).toEqual({ kind: 'number', value: -0.5 });
    expect(parseInput('1e3', null)).toEqual({ kind: 'number', value: 1000 });
  });

  it('treats letters as command names in upper case', () => {
    expect(parseInput(' line ', null)).toEqual({ kind: 'text', text: 'LINE' });
  });

  it('reports malformed coordinates instead of guessing', () => {
    expect(parseInput('1,2,3', null).kind).toBe('invalid');
    expect(parseInput('@,5', null).kind).toBe('invalid');
  });

  it('treats empty input as confirm', () => {
    expect(parseInput('   ', null)).toEqual({ kind: 'empty' });
  });

  // Regression: "1e999" matches the number pattern but reads as Infinity. A rotate by that angle built a NaN matrix and
  // threw an uncaught error out of the session. The parser now refuses non-finite values once, at the boundary.
  it('refuses numbers and points that overflow to Infinity', () => {
    for (const text of ['1e999', '-1e999', '1e999,0', '0,-1e999', '@1e999,0', '@1e999<45', '@10<1e999']) {
      const result = parseInput(text, vec2(0, 0));
      expect(result.kind, text).toBe('invalid');
      expect(result.kind === 'invalid' && result.reason, text).toMatch(/finite/);
    }
  });

  it('still accepts large but finite values', () => {
    expect(parseInput('1e300', null)).toEqual({ kind: 'number', value: 1e300 });
    expect(parseInput('1e300,-1e300', null)).toEqual({ kind: 'point', point: vec2(1e300, -1e300) });
  });
});
