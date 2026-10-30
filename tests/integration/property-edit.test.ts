import { describe, expect, it } from 'vitest';
import { editableFields, formatFieldValue, readField, withField } from '../../src/core/entities/edit';
import type { ArcEntity, CircleEntity, Entity, LineEntity, PolylineEntity } from '../../src/core/entities/types';
import { vec2 } from '../../src/core/geometry/vector';
import { EditorSession } from '../../src/state/EditorSession';
import { parseFieldNumber } from '../../src/state/input-parse';

const line = (id = 'e1'): LineEntity => ({ id, type: 'line', layer: '0', color: null, start: vec2(0, 0), end: vec2(10, 5) });
const circle = (id = 'e1'): CircleEntity => ({ id, type: 'circle', layer: '0', color: null, center: vec2(2, 3), radius: 5 });
const arc = (id = 'e1'): ArcEntity => ({ id, type: 'arc', layer: '0', color: null, center: vec2(1, 1), radius: 4, startAngle: 0, endAngle: Math.PI / 2 });
const polyline = (id = 'e1'): PolylineEntity => ({ id, type: 'polyline', layer: '0', color: null, vertices: [vec2(0, 0), vec2(1, 0), vec2(1, 1)], closed: false });

function sessionWith(entity: Entity): EditorSession {
  const s = new EditorSession();
  s.setViewSize(800, 600);
  s.drawing.apply({ kind: 'insert', entity, index: 0 });
  return s;
}

const lastLog = (s: EditorSession) => s.log.at(-1) ?? '';

describe('editable fields', () => {
  it('lists the fields of each entity type, and none for a polyline', () => {
    expect(editableFields(line()).map((f) => f.field)).toEqual(['startX', 'startY', 'endX', 'endY']);
    expect(editableFields(circle()).map((f) => f.field)).toEqual(['centerX', 'centerY', 'radius']);
    expect(editableFields(arc()).map((f) => f.field)).toEqual(['centerX', 'centerY', 'radius', 'startAngle', 'endAngle']);
    expect(editableFields(polyline())).toEqual([]);
  });

  it('reads values, with angles in degrees in [0, 360), and null for a field the entity lacks', () => {
    expect(readField(line(), 'endY')).toBe(5);
    expect(readField(circle(), 'radius')).toBe(5);
    expect(readField(arc(), 'endAngle')).toBeCloseTo(90, 10);
    expect(readField({ ...arc(), startAngle: -Math.PI / 2 }, 'startAngle')).toBeCloseTo(270, 10);
    expect(readField(line(), 'radius')).toBeNull();
    expect(readField(circle(), 'startAngle')).toBeNull();
    expect(readField(polyline(), 'startX')).toBeNull();
  });

  it('every listed field can be read back as the value it was set to', () => {
    for (const entity of [line(), circle(), arc()]) {
      for (const { field } of editableFields(entity)) {
        const current = readField(entity, field)!;
        const edit = withField(entity, field, current);
        expect('entity' in edit && readField(edit.entity, field)).toBeCloseTo(current, 9);
      }
    }
  });
});

describe('withField', () => {
  it('changes only the named field', () => {
    const edit = withField(line(), 'endX', 20);
    expect(edit).toEqual({ entity: { ...line(), end: vec2(20, 5) } });
    expect(withField(circle(), 'centerY', -7)).toEqual({ entity: { ...circle(), center: vec2(2, -7) } });
    expect(withField(circle(), 'radius', 1.5)).toEqual({ entity: { ...circle(), radius: 1.5 } });
  });

  it('does not modify the entity it was given', () => {
    const original = line();
    const frozen = JSON.stringify(original);
    withField(original, 'startX', 99);
    expect(JSON.stringify(original)).toBe(frozen);
  });

  it('stores arc angles as radians in [0, 2π), wrapping degrees', () => {
    const turn = (deg: number) => {
      const edit = withField(arc(), 'startAngle', deg);
      return 'entity' in edit ? (edit.entity as ArcEntity).startAngle : NaN;
    };
    expect(turn(45)).toBeCloseTo(Math.PI / 4, 12);
    expect(turn(405)).toBeCloseTo(Math.PI / 4, 12);
    expect(turn(-90)).toBeCloseTo((3 * Math.PI) / 2, 12);
    expect(turn(360)).toBe(0);
  });

  it('refuses values that would make the entity invalid, naming why', () => {
    expect(withField(circle(), 'radius', 0)).toEqual({ error: 'Circle radius must be a positive number.' });
    expect(withField(circle(), 'radius', -3)).toHaveProperty('error');
    expect(withField({ ...line(), end: vec2(0, 5) }, 'endY', 0)).toEqual({ error: 'Line has zero length.' });
    expect(withField(arc(), 'radius', -1)).toHaveProperty('error');
    // End angle set equal to the start angle leaves a zero sweep.
    expect(withField(arc(), 'endAngle', 0)).toEqual({ error: 'Arc sweep must be greater than zero.' });
    expect(withField(arc(), 'endAngle', 360)).toEqual({ error: 'Arc sweep must be greater than zero.' });
  });

  it('refuses NaN and infinite values', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(withField(line(), 'startX', bad)).toEqual({ error: 'Start X must be a finite number.' });
    }
  });

  it('refuses a field the entity does not have', () => {
    expect(withField(line(), 'radius', 3)).toEqual({ error: 'Radius cannot be edited on this object.' });
    expect(withField(polyline(), 'startX', 3)).toHaveProperty('error');
    expect(withField(circle(), 'endAngle', 3)).toHaveProperty('error');
  });
});

describe('formatFieldValue', () => {
  it('shows up to 12 significant digits, not a fixed number of decimals', () => {
    expect(formatFieldValue(5)).toBe('5');
    expect(formatFieldValue(-12.5)).toBe('-12.5');
    expect(formatFieldValue(1 / 3)).toBe('0.333333333333');
    expect(formatFieldValue(123456.789012345)).toBe('123456.789012');
    expect(formatFieldValue(1e21)).toBe('1e+21');
  });

  it('shows rounding noise as zero, including negative zero', () => {
    expect(formatFieldValue(0)).toBe('0');
    expect(formatFieldValue(-0)).toBe('0');
    expect(formatFieldValue(1e-14)).toBe('0');
    expect(formatFieldValue(-1e-14)).toBe('0');
  });

  it('does not round at the 4 decimals the read-only display uses', () => {
    expect(formatFieldValue(12.34567891)).toBe('12.34567891');
  });
});

describe('parseFieldNumber', () => {
  it('accepts plain decimal numbers', () => {
    for (const [text, value] of [['12', 12], [' -3.5 ', -3.5], ['1e3', 1000], ['.5', 0.5], ['+7', 7], ['0', 0], ['-0.25e-2', -0.0025]] as const) {
      expect(parseFieldNumber(text), text).toEqual({ ok: true, value });
    }
  });

  it('refuses blank, malformed, hex, comma and coordinate input', () => {
    for (const text of ['', '   ', 'abc', '1,5', '0x10', '--1', '1 2', 'NaN', 'Infinity', '1,2', '@1,2', '5<30', '1e', '.']) {
      expect(parseFieldNumber(text).ok, `"${text}"`).toBe(false);
    }
  });

  it('refuses numbers that overflow to Infinity', () => {
    expect(parseFieldNumber('1e999')).toEqual({ ok: false, reason: '"1e999" is out of range. Numbers must be finite.' });
    expect(parseFieldNumber('-1e999').ok).toBe(false);
  });
});

describe('EditorSession.editGeometry', () => {
  it('edits a value, and one undo restores the exact previous entity', () => {
    const s = sessionWith(circle());
    const before = s.drawing.getEntity('e1');
    expect(s.editGeometry('e1', 'radius', 8)).toBeNull();
    expect(s.drawing.getEntity('e1')).toEqual({ ...circle(), radius: 8 });
    s.undo();
    expect(s.drawing.getEntity('e1')).toBe(before);
  });

  it('records each edit as its own undo step, even for the same field in a row', () => {
    const s = sessionWith(circle());
    s.editGeometry('e1', 'radius', 6);
    s.editGeometry('e1', 'radius', 7);
    s.editGeometry('e1', 'radius', 9);
    expect(s.history.entries.length).toBe(3);
    s.undo();
    expect((s.drawing.getEntity('e1') as CircleEntity).radius).toBe(7);
    s.undo();
    expect((s.drawing.getEntity('e1') as CircleEntity).radius).toBe(6);
    s.redo();
    expect((s.drawing.getEntity('e1') as CircleEntity).radius).toBe(7);
  });

  it('labels the undo step with the edited field', () => {
    const s = sessionWith(line());
    s.editGeometry('e1', 'startX', -4);
    expect(s.history.undoLabel).toBe('Edit start x');
  });

  it('edits every line field and keeps the others', () => {
    const s = sessionWith(line());
    s.editGeometry('e1', 'startX', -1);
    s.editGeometry('e1', 'startY', -2);
    s.editGeometry('e1', 'endX', 30);
    s.editGeometry('e1', 'endY', 40);
    expect(s.drawing.getEntity('e1')).toEqual({ ...line(), start: vec2(-1, -2), end: vec2(30, 40) });
  });

  it('edits arc angles in degrees', () => {
    const s = sessionWith(arc());
    expect(s.editGeometry('e1', 'startAngle', 30)).toBeNull();
    expect(s.editGeometry('e1', 'endAngle', 200)).toBeNull();
    const a = s.drawing.getEntity('e1') as ArcEntity;
    expect(a.startAngle).toBeCloseTo((30 * Math.PI) / 180, 12);
    expect(a.endAngle).toBeCloseTo((200 * Math.PI) / 180, 12);
    expect(a.center).toEqual(vec2(1, 1));
    expect(a.radius).toBe(4);
  });

  it('a refused edit returns the reason, logs it, and leaves the drawing and history untouched', () => {
    const s = sessionWith(circle());
    const before = s.drawing.getEntity('e1');
    expect(s.editGeometry('e1', 'radius', 0)).toBe('Circle radius must be a positive number.');
    expect(lastLog(s)).toBe('Circle radius must be a positive number.');
    expect(s.drawing.getEntity('e1')).toBe(before);
    expect(s.history.canUndo).toBe(false);
    expect(s.history.isDirty).toBe(false);
  });

  it('refuses NaN and Infinity without touching the drawing', () => {
    const s = sessionWith(line());
    const before = s.drawing.getEntity('e1');
    expect(s.editGeometry('e1', 'endX', NaN)).toMatch(/finite/);
    expect(s.editGeometry('e1', 'endX', Infinity)).toMatch(/finite/);
    expect(s.drawing.getEntity('e1')).toBe(before);
    expect(s.history.canUndo).toBe(false);
  });

  it('refuses an object on a locked or hidden layer', () => {
    for (const patch of [{ locked: true }, { visible: false }] as const) {
      const s = sessionWith(circle());
      s.updateLayer('0', patch);
      const before = s.drawing.getEntity('e1');
      expect(s.editGeometry('e1', 'radius', 9)).toBe('Layer "0" is hidden or locked.');
      expect(s.drawing.getEntity('e1')).toBe(before);
    }
  });

  it('refuses an object that no longer exists', () => {
    const s = sessionWith(circle());
    expect(s.editGeometry('e99', 'radius', 3)).toBe('That object no longer exists.');
  });

  it('refuses a field the object does not have', () => {
    const s = sessionWith(line());
    expect(s.editGeometry('e1', 'radius', 3)).toMatch(/cannot be edited/);
    expect(s.history.canUndo).toBe(false);
  });

  it('marks the drawing dirty, and clean again after undo back to the saved state', () => {
    const s = sessionWith(circle());
    s.history.markSaved();
    s.editGeometry('e1', 'radius', 2);
    expect(s.history.isDirty).toBe(true);
    s.undo();
    expect(s.history.isDirty).toBe(false);
  });

  it('moves the object in the spatial index, so it is picked at its new place and not its old one', () => {
    const s = sessionWith(circle());
    s.editGeometry('e1', 'centerX', 500);
    const { drawing } = s;
    expect(drawing.entitiesIn({ minX: 497, minY: 0, maxX: 507, maxY: 10 }).map((e) => e.id)).toEqual(['e1']);
    expect(drawing.entitiesIn({ minX: -10, minY: -10, maxX: 10, maxY: 10 })).toEqual([]);
    s.undo();
    expect(drawing.entitiesIn({ minX: -10, minY: -10, maxX: 10, maxY: 10 }).map((e) => e.id)).toEqual(['e1']);
  });
});

describe('normalizeAngle range (found while testing field edits)', () => {
  // -1e-17 + 2π rounds to exactly 2π in floating point, which is outside the documented range [0, 2π).
  it('maps tiny negative angles to 0, never to 2π', async () => {
    const { normalizeAngle } = await import('../../src/core/geometry/arc');
    for (const tiny of [-1e-17, -1e-300, -Number.MIN_VALUE, -1e-16]) {
      const n = normalizeAngle(tiny);
      expect(n, String(tiny)).toBeGreaterThanOrEqual(0);
      expect(n, String(tiny)).toBeLessThan(2 * Math.PI);
    }
    expect(normalizeAngle(-1e-17)).toBe(0);
  });

  it('keeps every other result inside [0, 2π) across a sweep including exact multiples', async () => {
    const { normalizeAngle } = await import('../../src/core/geometry/arc');
    for (let k = -50; k <= 50; k++) {
      for (const offset of [0, 1e-12, -1e-12, 1e-17, -1e-17]) {
        const n = normalizeAngle(k * Math.PI + offset);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(2 * Math.PI);
      }
    }
  });

  it('the panel never shows 360 for an angle just below zero', () => {
    const tinyNegative = readField({ ...arc(), startAngle: -1e-17 }, 'startAngle')!;
    expect(tinyNegative).toBeGreaterThanOrEqual(0);
    expect(tinyNegative).toBeLessThan(360);
    expect(formatFieldValue(tinyNegative)).toBe('0');
  });
});

describe('an edit that changes nothing is not an edit (found by QA)', () => {
  it('setting an arc angle to 360 when it is 0 records no undo step and leaves the drawing clean', () => {
    const s = sessionWith(arc());
    s.history.markSaved();
    expect(s.editGeometry('e1', 'startAngle', 360)).toBeNull();
    expect(s.history.canUndo).toBe(false);
    expect(s.isDirty).toBe(false);
  });

  it('wrapping an angle to the value it already has, or typing the current value, records nothing', () => {
    const s = sessionWith({ ...arc(), startAngle: Math.PI / 2, endAngle: Math.PI });
    expect(s.editGeometry('e1', 'startAngle', 450)).toBeNull();
    expect(s.editGeometry('e1', 'radius', 4)).toBeNull();
    expect(s.editGeometry('e1', 'centerX', 1)).toBeNull();
    expect(s.history.canUndo).toBe(false);
  });

  it('typing the current value of a line or circle field records nothing', () => {
    const l = sessionWith(line());
    expect(l.editGeometry('e1', 'endX', 10)).toBeNull();
    expect(l.editGeometry('e1', 'startY', 0)).toBeNull();
    expect(l.history.canUndo).toBe(false);
    const c = sessionWith(circle());
    expect(c.editGeometry('e1', 'radius', 5)).toBeNull();
    expect(c.editGeometry('e1', 'centerX', 2)).toBeNull();
    expect(c.history.canUndo).toBe(false);
  });

  it('a real change still records one step', () => {
    const s = sessionWith(arc());
    expect(s.editGeometry('e1', 'startAngle', 10)).toBeNull();
    expect(s.history.entries).toHaveLength(1);
  });
});
