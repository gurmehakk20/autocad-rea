import { describe, expect, it } from 'vitest';
import { Drawing, type Mutation } from '../../src/core/document/Drawing';
import { distanceToEntity, entityBounds } from '../../src/core/entities/geometry';
import type { Entity } from '../../src/core/entities/types';
import { type Vec2, vec2 } from '../../src/core/geometry/vector';
import { pickEntity, selectByRectangle } from '../../src/core/selection/selection';
import { RTree } from '../../src/core/spatial/rtree';
import { DEFAULT_SNAP_SETTINGS, findSnap } from '../../src/core/snapping/snap';
import { completeCommand } from '../../src/state/commands';
import { EditorSession } from '../../src/state/EditorSession';
import { parseInput } from '../../src/state/input-parse';

/** QA probes for the milestone 2 spatial index, bulk mutation fast paths, input parsing and Tab completion. */

const line = (id: string, x1: number, y1: number, x2: number, y2: number, layer = '0'): Entity => ({
  id,
  type: 'line',
  layer,
  color: null,
  start: vec2(x1, y1),
  end: vec2(x2, y2),
});
const ins = (e: Entity, index = 0): Mutation => ({ kind: 'insert', entity: e, index });
const ids = (d: Drawing) => d.entities().map((e) => e.id);

/** A whole-plane search must return exactly entities(): no entity may be lost to, or invented by, the index. */
function expectIndexMatchesEntities(d: Drawing) {
  const all = ids(d);
  const whole = { minX: -1e18, minY: -1e18, maxX: 1e18, maxY: 1e18 };
  expect(d.entitiesIn(whole).map((e) => e.id)).toEqual(all);
  // Does not contain the extent, so the tree path runs.
  const half = { minX: -1e18, minY: -1e18, maxX: 1e18, maxY: 1e18 };
  const extent = d.entitiesIn(half);
  expect(extent.length).toBe(all.length);
}

describe('M2 QA: index drift', () => {
  it('loadParts that throws midway on an invalid entity leaves the index in step with entities()', () => {
    const d = new Drawing();
    const parts = {
      units: 'mm' as const,
      layers: d.layers(),
      idSequence: 5,
      entities: [line('e1', 0, 0, 1, 1), line('e2', 0, 0, 0, 0)],
    };
    expect(() => d.loadParts(parts)).toThrow();
    expectIndexMatchesEntities(d);
    // Every visible entity must also be pickable.
    for (const e of d.entities()) expect(pickEntity(d, vec2(0.5, 0.5), 1)?.id).toBe(e.id);
  });

  it('loadParts that throws for a missing layer 0 leaves no stale index entries from the earlier drawing', () => {
    const d = new Drawing();
    d.apply(ins(line('e1', 0, 0, 10, 10)));
    expect(() =>
      d.loadParts({ units: 'mm', layers: [{ name: 'A', color: '#ffffff', visible: true, locked: false }], entities: [], idSequence: 0 }),
    ).toThrow();
    expectIndexMatchesEntities(d);
    expect(pickEntity(d, vec2(5, 5), 1)).toBeUndefined();
  });

  it('replace then its inverse keeps pick and cached bounds in step', () => {
    const d = new Drawing();
    d.apply(ins(line('e1', 0, 0, 10, 0)));
    const inv = d.apply({ kind: 'replace', entity: line('e1', 1000, 1000, 1010, 1000) });
    expect(pickEntity(d, vec2(5, 0), 1)).toBeUndefined();
    expect(pickEntity(d, vec2(1005, 1000), 1)?.id).toBe('e1');
    d.apply(inv);
    expect(pickEntity(d, vec2(5, 0), 1)?.id).toBe('e1');
    expect(d.boundsOf('e1')).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 0 });
  });

  it('a generic batch that fails on a later step rolls back the index too', () => {
    const d = new Drawing();
    d.apply(ins(line('e1', 0, 0, 10, 0)));
    expect(() =>
      d.apply({ kind: 'batch', mutations: [ins(line('e2', 0, 5, 10, 5), 1), { kind: 'replace', entity: line('nope', 0, 0, 1, 1) }] }),
    ).toThrow();
    expect(ids(d)).toEqual(['e1']);
    expect(d.boundsOf('e2')).toBeNull();
    expect(pickEntity(d, vec2(5, 5), 1)).toBeUndefined();
    expectIndexMatchesEntities(d);
  });

  it('a bulk insert with an invalid last entity changes nothing', () => {
    const d = new Drawing();
    d.apply(ins(line('e1', 0, 0, 10, 0)));
    expect(() => d.apply({ kind: 'batch', mutations: [ins(line('e2', 0, 5, 10, 5), 1), ins(line('e3', 0, 0, 0, 0), 2)] })).toThrow();
    expect(ids(d)).toEqual(['e1']);
    expect(d.boundsOf('e2')).toBeNull();
    expectIndexMatchesEntities(d);
  });

  it('a bulk insert naming a missing layer changes nothing', () => {
    const d = new Drawing();
    expect(() =>
      d.apply({ kind: 'batch', mutations: [ins(line('e2', 0, 5, 10, 5, 'Missing'), 0), ins(line('e3', 0, 6, 10, 6), 1)] }),
    ).toThrow();
    expect(d.entityCount).toBe(0);
    expectIndexMatchesEntities(d);
  });

  it('bulk insert with negative, equal, non-integer and NaN indices matches one-by-one', () => {
    const cases: number[][] = [[-1, 0], [0, 0], [0.5, 1.5], [Number.NaN, 1], [1, Number.NaN], [-5, -3], [0, 100], [3, 3, 3], [2, 1]];
    for (const idx of cases) {
      const base = () => {
        const d = new Drawing();
        for (let i = 0; i < 3; i++) d.apply(ins(line(`b${i}`, i, 0, i, 5), i));
        return d;
      };
      const steps = idx.map((index, i) => ins(line(`n${i}`, 20 + i, 0, 20 + i, 5), index));
      const a = base();
      const b = base();
      let errA: unknown = null;
      let errB: unknown = null;
      try {
        a.apply({ kind: 'batch', mutations: steps });
      } catch (e) {
        errA = e;
      }
      try {
        for (const s of steps) b.apply(s);
      } catch (e) {
        errB = e;
      }
      expect(!!errA, `idx ${idx}`).toBe(!!errB);
      expect(ids(a), `idx ${idx}`).toEqual(ids(b));
      expectIndexMatchesEntities(a);
    }
  });

  it('bulk insert undo and redo repeated stays stable', () => {
    const d = new Drawing();
    for (let i = 0; i < 5; i++) d.apply(ins(line(`b${i}`, i, 0, i, 5), i));
    const steps = [ins(line('n0', 50, 0, 50, 5), 1), ins(line('n1', 51, 0, 51, 5), 3), ins(line('n2', 52, 0, 52, 5), 7)];
    let inv = d.apply({ kind: 'batch', mutations: steps });
    const after = ids(d);
    for (let i = 0; i < 3; i++) {
      const redo = d.apply(inv);
      expect(ids(d)).toEqual(['b0', 'b1', 'b2', 'b3', 'b4']);
      inv = d.apply(redo);
      expect(ids(d)).toEqual(after);
      expectIndexMatchesEntities(d);
    }
  });

  it('hiding then showing a layer does not change what is pickable or snappable', () => {
    const d = new Drawing();
    const layer = { name: 'A', color: '#ff0000', visible: true, locked: false };
    d.apply({ kind: 'put-layer', layer });
    d.apply(ins(line('e1', 0, 0, 10, 0, 'A')));
    d.apply({ kind: 'put-layer', layer: { ...layer, visible: false } });
    expect(pickEntity(d, vec2(5, 0), 1)).toBeUndefined();
    expect(selectByRectangle(d, vec2(-1, -1), vec2(11, 1), 'crossing')).toEqual([]);
    d.apply({ kind: 'put-layer', layer });
    expect(pickEntity(d, vec2(5, 0), 1)?.id).toBe('e1');
    expect(findSnap({ drawing: d, cursor: vec2(0.1, 0.1), tolerance: 1, settings: DEFAULT_SNAP_SETTINGS }).kind).toBe('endpoint');
  });
});

describe('M2 QA: pick, snap and selection edges against a scan', () => {
  const scanPick = (d: Drawing, p: Vec2, tol: number) => {
    const es = d.entities();
    for (let i = es.length - 1; i >= 0; i--) if (d.isEditable(es[i]!) && distanceToEntity(es[i]!, p) <= tol) return es[i];
    return undefined;
  };
  const fixture = () => {
    const d = new Drawing();
    d.apply(ins(line('h', 0, 0, 10, 0), 0));
    d.apply(ins(line('v', 20, 0, 20, 10), 1));
    d.apply(ins({ id: 'c', type: 'circle', layer: '0', color: null, center: vec2(50, 50), radius: 5 }, 2));
    d.apply(
      ins(
        { id: 'a', type: 'arc', layer: '0', color: null, center: vec2(0, -1000), radius: 1000, startAngle: Math.PI / 2 - 0.05, endAngle: Math.PI / 2 + 0.05 },
        3,
      ),
    );
    return d;
  };

  it('pick with tolerance 0, tiny, negative, NaN and Infinity matches a scan', () => {
    const d = fixture();
    const pts = [vec2(5, 0), vec2(20, 5), vec2(55, 50), vec2(5, 1e-12), vec2(5, 1), vec2(0, 0), vec2(20, 10), vec2(1e300, 1e300)];
    for (const tol of [0, 1e-12, 0.5, 1, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      for (const p of pts) expect(pickEntity(d, p, tol)?.id, `p=${p.x},${p.y} tol=${tol}`).toBe(scanPick(d, p, tol)?.id);
    }
  });

  it('pick at a non-finite cursor returns what a scan returns', () => {
    const d = fixture();
    for (const p of [vec2(Number.NaN, 0), vec2(Infinity, 0), vec2(0, -Infinity)]) {
      expect(pickEntity(d, p, 5)?.id, `${p.x},${p.y}`).toBe(scanPick(d, p, 5)?.id);
    }
  });

  it('degenerate and inverted selection rectangles agree with a bounds scan', () => {
    const d = fixture();
    const scan = (c1: Vec2, c2: Vec2, mode: 'window' | 'crossing') => {
      const r = { minX: Math.min(c1.x, c2.x), maxX: Math.max(c1.x, c2.x), minY: Math.min(c1.y, c2.y), maxY: Math.max(c1.y, c2.y) };
      return d
        .entities()
        .filter((e) => {
          const b = entityBounds(e)!;
          return mode === 'window'
            ? b.minX >= r.minX && b.maxX <= r.maxX && b.minY >= r.minY && b.maxY <= r.maxY
            : b.minX <= r.maxX && b.maxX >= r.minX && b.minY <= r.maxY && b.maxY >= r.minY;
        })
        .map((e) => e.id);
    };
    const rects: [Vec2, Vec2][] = [
      [vec2(5, 0), vec2(5, 0)],
      [vec2(20, 5), vec2(20, 5)],
      [vec2(11, 0), vec2(-1, 0)],
      [vec2(-1, -1), vec2(21, 11)],
      [vec2(0, 0), vec2(10, 0)],
    ];
    for (const [a, b] of rects) {
      expect(selectByRectangle(d, a, b, 'window'), `window ${a.x},${a.y}-${b.x},${b.y}`).toEqual(scan(a, b, 'window'));
      for (const id of selectByRectangle(d, a, b, 'crossing')) expect(scan(a, b, 'crossing')).toContain(id);
    }
  });

  it('an excluded arc is not snapped to through its far centre', () => {
    const d = fixture();
    const s = findSnap({ drawing: d, cursor: vec2(0.2, -1000.1), tolerance: 1, settings: DEFAULT_SNAP_SETTINGS, exclude: new Set(['a']) });
    expect(s.kind).toBe('none');
  });

  it('snap tolerance at the boundary behaves like a scan on an endpoint', () => {
    const d = fixture();
    expect(findSnap({ drawing: d, cursor: vec2(-1, 0), tolerance: 1, settings: DEFAULT_SNAP_SETTINGS }).kind).toBe('endpoint');
    expect(findSnap({ drawing: d, cursor: vec2(-1.0000001, 0), tolerance: 1, settings: DEFAULT_SNAP_SETTINGS }).kind).toBe('none');
  });
});

describe('M2 QA: R-tree at float extremes', () => {
  it('matches brute force with boxes near the largest doubles', () => {
    const t = new RTree();
    const boxes: [string, number, number, number, number][] = [];
    let s = 12345;
    const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 300; i++) {
      const cx = (rnd() - 0.5) * 1.7e308;
      const cy = (rnd() - 0.5) * 1.7e308;
      const w = rnd() * 1e307;
      boxes.push([`i${i}`, cx, cy, cx + w, cy + w]);
      t.insert(`i${i}`, { minX: cx, minY: cy, maxX: cx + w, maxY: cy + w });
    }
    for (let q = 0; q < 50; q++) {
      const cx = (rnd() - 0.5) * 1.7e308;
      const cy = (rnd() - 0.5) * 1.7e308;
      const area = { minX: cx, minY: cy, maxX: cx + 5e307, maxY: cy + 5e307 };
      const got: string[] = [];
      t.search(area, (id) => got.push(id));
      const want = boxes.filter(([, a, b, c, d]) => a <= area.maxX && c >= area.minX && b <= area.maxY && d >= area.minY).map(([id]) => id);
      expect(got.sort()).toEqual(want.sort());
    }
  });
});

describe('M2 QA: input parsing and Tab completion', () => {
  it.each(['1e999', '-1e999', '1e999,0', '0,-1e999', '@1e999,0', '@1e308,1e308'])(
    '%s is not a usable number or point',
    (text) => {
      const base = text.startsWith('@1e308') ? vec2(1e308, 1e308) : null;
      expect(parseInput(text, base).kind).toBe('invalid');
    },
  );

  it.each(['1e999<45', '5<1e999'])('%s never becomes a point or a number', (text) => {
    // The polar pattern has no exponent, so these read as an unknown command word, not as Infinity.
    expect(['text', 'invalid']).toContain(parseInput(text, null).kind);
  });

  it('finite extremes still parse', () => {
    expect(parseInput('1e300', null).kind).toBe('number');
    expect(parseInput('1e-999', null)).toEqual({ kind: 'number', value: 0 });
  });

  // Regression (found by QA): completeCommand returns the typed text for a prefix whose matches share nothing longer, and
  // the page cancelled Tab each time, so Tab never left the field. The session now lets the second Tab through.
  it('Tab on a prefix shared by several commands lists once, then lets focus move on', () => {
    for (const typed of ['C', 'E', 'R', 'S', 'M', 'P', 'Z', 'U']) {
      const c = completeCommand(typed);
      if (!c || c.candidates.length < 2 || c.text.toUpperCase() !== typed) continue;
      const s = new EditorSession();
      expect(s.completeInput(typed), `first Tab on "${typed}"`).toBe(typed);
      expect(s.completeInput(typed), `second Tab on "${typed}"`).toBeNull();
    }
  });
});
