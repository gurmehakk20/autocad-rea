import { describe, expect, it } from 'vitest';
import { Drawing, DrawingError, type Layer } from '../../src/core/document/Drawing';
import { distanceToEntity, entityBounds, intersectEntities, snapCandidatesOf, transformEntity, unionEntityBounds } from '../../src/core/entities/geometry';
import { type Entity, type LineEntity, type CircleEntity, entityValidationError } from '../../src/core/entities/types';
import { History } from '../../src/core/history/History';
import { rotation, translation } from '../../src/core/geometry/transform';
import { vec2 } from '../../src/core/geometry/vector';

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

describe('entity validation', () => {
  it('rejects zero-length lines, bad radii, and degenerate polylines', () => {
    expect(entityValidationError(line('a', [1, 1], [1, 1]))).toMatch(/zero length/);
    expect(entityValidationError(circle('b', [0, 0], 0))).toMatch(/radius/);
    expect(
      entityValidationError({ id: 'c', type: 'polyline', layer: '0', color: null, closed: false, vertices: [vec2(0, 0), vec2(0, 0)] }),
    ).toMatch(/duplicate/);
    expect(
      entityValidationError({ id: 'd', type: 'polyline', layer: '0', color: null, closed: true, vertices: [vec2(0, 0), vec2(1, 0), vec2(0, 0)] }),
    ).toMatch(/repeats/);
  });

  it('rejects arcs with zero sweep or non-finite values', () => {
    expect(entityValidationError({ id: 'e', type: 'arc', layer: '0', color: null, center: vec2(0, 0), radius: 1, startAngle: 0, endAngle: 0 })).toMatch(/sweep/);
    expect(entityValidationError({ id: 'f', type: 'arc', layer: '0', color: null, center: vec2(NaN, 0), radius: 1, startAngle: 0, endAngle: 1 })).toMatch(/centre/);
  });
});

describe('entity geometry', () => {
  it('computes bounds and distance for each type', () => {
    const l = line('a', [0, 0], [10, 0]);
    expect(entityBounds(l)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 0 });
    expect(distanceToEntity(l, vec2(5, 4))).toBeCloseTo(4, 12);
    const c = circle('b', [0, 0], 5);
    expect(distanceToEntity(c, vec2(0, 0))).toBe(5);
  });

  it('lists snap candidates for endpoints, midpoints and centres', () => {
    const kinds = snapCandidatesOf(line('a', [0, 0], [10, 0])).map((c) => c.kind);
    expect(kinds).toEqual(['endpoint', 'endpoint', 'midpoint']);
    expect(snapCandidatesOf(circle('b', [1, 1], 2))).toEqual([{ kind: 'center', point: vec2(1, 1) }]);
  });

  it('finds intersections between a line and a circle within the segment extent', () => {
    const pts = intersectEntities(line('a', [-10, 0], [10, 0]), circle('b', [0, 0], 5));
    expect(pts).toHaveLength(2);
    expect(intersectEntities(line('a', [-1, 0], [1, 0]), circle('b', [0, 0], 5))).toHaveLength(0);
  });

  it('transforms entities by rigid motion and keeps their identity', () => {
    const moved = transformEntity(line('a', [0, 0], [1, 0], 'Walls'), translation(5, 5));
    expect(moved).toMatchObject({ id: 'a', layer: 'Walls', start: { x: 5, y: 5 }, end: { x: 6, y: 5 } });
    const rotated = transformEntity(circle('b', [1, 0], 2), rotation(Math.PI / 2));
    expect(rotated.type === 'circle' && Math.abs(rotated.center.y - 1) < 1e-12).toBe(true);
    expect(() => transformEntity(circle('b', [0, 0], 1), { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 })).toThrow(/rigid/);
  });

  it('rotates an arc by adding the rotation to its angles', () => {
    const arc = transformEntity(
      { id: 'x', type: 'arc', layer: '0', color: null, center: vec2(0, 0), radius: 1, startAngle: 0, endAngle: 1 },
      rotation(0.5),
    );
    expect(arc.type === 'arc' && arc.startAngle).toBeCloseTo(0.5, 12);
    expect(arc.type === 'arc' && arc.endAngle).toBeCloseTo(1.5, 12);
  });

  it('returns combined bounds for an empty and non-empty list', () => {
    expect(unionEntityBounds([])).toBeNull();
    expect(unionEntityBounds([line('a', [0, 0], [1, 1]), circle('b', [5, 5], 1)])).toEqual({ minX: 0, minY: 0, maxX: 6, maxY: 6 });
  });
});

describe('Drawing mutations', () => {
  it('inserts and removes entities, returning the exact inverse', () => {
    const d = new Drawing();
    const l = line(d.nextId(), [0, 0], [1, 1]);
    const undo = d.apply({ kind: 'insert', entity: l, index: 0 });
    expect(d.getEntity(l.id)).toEqual(l);
    d.apply(undo);
    expect(d.getEntity(l.id)).toBeUndefined();
  });

  it('restores entity order when undoing a removal', () => {
    const d = new Drawing();
    const ids = ['a', 'b', 'c'];
    ids.forEach((id, i) => d.apply({ kind: 'insert', entity: line(id, [i, 0], [i, 1]), index: i }));
    const inverse = d.apply({ kind: 'remove', id: 'b' });
    expect(d.entities().map((e) => e.id)).toEqual(['a', 'c']);
    d.apply(inverse);
    expect(d.entities().map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('rejects invalid entities, duplicate ids and unknown layers without changing the drawing', () => {
    const d = new Drawing();
    d.apply({ kind: 'insert', entity: line('a', [0, 0], [1, 0]), index: 0 });
    expect(() => d.apply({ kind: 'insert', entity: line('a', [0, 0], [2, 0]), index: 1 })).toThrow(DrawingError);
    expect(() => d.apply({ kind: 'insert', entity: line('b', [0, 0], [0, 0]), index: 1 })).toThrow(/zero length/);
    expect(() => d.apply({ kind: 'insert', entity: line('c', [0, 0], [1, 0], 'Nope'), index: 1 })).toThrow(/does not exist/);
    expect(d.entityCount).toBe(1);
  });

  it('rolls back a failed batch so no partial change remains', () => {
    const d = new Drawing();
    d.apply({ kind: 'insert', entity: line('a', [0, 0], [1, 0]), index: 0 });
    expect(() =>
      d.apply({
        kind: 'batch',
        mutations: [
          { kind: 'replace', entity: line('a', [5, 5], [6, 5]) },
          { kind: 'remove', id: 'missing' },
        ],
      }),
    ).toThrow(/does not exist/);
    expect(d.getEntity('a')).toMatchObject({ start: { x: 0, y: 0 } });
  });

  it('protects layer 0 and refuses to delete a layer that still has entities', () => {
    const d = new Drawing();
    expect(() => d.apply({ kind: 'delete-layer', name: '0' })).toThrow(/cannot be deleted/);
    const walls: Layer = { name: 'Walls', color: '#ff0000', visible: true, locked: false };
    d.apply({ kind: 'put-layer', layer: walls });
    d.apply({ kind: 'insert', entity: { ...line('a', [0, 0], [1, 0]), layer: 'Walls' }, index: 0 });
    expect(() => d.apply({ kind: 'delete-layer', name: 'Walls' })).toThrow(/still has/);
  });

  it('rejects invalid colours and blank layer names', () => {
    const d = new Drawing();
    expect(() => d.apply({ kind: 'put-layer', layer: { name: 'X', color: 'red', visible: true, locked: false } })).toThrow(/#rrggbb/);
    expect(() => d.apply({ kind: 'put-layer', layer: { name: ' ', color: '#ffffff', visible: true, locked: false } })).toThrow(/empty/);
  });

  it('hides and locks entities through layer state', () => {
    const d = new Drawing();
    d.apply({ kind: 'insert', entity: line('a', [0, 0], [1, 0]), index: 0 });
    expect(d.isEditable(d.getEntity('a') as Entity)).toBe(true);
    d.apply({ kind: 'put-layer', layer: { name: '0', color: '#e6e6e6', visible: true, locked: true } });
    expect(d.isEditable(d.getEntity('a') as Entity)).toBe(false);
  });

  it('never reuses ids, even after deletion', () => {
    const d = new Drawing();
    const first = d.nextId();
    d.apply({ kind: 'insert', entity: line(first, [0, 0], [1, 0]), index: 0 });
    d.apply({ kind: 'remove', id: first });
    expect(d.nextId()).not.toBe(first);
  });
});

describe('History', () => {
  it('undoes and redoes a sequence of commands', () => {
    const d = new Drawing();
    const h = new History(d);
    h.execute({ kind: 'insert', entity: line('a', [0, 0], [1, 0]), index: 0 }, 'Line');
    h.execute({ kind: 'replace', entity: line('a', [0, 0], [2, 0]) }, 'Stretch');
    expect(d.getEntity('a')).toMatchObject({ end: { x: 2 } });

    h.undo();
    expect(d.getEntity('a')).toMatchObject({ end: { x: 1 } });
    h.undo();
    expect(d.entityCount).toBe(0);
    h.redo();
    h.redo();
    expect(d.getEntity('a')).toMatchObject({ end: { x: 2 } });
  });

  it('clears redo history when a new command is recorded', () => {
    const d = new Drawing();
    const h = new History(d);
    h.execute({ kind: 'insert', entity: line('a', [0, 0], [1, 0]), index: 0 }, 'A');
    h.undo();
    expect(h.canRedo).toBe(true);
    h.execute({ kind: 'insert', entity: line('b', [0, 0], [1, 1]), index: 0 }, 'B');
    expect(h.canRedo).toBe(false);
  });

  it('tracks dirty state against the last save point, including undo back to it', () => {
    const d = new Drawing();
    const h = new History(d);
    expect(h.isDirty).toBe(false);
    h.execute({ kind: 'insert', entity: line('a', [0, 0], [1, 0]), index: 0 }, 'A');
    expect(h.isDirty).toBe(true);
    h.markSaved();
    expect(h.isDirty).toBe(false);
    h.execute({ kind: 'insert', entity: line('b', [0, 0], [1, 1]), index: 1 }, 'B');
    expect(h.isDirty).toBe(true);
    h.undo();
    expect(h.isDirty).toBe(false);
  });

  it('records a batch as one undo step', () => {
    const d = new Drawing();
    const h = new History(d);
    h.execute({ kind: 'insert', entity: line('a', [0, 0], [1, 0]), index: 0 }, 'Setup');
    h.execute(
      {
        kind: 'batch',
        mutations: [
          { kind: 'replace', entity: transformEntity(line('a', [0, 0], [1, 0]), translation(3, 3)) },
          { kind: 'insert', entity: circle('c', [9, 9], 1), index: 1 },
        ],
      },
      'Move and add',
    );
    expect(d.entityCount).toBe(2);
    h.undo();
    expect(d.entityCount).toBe(1);
    expect(d.getEntity('a')).toMatchObject({ start: { x: 0, y: 0 } });
  });

  it('does not change the drawing when a command fails', () => {
    const d = new Drawing();
    const h = new History(d);
    expect(() => h.execute({ kind: 'remove', id: 'nope' }, 'Bad')).toThrow();
    expect(h.canUndo).toBe(false);
  });
});
