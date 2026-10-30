import { describe, expect, it } from 'vitest';
import { readField, withField } from '../../src/core/entities/edit';
import type { ArcEntity, CircleEntity } from '../../src/core/entities/types';
import { vec2 } from '../../src/core/geometry/vector';
import { EditorSession } from '../../src/state/EditorSession';
import { parseFieldNumber } from '../../src/state/input-parse';

const arc = (startAngle: number, endAngle: number): ArcEntity => ({ id: 'e1', type: 'arc', layer: '0', color: null, center: vec2(1, 1), radius: 4, startAngle, endAngle });
const deg = (d: number) => (d * Math.PI) / 180;

describe('arc fields at wrap boundaries', () => {
  it('reads an angle stored as a full turn as 0, and always inside [0, 360)', () => {
    expect(readField(arc(2 * Math.PI, Math.PI), 'startAngle')).toBe(0);
    for (const stored of [-1e-17, -deg(720), deg(725), 7 * Math.PI]) {
      const v = readField(arc(stored, 1), 'startAngle')!;
      expect(v, String(stored)).toBeGreaterThanOrEqual(0);
      expect(v, String(stored)).toBeLessThan(360);
    }
  });

  it('editing one angle of a wrapping arc (350 to 10) leaves the other angle and the sweep alone', () => {
    const wrapping = arc(deg(350), deg(10));
    const edit = withField(wrapping, 'endAngle', 20);
    expect('entity' in edit && (edit.entity as ArcEntity).startAngle).toBe(wrapping.startAngle);
    const moved = withField(wrapping, 'startAngle', 340);
    expect('entity' in moved && (moved.entity as ArcEntity).endAngle).toBe(wrapping.endAngle);
  });

  it('editing the radius or centre does not rewrite the angles', () => {
    const a = arc(deg(350), deg(10));
    for (const [field, value] of [['radius', 9], ['centerX', 5]] as const) {
      const edit = withField(a, field, value);
      expect('entity' in edit && (edit.entity as ArcEntity).startAngle).toBe(a.startAngle);
      expect('entity' in edit && (edit.entity as ArcEntity).endAngle).toBe(a.endAngle);
    }
  });

  it('refuses an angle edit that makes the arc a zero sweep from the other side of the wrap', () => {
    expect(withField(arc(deg(350), deg(10)), 'startAngle', 10)).toEqual({ error: 'Arc sweep must be greater than zero.' });
    expect(withField(arc(deg(350), deg(10)), 'startAngle', -350)).toEqual({ error: 'Arc sweep must be greater than zero.' });
  });
});

describe('parseFieldNumber edges', () => {
  it('accepts forms the pattern allows', () => {
    for (const [text, value] of [['1.', 1], ['1E3', 1000], ['+.5', 0.5], ['-.5e+2', -50], ['1e-999', 0], ['007', 7]] as const) {
      expect(parseFieldNumber(text), text).toEqual({ ok: true, value });
    }
    const negZero = parseFieldNumber('-0');
    expect(negZero.ok && Object.is(negZero.value, -0)).toBe(true);
  });

  it('refuses separators, non-ASCII digits and inner whitespace', () => {
    for (const text of ['1_000', '١٢', '1\n2', '1 e3', '−5', '5°', '5.5.5', '1e+', '++1', '0b1', '1e3.5']) {
      expect(parseFieldNumber(text).ok, JSON.stringify(text)).toBe(false);
    }
  });

  it('trims surrounding tabs and newlines', () => {
    expect(parseFieldNumber('\t 4\n')).toEqual({ ok: true, value: 4 });
  });
});

describe('editGeometry on a protected layer', () => {
  it('records no history and does not dirty the drawing when the layer is locked', () => {
    const s = new EditorSession();
    s.setViewSize(800, 600);
    const circle: CircleEntity = { id: 'e1', type: 'circle', layer: '0', color: null, center: vec2(0, 0), radius: 5 };
    s.drawing.apply({ kind: 'insert', entity: circle, index: 0 });
    s.updateLayer('0', { locked: true });
    s.history.markSaved();
    const undoDepth = s.history.entries.length;
    expect(s.editGeometry('e1', 'radius', 9)).toBe('Layer "0" is hidden or locked.');
    expect(s.history.entries.length).toBe(undoDepth);
    expect(s.history.isDirty).toBe(false);
    s.updateLayer('0', { locked: false });
    expect(s.editGeometry('e1', 'radius', 9)).toBeNull();
  });
});
