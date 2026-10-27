import { describe, expect, it } from 'vitest';
import { Drawing, layerNameError, type Layer } from '../../src/core/document/Drawing';
import { transformEntity } from '../../src/core/entities/geometry';
import type { ArcEntity, Entity, LineEntity } from '../../src/core/entities/types';
import { arcEndPoint, arcStartPoint, TAU } from '../../src/core/geometry/arc';
import { rotation } from '../../src/core/geometry/transform';
import { vec2 } from '../../src/core/geometry/vector';
import { History } from '../../src/core/history/History';
import { importDxf } from '../../src/io/dxf/read';
import { EditorSession } from '../../src/state/EditorSession';
import { worldToScreen } from '../../src/viewport/camera';

const line = (id: string, a: [number, number], b: [number, number], layer = '0'): LineEntity => ({
  id,
  type: 'line',
  layer,
  color: null,
  start: vec2(...a),
  end: vec2(...b),
});

const dxf = (...pairs: Array<string | number>) => ['0', 'SECTION', '2', 'ENTITIES', ...pairs.map(String), '0', 'ENDSEC', '0', 'EOF'].join('\n');

function newSession(): EditorSession {
  const s = new EditorSession();
  s.setViewSize(800, 600);
  return s;
}

function click(s: EditorSession, x: number, y: number): void {
  const p = worldToScreen(s.camera, s.view, x, y);
  s.pointerMove(p);
  s.pointerDown(p, 0, false);
  s.pointerUp(p);
}

describe('RCA: ids must not collide with entities that are already present', () => {
  it('nextId skips ids that exist, even when the counter is behind', () => {
    const d = new Drawing();
    d.apply({ kind: 'insert', entity: line('e1', [0, 0], [1, 0]), index: 0 });
    d.apply({ kind: 'insert', entity: line('e2', [0, 0], [2, 0]), index: 1 });
    expect(d.nextId()).toBe('e3');
  });

  it('loading parts raises the counter above the highest numbered id in use', () => {
    const d = new Drawing();
    const layers: Layer[] = d.layers();
    d.loadParts({ units: 'mm', layers, entities: [line('e7', [0, 0], [1, 0]), line('custom', [0, 0], [2, 0])], idSequence: 0 });
    expect(d.idSequence).toBe(7);
    expect(d.nextId()).toBe('e8');
  });
});

describe('RCA: layer names must be valid and unique for DXF', () => {
  const existing = ['0', 'Walls'];

  it('accepts ordinary names, spaces and non-ASCII letters', () => {
    expect(layerNameError('Door frames', existing)).toBeNull();
    expect(layerNameError('Grundriss-ÄÖ', existing)).toBeNull();
  });

  it.each(['a<b', 'a>b', 'a/b', 'a\\b', 'a"b', 'a:b', 'a;b', 'a?b', 'a*b', 'a|b', 'a=b', 'a`b', 'a\nb'])('rejects %j', (name) => {
    expect(layerNameError(name, existing)).toMatch(/cannot contain/);
  });

  it('rejects blank, over-long and duplicate names regardless of case', () => {
    expect(layerNameError('   ', existing)).toMatch(/empty/);
    expect(layerNameError('x'.repeat(256), existing)).toMatch(/limited/);
    expect(layerNameError('WALLS', existing)).toMatch(/already exists/);
  });

  it('lets a layer be renamed to a different case of its own name', () => {
    expect(layerNameError('walls', existing, 'Walls')).toBeNull();
  });

  it('is enforced by the session when adding and renaming', () => {
    const s = newSession();
    s.addLayer('bad:name');
    expect(s.drawing.getLayer('bad:name')).toBeUndefined();
    s.addLayer('Walls');
    s.addLayer('walls');
    expect(s.drawing.layers().map((l) => l.name)).toEqual(['0', 'Walls']);
    s.renameLayer('Walls', 'a|b');
    expect(s.drawing.getLayer('Walls')).toBeDefined();
    s.renameLayer('Walls', 'WALLS');
    expect(s.drawing.getLayer('WALLS')).toBeDefined();
  });
});

describe('RCA: continuous edits must not flood the undo stack', () => {
  const colourEdit = (color: string): Parameters<History['execute']>[0] => ({ kind: 'replace', entity: { ...line('a', [0, 0], [1, 0]), color } });

  function setup() {
    const d = new Drawing();
    const h = new History(d);
    h.execute({ kind: 'insert', entity: line('a', [0, 0], [1, 0]), index: 0 }, 'Line');
    return { d, h };
  }

  it('merges back-to-back edits with the same key into one undo step', () => {
    const { d, h } = setup();
    for (const c of ['#ff0000', '#00ff00', '#0000ff']) h.execute(colourEdit(c), 'Colour', 'colour:a');
    expect(h.entries).toHaveLength(2);
    expect(d.getEntity('a')).toMatchObject({ color: '#0000ff' });
    h.undo();
    expect(d.getEntity('a')).toMatchObject({ color: null }); // original, not the previous picker value
    h.redo();
    expect(d.getEntity('a')).toMatchObject({ color: '#0000ff' });
  });

  it('does not merge different keys, missing keys, or edits after something else', () => {
    const { h } = setup();
    h.execute(colourEdit('#111111'), 'Colour', 'colour:a');
    h.execute(colourEdit('#222222'), 'Colour', 'colour:b');
    expect(h.entries).toHaveLength(3);
    h.execute(colourEdit('#333333'), 'Colour');
    h.execute(colourEdit('#444444'), 'Colour');
    expect(h.entries).toHaveLength(5);
  });

  it('does not merge into an entry that has been undone, so redo history stays correct', () => {
    const { d, h } = setup();
    h.execute(colourEdit('#111111'), 'Colour', 'colour:a');
    h.execute({ kind: 'replace', entity: line('a', [0, 0], [5, 0]) }, 'Stretch');
    h.undo();
    expect(h.canRedo).toBe(true);
    h.execute(colourEdit('#222222'), 'Colour', 'colour:a');
    expect(h.canRedo).toBe(false);
    // The undone Stretch is gone and the new edit is its own step, not merged into the older colour entry.
    expect(h.entries).toHaveLength(3);
    expect(d.getEntity('a')).toMatchObject({ color: '#222222' });
  });

  it('keeps the dirty flag correct when a merged edit follows a save', () => {
    const { h } = setup();
    h.execute(colourEdit('#111111'), 'Colour', 'colour:a');
    h.markSaved();
    expect(h.isDirty).toBe(false);
    h.execute(colourEdit('#222222'), 'Colour', 'colour:a');
    expect(h.isDirty).toBe(true);
    h.undo();
    expect(h.isDirty).toBe(true); // back before the saved state, so it differs from what was saved
  });

  it('merges picker events for a layer colour in the session', () => {
    const s = newSession();
    for (const c of ['#ff0000', '#00ff00', '#0000ff']) s.updateLayer('0', { color: c });
    expect(s.history.entries).toHaveLength(1);
    s.undo();
    expect(s.drawing.getLayer('0')?.color).toBe('#e6e6e6');
  });

  it('does not merge visibility toggles with colour edits', () => {
    const s = newSession();
    s.updateLayer('0', { color: '#ff0000' });
    s.updateLayer('0', { visible: false });
    s.updateLayer('0', { visible: true });
    expect(s.history.entries).toHaveLength(3);
  });
});

describe('RCA: arcs keep their angles in [0, 2π) under repeated rotation', () => {
  it('normalises angles and preserves the geometry', () => {
    let arc: Entity = { id: 'a', type: 'arc', layer: '0', color: null, center: vec2(0, 0), radius: 5, startAngle: 0.2, endAngle: 1.2 };
    for (let i = 0; i < 40; i++) arc = transformEntity(arc, rotation(1.9));
    const a = arc as ArcEntity;
    expect(a.startAngle).toBeGreaterThanOrEqual(0);
    expect(a.startAngle).toBeLessThan(TAU);
    expect(a.endAngle).toBeGreaterThanOrEqual(0);
    expect(a.endAngle).toBeLessThan(TAU);
    // The rotated start point matches rotating the original point directly.
    const expected = transformEntity({ ...arc, startAngle: 0.2, endAngle: 1.2 } as Entity, rotation(1.9 * 40)) as ArcEntity;
    expect(arcStartPoint(a).x).toBeCloseTo(arcStartPoint(expected).x, 9);
    expect(arcEndPoint(a).y).toBeCloseTo(arcEndPoint(expected).y, 9);
  });
});

describe('RCA: geometry cannot be created on hidden or locked layers', () => {
  it('refuses on a hidden layer and tells the user why', () => {
    const s = newSession();
    s.addLayer('Ghost');
    s.updateLayer('Ghost', { visible: false });
    s.setTool('line');
    click(s, 0, 0);
    click(s, 4, 0);
    expect(s.drawing.entityCount).toBe(0);
    expect(s.log.at(-1)).toMatch(/hidden/);
  });

  it('refuses on a locked layer and tells the user why', () => {
    const s = newSession();
    s.addLayer('Fixed');
    s.updateLayer('Fixed', { locked: true });
    s.setTool('circle');
    click(s, 0, 0);
    s.submitCommand('3');
    expect(s.drawing.entityCount).toBe(0);
    expect(s.log.at(-1)).toMatch(/locked/);
  });

  it('allows drawing again once the layer is visible and unlocked', () => {
    const s = newSession();
    s.addLayer('Work');
    s.updateLayer('Work', { locked: true });
    s.updateLayer('Work', { locked: false });
    s.setTool('line');
    click(s, 0, 0);
    click(s, 4, 0);
    expect(s.drawing.entityCount).toBe(1);
  });
});

describe('RCA: selection must not keep entities that became uneditable', () => {
  it('drops selected entities when their layer is locked or hidden', () => {
    const s = newSession();
    s.setTool('line');
    click(s, -5, 0);
    click(s, 5, 0);
    s.cancel();
    s.cancel();
    click(s, 0, 0);
    expect(s.selection.size).toBe(1);
    s.updateLayer('0', { locked: true });
    expect(s.selection.size).toBe(0);
  });
});

describe('RCA: view feedback', () => {
  it('wheel zoom scales with the delta and notifies the UI channel', () => {
    const s = newSession();
    const versions: number[] = [];
    s.subscribeUi(() => versions.push(s.getUiVersion()));
    const centre = vec2(400, 300);
    const before = s.camera.zoom;
    s.wheel(centre, -4);
    const small = s.camera.zoom / before;
    expect(small).toBeGreaterThan(1);
    expect(small).toBeLessThan(1.01);
    s.wheel(centre, -100);
    expect(s.camera.zoom / before / small).toBeGreaterThan(1.1);
    expect(versions.length).toBeGreaterThanOrEqual(2);
  });

  it('wheel in and out by the same amount returns to the same zoom', () => {
    const s = newSession();
    s.wheel(vec2(100, 100), -80);
    s.wheel(vec2(100, 100), 80);
    expect(s.camera.zoom).toBeCloseTo(20, 9);
  });

  it('one huge wheel delta is clamped', () => {
    const s = newSession();
    s.wheel(vec2(100, 100), -1e9);
    expect(s.camera.zoom).toBeLessThan(20 * 1.5);
  });

  it('clears the cursor when the pointer leaves, but not in the middle of a gesture', () => {
    const s = newSession();
    s.pointerMove(vec2(50, 50));
    expect(s.cursor).not.toBeNull();
    s.pointerLeave();
    expect(s.cursor).toBeNull();
    s.pointerMove(vec2(50, 50));
    s.pointerDown(vec2(50, 50), 0, false);
    s.pointerLeave();
    expect(s.cursor).not.toBeNull();
  });

  it('abandons a drag when the browser cancels the pointer', () => {
    const s = newSession();
    s.pointerDown(vec2(10, 10), 0, false);
    s.pointerMove(vec2(200, 200));
    s.pointerCancel();
    expect(s.renderState().rubberBand).toBeNull();
    s.pointerUp(vec2(200, 200));
    expect(s.selection.size).toBe(0);
  });
});

describe('RCA: DXF import fidelity and robustness', () => {
  it('does not warn that layer 0 is undefined when the file has no layer table', () => {
    const r = importDxf(dxf(0, 'LINE', 8, 0, 10, 0, 20, 0, 11, 5, 21, 0, 0, 'LINE', 10, 1, 20, 1, 11, 6, 21, 1));
    expect(r.imported).toBe(2);
    expect(r.warnings).toEqual([]);
    expect(r.drawing.layers().map((l) => l.name)).toEqual(['0']);
  });

  it('still warns about a genuinely undefined layer, and keeps layer 0 first', () => {
    const r = importDxf(dxf(0, 'LINE', 8, 'Ghost', 10, 0, 20, 0, 11, 5, 21, 0));
    expect(r.warnings.join('\n')).toMatch(/Ghost/);
    expect(r.drawing.layers().map((l) => l.name)).toEqual(['0', 'Ghost']);
  });

  it('treats a blank layer name as layer 0 instead of failing', () => {
    const r = importDxf(dxf(0, 'LINE', 8, '', 10, 0, 20, 0, 11, 5, 21, 0));
    expect(r.imported).toBe(1);
    expect(r.drawing.entities()[0]?.layer).toBe('0');
  });

  it('mirrors a circle whose extrusion is -Z', () => {
    const r = importDxf(dxf(0, 'CIRCLE', 8, 0, 10, 10, 20, 3, 40, 2, 230, -1));
    expect(r.drawing.entities()[0]).toMatchObject({ type: 'circle', center: { x: -10, y: 3 }, radius: 2 });
  });

  it('mirrors an arc so its endpoints land where AutoCAD draws them', () => {
    // Arc from 0 to 90 degrees about the origin runs from (5,0) to (0,5). Mirrored in X it runs from (-5,0) to (0,5),
    // which is a counter-clockwise arc from 90 to 180 degrees whose start is (0,5).
    const r = importDxf(dxf(0, 'ARC', 8, 0, 10, 0, 20, 0, 40, 5, 50, 0, 51, 90, 230, -1));
    const arc = r.drawing.entities()[0] as ArcEntity;
    expect(arc.startAngle).toBeCloseTo(Math.PI / 2, 12);
    expect(arc.endAngle).toBeCloseTo(Math.PI, 12);
    expect(arcStartPoint(arc).y).toBeCloseTo(5, 9);
    expect(arcEndPoint(arc).x).toBeCloseTo(-5, 9);
  });

  it('mirrors polyline vertices and flips the bulge so arcs still bow the same way', () => {
    const plain = importDxf(dxf(0, 'LWPOLYLINE', 8, 0, 90, 2, 70, 0, 10, 0, 20, 0, 42, 1, 10, 2, 20, 0));
    const mirrored = importDxf(dxf(0, 'LWPOLYLINE', 8, 0, 90, 2, 70, 0, 10, 0, 20, 0, 42, 1, 10, 2, 20, 0, 230, -1));
    const a = plain.drawing.entities()[0] as Extract<Entity, { type: 'polyline' }>;
    const b = mirrored.drawing.entities()[0] as Extract<Entity, { type: 'polyline' }>;
    expect(b.vertices).toHaveLength(a.vertices.length);
    a.vertices.forEach((p, i) => {
      expect(b.vertices[i]!.x).toBeCloseTo(-p.x, 9);
      expect(b.vertices[i]!.y).toBeCloseTo(p.y, 9);
    });
  });

  it('skips entities on a tilted 3D plane and reports them', () => {
    const r = importDxf(dxf(0, 'CIRCLE', 8, 0, 10, 0, 20, 0, 40, 1, 210, 0.5, 220, 0, 230, 0.8660254));
    expect(r.imported).toBe(0);
    expect(r.warnings.join('\n')).toMatch(/CIRCLE \(tilted 3D plane\) x1/);
  });

  it('leaves entities with the default or +Z extrusion alone', () => {
    const r = importDxf(dxf(0, 'CIRCLE', 8, 0, 10, 4, 20, 0, 40, 1, 230, 1));
    expect(r.drawing.entities()[0]).toMatchObject({ center: { x: 4, y: 0 } });
  });

  it('does not mirror LINE entities, which are stored in world coordinates', () => {
    const r = importDxf(dxf(0, 'LINE', 8, 0, 10, 1, 20, 0, 11, 5, 21, 0, 230, -1));
    expect(r.drawing.entities()[0]).toMatchObject({ start: { x: 1, y: 0 }, end: { x: 5, y: 0 } });
  });
});

describe('RCA: file load failures are reported and leave the drawing untouched', () => {
  it('returns the reason for a rejected native file and keeps the current drawing', () => {
    const s = newSession();
    s.setTool('line');
    click(s, 0, 0);
    click(s, 3, 0);
    const before = s.drawing.entityCount;
    const error = s.loadNativeText('nope', 'bad.json');
    expect(error).toMatch(/not valid JSON/);
    expect(s.drawing.entityCount).toBe(before);
  });

  it('returns the reason for a rejected DXF and keeps the current drawing', () => {
    const s = newSession();
    s.setTool('line');
    click(s, 0, 0);
    click(s, 3, 0);
    const result = s.loadDxfText('hello', 'bad.dxf');
    expect(result.error).toMatch(/group code/);
    expect(result.warnings).toEqual([]);
    expect(s.drawing.entityCount).toBe(1);
  });

  it('returns null on success and swaps in the new drawing', () => {
    const s = newSession();
    const result = s.loadDxfText(dxf(0, 'LINE', 8, 0, 10, 0, 20, 0, 11, 5, 21, 0), 'ok.dxf');
    expect(result.error).toBeNull();
    expect(s.drawing.entityCount).toBe(1);
  });
});
