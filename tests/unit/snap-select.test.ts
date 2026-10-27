import { describe, expect, it } from 'vitest';
import { Drawing } from '../../src/core/document/Drawing';
import type { CircleEntity, Entity, LineEntity, PolylineEntity } from '../../src/core/entities/types';
import { constrainOrtho, DEFAULT_SNAP_SETTINGS, findSnap, snapToGrid, type SnapSettings } from '../../src/core/snapping/snap';
import { Selection, pickEntity, selectByRectangle } from '../../src/core/selection/selection';
import { vec2 } from '../../src/core/geometry/vector';

function drawingWith(entities: Entity[], layers?: Array<{ name: string; visible?: boolean; locked?: boolean }>): Drawing {
  const d = new Drawing();
  for (const l of layers ?? []) {
    d.apply({ kind: 'put-layer', layer: { name: l.name, color: '#e6e6e6', visible: l.visible ?? true, locked: l.locked ?? false } });
  }
  for (const e of entities) d.apply({ kind: 'insert', entity: e, index: d.entityCount });
  return d;
}

const line = (id: string, a: [number, number], b: [number, number], layer = '0'): LineEntity => ({
  id,
  type: 'line',
  layer,
  color: null,
  start: vec2(...a),
  end: vec2(...b),
});

const circle = (id: string, c: [number, number], r: number): CircleEntity => ({
  id,
  type: 'circle',
  layer: '0',
  color: null,
  center: vec2(...c),
  radius: r,
});

const SNAP_ON: SnapSettings = { ...DEFAULT_SNAP_SETTINGS, grid: false };
const NO_SNAP: SnapSettings = { ...DEFAULT_SNAP_SETTINGS, objectSnap: false, grid: false, ortho: false };

describe('object snapping', () => {
  const d = drawingWith([line('a', [0, 0], [10, 0])]);

  it('snaps to an endpoint within tolerance', () => {
    const r = findSnap({ drawing: d, cursor: vec2(0.2, -0.2), tolerance: 0.5, settings: SNAP_ON });
    expect(r.kind).toBe('endpoint');
    expect(r.point).toEqual({ x: 0, y: 0 });
  });

  it('snaps to the midpoint', () => {
    const r = findSnap({ drawing: d, cursor: vec2(5.1, 0.1), tolerance: 0.5, settings: SNAP_ON });
    expect(r).toMatchObject({ kind: 'midpoint', point: { x: 5, y: 0 } });
  });

  it('does not snap when the cursor is outside tolerance', () => {
    const r = findSnap({ drawing: d, cursor: vec2(3, 3), tolerance: 0.5, settings: SNAP_ON });
    expect(r.kind).toBe('none');
    expect(r.point).toEqual({ x: 3, y: 3 });
  });

  it('computes intersections between entities, not just visual proximity', () => {
    const cross = drawingWith([line('a', [0, 0], [10, 10]), line('b', [0, 10], [10, 0])]);
    const r = findSnap({ drawing: cross, cursor: vec2(5.05, 4.97), tolerance: 0.5, settings: SNAP_ON });
    expect(r.kind).toBe('intersection');
    expect(Math.abs(r.point.x - 5)).toBeLessThan(1e-9);
    expect(Math.abs(r.point.y - 5)).toBeLessThan(1e-9);
  });

  it('prefers endpoints over intersections and midpoints when both are in range', () => {
    const d2 = drawingWith([line('a', [0, 0], [10, 0]), line('b', [0, 0], [0, 10])]);
    // (0,0) is an endpoint of both lines and also their intersection.
    const r = findSnap({ drawing: d2, cursor: vec2(0.1, 0.1), tolerance: 0.5, settings: SNAP_ON });
    expect(r.kind).toBe('endpoint');
  });

  it('snaps to a circle centre', () => {
    const d3 = drawingWith([circle('c', [4, 4], 2)]);
    const r = findSnap({ drawing: d3, cursor: vec2(4.1, 3.95), tolerance: 0.3, settings: SNAP_ON });
    expect(r).toMatchObject({ kind: 'center', point: { x: 4, y: 4 } });
  });

  it('ignores excluded entities, such as the selection being moved', () => {
    const r = findSnap({ drawing: d, cursor: vec2(0, 0), tolerance: 0.5, settings: SNAP_ON, exclude: new Set(['a']) });
    expect(r.kind).toBe('none');
  });

  it('ignores hidden and locked entities', () => {
    const hidden = drawingWith([line('a', [0, 0], [10, 0], 'H')], [{ name: 'H', visible: false }]);
    expect(findSnap({ drawing: hidden, cursor: vec2(0, 0), tolerance: 0.5, settings: SNAP_ON }).kind).toBe('none');
    const locked = drawingWith([line('a', [0, 0], [10, 0], 'L')], [{ name: 'L', locked: true }]);
    expect(findSnap({ drawing: locked, cursor: vec2(0, 0), tolerance: 0.5, settings: SNAP_ON }).kind).toBe('none');
  });
});

describe('grid and ortho', () => {
  it('rounds to the nearest grid point, including negative coordinates', () => {
    expect(snapToGrid(vec2(-6, 14), 10)).toEqual({ x: -10, y: 10 });
    expect(() => snapToGrid(vec2(1, 1), 0)).toThrow(/positive/);
  });

  it('constrains the cursor to the dominant axis from the base point', () => {
    expect(constrainOrtho(vec2(0, 0), vec2(10, 3))).toEqual({ x: 10, y: 0 });
    expect(constrainOrtho(vec2(0, 0), vec2(3, -10))).toEqual({ x: 0, y: -10 });
  });

  it('uses the grid when enabled and no object is near', () => {
    const r = findSnap({ drawing: new Drawing(), cursor: vec2(12, 26), tolerance: 0.5, settings: { ...NO_SNAP, grid: true, gridSize: 10 } });
    expect(r).toEqual({ point: { x: 10, y: 30 }, kind: 'grid' });
  });

  it('keeps an object snap in preference to grid and ortho', () => {
    const d = drawingWith([line('a', [0, 0], [10, 0])]);
    const r = findSnap({
      drawing: d,
      cursor: vec2(0.1, 0.1),
      tolerance: 0.5,
      settings: { ...SNAP_ON, grid: true, ortho: true, gridSize: 10 },
      base: vec2(5, 5),
    });
    expect(r.kind).toBe('endpoint');
  });

  it('applies ortho to the raw cursor when no object snap applies', () => {
    const r = findSnap({
      drawing: new Drawing(),
      cursor: vec2(9, 2),
      tolerance: 0.5,
      settings: { ...NO_SNAP, ortho: true },
      base: vec2(0, 0),
    });
    expect(r.point).toEqual({ x: 9, y: 0 });
  });
});

describe('selection', () => {
  const d = drawingWith([
    line('inside', [2, 2], [4, 4]),
    line('crossing', [-5, 5], [5, 5]),
    line('outside', [20, 20], [30, 30]),
  ]);

  it('picks the topmost entity within tolerance', () => {
    const d2 = drawingWith([line('bottom', [0, 0], [10, 0]), line('top', [0, 0], [10, 0])]);
    expect(pickEntity(d2, vec2(5, 0.1), 0.5)?.id).toBe('top');
    expect(pickEntity(d, vec2(100, 100), 0.5)).toBeUndefined();
  });

  it('window selection takes only entities fully inside the rectangle', () => {
    expect(selectByRectangle(d, vec2(0, 0), vec2(10, 10), 'window')).toEqual(['inside']);
  });

  it('crossing selection also takes entities that only touch the rectangle', () => {
    expect(selectByRectangle(d, vec2(0, 0), vec2(10, 10), 'crossing').sort()).toEqual(['crossing', 'inside']);
  });

  it('normalises reversed rectangle corners', () => {
    expect(selectByRectangle(d, vec2(10, 10), vec2(0, 0), 'window')).toEqual(['inside']);
  });

  it('crossing selection catches a circle whose outline passes through the window', () => {
    const cd = drawingWith([circle('c', [0, 0], 5)]);
    expect(selectByRectangle(cd, vec2(4, -1), vec2(10, 1), 'crossing')).toEqual(['c']);
    expect(selectByRectangle(cd, vec2(-1, -1), vec2(1, 1), 'crossing')).toEqual([]);
  });

  it('never selects hidden or locked entities', () => {
    const hd = drawingWith([line('a', [2, 2], [4, 4], 'H')], [{ name: 'H', visible: false }]);
    expect(selectByRectangle(hd, vec2(0, 0), vec2(10, 10), 'window')).toEqual([]);
  });

  it('prunes selected ids that are no longer editable', () => {
    const sel = new Selection();
    sel.replace(['inside', 'outside']);
    const hiddenDrawing = drawingWith([line('inside', [2, 2], [4, 4], 'H')], [{ name: 'H', visible: false }]);
    sel.prune(hiddenDrawing);
    expect(sel.toArray()).toEqual([]);
  });

  it('keeps polyline segments pickable at every segment', () => {
    const poly: PolylineEntity = {
      id: 'p',
      type: 'polyline',
      layer: '0',
      color: null,
      closed: true,
      vertices: [vec2(0, 0), vec2(10, 0), vec2(10, 10), vec2(0, 10)],
    };
    const pd = drawingWith([poly]);
    expect(pickEntity(pd, vec2(0, 5), 0.1)?.id).toBe('p'); // closing segment
    expect(pickEntity(pd, vec2(5, 5), 0.1)).toBeUndefined();
  });
});
