import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Drawing } from '../../src/core/document/Drawing';
import { intersectEntities, transformEntity } from '../../src/core/entities/geometry';
import type { ArcEntity, CircleEntity, Entity, LineEntity } from '../../src/core/entities/types';
import { arcFromThreePoints, arcSweep } from '../../src/core/geometry/arc';
import { intersectCircles, intersectSegmentCircle } from '../../src/core/geometry/circle';
import { closestPointOnSegment, distancePointToSegment, intersectSegments } from '../../src/core/geometry/segment';
import { rotation, translation, compose } from '../../src/core/geometry/transform';
import { distance, vec2 } from '../../src/core/geometry/vector';
import { DxfFileError, importDxf } from '../../src/io/dxf/read';
import { exportDxf } from '../../src/io/dxf/write';
import { DrawingFileError, parseDrawing, serializeDrawing } from '../../src/io/serialization/native';

/** Small deterministic PRNG (mulberry32) so failures reproduce from the seed. */
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

const fixture = readFileSync(join(__dirname, '..', 'fixtures', 'mixed-sample.dxf'), 'utf8');

const JUNK = ['', ' ', '0', '-1', '1e999', '-0', 'NaN', 'Infinity', '\u0000', 'ENDSEC', 'SECTION', 'LINE', 'LWPOLYLINE', '99999999999999999999', '1.5.2', '0x10', 'é', '\t'];

/** Applies one random structural or value mutation to DXF text. */
function mutateDxf(text: string, rand: () => number): string {
  const lines = text.split('\n');
  const pick = () => Math.floor(rand() * lines.length);
  switch (Math.floor(rand() * 6)) {
    case 0:
      lines.splice(pick(), 1); // drop a line (breaks code/value pairing)
      break;
    case 1:
      lines.splice(pick(), 0, JUNK[Math.floor(rand() * JUNK.length)]!);
      break;
    case 2:
      lines[pick()] = JUNK[Math.floor(rand() * JUNK.length)]!;
      break;
    case 3:
      return lines.slice(0, pick()).join('\n'); // truncate
    case 4: {
      const i = pick();
      const j = pick();
      [lines[i], lines[j]] = [lines[j]!, lines[i]!];
      break;
    }
    default:
      lines[pick()] = String(Math.floor(rand() * 400) - 20); // a random number, often a plausible group code
  }
  return lines.join('\n');
}

describe('fuzz: DXF import never fails in an unexpected way', () => {
  it('only returns a result or throws DxfFileError for 4,000 mutated files', () => {
    const rand = rng(20261028);
    let imported = 0;
    let rejected = 0;
    for (let n = 0; n < 4000; n++) {
      let text = fixture;
      const mutations = 1 + Math.floor(rand() * 4);
      for (let m = 0; m < mutations; m++) text = mutateDxf(text, rand);
      try {
        const result = importDxf(text);
        imported++;
        // A successful import must yield a drawing that is valid by the model's own rules.
        for (const e of result.drawing.entities()) {
          expect(result.drawing.getLayer(e.layer), `layer of ${e.id}`).toBeDefined();
        }
        // And it must be exportable without error.
        exportDxf(result.drawing);
      } catch (error) {
        rejected++;
        if (!(error instanceof DxfFileError)) {
          throw new Error(`Unexpected ${(error as Error).name}: ${(error as Error).message}\n--- input ---\n${text}`, { cause: error });
        }
      }
    }
    expect(imported + rejected).toBe(4000);
    expect(imported).toBeGreaterThan(100); // the corpus must exercise both outcomes
    expect(rejected).toBeGreaterThan(100);
  });

  it('survives random binary-ish and degenerate text', () => {
    const rand = rng(7);
    const inputs = ['', '\n', '\r\n\r\n', '0', '0\n', '0\nEOF', '999\ncomment\n0\nEOF', '0\nSECTION\n2\nENTITIES\n0\nENDSEC', 'x'.repeat(10_000)];
    for (let i = 0; i < 200; i++) {
      inputs.push(Array.from({ length: Math.floor(rand() * 60) }, () => String.fromCharCode(Math.floor(rand() * 128))).join(''));
    }
    for (const text of inputs) {
      try {
        importDxf(text);
      } catch (error) {
        expect(error).toBeInstanceOf(DxfFileError);
      }
    }
  });
});

describe('fuzz: native files never fail in an unexpected way', () => {
  function sample(): string {
    const d = new Drawing();
    d.apply({ kind: 'put-layer', layer: { name: 'Walls', color: '#ff0000', visible: true, locked: false } });
    const entities: Entity[] = [
      { id: d.nextId(), type: 'line', layer: 'Walls', color: null, start: vec2(0, 0), end: vec2(5, 5) },
      { id: d.nextId(), type: 'circle', layer: '0', color: '#00ff00', center: vec2(1, 1), radius: 2 },
      { id: d.nextId(), type: 'arc', layer: '0', color: null, center: vec2(0, 0), radius: 3, startAngle: 0, endAngle: 1 },
      { id: d.nextId(), type: 'polyline', layer: '0', color: null, closed: true, vertices: [vec2(0, 0), vec2(2, 0), vec2(2, 2)] },
    ];
    for (const e of entities) d.apply({ kind: 'insert', entity: e, index: d.entityCount });
    return serializeDrawing(d);
  }

  /** Replaces a random value anywhere in the JSON tree with something of the wrong type or range. */
  function corrupt(value: unknown, rand: () => number, depth = 0): unknown {
    const wrong = [null, undefined, 'x', '', -1, 0, 1e308, NaN, [], {}, true, [null], { x: 'a' }];
    if (typeof value !== 'object' || value === null) return wrong[Math.floor(rand() * wrong.length)];
    const copy: unknown = Array.isArray(value) ? [...value] : { ...(value as Record<string, unknown>) };
    const keys = Object.keys(copy as object);
    if (keys.length === 0) return copy;
    const key = keys[Math.floor(rand() * keys.length)]!;
    const record = copy as Record<string, unknown>;
    record[key] = depth < 3 && rand() < 0.5 ? corrupt(record[key], rand, depth + 1) : wrong[Math.floor(rand() * wrong.length)];
    return copy;
  }

  it('only loads a valid drawing or throws DrawingFileError for 4,000 corrupted files', () => {
    const rand = rng(424242);
    const base = JSON.parse(sample());
    let loaded = 0;
    let rejected = 0;
    for (let n = 0; n < 4000; n++) {
      let doc: unknown = base;
      const rounds = 1 + Math.floor(rand() * 3);
      for (let r = 0; r < rounds; r++) doc = corrupt(doc, rand);
      const text = JSON.stringify(doc);
      try {
        const drawing = parseDrawing(text);
        loaded++;
        // Whatever loads must round-trip and must allow new ids.
        const again = parseDrawing(serializeDrawing(drawing));
        expect(again.entityCount).toBe(drawing.entityCount);
        expect(drawing.entities().some((e) => e.id === drawing.nextId())).toBe(false);
      } catch (error) {
        rejected++;
        if (!(error instanceof DrawingFileError)) {
          throw new Error(`Unexpected ${(error as Error).name}: ${(error as Error).message}\n--- input ---\n${text}`, { cause: error });
        }
      }
    }
    expect(loaded + rejected).toBe(4000);
    expect(rejected).toBeGreaterThan(100);
  });

  it('rejects truncated and non-object JSON', () => {
    const text = sample();
    for (const bad of [text.slice(0, text.length >> 1), 'null', '1', '"s"', '[]', '{}', '{"format":"opendraft-drawing"}']) {
      expect(() => parseDrawing(bad)).toThrow(DrawingFileError);
    }
  });
});

describe('property: geometry invariants on random input', () => {
  const rand = rng(99);
  const coord = (scale = 100) => (rand() - 0.5) * 2 * scale;
  const point = (scale = 100) => vec2(coord(scale), coord(scale));

  it('segment intersections lie on both segments', () => {
    let found = 0;
    for (let i = 0; i < 5000; i++) {
      const a1 = point();
      const a2 = point();
      const b1 = point();
      const b2 = point();
      const hits = intersectSegments(a1, a2, b1, b2);
      expect(hits.length).toBeLessThanOrEqual(1);
      for (const p of hits) {
        found++;
        expect(distancePointToSegment(p, a1, a2)).toBeLessThan(1e-7);
        expect(distancePointToSegment(p, b1, b2)).toBeLessThan(1e-7);
      }
    }
    expect(found).toBeGreaterThan(500);
  });

  it('intersection is symmetric in its arguments', () => {
    for (let i = 0; i < 2000; i++) {
      const a1 = point();
      const a2 = point();
      const b1 = point();
      const b2 = point();
      const ab = intersectSegments(a1, a2, b1, b2);
      const ba = intersectSegments(b1, b2, a1, a2);
      expect(ab.length).toBe(ba.length);
      if (ab[0] && ba[0]) expect(distance(ab[0], ba[0])).toBeLessThan(1e-7);
    }
  });

  it('the closest point on a segment is never farther than either endpoint', () => {
    for (let i = 0; i < 3000; i++) {
      const a = point();
      const b = point();
      const p = point(200);
      const c = closestPointOnSegment(p, a, b);
      expect(c.t).toBeGreaterThanOrEqual(0);
      expect(c.t).toBeLessThanOrEqual(1);
      expect(distance(p, c.point)).toBeLessThanOrEqual(Math.min(distance(p, a), distance(p, b)) + 1e-9);
    }
  });

  it('circle intersections lie on both circles', () => {
    let found = 0;
    for (let i = 0; i < 4000; i++) {
      const c1 = { center: point(50), radius: 1 + rand() * 40 };
      const c2 = { center: point(50), radius: 1 + rand() * 40 };
      for (const p of intersectCircles(c1, c2)) {
        found++;
        expect(Math.abs(distance(p, c1.center) - c1.radius)).toBeLessThan(1e-6);
        expect(Math.abs(distance(p, c2.center) - c2.radius)).toBeLessThan(1e-6);
      }
    }
    expect(found).toBeGreaterThan(500);
  });

  it('segment-circle intersections lie on the circle and on the segment', () => {
    let found = 0;
    for (let i = 0; i < 4000; i++) {
      const c = { center: point(30), radius: 1 + rand() * 30 };
      const a = point();
      const b = point();
      for (const p of intersectSegmentCircle(a, b, c)) {
        found++;
        expect(Math.abs(distance(p, c.center) - c.radius)).toBeLessThan(1e-6);
        expect(distancePointToSegment(p, a, b)).toBeLessThan(1e-6);
      }
    }
    expect(found).toBeGreaterThan(500);
  });

  it('the arc through three points passes through all three', () => {
    let built = 0;
    for (let i = 0; i < 4000; i++) {
      const p1 = point();
      const p2 = point();
      const p3 = point();
      const arc = arcFromThreePoints(p1, p2, p3);
      if (!arc) continue;
      built++;
      const onCircle = (p: ReturnType<typeof point>) => Math.abs(distance(p, arc.center) - arc.radius) <= 1e-6 * Math.max(1, arc.radius);
      expect(onCircle(p1) && onCircle(p2) && onCircle(p3)).toBe(true);
      // The middle point must lie inside the sweep, which is what makes it the right one of the two possible arcs.
      const sweep = arcSweep(arc);
      expect(sweep).toBeGreaterThan(0);
      const inSweep = (p: ReturnType<typeof point>) => {
        const angle = Math.atan2(p.y - arc.center.y, p.x - arc.center.x);
        const offset = (((angle - arc.startAngle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        return offset <= sweep + 1e-6 || 2 * Math.PI - offset < 1e-6;
      };
      expect(inSweep(p1) && inSweep(p2) && inSweep(p3)).toBe(true);
    }
    expect(built).toBeGreaterThan(3500);
  });

  it('rigid transforms preserve lengths, radii and sweeps for every entity type', () => {
    for (let i = 0; i < 2000; i++) {
      const m = compose(translation(coord(), coord()), rotation(rand() * 20 - 10, point()));
      const l: LineEntity = { id: 'l', type: 'line', layer: '0', color: null, start: point(), end: point() };
      const tl = transformEntity(l, m) as LineEntity;
      expect(distance(tl.start, tl.end)).toBeCloseTo(distance(l.start, l.end), 6);

      const c: CircleEntity = { id: 'c', type: 'circle', layer: '0', color: null, center: point(), radius: 1 + rand() * 10 };
      expect((transformEntity(c, m) as CircleEntity).radius).toBe(c.radius);

      const a: ArcEntity = { id: 'a', type: 'arc', layer: '0', color: null, center: point(), radius: 1 + rand() * 10, startAngle: rand() * 6, endAngle: rand() * 6 };
      if (arcSweep(a) === 0) continue;
      const ta = transformEntity(a, m) as ArcEntity;
      expect(arcSweep(ta)).toBeCloseTo(arcSweep(a), 6);
    }
  });

  it('transforming then inverse-transforming restores a line', () => {
    for (let i = 0; i < 1000; i++) {
      const centre = point();
      const angle = rand() * 6 - 3;
      const l: LineEntity = { id: 'l', type: 'line', layer: '0', color: null, start: point(), end: point() };
      const back = transformEntity(transformEntity(l, rotation(angle, centre)), rotation(-angle, centre)) as LineEntity;
      expect(distance(back.start, l.start)).toBeLessThan(1e-7);
      expect(distance(back.end, l.end)).toBeLessThan(1e-7);
    }
  });

  it('entity intersection is symmetric for lines and circles', () => {
    for (let i = 0; i < 1500; i++) {
      const l: LineEntity = { id: 'l', type: 'line', layer: '0', color: null, start: point(40), end: point(40) };
      const c: CircleEntity = { id: 'c', type: 'circle', layer: '0', color: null, center: point(20), radius: 1 + rand() * 25 };
      expect(intersectEntities(l, c).length).toBe(intersectEntities(c, l).length);
    }
  });
});
