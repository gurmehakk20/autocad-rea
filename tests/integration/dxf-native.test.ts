import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Drawing, type Layer } from '../../src/core/document/Drawing';
import { arcSweep } from '../../src/core/geometry/arc';
import { vec2 } from '../../src/core/geometry/vector';
import type { Entity } from '../../src/core/entities/types';
import { DxfFileError, flattenBulge, importDxf } from '../../src/io/dxf/read';
import { exportDxf } from '../../src/io/dxf/write';
import { DrawingFileError, NATIVE_FORMAT, NATIVE_VERSION, parseDrawing, serializeDrawing } from '../../src/io/serialization/native';

const fixture = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8');
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

/** Builds a drawing programmatically with a range of entity types and colours. */
function sampleDrawing(): Drawing {
  const d = new Drawing();
  d.apply({ kind: 'set-units', units: 'mm' });
  const walls: Layer = { name: 'Walls', color: '#ff0000', visible: true, locked: false };
  const hidden: Layer = { name: 'Hidden', color: '#00ff00', visible: false, locked: true };
  d.apply({ kind: 'put-layer', layer: walls });
  d.apply({ kind: 'put-layer', layer: hidden });
  const entities: Entity[] = [
    { id: d.nextId(), type: 'line', layer: 'Walls', color: null, start: vec2(-12.5, 0), end: vec2(1e6, 3.25) },
    { id: d.nextId(), type: 'circle', layer: '0', color: '#123456', center: vec2(50, -50), radius: 7.5 },
    { id: d.nextId(), type: 'arc', layer: 'Walls', color: null, center: vec2(0, 0), radius: 5, startAngle: 0, endAngle: Math.PI / 2 },
    { id: d.nextId(), type: 'polyline', layer: 'Hidden', color: null, closed: true, vertices: [vec2(0, 0), vec2(10, 0), vec2(10, 10)] },
  ];
  for (const e of entities) d.apply({ kind: 'insert', entity: e, index: d.entityCount });
  return d;
}

describe('DXF import', () => {
  it('reads units, layers, supported entities and reports unsupported ones', () => {
    const result = importDxf(fixture('mixed-sample.dxf'));
    const d = result.drawing;

    expect(d.units).toBe('mm');
    expect(d.getLayer('Walls')).toMatchObject({ color: '#ff0000', visible: true });
    expect(d.getLayer('Hidden')).toMatchObject({ visible: false, locked: true });
    expect(result.imported).toBe(4);
    expect(result.skipped).toBe(1);
    expect(result.warnings.join('\n')).toMatch(/TEXT x1/);
    expect(result.warnings.join('\n')).toMatch(/approximated with straight segments/);
  });

  it('imports explicit true colour and leaves ByLayer entities without a colour', () => {
    const d = importDxf(fixture('mixed-sample.dxf')).drawing;
    const [line, circle] = d.entities();
    expect(line?.color).toBeNull();
    expect(circle).toMatchObject({ type: 'circle', color: '#ff0000', radius: 25 });
  });

  it('converts DXF arc angles from degrees to radians', () => {
    const arc = importDxf(fixture('mixed-sample.dxf')).drawing.entities().find((e) => e.type === 'arc');
    expect(arc?.type).toBe('arc');
    if (arc?.type !== 'arc') return;
    close(arc.startAngle, 0);
    close(arc.endAngle, Math.PI / 2);
    close(arcSweep(arc), Math.PI / 2);
  });

  it('flattens bulge segments into points that stay on the true arc', () => {
    const d = importDxf(fixture('mixed-sample.dxf')).drawing;
    const poly = d.entities().find((e) => e.type === 'polyline');
    expect(poly?.type).toBe('polyline');
    if (poly?.type !== 'polyline') return;
    expect(poly.closed).toBe(true);
    expect(poly.vertices.length).toBeGreaterThan(3);
    expect(poly.vertices[0]).toEqual({ x: 0, y: 0 });
    // Every flattened point of the first bulge segment lies on the same circle as the chord endpoints.
    const first = poly.vertices.slice(0, 23);
    const centre = bulgeCentre(vec2(0, 0), vec2(100, 0), 0.5);
    const r = Math.hypot(centre.x, centre.y);
    for (const p of first) close(Math.hypot(p.x - centre.x, p.y - centre.y), r, 1e-6);
  });

  it('matches a semicircle bulge to the expected geometry', () => {
    // Positive bulge is counter-clockwise, so the arc from (0,0) to (2,0) bows below the chord.
    const pts = flattenBulge(vec2(0, 0), vec2(2, 0), 1);
    expect(pts.length).toBeGreaterThan(10);
    for (const p of pts) close(Math.hypot(p.x - 1, p.y), 1, 1e-9);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...ys)).toBeLessThan(-0.99);
    expect(Math.max(...ys)).toBeLessThanOrEqual(1e-9);
  });

  it('treats straight segments and degenerate chords as no-op bulges', () => {
    expect(flattenBulge(vec2(0, 0), vec2(5, 0), 0)).toEqual([]);
    expect(flattenBulge(vec2(1, 1), vec2(1, 1), 0.7)).toEqual([]);
  });

  it('rejects text that is not DXF', () => {
    expect(() => importDxf('hello world')).toThrow(DxfFileError);
    expect(() => importDxf('0\nSECTION\n2\nHEADER\n')).not.toThrow(); // structurally valid, just empty
    expect(() => importDxf('0\nLINE\n8\n0\n')).toThrow(/No DXF sections/);
  });

  it('reports a dangling group code', () => {
    expect(() => importDxf('0\nSECTION\n2\nENTITIES\n10')).toThrow(/group code that has no value/);
  });

  it('skips invalid entities with a warning instead of importing zero-length geometry', () => {
    const text = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LINE', '8', '0', '10', '1', '20', '1', '11', '1', '21', '1',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n');
    const r = importDxf(text);
    expect(r.imported).toBe(0);
    expect(r.warnings.join('\n')).toMatch(/zero length/);
  });

  it('warns about unsupported units and colour indices', () => {
    const text = [
      '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '99', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LINE', '8', '0', '62', '42', '10', '0', '20', '0', '11', '1', '21', '0',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n');
    const r = importDxf(text);
    expect(r.drawing.units).toBe('unitless');
    expect(r.warnings.join('\n')).toMatch(/units code 99/);
    expect(r.warnings.join('\n')).toMatch(/Colour index 42/);
    expect(r.drawing.entities()[0]?.color).toBeNull();
  });

  it('creates missing layers used by entities and warns', () => {
    const text = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LINE', '8', 'Ghost', '10', '0', '20', '0', '11', '1', '21', '0',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n');
    const r = importDxf(text);
    expect(r.drawing.getLayer('Ghost')).toBeDefined();
    expect(r.warnings.join('\n')).toMatch(/Ghost/);
  });
});

describe('DXF export and round trip', () => {
  it('writes supported entities with the expected DXF records', () => {
    const { text } = exportDxf(sampleDrawing());
    expect(text).toMatch(/\nLINE\n/);
    expect(text).toMatch(/\nCIRCLE\n/);
    expect(text).toMatch(/\nARC\n/);
    expect(text).toMatch(/\nLWPOLYLINE\n/);
    expect(text).toMatch(/\$INSUNITS\s*\n\s*70\s*\n\s*4\s*\n/);
  });

  it('round-trips geometry, layers, units, visibility and explicit colours', () => {
    const original = sampleDrawing();
    const { text, warnings } = exportDxf(original);
    expect(warnings).toEqual([]);

    const back = importDxf(text);
    expect(back.warnings).toEqual([]);
    const d = back.drawing;
    expect(d.units).toBe('mm');
    expect(d.getLayer('Walls')).toMatchObject({ color: '#ff0000', visible: true });
    expect(d.getLayer('Hidden')).toMatchObject({ visible: false, locked: true });

    const a = original.entities();
    const b = d.entities();
    expect(b.map((e) => e.type)).toEqual(a.map((e) => e.type));
    expect(b[0]).toMatchObject({ layer: 'Walls', color: null });
    expect(b[1]).toMatchObject({ layer: '0', color: '#123456' });

    const line0 = b[0] as Extract<Entity, { type: 'line' }>;
    close(line0.start.x, -12.5, 1e-9);
    close(line0.end.x, 1e6, 1e-6);
    close(line0.end.y, 3.25, 1e-9);

    const arc = b[2] as Extract<Entity, { type: 'arc' }>;
    close(arc.endAngle, Math.PI / 2, 1e-9);
    close(arc.radius, 5, 1e-9);
  });

  it('warns when a layer colour cannot be represented in the AutoCAD palette', () => {
    const d = new Drawing();
    d.apply({ kind: 'put-layer', layer: { name: 'Teal', color: '#123456', visible: true, locked: false } });
    const { warnings } = exportDxf(d);
    expect(warnings.join('\n')).toMatch(/Layer "Teal" colour #123456 was approximated/);
  });

  it('exports an empty drawing that imports back as empty', () => {
    const back = importDxf(exportDxf(new Drawing()).text);
    expect(back.imported).toBe(0);
    expect(back.drawing.getLayer('0')).toBeDefined();
  });
});

describe('native drawing format', () => {
  it('round-trips a drawing exactly, including id sequence and layer state', () => {
    const original = sampleDrawing();
    const text = serializeDrawing(original);
    const back = parseDrawing(text);
    expect(back.entities()).toEqual(original.entities());
    expect(back.layers()).toEqual(original.layers());
    expect(back.units).toBe('mm');
    expect(back.idSequence).toBe(original.idSequence);
    expect(back.nextId()).toBe(`e${original.idSequence + 1}`);
    expect(JSON.parse(text)).toMatchObject({ format: NATIVE_FORMAT, version: NATIVE_VERSION });
  });

  it('rejects files that are not drawings, with a readable message', () => {
    expect(() => parseDrawing('not json')).toThrow(/not valid JSON/);
    expect(() => parseDrawing('[]')).toThrow(/does not contain a drawing/);
    expect(() => parseDrawing('{"format":"other"}')).toThrow(/not an OpenDraft/);
  });

  it('rejects future or unknown format versions', () => {
    const doc = JSON.parse(serializeDrawing(new Drawing()));
    expect(() => parseDrawing(JSON.stringify({ ...doc, version: 99 }))).toThrow(/version 99/);
    expect(() => parseDrawing(JSON.stringify({ ...doc, units: 'furlong' }))).toThrow(/Unknown drawing units/);
  });

  it('validates each entity before loading anything', () => {
    const doc = JSON.parse(serializeDrawing(sampleDrawing()));
    const badRadius = { ...doc, entities: [...doc.entities, { id: 'bad', type: 'circle', layer: '0', color: null, center: { x: 0, y: 0 }, radius: 'big' }] };
    expect(() => parseDrawing(JSON.stringify(badRadius))).toThrow(DrawingFileError);
    expect(() => parseDrawing(JSON.stringify(badRadius))).toThrow(/radius/);

    const zeroLine = { ...doc, entities: [{ id: 'z', type: 'line', layer: '0', color: null, start: { x: 1, y: 1 }, end: { x: 1, y: 1 } }] };
    expect(() => parseDrawing(JSON.stringify(zeroLine))).toThrow(/zero length/);
  });

  it('rejects duplicate ids and missing layer 0', () => {
    const doc = JSON.parse(serializeDrawing(sampleDrawing()));
    const dup = { ...doc, entities: [doc.entities[0], doc.entities[0]] };
    expect(() => parseDrawing(JSON.stringify(dup))).toThrow(/Duplicate entity id/);
    const noZero = { ...doc, layers: doc.layers.filter((l: { name: string }) => l.name !== '0') };
    expect(() => parseDrawing(JSON.stringify(noZero))).toThrow(/layer "0"/);
  });

  it('rejects an entity that refers to a layer that does not exist', () => {
    const doc = JSON.parse(serializeDrawing(new Drawing()));
    const orphan = { ...doc, entities: [{ id: 'x', type: 'line', layer: 'Nope', color: null, start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }] };
    expect(() => parseDrawing(JSON.stringify(orphan))).toThrow(/does not exist/);
  });
});

/** Centre of the circle through the chord endpoints for a given bulge, used to verify flattened points. */
function bulgeCentre(p1: { x: number; y: number }, p2: { x: number; y: number }, bulge: number) {
  const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const included = 4 * Math.atan(Math.abs(bulge));
  const radius = chord / (2 * Math.sin(included / 2));
  const nx = -(p2.y - p1.y) / chord;
  const ny = (p2.x - p1.x) / chord;
  const sign = bulge > 0 ? 1 : -1;
  const d = radius * Math.cos(included / 2) * sign;
  return vec2((p1.x + p2.x) / 2 + nx * d, (p1.y + p2.y) / 2 + ny * d);
}
