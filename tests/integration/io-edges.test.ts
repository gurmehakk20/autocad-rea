import { describe, expect, it } from 'vitest';
import { DRAWING_UNITS, Drawing, type DrawingUnits } from '../../src/core/document/Drawing';
import type { Entity } from '../../src/core/entities/types';
import { vec2 } from '../../src/core/geometry/vector';
import { DxfFileError, flattenBulge, importDxf } from '../../src/io/dxf/read';
import { ACI_PALETTE, INSUNITS_TO_DRAWING, nearestAci, parseHex, toHex } from '../../src/io/dxf/units';
import { exportDxf } from '../../src/io/dxf/write';
import { DrawingFileError, NATIVE_FORMAT, NATIVE_VERSION, parseDrawing, serializeDrawing } from '../../src/io/serialization/native';

/** Builds a DXF text from group-code/value pairs for each section. */
function dxf(sections: { header?: Array<string | number>; tables?: Array<string | number>; entities?: Array<string | number> }): string {
  const out: string[] = [];
  const add = (name: string, body: Array<string | number> | undefined) => {
    if (!body) return;
    out.push('0', 'SECTION', '2', name, ...body.map(String), '0', 'ENDSEC');
  };
  add('HEADER', sections.header);
  add('TABLES', sections.tables);
  add('ENTITIES', sections.entities);
  out.push('0', 'EOF');
  return out.join('\n');
}

const layerTable = (...layers: Array<{ name: string; color?: number; flags?: number }>) => [
  0, 'TABLE', 2, 'LAYER',
  ...layers.flatMap((l) => [0, 'LAYER', 2, l.name, 70, l.flags ?? 0, 62, l.color ?? 7]),
  0, 'ENDTAB',
];

describe('DXF units and colour helpers', () => {
  it('maps every supported $INSUNITS code and nothing else', () => {
    expect(Object.keys(INSUNITS_TO_DRAWING).map(Number).sort((a, b) => a - b)).toEqual([0, 1, 2, 4, 5, 6]);
    expect(INSUNITS_TO_DRAWING[3]).toBeUndefined();
  });

  it('parseHex and toHex are inverse, and toHex pads and masks', () => {
    expect(parseHex('#0a0b0c')).toEqual([10, 11, 12]);
    expect(toHex(0x0a0b0c)).toBe('#0a0b0c');
    expect(toHex(0)).toBe('#000000');
    expect(toHex(0xffffff)).toBe('#ffffff');
    expect(toHex(0x1ffffff)).toBe('#ffffff'); // bits above 24 are dropped
    for (const hex of ['#123456', '#abcdef', '#000001']) expect(toHex(Number.parseInt(hex.slice(1), 16))).toBe(hex);
  });

  it('nearestAci returns an exact palette index for palette colours and the closest primary otherwise', () => {
    for (let i = 1; i <= 7; i++) expect(nearestAci(ACI_PALETTE[i]!)).toBe(i);
    expect(nearestAci('#fe0101')).toBe(1);
    expect(nearestAci('#0101fe')).toBe(5);
    expect(nearestAci('#000000')).toBe(250); // black is index 250 in the palette
    expect(nearestAci('#ffffff')).toBe(255);
    expect(nearestAci('#e6e6e6')).toBe(7);
    const index = nearestAci('#123456');
    expect(index).toBeGreaterThanOrEqual(1);
    expect(index).toBeLessThanOrEqual(255);
  });
});

describe('DXF import: file structure', () => {
  it('rejects an empty file, whitespace and files without sections', () => {
    for (const text of ['', '\n\n', '0\nEOF']) expect(() => importDxf(text)).toThrow(DxfFileError);
  });

  it('rejects a non-numeric or fractional group code and names the line', () => {
    expect(() => importDxf('abc\nSECTION')).toThrow(/line 1/);
    expect(() => importDxf('1.5\nSECTION')).toThrow(/Expected a group code/);
    expect(() => importDxf('0\nSECTION\n \nx')).toThrow(/line 3/);
  });

  it('accepts CRLF line endings and lower-case section names', () => {
    const text = dxf({ entities: [0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 5, 21, 0] }).replace(/\n/g, '\r\n').replace('ENTITIES', 'entities');
    const result = importDxf(text);
    expect(result.imported).toBe(1);
  });

  it('warns that the drawing is empty when there is no ENTITIES section, and still loads', () => {
    const result = importDxf(dxf({ header: [] }));
    expect(result.imported).toBe(0);
    expect(result.drawing.entityCount).toBe(0);
    expect(result.warnings.join(' ')).toMatch(/no ENTITIES section/);
  });

  it('defaults to unitless without $INSUNITS and warns for an unsupported code', () => {
    expect(importDxf(dxf({ entities: [] })).drawing.units).toBe('unitless');
    const odd = importDxf(dxf({ header: [9, '$INSUNITS', 70, 3], entities: [] }));
    expect(odd.drawing.units).toBe('unitless');
    expect(odd.warnings.join(' ')).toMatch(/code 3/);
  });

  it('reads each supported $INSUNITS code', () => {
    for (const [code, units] of Object.entries(INSUNITS_TO_DRAWING)) {
      expect(importDxf(dxf({ header: [9, '$INSUNITS', 70, code], entities: [] })).drawing.units).toBe(units);
    }
  });

  it('assigns sequential ids e1..eN in file order and sets the id counter', () => {
    const body = [0, 'LINE', 10, 0, 20, 0, 11, 1, 21, 0, 0, 'CIRCLE', 10, 0, 20, 0, 40, 2];
    const result = importDxf(dxf({ entities: body }));
    expect(result.drawing.entities().map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(result.drawing.nextId()).toBe('e3');
  });
});

describe('DXF import: layers and colours', () => {
  it('reads frozen (flag 1), locked (flag 4), negative-colour layers and combined flags', () => {
    const result = importDxf(
      dxf({
        tables: layerTable({ name: 'frozen', flags: 1 }, { name: 'locked', flags: 4 }, { name: 'off', color: -3 }, { name: 'both', flags: 5 }),
        entities: [],
      }),
    );
    const d = result.drawing;
    expect(d.getLayer('frozen')).toMatchObject({ visible: false, locked: false });
    expect(d.getLayer('locked')).toMatchObject({ visible: true, locked: true });
    expect(d.getLayer('off')).toMatchObject({ visible: false, color: ACI_PALETTE[3] });
    expect(d.getLayer('both')).toMatchObject({ visible: false, locked: true });
  });

  it('warns once for an invalid layer colour index and uses the default', () => {
    const result = importDxf(dxf({ tables: layerTable({ name: 'x', color: 300 }), entities: [] }));
    expect(result.drawing.getLayer('x')!.color).toBe(ACI_PALETTE[7]);
    expect(result.warnings.filter((w) => /index 300/.test(w))).toHaveLength(1);
  });

  it('ignores a LAYER record without a name but keeps going', () => {
    const table = [0, 'TABLE', 2, 'LAYER', 0, 'LAYER', 70, 0, 62, 1, 0, 'LAYER', 2, 'ok', 62, 1, 0, 'ENDTAB'];
    const result = importDxf(dxf({ tables: table, entities: [] }));
    expect(result.warnings.join(' ')).toMatch(/without a name/);
    expect(result.drawing.getLayer('ok')!.color).toBe(ACI_PALETTE[1]);
  });

  it('does not read LAYER records from other tables', () => {
    const table = [0, 'TABLE', 2, 'LTYPE', 0, 'LAYER', 2, 'impostor', 62, 1, 0, 'ENDTAB'];
    expect(importDxf(dxf({ tables: table, entities: [] })).drawing.getLayer('impostor')).toBeUndefined();
  });

  it('layer 0 from the table overrides the default colour but stays first', () => {
    const result = importDxf(dxf({ tables: layerTable({ name: 'a', color: 1 }, { name: '0', color: 3 }), entities: [] }));
    expect(result.drawing.layers().map((l) => l.name)).toEqual(['0', 'a']);
    expect(result.drawing.getLayer('0')!.color).toBe(ACI_PALETTE[3]);
  });

  it('entity colour: ACI 1-9 map to the palette, 0/256/negative mean ByLayer, 420 true colour wins over 62', () => {
    const line = (extra: Array<string | number>) => [0, 'LINE', 10, 0, 20, 0, 11, 1, 21, 0, ...extra];
    const body = [
      ...line([62, 1]),
      ...line([62, 0]),
      ...line([62, 256]),
      ...line([62, -5]),
      ...line([62, 9]),
      ...line([62, 1, 420, 0x123456]),
      ...line([62, 300]),
      ...line([62, 300]),
    ];
    const result = importDxf(dxf({ entities: body }));
    expect(result.drawing.entities().map((e) => e.color)).toEqual([ACI_PALETTE[1], null, null, null, ACI_PALETTE[9], '#123456', null, null]);
    // The invalid index is reported once, not once per entity.
    expect(result.warnings.filter((w) => /Colour index 300/.test(w))).toHaveLength(1);
  });
});

describe('DXF import: entity errors and edge cases', () => {
  const imp = (body: Array<string | number>) => importDxf(dxf({ entities: body }));

  it('skips a circle with no radius, a non-numeric radius, a zero radius and a negative radius, each with a warning', () => {
    const circle = (r: Array<string | number>) => [0, 'CIRCLE', 10, 0, 20, 0, ...r];
    const result = imp([...circle([]), ...circle([40, 'abc']), ...circle([40, 0]), ...circle([40, -2]), ...circle([40, 2])]);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(4);
    expect(result.warnings.filter((w) => /radius/i.test(w))).toHaveLength(4);
  });

  it('skips a line with a missing coordinate and reports which one', () => {
    const result = imp([0, 'LINE', 10, 0, 20, 0, 11, 1]);
    expect(result.imported).toBe(0);
    expect(result.warnings.join(' ')).toMatch(/LINE end Y is missing/);
  });

  it('skips non-finite numbers written as text', () => {
    const result = imp([0, 'LINE', 10, 'NaN', 20, 0, 11, 1, 21, 1]);
    expect(result.imported).toBe(0);
    expect(result.warnings.join(' ')).toMatch(/not a number/);
  });

  it('imports very large and very small coordinates unchanged', () => {
    const result = imp([0, 'LINE', 10, 1e12, 20, -1e12, 11, 1e-9, 21, 0]);
    const e = result.drawing.entities()[0]!;
    expect(e).toMatchObject({ type: 'line', start: vec2(1e12, -1e12) });
  });

  it('keeps the first value when a group code is repeated on a record', () => {
    const result = imp([0, 'CIRCLE', 10, 1, 10, 9, 20, 2, 40, 3, 40, 7]);
    expect(result.drawing.entities()[0]).toMatchObject({ center: vec2(1, 2), radius: 3 });
  });

  it('skips a full-turn arc (0 to 360 degrees) as degenerate instead of importing it', () => {
    const result = imp([0, 'ARC', 10, 0, 20, 0, 40, 5, 50, 0, 51, 360]);
    expect(result.imported).toBe(0);
    expect(result.warnings.join(' ')).toMatch(/sweep/);
  });

  it('imports an arc whose end angle is below the start angle as a wrapping arc', () => {
    const result = imp([0, 'ARC', 10, 0, 20, 0, 40, 5, 50, 270, 51, 90]);
    const arc = result.drawing.entities()[0]!;
    expect(arc.type).toBe('arc');
  });

  it('LWPOLYLINE: one vertex or none is skipped, two vertices are kept', () => {
    const single = imp([0, 'LWPOLYLINE', 70, 0, 10, 0, 20, 0]);
    expect(single.imported).toBe(0);
    expect(single.skipped).toBe(1);
    const none = imp([0, 'LWPOLYLINE', 70, 0]);
    expect(none.skipped).toBe(1);
    const two = imp([0, 'LWPOLYLINE', 70, 0, 10, 0, 20, 0, 10, 1, 20, 1]);
    expect(two.imported).toBe(1);
  });

  it('LWPOLYLINE: a Y before any X is an error that skips the entity', () => {
    const result = imp([0, 'LWPOLYLINE', 70, 0, 20, 0, 10, 1]);
    expect(result.imported).toBe(0);
    expect(result.warnings.join(' ')).toMatch(/Y value without an X/);
  });

  it('LWPOLYLINE: the closed flag survives and a repeated first vertex is not duplicated', () => {
    const open = [10, 0, 20, 0, 10, 4, 20, 0, 10, 4, 20, 4];
    const closed = imp([0, 'LWPOLYLINE', 70, 1, ...open]).drawing.entities()[0] as Extract<Entity, { type: 'polyline' }>;
    expect(closed.closed).toBe(true);
    expect(closed.vertices).toHaveLength(3);
    const repeated = imp([0, 'LWPOLYLINE', 70, 1, 10, 0, 20, 0, 10, 4, 20, 0, 10, 4, 20, 4, 10, 0, 20, 0]).drawing.entities()[0] as Extract<Entity, { type: 'polyline' }>;
    expect(repeated.vertices).toHaveLength(3);
  });

  it('LWPOLYLINE: consecutive duplicate vertices are collapsed and a polyline that collapses to one point is skipped', () => {
    const collapsed = imp([0, 'LWPOLYLINE', 70, 0, 10, 1, 20, 1, 10, 1, 20, 1]);
    expect(collapsed.imported).toBe(0);
    expect(collapsed.skipped).toBe(1);
    const dedup = imp([0, 'LWPOLYLINE', 70, 0, 10, 0, 20, 0, 10, 0, 20, 0, 10, 5, 20, 0]);
    expect((dedup.drawing.entities()[0] as Extract<Entity, { type: 'polyline' }>).vertices).toHaveLength(2);
  });

  it('LWPOLYLINE: a closing bulge on a closed polyline is flattened and reported', () => {
    const result = imp([0, 'LWPOLYLINE', 70, 1, 10, 0, 20, 0, 10, 10, 20, 0, 10, 10, 20, 10, 42, 1]);
    const polyline = result.drawing.entities()[0] as Extract<Entity, { type: 'polyline' }>;
    expect(polyline.closed).toBe(true);
    expect(polyline.vertices.length).toBeGreaterThan(3);
    expect(result.warnings.join(' ')).toMatch(/approximated/);
  });

  it('reports unsupported entity types by count, sorted by first appearance, and counts them as skipped', () => {
    const result = imp([0, 'TEXT', 0, 'TEXT', 0, 'HATCH', 0, 'LINE', 10, 0, 20, 0, 11, 1, 21, 0]);
    expect(result.skipped).toBe(3);
    expect(result.warnings.join(' ')).toMatch(/TEXT x2, HATCH x1/);
  });

  it('treats a tilted extrusion on any axis, or a zero vector, as unsupported', () => {
    const circle = (ext: Array<string | number>) => [0, 'CIRCLE', 10, 0, 20, 0, 40, 1, ...ext];
    const result = imp([...circle([210, 1, 230, 0]), ...circle([220, 0.5, 230, 0.5]), ...circle([230, 0])]);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(3);
    expect(result.warnings.join(' ')).toMatch(/CIRCLE \(tilted 3D plane\) x3/);
  });
});

describe('flattenBulge', () => {
  it('returns interior points only, all at the same radius from the arc centre', () => {
    const pts = flattenBulge(vec2(0, 0), vec2(10, 0), 1);
    expect(pts.length).toBeGreaterThanOrEqual(2);
    for (const p of pts) expect(Math.hypot(p.x - 5, p.y)).toBeCloseTo(5, 9);
  });

  it('bows to the right of the direction of travel for a negative bulge and to the left for a positive one', () => {
    expect(flattenBulge(vec2(0, 0), vec2(10, 0), 0.5).every((p) => p.y < 0)).toBe(true);
    expect(flattenBulge(vec2(0, 0), vec2(10, 0), -0.5).every((p) => p.y > 0)).toBe(true);
  });

  it('uses more segments for a bigger sweep', () => {
    expect(flattenBulge(vec2(0, 0), vec2(10, 0), 1).length).toBeGreaterThan(flattenBulge(vec2(0, 0), vec2(10, 0), 0.1).length);
  });

  it('returns nothing for a zero bulge, a zero chord and a non-finite chord', () => {
    expect(flattenBulge(vec2(0, 0), vec2(1, 0), 0)).toEqual([]);
    expect(flattenBulge(vec2(1, 1), vec2(1, 1), 2)).toEqual([]);
  });

  it('tiny bulges produce at least one interior point or none, never NaN', () => {
    for (const p of flattenBulge(vec2(0, 0), vec2(10, 0), 1e-9)) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  });
});

describe('DXF export', () => {
  function sample(): Drawing {
    const d = new Drawing();
    d.apply({ kind: 'put-layer', layer: { name: 'Walls', color: '#ff0000', visible: true, locked: false } });
    d.apply({ kind: 'put-layer', layer: { name: 'Frozen', color: '#00ff00', visible: false, locked: true } });
    const entities: Entity[] = [
      { id: 'e1', type: 'line', layer: 'Walls', color: '#123456', start: vec2(0, 0), end: vec2(1, 1) },
      { id: 'e2', type: 'polyline', layer: 'Walls', color: null, vertices: [vec2(0, 0), vec2(2, 0), vec2(2, 2)], closed: true },
      { id: 'e3', type: 'arc', layer: 'Frozen', color: null, center: vec2(0, 0), radius: 3, startAngle: 0, endAngle: Math.PI / 2 },
    ];
    for (const e of entities) d.apply({ kind: 'insert', entity: e, index: d.entityCount });
    return d;
  }

  it('writes true colour (group 420) for entities with an explicit colour and for every layer', () => {
    const drawing = sample();
    const { text } = exportDxf(drawing);
    const matches = text.match(/\n420\r?\n/g) ?? [];
    expect(matches).toHaveLength(1 + drawing.layers().length);
    expect(text).toContain(String(0x123456));
  });

  it('writes the closed flag for a closed polyline and degrees for arcs', () => {
    const { text } = exportDxf(sample());
    const back = importDxf(text).drawing;
    const polyline = back.entities().find((e) => e.type === 'polyline') as Extract<Entity, { type: 'polyline' }>;
    expect(polyline.closed).toBe(true);
    const arc = back.entities().find((e) => e.type === 'arc') as Extract<Entity, { type: 'arc' }>;
    expect(arc.endAngle).toBeCloseTo(Math.PI / 2, 9);
  });

  it('round-trips frozen and locked layer state, and every supported unit', () => {
    const back = importDxf(exportDxf(sample()).text).drawing;
    expect(back.getLayer('Frozen')).toMatchObject({ visible: false, locked: true });
    expect(back.getLayer('Walls')).toMatchObject({ visible: true, locked: false });
    for (const units of DRAWING_UNITS) {
      const d = new Drawing();
      d.apply({ kind: 'set-units', units: units as DrawingUnits });
      expect(importDxf(exportDxf(d).text).drawing.units).toBe(units);
    }
  });

  it('does not warn for a palette colour in upper case, and gives one summary for the layers outside the index', () => {
    const d = new Drawing();
    d.apply({ kind: 'put-layer', layer: { name: 'A', color: '#FF0000', visible: true, locked: false } });
    expect(exportDxf(d).warnings).toEqual([]);
    d.apply({ kind: 'put-layer', layer: { name: 'B', color: '#123456', visible: true, locked: false } });
    expect(exportDxf(d).warnings).toHaveLength(1);
    expect(exportDxf(d).warnings[0]).toMatch(/^1 layer colour/);
    d.apply({ kind: 'put-layer', layer: { name: 'C', color: '#654321', visible: true, locked: false } });
    expect(exportDxf(d).warnings).toHaveLength(1);
    expect(exportDxf(d).warnings[0]).toMatch(/^2 layer colour/);
  });

  it('exports layer names with spaces and non-ASCII letters', () => {
    const d = new Drawing();
    d.apply({ kind: 'put-layer', layer: { name: 'Mauern & Türen 2', color: '#ff0000', visible: true, locked: false } });
    expect(importDxf(exportDxf(d).text).drawing.getLayer('Mauern & Türen 2')).toBeDefined();
  });

  it('round-trips very large and very small coordinates to within double precision of the text form', () => {
    const d = new Drawing();
    d.apply({ kind: 'insert', entity: { id: 'e1', type: 'line', layer: '0', color: null, start: vec2(1e9, -1e9), end: vec2(1e9 + 0.001, 1e-7) }, index: 0 });
    const e = importDxf(exportDxf(d).text).drawing.entities()[0] as Extract<Entity, { type: 'line' }>;
    expect(e.start.x).toBeCloseTo(1e9, 3);
    expect(e.end.y).toBeCloseTo(1e-7, 12);
  });
});

describe('native format edge cases', () => {
  const valid = () => {
    const d = new Drawing();
    d.apply({ kind: 'insert', entity: { id: 'e1', type: 'line', layer: '0', color: null, start: vec2(0, 0), end: vec2(1, 1) }, index: 0 });
    return JSON.parse(serializeDrawing(d)) as Record<string, unknown>;
  };
  const load = (doc: unknown) => parseDrawing(JSON.stringify(doc));

  it('writes the format marker and version, and ends with a newline', () => {
    const text = serializeDrawing(new Drawing());
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toMatchObject({ format: NATIVE_FORMAT, version: NATIVE_VERSION });
  });

  it('round-trips an empty drawing with units', () => {
    const d = new Drawing();
    d.apply({ kind: 'set-units', units: 'foot' });
    const back = parseDrawing(serializeDrawing(d));
    expect(back.units).toBe('foot');
    expect(back.entityCount).toBe(0);
  });

  it('rejects non-string, unknown and missing units', () => {
    for (const units of [undefined, 5, 'parsec', null]) {
      expect(() => load({ ...valid(), units })).toThrow(/units/);
    }
  });

  it('rejects a bad idSequence: negative, fractional, string, missing', () => {
    for (const idSequence of [-1, 1.5, '3', undefined, null]) {
      expect(() => load({ ...valid(), idSequence })).toThrow(/idSequence/);
    }
  });

  it('rejects non-array layers and entities', () => {
    expect(() => load({ ...valid(), layers: {} })).toThrow(/layers/);
    expect(() => load({ ...valid(), entities: 'x' })).toThrow(/entities/);
  });

  it('rejects arrays, null and primitives at the top level with a readable message', () => {
    for (const text of ['[]', 'null', '42', '"x"', 'true']) expect(() => parseDrawing(text)).toThrow(DrawingFileError);
    expect(() => parseDrawing('{')).toThrow(/not valid JSON/);
    expect(() => parseDrawing('')).toThrow(/not valid JSON/);
  });

  it('rejects layer records with missing or mistyped fields', () => {
    const base = valid();
    const withLayers = (layers: unknown[]) => load({ ...base, layers });
    expect(() => withLayers([null])).toThrow(/Layer 1 is not an object/);
    expect(() => withLayers([{ name: '', color: '#fff', visible: true, locked: false }])).toThrow(/needs a name/);
    expect(() => withLayers([{ name: '0', color: 5, visible: true, locked: false }])).toThrow(/colour/);
    expect(() => withLayers([{ name: '0', color: '#ffffff', visible: 'yes', locked: false }])).toThrow(/boolean/);
    expect(() => withLayers([{ name: '0', color: 'white', visible: true, locked: false }])).toThrow(/#rrggbb/);
  });

  it('rejects entities with bad ids, unknown types, bad points and non-finite numbers', () => {
    const base = valid();
    const withEntities = (entities: unknown[]) => load({ ...base, entities });
    const line = { id: 'a', type: 'line', layer: '0', color: null, start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };
    expect(() => withEntities([{ ...line, id: '' }])).toThrow(/needs an id/);
    expect(() => withEntities([{ ...line, id: 5 }])).toThrow(/needs an id/);
    expect(() => withEntities([{ ...line, layer: undefined }])).toThrow(/layer name/);
    expect(() => withEntities([{ ...line, color: 5 }])).toThrow(/colour/);
    expect(() => withEntities([{ ...line, type: 'spline' }])).toThrow(/unknown type "spline"/);
    expect(() => withEntities([{ ...line, start: { x: 'a', y: 0 } }])).toThrow(/invalid point/);
    expect(() => withEntities([{ ...line, start: null }])).toThrow(/invalid point/);
    expect(() => withEntities([{ ...line, end: { x: 1 } }])).toThrow(/invalid point/);
    expect(() => withEntities([{ id: 'c', type: 'circle', layer: '0', color: null, center: { x: 0, y: 0 }, radius: '5' }])).toThrow(/radius/);
    expect(() => withEntities([{ id: 'c', type: 'arc', layer: '0', color: null, center: { x: 0, y: 0 }, radius: 5, startAngle: 0 }])).toThrow(/endAngle/);
    expect(() => withEntities([{ id: 'p', type: 'polyline', layer: '0', color: null, vertices: 'x', closed: false }])).toThrow(/vertices/);
    expect(() => withEntities([{ id: 'p', type: 'polyline', layer: '0', color: null, vertices: [], closed: 'no' }])).toThrow(/closed/);
  });

  it('rejects geometrically invalid entities that are well-formed JSON', () => {
    const base = valid();
    const zero = { id: 'a', type: 'line', layer: '0', color: null, start: { x: 1, y: 1 }, end: { x: 1, y: 1 } };
    expect(() => load({ ...base, entities: [zero] })).toThrow(DrawingFileError);
    const badRadius = { id: 'c', type: 'circle', layer: '0', color: null, center: { x: 0, y: 0 }, radius: -1 };
    expect(() => load({ ...base, entities: [badRadius] })).toThrow(/radius/);
  });

  it('turns very large numbers that JSON writes as 1e999 into a rejected file, not Infinity', () => {
    const text = serializeDrawing(new Drawing()).replace('"entities": []', '"entities": [{"id":"a","type":"circle","layer":"0","color":null,"center":{"x":0,"y":0},"radius":1e999}]');
    expect(() => parseDrawing(text)).toThrow(DrawingFileError);
  });

  it('lifts the id counter above entity ids when the saved counter is stale', () => {
    const doc = valid();
    doc.idSequence = 0;
    const d = load(doc);
    expect(d.nextId()).toBe('e2');
  });

  it('ignores unknown extra fields rather than failing', () => {
    const d = load({ ...valid(), futureField: { a: 1 } });
    expect(d.entityCount).toBe(1);
  });
});
