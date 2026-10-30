import { describe, expect, it } from 'vitest';
import { Drawing, type Mutation } from '../../src/core/document/Drawing';
import { distanceToEntity, entityBounds, intersectEntities, snapCandidatesOf } from '../../src/core/entities/geometry';
import { type Entity, type EntityId, type LineEntity, entityValidationError } from '../../src/core/entities/types';
import { arcExtremePoints } from '../../src/core/geometry/arc';
import {
  type Bounds,
  boundsContainsBounds,
  boundsContainsPoint,
  boundsFromCorners,
  boundsFromPoints,
  boundsIntersect,
  expandBounds,
} from '../../src/core/geometry/bounds';
import { type Vec2, distance, vec2 } from '../../src/core/geometry/vector';
import { History } from '../../src/core/history/History';
import { Selection, pickEntity, selectByRectangle, selectableIds } from '../../src/core/selection/selection';
import { RTree } from '../../src/core/spatial/rtree';
import { DEFAULT_SNAP_SETTINGS, findSnap } from '../../src/core/snapping/snap';

/**
 * Differential tests: the spatial index must return exactly what a scan of every entity returns.
 * The oracles below are the scanning algorithms that existed before the index, written against the public
 * geometry functions. Every random case is seeded, so a failure reproduces.
 */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const logUniform = (r: Rand, lo: number, hi: number) => Math.exp(Math.log(lo) + r() * (Math.log(hi) - Math.log(lo)));
const between = (r: Rand, lo: number, hi: number) => lo + r() * (hi - lo);

/** Mostly a modest area, sometimes far away, so the tree sees clustered and outlying boxes. */
function coord(r: Rand): number {
  const roll = r();
  if (roll < 0.04) return between(r, -1e9, 1e9);
  return between(r, -2000, 2000);
}

/** A valid random entity. A tiny shape far from the origin falls under the relative tolerance, so it is grown until it is valid. */
function randomEntity(r: Rand, id: EntityId, layers: readonly string[] = ['0']): Entity {
  const layer = layers[Math.floor(r() * layers.length)]!;
  const origin = vec2(coord(r), coord(r));
  const kind = Math.floor(r() * 4);
  const angle = r() * Math.PI * 2;
  const sweep = 0.2 + r() * 5.5;
  const jitter = Array.from({ length: 12 }, () => r());
  const closed = r() < 0.4;
  let size = logUniform(r, 0.01, 50_000);
  for (let attempt = 0; ; attempt++) {
    const entity = shape({ id, layer, color: null }, origin, size, kind, angle, sweep, jitter, closed);
    if (!entityValidationError(entity) || attempt > 12) return entity;
    size *= 10;
  }
}

function shape(
  base: { id: EntityId; layer: string; color: null },
  origin: Vec2,
  size: number,
  kind: number,
  angle: number,
  sweep: number,
  jitter: readonly number[],
  closed: boolean,
): Entity {
  switch (kind) {
    case 0:
      return { ...base, type: 'line', start: origin, end: vec2(origin.x + Math.cos(angle) * size, origin.y + Math.sin(angle) * size) };
    case 1:
      return { ...base, type: 'circle', center: origin, radius: size };
    case 2:
      return { ...base, type: 'arc', center: origin, radius: size, startAngle: angle, endAngle: angle + sweep };
    default: {
      const count = 2 + Math.floor(jitter[0]! * 5);
      const vertices: Vec2[] = [origin];
      for (let i = 1; i < count; i++) {
        const last = vertices[i - 1]!;
        const a = jitter[i]! * Math.PI * 2 + i;
        vertices.push(vec2(last.x + Math.cos(a) * size * (0.2 + jitter[i + 5]!), last.y + Math.sin(a) * size * (0.2 + jitter[i + 5]!)));
      }
      return { ...base, type: 'polyline', vertices, closed: count > 2 && closed };
    }
  }
}

/** Replaces geometry but keeps the id, type and layer. */
function moved(r: Rand, e: Entity): Entity {
  const dx = between(r, -300, 300);
  const dy = between(r, -300, 300);
  switch (e.type) {
    case 'line':
      return { ...e, start: vec2(e.start.x + dx, e.start.y + dy), end: vec2(e.end.x + dx, e.end.y + dy) };
    case 'circle':
      return { ...e, center: vec2(e.center.x + dx, e.center.y + dy), radius: e.radius * (0.5 + r()) };
    case 'arc':
      return { ...e, center: vec2(e.center.x + dx, e.center.y + dy) };
    case 'polyline':
      return { ...e, vertices: e.vertices.map((v) => vec2(v.x + dx, v.y + dy)) };
  }
}

// ---- oracles -----------------------------------------------------------------------------------

function refPick(d: Drawing, p: Vec2, tolerance: number): Entity | undefined {
  const all = d.entities();
  for (let i = all.length - 1; i >= 0; i--) {
    if (d.isEditable(all[i]!) && distanceToEntity(all[i]!, p) <= tolerance) return all[i];
  }
  return undefined;
}

const PRIORITY = { endpoint: 0, intersection: 1, midpoint: 2, center: 3 } as const;

function refSnap(d: Drawing, cursor: Vec2, tolerance: number, exclude?: ReadonlySet<EntityId>) {
  const candidates: { kind: keyof typeof PRIORITY; point: Vec2; d: number }[] = [];
  const entities = d.entities().filter((e) => d.isEditable(e) && !exclude?.has(e.id));
  for (const entity of entities) {
    for (const c of snapCandidatesOf(entity)) {
      const dist = distance(c.point, cursor);
      if (dist <= tolerance) candidates.push({ kind: c.kind, point: c.point, d: dist });
    }
  }
  const reach = expandBounds(boundsFromPoints([cursor])!, tolerance);
  const near = entities.filter((e) => {
    const b = entityBounds(e);
    return !!b && boundsIntersect(b, reach);
  });
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      for (const point of intersectEntities(near[i]!, near[j]!)) {
        const dist = distance(point, cursor);
        if (dist <= tolerance) candidates.push({ kind: 'intersection', point, d: dist });
      }
    }
  }
  if (candidates.length === 0) return { point: cursor, kind: 'none' };
  candidates.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.d - b.d);
  return { point: candidates[0]!.point, kind: candidates[0]!.kind };
}

function refSelect(d: Drawing, a: Vec2, b: Vec2, mode: 'window' | 'crossing'): EntityId[] {
  const rect = boundsFromCorners(a, b);
  const corners = [vec2(rect.minX, rect.minY), vec2(rect.maxX, rect.minY), vec2(rect.maxX, rect.maxY), vec2(rect.minX, rect.maxY)];
  const edges: LineEntity[] = corners.map((start, i) => ({ id: '', type: 'line', layer: '', color: null, start, end: corners[(i + 1) % 4]! }));
  const out: EntityId[] = [];
  for (const e of d.entities()) {
    if (!d.isEditable(e)) continue;
    const bounds = entityBounds(e);
    if (!bounds) continue;
    if (mode === 'window') {
      if (boundsContainsBounds(rect, bounds)) out.push(e.id);
      continue;
    }
    if (!boundsIntersect(bounds, rect)) continue;
    const vertices =
      e.type === 'line' ? [e.start, e.end] : e.type === 'polyline' ? [...e.vertices] : e.type === 'arc' ? arcExtremePoints(e) : [];
    if (boundsContainsBounds(rect, bounds) || vertices.some((v) => boundsContainsPoint(rect, v)) || edges.some((edge) => intersectEntities(e, edge).length > 0)) {
      out.push(e.id);
    }
  }
  return out;
}

// ---- RTree against brute force -----------------------------------------------------------------

function randomBox(r: Rand): Bounds {
  const x = coord(r);
  const y = coord(r);
  const w = r() < 0.15 ? 0 : logUniform(r, 0.01, 40_000);
  const h = r() < 0.15 ? 0 : logUniform(r, 0.01, 40_000);
  return { minX: x, minY: y, maxX: x + w, maxY: y + h };
}

function searchIds(tree: RTree, area: Bounds): string[] {
  const ids: string[] = [];
  tree.search(area, (id) => ids.push(id));
  return ids.sort();
}

function bruteIds(boxes: Map<string, Bounds>, area: Bounds): string[] {
  return [...boxes].filter(([, b]) => boundsIntersect(b, area)).map(([id]) => id).sort();
}

describe('RTree', () => {
  it('is empty at the start and after clearing', () => {
    const tree = new RTree();
    expect(tree.size).toBe(0);
    expect(tree.extent).toBeNull();
    expect(searchIds(tree, { minX: -1e12, minY: -1e12, maxX: 1e12, maxY: 1e12 })).toEqual([]);
    tree.insert('a', { minX: 0, minY: 0, maxX: 1, maxY: 1 });
    tree.clear();
    expect(tree.size).toBe(0);
    expect(searchIds(tree, { minX: -5, minY: -5, maxX: 5, maxY: 5 })).toEqual([]);
  });

  it('treats touching boxes as intersecting and separated boxes as not', () => {
    const tree = new RTree();
    tree.insert('a', { minX: 0, minY: 0, maxX: 1, maxY: 1 });
    expect(searchIds(tree, { minX: 1, minY: 1, maxX: 2, maxY: 2 })).toEqual(['a']);
    expect(searchIds(tree, { minX: 1.0000001, minY: 0, maxX: 2, maxY: 1 })).toEqual([]);
  });

  it('refuses a duplicate id and an unknown removal', () => {
    const tree = new RTree();
    tree.insert('a', { minX: 0, minY: 0, maxX: 1, maxY: 1 });
    expect(() => tree.insert('a', { minX: 5, minY: 5, maxX: 6, maxY: 6 })).toThrow(/already/);
    expect(() => tree.remove('missing')).toThrow(/does not hold/);
    expect(() => tree.load([{ id: 'x', bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } }, { id: 'x', bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } }])).toThrow(/already/);
  });

  it('keeps many identical boxes, which cannot be split apart', () => {
    const tree = new RTree();
    const box = { minX: 3, minY: 3, maxX: 3, maxY: 3 };
    for (let i = 0; i < 200; i++) tree.insert(`p${i}`, box);
    expect(searchIds(tree, box)).toHaveLength(200);
    for (let i = 0; i < 200; i += 2) tree.remove(`p${i}`);
    expect(searchIds(tree, box)).toHaveLength(100);
  });

  for (const count of [0, 1, 2, 15, 16, 17, 40, 257, 1000]) {
    it(`returns the brute-force result after a bulk load of ${count} boxes`, () => {
      const r = rng(1000 + count);
      const boxes = new Map<string, Bounds>();
      for (let i = 0; i < count; i++) boxes.set(`b${i}`, randomBox(r));
      const tree = new RTree();
      tree.load([...boxes].map(([id, bounds]) => ({ id, bounds })));
      expect(tree.size).toBe(count);
      for (let q = 0; q < 150; q++) {
        const a = randomBox(r);
        expect(searchIds(tree, a)).toEqual(bruteIds(boxes, a));
      }
    });
  }

  it('matches brute force through 4,000 random inserts and removals, with queries after each batch', () => {
    const r = rng(7);
    const tree = new RTree();
    const boxes = new Map<string, Bounds>();
    let next = 0;
    for (let step = 0; step < 4000; step++) {
      if (boxes.size > 0 && r() < 0.42) {
        const id = [...boxes.keys()][Math.floor(r() * boxes.size)]!;
        tree.remove(id);
        boxes.delete(id);
      } else {
        const id = `b${next++}`;
        const box = randomBox(r);
        tree.insert(id, box);
        boxes.set(id, box);
      }
      if (step % 25 === 0) {
        expect(tree.size).toBe(boxes.size);
        for (let q = 0; q < 6; q++) {
          const a = randomBox(r);
          expect(searchIds(tree, a), `step ${step}`).toEqual(bruteIds(boxes, a));
        }
      }
    }
  });

  it('can be emptied one by one and used again', () => {
    const r = rng(11);
    const tree = new RTree();
    const boxes = new Map<string, Bounds>();
    for (let i = 0; i < 300; i++) {
      boxes.set(`b${i}`, randomBox(r));
      tree.insert(`b${i}`, boxes.get(`b${i}`)!);
    }
    for (const id of [...boxes.keys()]) tree.remove(id);
    expect(tree.size).toBe(0);
    expect(tree.extent).toBeNull();
    tree.insert('again', { minX: 1, minY: 1, maxX: 2, maxY: 2 });
    expect(searchIds(tree, { minX: 0, minY: 0, maxX: 3, maxY: 3 })).toEqual(['again']);
  });

  it('handles very large and very small coordinates', () => {
    const tree = new RTree();
    tree.insert('far', { minX: 1e12, minY: -1e12, maxX: 1e12 + 5, maxY: -1e12 + 5 });
    tree.insert('tiny', { minX: 1e-9, minY: 1e-9, maxX: 2e-9, maxY: 2e-9 });
    expect(searchIds(tree, { minX: 1e12, minY: -1e12, maxX: 1e12, maxY: -1e12 })).toEqual(['far']);
    expect(searchIds(tree, { minX: 0, minY: 0, maxX: 1e-8, maxY: 1e-8 })).toEqual(['tiny']);
  });
});

// ---- Drawing queries against the scan oracles --------------------------------------------------

function buildDrawing(r: Rand, count: number): Drawing {
  const d = new Drawing();
  d.apply({ kind: 'put-layer', layer: { name: 'L1', color: '#ff0000', visible: true, locked: false } });
  for (let i = 0; i < count; i++) d.apply({ kind: 'insert', entity: randomEntity(r, d.nextId(), ['0', 'L1']), index: d.entityCount });
  return d;
}

/** A query point near real geometry, so that queries mostly hit something. */
function interestingPoint(r: Rand, d: Drawing): Vec2 {
  const all = d.entities();
  if (all.length === 0 || r() < 0.15) return vec2(coord(r), coord(r));
  const e = all[Math.floor(r() * all.length)]!;
  const candidates = snapCandidatesOf(e);
  const base = candidates[Math.floor(r() * candidates.length)]!.point;
  const spread = logUniform(r, 0.001, 30);
  return vec2(base.x + between(r, -spread, spread), base.y + between(r, -spread, spread));
}

function compareQueries(d: Drawing, r: Rand, label: string, rounds = 12): void {
  for (let i = 0; i < rounds; i++) {
    const p = interestingPoint(r, d);
    const tol = logUniform(r, 0.001, 40);
    expect(pickEntity(d, p, tol)?.id, `${label}: pick`).toBe(refPick(d, p, tol)?.id);

    const exclude = r() < 0.3 ? new Set(d.entities().filter(() => r() < 0.3).map((e) => e.id)) : undefined;
    const got = findSnap({ drawing: d, cursor: p, tolerance: tol, settings: DEFAULT_SNAP_SETTINGS, ...(exclude ? { exclude } : {}) });
    expect(got, `${label}: snap`).toEqual(refSnap(d, p, tol, exclude));

    const q = interestingPoint(r, d);
    const mode = r() < 0.5 ? 'window' : 'crossing';
    expect(selectByRectangle(d, p, q, mode), `${label}: ${mode} select`).toEqual(refSelect(d, p, q, mode));
  }
}

describe('Drawing queries use the index without changing results', () => {
  it('returns the same picks, snaps and rectangle selections as a scan on 40 random drawings', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed);
      const d = buildDrawing(r, 20 + Math.floor(r() * 300));
      compareQueries(d, r, `seed ${seed}`, 25);
    }
  });

  it('finds the centre of an arc whose centre lies far outside the arc bounds', () => {
    const d = new Drawing();
    // A shallow arc on a large circle: its bounding box is a thin sliver, and its centre is 1,000 units away.
    d.apply({
      kind: 'insert',
      index: 0,
      entity: { id: d.nextId(), type: 'arc', layer: '0', color: null, center: vec2(0, -1000), radius: 1000, startAngle: Math.PI / 2 - 0.05, endAngle: Math.PI / 2 + 0.05 },
    });
    const snap = findSnap({ drawing: d, cursor: vec2(0.2, -1000.1), tolerance: 1, settings: DEFAULT_SNAP_SETTINGS });
    expect(snap.kind).toBe('center');
    expect(snap.point).toEqual(vec2(0, -1000));
    expect(refSnap(d, vec2(0.2, -1000.1), 1)).toEqual(snap);
  });

  it('keeps the topmost entity winning a pick when entities overlap', () => {
    const d = new Drawing();
    for (let i = 0; i < 40; i++) {
      d.apply({ kind: 'insert', index: d.entityCount, entity: { id: d.nextId(), type: 'circle', layer: '0', color: null, center: vec2(0, 0), radius: 5 } });
    }
    expect(pickEntity(d, vec2(5, 0), 0.1)?.id).toBe('e40');
  });

  it('skips hidden and locked layers exactly as the scan does', () => {
    const r = rng(99);
    const d = buildDrawing(r, 200);
    d.apply({ kind: 'put-layer', layer: { name: 'L1', color: '#ff0000', visible: false, locked: false } });
    compareQueries(d, r, 'hidden layer', 40);
    d.apply({ kind: 'put-layer', layer: { name: 'L1', color: '#ff0000', visible: true, locked: true } });
    compareQueries(d, r, 'locked layer', 40);
  });

  it('matches the scan after loadParts replaces the drawing, and after it is loaded again', () => {
    const r = rng(5);
    const source = buildDrawing(r, 250);
    const copy = new Drawing();
    copy.loadParts({ units: 'mm', layers: source.layers(), entities: source.entities(), idSequence: source.idSequence });
    compareQueries(copy, r, 'first load', 40);
    copy.loadParts({ units: 'mm', layers: source.layers(), entities: source.entities().slice(0, 60), idSequence: source.idSequence });
    compareQueries(copy, r, 'second load', 40);
    copy.loadParts({ units: 'mm', layers: source.layers(), entities: [], idSequence: 0 });
    expect(pickEntity(copy, vec2(0, 0), 10)).toBeUndefined();
    expect(selectByRectangle(copy, vec2(-1e9, -1e9), vec2(1e9, 1e9), 'crossing')).toEqual([]);
  });

  it('selectableIds lists every editable entity in creation order', () => {
    const r = rng(21);
    const d = buildDrawing(r, 120);
    d.apply({ kind: 'put-layer', layer: { name: 'L1', color: '#ff0000', visible: false, locked: false } });
    expect(selectableIds(d)).toEqual(d.entities().filter((e) => d.isEditable(e)).map((e) => e.id));
  });
});

describe('the index stays correct through every kind of mutation', () => {
  it('matches the scan through 600 random inserts, removes, replaces, bulk deletes, undos and redos', () => {
    const r = rng(2024);
    const d = buildDrawing(r, 60);
    const history = new History(d);
    for (let step = 0; step < 600; step++) {
      const roll = r();
      const all = d.entities();
      try {
        if (roll < 0.2) {
          history.execute({ kind: 'insert', entity: randomEntity(r, d.nextId(), ['0', 'L1']), index: Math.floor(r() * (all.length + 1)) }, 'insert');
        } else if (roll < 0.32 && all.length > 0) {
          history.execute({ kind: 'remove', id: all[Math.floor(r() * all.length)]!.id }, 'remove');
        } else if (roll < 0.52 && all.length > 0) {
          const e = all[Math.floor(r() * all.length)]!;
          history.execute({ kind: 'replace', entity: moved(r, e) }, 'replace');
        } else if (roll < 0.62 && all.length > 2) {
          const ids = all.filter(() => r() < 0.3).map((e) => e.id);
          if (ids.length > 1) history.execute({ kind: 'batch', mutations: ids.map((id) => ({ kind: 'remove', id }) satisfies Mutation) }, 'delete many');
        } else if (roll < 0.7) {
          history.execute({ kind: 'put-layer', layer: { name: 'L1', color: '#ff0000', visible: r() < 0.7, locked: r() < 0.2 } }, 'layer');
        } else if (roll < 0.86) {
          history.undo();
        } else {
          history.redo();
        }
      } catch (error) {
        throw new Error(`step ${step} (roll ${roll.toFixed(3)}): ${(error as Error).message}`, { cause: error });
      }
      // Cached bounds must follow the entities exactly.
      if (step % 10 === 0) {
        for (const e of d.entities()) expect(d.boundsOf(e.id), `bounds of ${e.id} at step ${step}`).toEqual(entityBounds(e));
        compareQueries(d, r, `step ${step}`, 4);
      }
    }
    compareQueries(d, r, 'final', 60);
  });

  it('a failed batch leaves the index as it was', () => {
    const r = rng(8);
    const d = buildDrawing(r, 80);
    const before = d.entities();
    const good = randomEntity(r, d.nextId());
    const bad = { ...randomEntity(r, d.nextId()), layer: 'NoSuchLayer' };
    expect(() =>
      d.apply({
        kind: 'batch',
        mutations: [
          { kind: 'insert', entity: good, index: 3 },
          { kind: 'remove', id: before[0]!.id },
          { kind: 'insert', entity: bad, index: 4 },
        ],
      }),
    ).toThrow(/does not exist/);
    expect(d.entities()).toEqual(before);
    compareQueries(d, r, 'after failed batch', 40);
  });

  it('a replace that moves an entity far away is found at the new place and not the old one', () => {
    const d = new Drawing();
    const e: Entity = { id: d.nextId(), type: 'circle', layer: '0', color: null, center: vec2(0, 0), radius: 3 };
    d.apply({ kind: 'insert', entity: e, index: 0 });
    d.apply({ kind: 'replace', entity: { ...e, center: vec2(5000, 5000) } });
    expect(pickEntity(d, vec2(3, 0), 0.5)).toBeUndefined();
    expect(pickEntity(d, vec2(5003, 5000), 0.5)?.id).toBe(e.id);
  });
});

describe('bulk remove and insert give the same drawing as one by one', () => {
  function pair(seed: number): { fast: Drawing; slow: Drawing; ids: EntityId[] } {
    const build = () => buildDrawing(rng(seed), 120);
    const fast = build();
    const slow = build();
    const r = rng(seed + 1);
    const ids = fast.entities().filter(() => r() < 0.35).map((e) => e.id);
    return { fast, slow, ids };
  }

  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`delete then undo restores order exactly (seed ${seed})`, () => {
      const { fast, slow, ids } = pair(seed);
      const original = fast.entities().map((e) => e.id);
      const inverse = fast.apply({ kind: 'batch', mutations: ids.map((id) => ({ kind: 'remove', id }) satisfies Mutation) });
      for (const id of ids) slow.apply({ kind: 'remove', id });
      expect(fast.entities().map((e) => e.id)).toEqual(slow.entities().map((e) => e.id));
      expect(fast.entityCount).toBe(original.length - ids.length);

      fast.apply(inverse);
      expect(fast.entities().map((e) => e.id)).toEqual(original);
      compareQueries(fast, rng(seed + 50), `bulk undo ${seed}`, 30);
    });
  }

  it('redoing a bulk delete after undo gives the same result again', () => {
    const { fast, ids } = pair(9);
    const history = new History(fast);
    history.execute({ kind: 'batch', mutations: ids.map((id) => ({ kind: 'remove', id }) satisfies Mutation) }, 'delete');
    const afterDelete = fast.entities().map((e) => e.id);
    history.undo();
    history.redo();
    expect(fast.entities().map((e) => e.id)).toEqual(afterDelete);
  });

  it('refuses a bulk delete that names an unknown or repeated id, and changes nothing', () => {
    const { fast, ids } = pair(3);
    const before = fast.entities().map((e) => e.id);
    expect(() => fast.apply({ kind: 'batch', mutations: [...ids, 'nope'].map((id) => ({ kind: 'remove', id }) satisfies Mutation) })).toThrow(/does not exist/);
    expect(() => fast.apply({ kind: 'batch', mutations: [ids[0]!, ids[1]!, ids[0]!].map((id) => ({ kind: 'remove', id }) satisfies Mutation) })).toThrow(/does not exist/);
    expect(fast.entities().map((e) => e.id)).toEqual(before);
    compareQueries(fast, rng(77), 'after refused delete', 20);
  });

  it('refuses a bulk insert with an invalid or repeated entity, and changes nothing', () => {
    const d = buildDrawing(rng(4), 30);
    const before = d.entities().map((e) => e.id);
    const a = randomEntity(rng(1), d.nextId());
    const dup = { ...randomEntity(rng(2), 'dup'), id: a.id };
    expect(() => d.apply({ kind: 'batch', mutations: [{ kind: 'insert', entity: a, index: 1 }, { kind: 'insert', entity: dup, index: 5 }] })).toThrow(/already exists/);
    const bad = { ...randomEntity(rng(3), d.nextId()), layer: 'Missing' };
    expect(() => d.apply({ kind: 'batch', mutations: [{ kind: 'insert', entity: a, index: 1 }, { kind: 'insert', entity: bad, index: 5 }] })).toThrow(/does not exist/);
    expect(d.entities().map((e) => e.id)).toEqual(before);
    expect(d.getEntity(a.id)).toBeUndefined();
  });

  it('inserts at ascending positions match one-by-one insertion, including positions past the end', () => {
    for (const seed of [1, 2, 3]) {
      const r = rng(seed);
      const fast = buildDrawing(rng(seed), 25);
      const slow = buildDrawing(rng(seed), 25);
      const steps: Mutation[] = [];
      let index = 0;
      for (let i = 0; i < 12; i++) {
        index += Math.floor(r() * 5) + 1 + (i === 11 ? 100 : 0);
        steps.push({ kind: 'insert', entity: randomEntity(r, `n${i}`), index });
      }
      fast.apply({ kind: 'batch', mutations: steps });
      for (const step of steps) slow.apply(step);
      expect(fast.entities().map((e) => e.id)).toEqual(slow.entities().map((e) => e.id));
    }
  });

  it('inserts that are not strictly ascending still work through the one-by-one path', () => {
    const fast = buildDrawing(rng(1), 10);
    const slow = buildDrawing(rng(1), 10);
    const steps: Mutation[] = [
      { kind: 'insert', entity: randomEntity(rng(1), 'x1'), index: 3 },
      { kind: 'insert', entity: randomEntity(rng(2), 'x2'), index: 3 },
      { kind: 'insert', entity: randomEntity(rng(3), 'x3'), index: -4 },
    ];
    fast.apply({ kind: 'batch', mutations: steps });
    for (const step of steps) slow.apply(step);
    expect(fast.entities().map((e) => e.id)).toEqual(slow.entities().map((e) => e.id));
  });

  it('forEachEntity visits the same entities as entities(), in the same order', () => {
    const d = buildDrawing(rng(6), 90);
    const visited: EntityId[] = [];
    d.forEachEntity((e) => visited.push(e.id));
    expect(visited).toEqual(d.entities().map((e) => e.id));
  });

  it('a selection can be pruned and queried after bulk operations', () => {
    const { fast, ids } = pair(2);
    const selection = new Selection();
    selection.replace(fast.entities().map((e) => e.id));
    fast.apply({ kind: 'batch', mutations: ids.map((id) => ({ kind: 'remove', id }) satisfies Mutation) });
    selection.prune(fast);
    expect(selection.size).toBe(fast.entityCount);
  });
});

describe('intersection snapping with entities that only surround the cursor', () => {
  // Concentric circles all have the cursor inside their bounds, but only the one nearest the cursor can take part
  // in an intersection within tolerance. The prefilter by distance must not change any result.
  function concentric(): Drawing {
    const d = new Drawing();
    for (let i = 1; i <= 60; i++) {
      d.apply({ kind: 'insert', index: d.entityCount, entity: { id: d.nextId(), type: 'circle', layer: '0', color: null, center: vec2(0, 0), radius: i * 3 } });
    }
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 6 + 0.1;
      d.apply({
        kind: 'insert',
        index: d.entityCount,
        entity: { id: d.nextId(), type: 'line', layer: '0', color: null, start: vec2(-200 * Math.cos(a), -200 * Math.sin(a)), end: vec2(200 * Math.cos(a), 200 * Math.sin(a)) },
      });
    }
    return d;
  }

  it('matches the scan with the cursor on, near and away from the crossings', () => {
    const d = concentric();
    const r = rng(404);
    for (let n = 0; n < 400; n++) {
      const ring = 1 + Math.floor(r() * 60);
      const line = Math.floor(r() * 6);
      const a = (line * Math.PI) / 6 + 0.1;
      const spread = logUniform(r, 0.001, 3);
      const cursor = vec2(ring * 3 * Math.cos(a) + between(r, -spread, spread), ring * 3 * Math.sin(a) + between(r, -spread, spread));
      const tolerance = logUniform(r, 0.05, 4);
      expect(findSnap({ drawing: d, cursor, tolerance, settings: DEFAULT_SNAP_SETTINGS }), `case ${n}`).toEqual(refSnap(d, cursor, tolerance));
    }
  });

  it('still finds a crossing between a ring and a line while 59 other rings surround the cursor', () => {
    const d = concentric();
    const a = 0.1;
    const exact = vec2(30 * Math.cos(a), 30 * Math.sin(a));
    const snap = findSnap({ drawing: d, cursor: vec2(exact.x + 0.1, exact.y - 0.1), tolerance: 1, settings: DEFAULT_SNAP_SETTINGS });
    expect(snap.kind).toBe('intersection');
    expect(distance(snap.point, exact)).toBeLessThan(1e-9);
  });
});

describe('intersection snapping with tolerance 0', () => {
  it('finds a crossing only when the cursor is exactly on it', () => {
    const d = new Drawing();
    const add = (a: Vec2, b: Vec2) =>
      d.apply({ kind: 'insert', index: d.entityCount, entity: { id: d.nextId(), type: 'line', layer: '0', color: null, start: a, end: b } });
    add(vec2(0, 0), vec2(10, 10));
    add(vec2(0, 10), vec2(10, 0));
    const settings = { ...DEFAULT_SNAP_SETTINGS, endpoint: false, midpoint: false, center: false, grid: false };
    const on = findSnap({ drawing: d, cursor: vec2(5, 5), tolerance: 0, settings });
    expect(on.kind).toBe('intersection');
    expect(distance(on.point, vec2(5, 5))).toBeLessThan(1e-9);
    expect(findSnap({ drawing: d, cursor: vec2(5.01, 5), tolerance: 0, settings }).kind).not.toBe('intersection');
  });
});
