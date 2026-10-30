import { describe, expect, it } from 'vitest';
import { Drawing } from '../../src/core/document/Drawing';
import { vec2 } from '../../src/core/geometry/vector';
import { ACI_TABLE } from '../../src/io/dxf/aci';
import { importDxf } from '../../src/io/dxf/read';
import { ACI_PALETTE, nearestAci, parseHex } from '../../src/io/dxf/units';
import { exportDxf } from '../../src/io/dxf/write';

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

const randomHex = (r: () => number) => `#${Math.floor(r() * 0x1000000).toString(16).padStart(6, '0')}`;

/** A DXF with one layer table record and one LINE per entry, written as raw group code pairs. */
function dxfText(layers: Array<Array<string | number>>, entities: Array<Array<string | number>> = []): string {
  const pairs: Array<string | number> = [0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER'];
  for (const layer of layers) pairs.push(0, 'LAYER', ...layer);
  pairs.push(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
  for (const extra of entities) pairs.push(0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 1, 21, 0, ...extra);
  pairs.push(0, 'ENDSEC', 0, 'EOF');
  return pairs.join('\n');
}

describe('the AutoCAD colour index table', () => {
  it('has 256 entries, each a lower-case #rrggbb, with index 0 as a placeholder', () => {
    expect(ACI_TABLE).toHaveLength(256);
    for (const [i, hex] of ACI_TABLE.entries()) expect(hex, `index ${i}`).toMatch(/^#[0-9a-f]{6}$/);
    expect(ACI_TABLE[0]).toBe('#000000');
  });

  it('holds the primary colours at 1 to 6 and the greys at 8 and 9', () => {
    expect(ACI_TABLE.slice(1, 7)).toEqual(['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff']);
    expect(ACI_TABLE[8]).toBe('#808080');
    expect(ACI_TABLE[9]).toBe('#c0c0c0');
  });

  it('repeats the primaries at the head of each hue group and ends with white', () => {
    expect(ACI_TABLE[10]).toBe('#ff0000');
    expect(ACI_TABLE[255]).toBe('#ffffff');
  });

  it('ACI_PALETTE covers 1 to 255 only, and shows index 7 as the workspace default linework colour', () => {
    expect(Object.keys(ACI_PALETTE)).toHaveLength(255);
    expect(ACI_PALETTE[0]).toBeUndefined();
    expect(ACI_PALETTE[256]).toBeUndefined();
    expect(ACI_PALETTE[7]).toBe('#e6e6e6');
    for (let i = 1; i <= 255; i++) if (i !== 7) expect(ACI_PALETTE[i], `index ${i}`).toBe(ACI_TABLE[i]);
  });

  it('nearestAci finds a palette entry with exactly the same colour for every palette colour', () => {
    for (let i = 1; i <= 255; i++) {
      const found = nearestAci(ACI_PALETTE[i]!);
      expect(ACI_PALETTE[found], `index ${i}`).toBe(ACI_PALETTE[i]);
      expect(found).toBeLessThanOrEqual(i); // the lowest index with that colour
    }
  });

  it('nearestAci never returns an index outside 1 to 255 and picks the closest colour', () => {
    const r = rng(3);
    for (let n = 0; n < 300; n++) {
      const hex = randomHex(r);
      const best = nearestAci(hex);
      expect(best).toBeGreaterThanOrEqual(1);
      expect(best).toBeLessThanOrEqual(255);
      const t = parseHex(hex);
      const dist = (i: number) => parseHex(ACI_PALETTE[i]!).reduce((s, c, k) => s + (c - t[k]!) ** 2, 0);
      for (let i = 1; i <= 255; i++) expect(dist(best)).toBeLessThanOrEqual(dist(i));
    }
  });
});

describe('importing colour indices 1 to 255', () => {
  it('maps every index on a layer and on an entity to its table colour, with no warnings', () => {
    const layers = Array.from({ length: 255 }, (_, k) => [2, `L${k + 1}`, 70, 0, 62, k + 1]);
    const entities = Array.from({ length: 255 }, (_, k) => [62, k + 1]);
    const result = importDxf(dxfText(layers, entities));
    expect(result.warnings).toEqual([]);
    for (let i = 1; i <= 255; i++) expect(result.drawing.getLayer(`L${i}`)!.color, `layer index ${i}`).toBe(ACI_PALETTE[i]);
    expect(result.drawing.entities().map((e) => e.color)).toEqual(Array.from({ length: 255 }, (_, k) => ACI_PALETTE[k + 1]));
  });

  it('reads the indices that used to be dropped (30, 140, 253)', () => {
    const result = importDxf(dxfText([[2, 'warm', 70, 0, 62, 30], [2, 'cool', 70, 0, 62, 140]], [[62, 253], [62, 30]]));
    expect(result.drawing.getLayer('warm')!.color).toBe('#ff7f00');
    expect(result.drawing.getLayer('cool')!.color).toBe(ACI_TABLE[140]);
    expect(result.drawing.entities().map((e) => e.color)).toEqual([ACI_TABLE[253], '#ff7f00']);
    expect(result.warnings).toEqual([]);
  });

  it('keeps 0 and 256 as ByLayer on entities and reports an index above 255 once', () => {
    const result = importDxf(dxfText([], [[62, 0], [62, 256], [62, 257], [62, 257]]));
    expect(result.drawing.entities().map((e) => e.color)).toEqual([null, null, null, null]);
    expect(result.warnings.filter((w) => /Colour index 257/.test(w))).toHaveLength(1);
  });

  it('a negative layer index switches the layer off but still gives it the colour of the absolute index', () => {
    const result = importDxf(dxfText([[2, 'off', 70, 0, 62, -140]]));
    expect(result.drawing.getLayer('off')).toMatchObject({ visible: false, color: ACI_TABLE[140] });
  });
});

describe('layer true colour (group 420)', () => {
  it('is read, and takes priority over the index on the same layer', () => {
    const result = importDxf(dxfText([[2, 'exact', 70, 0, 62, 5, 420, 0x123456]]));
    expect(result.drawing.getLayer('exact')!.color).toBe('#123456');
    expect(result.warnings).toEqual([]);
  });

  it('is accepted even when the index is invalid, so no warning is raised for that layer', () => {
    const result = importDxf(dxfText([[2, 'x', 70, 0, 62, 300, 420, 0xabcdef]]));
    expect(result.drawing.getLayer('x')!.color).toBe('#abcdef');
    expect(result.warnings).toEqual([]);
  });

  it('black (0x000000) is a real colour and is not mistaken for "absent"', () => {
    const result = importDxf(dxfText([[2, 'k', 70, 0, 62, 7, 420, 0]]));
    expect(result.drawing.getLayer('k')!.color).toBe('#000000');
  });
});

describe('exporting layer colours', () => {
  function layerWith(color: string): Drawing {
    const d = new Drawing();
    d.apply({ kind: 'put-layer', layer: { name: 'A', color, visible: true, locked: false } });
    return d;
  }

  it('writes the nearest index and the exact true colour for each layer', () => {
    const { text } = exportDxf(layerWith('#123456'));
    // Records are `code\nvalue` pairs. Find layer A's record and read its 62 and 420.
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((l, i) => l === 'AcDbLayerTableRecord' && lines[i + 1] === '2' && lines[i + 2] === 'A');
    expect(start).toBeGreaterThan(-1);
    const record = lines.slice(start, start + 16);
    expect(record[record.indexOf('62') + 1]).toBe(String(nearestAci('#123456')));
    expect(record[record.indexOf('420') + 1]).toBe(String(0x123456));
  });

  it('reports layers outside the colour index once, and exact ones not at all', () => {
    expect(exportDxf(layerWith('#ff0000')).warnings).toEqual([]);
    expect(exportDxf(layerWith('#e6e6e6')).warnings).toEqual([]);
    expect(exportDxf(layerWith('#123456')).warnings).toHaveLength(1);
  });

  it('uses the exact colour for black and white too', () => {
    for (const color of ['#000000', '#ffffff']) {
      const back = importDxf(exportDxf(layerWith(color)).text).drawing;
      expect(back.getLayer('A')!.color).toBe(color);
    }
  });
});

describe('colour round trips', () => {
  it('is exact for 400 random layer colours and 400 random entity colours', () => {
    const r = rng(11);
    const d = new Drawing();
    const layerColors: string[] = [];
    for (let i = 0; i < 400; i++) {
      const color = randomHex(r);
      layerColors.push(color);
      d.apply({ kind: 'put-layer', layer: { name: `L${i}`, color, visible: true, locked: false } });
    }
    const entityColors: string[] = [];
    for (let i = 0; i < 400; i++) {
      const color = randomHex(r);
      entityColors.push(color);
      d.apply({
        kind: 'insert',
        index: d.entityCount,
        entity: { id: d.nextId(), type: 'line', layer: `L${i}`, color, start: vec2(i, 0), end: vec2(i, 5) },
      });
    }
    const back = importDxf(exportDxf(d).text);
    for (let i = 0; i < 400; i++) expect(back.drawing.getLayer(`L${i}`)!.color, `layer ${i}`).toBe(layerColors[i]);
    expect(back.drawing.entities().map((e) => e.color)).toEqual(entityColors);
  });

  it('is exact for every palette colour on a layer', () => {
    const d = new Drawing();
    for (let i = 1; i <= 255; i++) d.apply({ kind: 'put-layer', layer: { name: `P${i}`, color: ACI_PALETTE[i]!, visible: true, locked: false } });
    const { text, warnings } = exportDxf(d);
    expect(warnings).toEqual([]);
    const back = importDxf(text).drawing;
    for (let i = 1; i <= 255; i++) expect(back.getLayer(`P${i}`)!.color).toBe(ACI_PALETTE[i]);
  });

  it('survives a second pass: import, export, import gives the same colours', () => {
    const first = importDxf(dxfText([[2, 'a', 70, 0, 62, 30], [2, 'b', 70, 0, 62, 5, 420, 0x00ff7f]], [[62, 140]]));
    const second = importDxf(exportDxf(first.drawing).text).drawing;
    expect(second.getLayer('a')!.color).toBe(first.drawing.getLayer('a')!.color);
    expect(second.getLayer('b')!.color).toBe('#00ff7f');
    expect(second.entities()[0]!.color).toBe(ACI_TABLE[140]);
  });
});

describe('layer colour edge cases', () => {
  it('an off layer (negative index) with group 420 keeps the exact colour and stays off', () => {
    const result = importDxf(dxfText([[2, 'off', 70, 0, 62, -5, 420, 0x123456]]));
    expect(result.drawing.getLayer('off')).toMatchObject({ visible: false, color: '#123456' });
    expect(result.warnings).toEqual([]);
  });

  it('a layer with no group 62 uses the default colour, and 420 alone still applies', () => {
    const result = importDxf(dxfText([[2, 'plain', 70, 0], [2, 'exact', 70, 0, 420, 0x00ff7f]]));
    expect(result.drawing.getLayer('plain')!.color).toBe('#e6e6e6');
    expect(result.drawing.getLayer('exact')!.color).toBe('#00ff7f');
    expect(result.warnings).toEqual([]);
  });

  it('group 420 beats an index of 0 on a layer without a warning', () => {
    const result = importDxf(dxfText([[2, 'z', 70, 0, 62, 0, 420, 0x0a0b0c]]));
    expect(result.drawing.getLayer('z')!.color).toBe('#0a0b0c');
    expect(result.warnings).toEqual([]);
  });

  it('an exported frozen and locked layer with an off-index colour keeps flags and exact colour', () => {
    const d = new Drawing();
    d.apply({ kind: 'put-layer', layer: { name: 'F', color: '#123456', visible: false, locked: true } });
    const back = importDxf(exportDxf(d).text).drawing;
    expect(back.getLayer('F')).toMatchObject({ color: '#123456', visible: false, locked: true });
  });

  it('layer names with spaces, unicode and punctuation keep their exact colour through export', () => {
    const names = ['My Layer', 'Wände-ü', 'A.B_C$1', '日本語'];
    const colors = ['#123456', '#234567', '#345678', '#456789'];
    const d = new Drawing();
    names.forEach((name, i) => d.apply({ kind: 'put-layer', layer: { name, color: colors[i]!, visible: true, locked: false } }));
    const back = importDxf(exportDxf(d).text).drawing;
    names.forEach((name, i) => expect(back.getLayer(name)?.color, name).toBe(colors[i]!));
  });

  it('upper-case hex that equals an index colour gives no warning and reads back lower case', () => {
    const d = new Drawing();
    d.apply({ kind: 'put-layer', layer: { name: 'U', color: '#FF00FF', visible: true, locked: false } });
    const out = exportDxf(d);
    expect(out.warnings).toEqual([]);
    expect(importDxf(out.text).drawing.getLayer('U')!.color).toBe('#ff00ff');
  });

  it('the summary warning counts every off-index layer', () => {
    const d = new Drawing();
    for (const [i, c] of ['#123456', '#654321', '#abcdef', '#ff0000'].entries()) {
      d.apply({ kind: 'put-layer', layer: { name: `N${i}`, color: c, visible: true, locked: false } });
    }
    const { warnings } = exportDxf(d);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^3 layer colour/);
  });

  it('nearestAci breaks ties towards the lowest index for colours that repeat in the table', () => {
    const seen = new Map<string, number>();
    for (let i = 1; i <= 255; i++) {
      const first = seen.get(ACI_PALETTE[i]!);
      if (first === undefined) seen.set(ACI_PALETTE[i]!, i);
      else expect(nearestAci(ACI_PALETTE[i]!), `index ${i}`).toBe(first);
    }
    expect(nearestAci('#ff0000')).toBe(1);
  });
});

describe('true colour values outside 0 to 0xFFFFFF (found by QA)', () => {
  // The old code masked the value with & 0xFFFFFF, so 16777216 became black and 4294967551 became blue, silently.
  const outOfRange = [0x1000000, 0x2000000 + 0xff0000, 4294967551, -1, 1.5, 1e12];

  it('are reported once and ignored on a layer, which then uses its index colour', () => {
    for (const value of outOfRange) {
      const result = importDxf(dxfText([[2, 'x', 70, 0, 62, 5, 420, value]]));
      expect(result.drawing.getLayer('x')!.color, String(value)).toBe(ACI_PALETTE[5]);
      expect(result.warnings.filter((w) => /true colour/i.test(w)), String(value)).toHaveLength(1);
    }
  });

  it('are reported once per distinct value and ignored on an entity, which then uses its index colour', () => {
    for (const value of outOfRange) {
      const result = importDxf(dxfText([], [[62, 3, 420, value], [62, 3, 420, value]]));
      expect(result.drawing.entities().map((e) => e.color), String(value)).toEqual([ACI_PALETTE[3], ACI_PALETTE[3]]);
      expect(result.warnings.filter((w) => /true colour/i.test(w)), String(value)).toHaveLength(1);
    }
  });

  it('fall back to ByLayer when the entity has no index either', () => {
    const result = importDxf(dxfText([], [[420, 0x1000000]]));
    expect(result.drawing.entities()[0]!.color).toBeNull();
    expect(result.warnings.filter((w) => /true colour/i.test(w))).toHaveLength(1);
  });

  it('accept the whole valid range, including both ends', () => {
    const result = importDxf(dxfText([[2, 'lo', 70, 0, 420, 0], [2, 'hi', 70, 0, 420, 0xffffff]], [[420, 0], [420, 0xffffff]]));
    expect(result.drawing.getLayer('lo')!.color).toBe('#000000');
    expect(result.drawing.getLayer('hi')!.color).toBe('#ffffff');
    expect(result.drawing.entities().map((e) => e.color)).toEqual(['#000000', '#ffffff']);
    expect(result.warnings).toEqual([]);
  });
});
