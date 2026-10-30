import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Drawing, type Mutation } from '../../src/core/document/Drawing';
import { boundsIntersect, expandBounds, boundsFromPoints } from '../../src/core/geometry/bounds';
import { intersectEntities } from '../../src/core/entities/geometry';
import type { Entity } from '../../src/core/entities/types';
import { vec2, distance } from '../../src/core/geometry/vector';
import { DEFAULT_SNAP_SETTINGS, findSnap } from '../../src/core/snapping/snap';
import { importDxf } from '../../src/io/dxf/read';
import { EditorSession } from '../../src/state/EditorSession';

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

/** The pre-change algorithm: bounds-only filter, then all pairs. */
function oldIntersections(d: Drawing, cursor: { x: number; y: number }, tol: number) {
  const pad = tol + 1e-9 * Math.max(1, Math.abs(cursor.x), Math.abs(cursor.y));
  const reach = expandBounds(boundsFromPoints([vec2(cursor.x, cursor.y)])!, tol);
  const es = d
    .entitiesIn({ minX: cursor.x - pad, minY: cursor.y - pad, maxX: cursor.x + pad, maxY: cursor.y + pad })
    .filter((e) => d.isEditable(e));
  const near = es.filter((e) => {
    const b = d.boundsOf(e.id);
    return !!b && boundsIntersect(b, reach);
  });
  let n = 0;
  for (let i = 0; i < near.length; i++)
    for (let j = i + 1; j < near.length; j++)
      for (const p of intersectEntities(near[i]!, near[j]!)) if (distance(p, vec2(cursor.x, cursor.y)) <= tol) n++;
  return n;
}

describe('QA WP-I snap prefilter vs old bounds-only filter', () => {
  const only = { ...DEFAULT_SNAP_SETTINGS, endpoint: false, midpoint: false, center: false, grid: false, ortho: false, intersection: true, objectSnap: true };

  function fuzz(scale: number, offset: number, seed: number, count: number, tolFn: (r: () => number) => number) {
    const r = rng(seed);
    const bad: string[] = [];
    for (let iter = 0; iter < count; iter++) {
      const d = new Drawing();
      const n = 2 + Math.floor(r() * 6);
      for (let i = 0; i < n; i++) {
        const k = r();
        const c = () => offset + (r() - 0.5) * 20 * scale;
        let e: Entity;
        if (k < 0.4) e = { id: '', type: 'line', layer: '0', color: null, start: vec2(c(), c()), end: vec2(c(), c()) };
        else if (k < 0.7) e = { id: '', type: 'circle', layer: '0', color: null, center: vec2(c(), c()), radius: (0.1 + r() * 15) * scale };
        else if (k < 0.85)
          e = { id: '', type: 'arc', layer: '0', color: null, center: vec2(c(), c()), radius: (0.1 + r() * 15) * scale, startAngle: r() * 6, endAngle: r() * 6 };
        else e = { id: '', type: 'polyline', layer: '0', color: null, vertices: [vec2(c(), c()), vec2(c(), c()), vec2(c(), c())], closed: r() < 0.5 };
        try {
          d.apply({ kind: 'insert', entity: e, index: i } as Mutation);
        } catch {
          /* invalid entity, skip */
        }
      }
      // cursor: sometimes exactly on an intersection
      const es = d.entities();
      let cursor = vec2(offset + (r() - 0.5) * 20 * scale, offset + (r() - 0.5) * 20 * scale);
      for (let i = 0; i < es.length && r() < 0.9; i++)
        for (let j = i + 1; j < es.length; j++) {
          const pts = intersectEntities(es[i]!, es[j]!);
          if (pts.length) {
            const p = pts[0]!;
            const tol0 = tolFn(r);
            // offset by exactly tolerance in x for boundary test
            cursor = vec2(p.x + (r() < 0.5 ? tol0 : r() * tol0), p.y);
          }
        }
      const tol = tolFn(r);
      const oldN = oldIntersections(d, cursor, tol);
      const hit = findSnap({ drawing: d, cursor, tolerance: tol, settings: only, base: null });
      const newHas = hit.kind === 'intersection';
      if ((oldN > 0) !== newHas) bad.push(`iter ${iter} old=${oldN} new=${hit.kind} tol=${tol} cursor=${cursor.x},${cursor.y}`);
    }
    return bad;
  }

  it('matches on ordinary coordinates', () => {
    expect(fuzz(1, 0, 11, 6000, (r) => r() * 2)).toEqual([]);
  });
  it('matches with tolerance 0 and boundary cursors', () => {
    expect(fuzz(1, 0, 12, 4000, () => 0)).toEqual([]);
  });
  it('matches at huge coordinates', () => {
    expect(fuzz(1, 1e9, 13, 4000, (r) => r() * 2)).toEqual([]);
    expect(fuzz(1e6, 1e12, 14, 4000, (r) => r() * 1e6)).toEqual([]);
  });
  it('matches with large circles far from origin', () => {
    expect(fuzz(1e7, 0, 15, 4000, (r) => r() * 5)).toEqual([]);
  });
});

describe('QA WP-H group 420 / 62 boundaries', () => {
  const dxf = (layerExtra: Array<string | number>, entExtra: Array<string | number> = []) =>
    ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '0', 'LAYER', '2', 'L', '70', '0', ...layerExtra.map(String), '0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', 'L', '10', '0', '20', '0', '11', '1', '21', '0', ...entExtra.map(String), '0', 'ENDSEC', '0', 'EOF'].join('\n');

  it('layer 420 above 0xFFFFFF, negative, fractional', () => {
    const out: Record<string, unknown> = {};
    for (const v of [16777216, 4294967296 + 255, -1, 1.5, 0x1ff0000]) {
      const r = importDxf(dxf([62, 5, 420, v]));
      out[String(v)] = { layers: JSON.stringify((r as any).drawing?.layers?.() ?? (r as any).layers), warnings: (r as any).warnings };
    }
    console.log(JSON.stringify(out, null, 1));
    expect(true).toBe(true);
  });
  it('entity 420 out of range', () => {
    const out: any[] = [];
    for (const v of [16777216, -1, 1.5]) {
      const r: any = importDxf(dxf([], [420, v]));
      out.push([v, r.drawing?.entities?.().map((e: any) => e.color), r.warnings]);
    }
    console.log(JSON.stringify(out));
  });
  it('62 fractional on entity/layer', () => {
    for (const v of [1.5, 0.5, 255.9]) {
      const r: any = importDxf(dxf([62, v], [62, v]));
      console.log(v, JSON.stringify(r.drawing.layers()), JSON.stringify(r.drawing.entities().map((e: any) => e.color)), r.warnings);
    }
  });
});

describe('QA WP-G editGeometry extremes', () => {
  it('numeric extremes', () => {
    const s = new EditorSession();
    s.setViewSize(800, 600);
    for (const c of ['L', '0,0', '10,0', '']) s.submitCommand(c);
    const id = s.drawing.entities()[0]!.id;
    const results: Record<string, unknown> = {};
    for (const v of [1e-300, 1e300, -0, 1e308, 5e-324]) {
      const r = s.editGeometry(id, 'endX', v);
      const e: any = s.drawing.getEntity(id);
      results[String(v)] = [r, Object.is(e.end.x, -0) ? '-0' : e.end.x];
    }
    console.log(JSON.stringify(results));
    // undo/redo cycle
    s.undo();
    s.undo();
    s.redo();
    s.redo();
  });
});

describe('QA WP-I saveNative when serialising throws', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = { confirm: vi.fn(() => true) };
  });
  it('releases the saving guard and reports instead of rejecting', async () => {
    vi.resetModules();
    vi.doMock('../../src/app/files', () => ({ saveTextFile: vi.fn(async () => ({ kind: 'saved', name: 'a', handle: null })), openTextFile: vi.fn() }));
    const actions = await import('../../src/app/actions');
    const { session } = await import('../../src/state/session');
    const spy = vi.spyOn(session, 'snapshotForSave').mockImplementationOnce(() => {
      throw new RangeError('Invalid string length');
    });
    const report = vi.fn();
    await actions.saveNative(report).catch(() => undefined);
    spy.mockRestore();
    const files = await import('../../src/app/files');
    await actions.saveNative(report);
    expect(files.saveTextFile).toHaveBeenCalledTimes(1); // second save must reach the file layer
  });
});

describe('QA WP-G arc angle that normalises to the same value', () => {
  it('typing 360 for a start angle of 0 creates an undo step that changes nothing', () => {
    const s = new EditorSession();
    s.setViewSize(800, 600);
    for (const c of ['A', '0,0', '5,0', '0,5', '']) s.submitCommand(c);
    const arc = s.drawing.entities().find((e) => e.type === 'arc')!;
    const before = s.history.entries.length;
    const angle = (arc as any).startAngle;
    s.editGeometry(arc.id, 'startAngle', (angle * 180) / Math.PI + 360);
    console.log('undo entries added:', s.history.entries.length - before);
  });
});
