import { describe, expect, it } from 'vitest';
import { EditorSession } from '../../src/state/EditorSession';
import { worldToScreen } from '../../src/viewport/camera';
import { vec2 } from '../../src/core/geometry/vector';

/** Session with a known 800x600 viewport and zoom 20 px/unit centred on the origin. */
function newSession(): EditorSession {
  const s = new EditorSession();
  s.setViewSize(800, 600);
  return s;
}

/** Clicks at a world point through the same screen path the canvas uses. */
function click(s: EditorSession, x: number, y: number, shift = false): void {
  const p = worldToScreen(s.camera, s.view, x, y);
  s.pointerMove(p);
  s.pointerDown(p, 0, shift);
  s.pointerUp(p);
}

/** Drags from world point a to b. */
function drag(s: EditorSession, a: [number, number], b: [number, number]): void {
  const pa = worldToScreen(s.camera, s.view, ...a);
  const pb = worldToScreen(s.camera, s.view, ...b);
  s.pointerMove(pa);
  s.pointerDown(pa, 0, false);
  s.pointerMove(pb);
  s.pointerUp(pb);
}

describe('drawing tools through the session', () => {
  it('draws a chain of lines and undoes them one at a time', () => {
    const s = newSession();
    s.setTool('line');
    click(s, 0, 0);
    click(s, 10, 0);
    click(s, 10, 10);
    s.confirm();
    expect(s.drawing.entityCount).toBe(2);
    expect(s.tool.id).toBe('select'); // Enter finishes the tool and returns to Select

    s.undo();
    expect(s.drawing.entityCount).toBe(1);
    s.undo();
    expect(s.drawing.entityCount).toBe(0);
    s.redo();
    expect(s.drawing.entityCount).toBe(1);
  });

  it('snaps line endpoints to existing geometry', () => {
    const s = newSession();
    s.submitCommand('L');
    click(s, 0, 0);
    click(s, 10, 0);
    s.confirm();
    s.submitCommand('L');
    // Click near the existing endpoint (10,0): should land exactly on it.
    click(s, 10.05, -0.05);
    click(s, 20, 20);
    s.confirm();
    const added = s.drawing.entities()[1];
    expect(added).toMatchObject({ type: 'line', start: { x: 10, y: 0 } });
  });

  it('refuses zero-length lines and reports why', () => {
    const s = newSession();
    s.setTool('line');
    click(s, 3, 3);
    click(s, 3, 3);
    expect(s.drawing.entityCount).toBe(0);
    expect(s.log.at(-1)).toMatch(/Zero-length/);
  });

  it('Escape cancels the pending line start, then ends the tool', () => {
    const s = newSession();
    s.setTool('line');
    click(s, 0, 0);
    s.cancel();
    expect(s.tool.id).toBe('line');
    s.cancel();
    expect(s.tool.id).toBe('select');
    expect(s.drawing.entityCount).toBe(0);
  });

  it('creates a circle from a typed radius', () => {
    const s = newSession();
    s.submitCommand('C');
    click(s, 5, 5);
    s.submitCommand('2.5');
    expect(s.drawing.entities()[0]).toMatchObject({ type: 'circle', center: { x: 5, y: 5 }, radius: 2.5 });
  });

  it('rejects a zero radius with a message', () => {
    const s = newSession();
    s.submitCommand('C');
    click(s, 0, 0);
    s.submitCommand('0');
    expect(s.drawing.entityCount).toBe(0);
    expect(s.log.at(-1)).toMatch(/greater than zero/);
  });

  it('draws a rectangle as a closed four-vertex polyline', () => {
    const s = newSession();
    s.setTool('rectangle');
    click(s, 0, 0);
    click(s, 4, 3);
    expect(s.drawing.entities()[0]).toMatchObject({ type: 'polyline', closed: true });
    expect((s.drawing.entities()[0] as { vertices: readonly unknown[] }).vertices).toHaveLength(4);
  });

  it('accepts typed relative coordinates for line endpoints', () => {
    const s = newSession();
    s.setTool('line');
    s.submitCommand('0,0');
    s.submitCommand('@3,4');
    expect(s.drawing.entities()[0]).toMatchObject({ end: { x: 3, y: 4 } });
  });

  it('builds a three-point arc', () => {
    const s = newSession();
    s.setTool('arc');
    click(s, 5, 0);
    click(s, 0, 5);
    click(s, -5, 0);
    expect(s.drawing.entities()[0]).toMatchObject({ type: 'arc', radius: 5 });
  });

  it('reports collinear arc points instead of creating geometry', () => {
    const s = newSession();
    s.setTool('arc');
    click(s, 0, 0);
    click(s, 1, 1);
    click(s, 2, 2);
    expect(s.drawing.entityCount).toBe(0);
    expect(s.log.at(-1)).toMatch(/collinear/);
  });

  it('polyline: Enter commits, Escape discards pending vertices', () => {
    const s = newSession();
    s.setTool('polyline');
    click(s, 0, 0);
    click(s, 5, 0);
    click(s, 5, 5);
    s.confirm();
    expect(s.drawing.entities()[0]).toMatchObject({ type: 'polyline', closed: false });
    expect((s.drawing.entities()[0] as { vertices: readonly unknown[] }).vertices).toHaveLength(3);

    s.submitCommand('PL');
    click(s, 0, 0);
    click(s, 1, 1);
    s.cancel();
    expect(s.drawing.entityCount).toBe(1);
  });
});

describe('selection and editing', () => {
  it('selects by click and deletes with undo support', () => {
    const s = sceneWithLine();
    click(s, 5, 0);
    expect(s.selection.size).toBe(1);
    s.deleteSelection();
    expect(s.drawing.entityCount).toBe(0);
    s.undo();
    expect(s.drawing.entityCount).toBe(1);
  });

  it('window selects only fully enclosed entities and crossing selects touching ones', () => {
    const s = sceneWithLine();
    drag(s, [-2, -2], [12, 2]); // left to right: window
    expect(s.selection.size).toBe(1);
    s.selection.clear();
    drag(s, [12, 2], [5, -2]); // right to left: crossing
    expect(s.selection.size).toBe(1);
    s.selection.clear();
    drag(s, [1, -1], [3, 1]); // window that only partly covers the line
    expect(s.selection.size).toBe(0);
  });

  it('Escape clears the selection in Select mode', () => {
    const s = sceneWithLine();
    click(s, 5, 0);
    s.cancel();
    expect(s.selection.size).toBe(0);
  });

  it('moves a selection with a base point and destination, as one undo step', () => {
    const s = sceneWithLine();
    click(s, 5, 0);
    s.setTool('move');
    click(s, 0, 0);
    click(s, 10, 10);
    expect(s.drawing.entities()[0]).toMatchObject({ start: { x: 10, y: 10 }, end: { x: 20, y: 10 } });
    expect(s.tool.id).toBe('select');
    s.undo();
    expect(s.drawing.entities()[0]).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
  });

  it('copies leave originals in place and keep the copy tool active for repeats', () => {
    const s = sceneWithLine();
    click(s, 5, 0);
    s.setTool('copy');
    click(s, 0, 0);
    click(s, 0, 5);
    click(s, 0, 10);
    expect(s.drawing.entityCount).toBe(3);
    expect(s.tool.id).toBe('copy');
    s.cancel();
    expect(s.tool.id).toBe('select');
  });

  it('rotates a selection about a base point using a typed angle', () => {
    const s = sceneWithLine();
    click(s, 5, 0);
    s.setTool('rotate');
    click(s, 0, 0); // base
    s.submitCommand('90'); // reference step accepts a typed angle
    const line = s.drawing.entities()[0] as { end: { x: number; y: number } };
    expect(line.end.x).toBeCloseTo(0, 9);
    expect(line.end.y).toBeCloseTo(10, 9);
  });

  it('move starts from the current selection when Enter is pressed after selecting', () => {
    const s = sceneWithLine();
    s.setTool('move');
    click(s, 5, 0);
    expect(s.selection.size).toBe(1);
    s.confirm();
    expect(s.tool.prompt()).toMatch(/base point/);
  });
});

describe('layers and properties', () => {
  it('creates layers and moves selected entities between them', () => {
    const s = sceneWithLine();
    s.addLayer('Walls');
    expect(s.activeLayerName).toBe('Walls');
    click(s, 5, 0);
    s.setSelectionLayer('Walls');
    expect(s.drawing.entities()[0]).toMatchObject({ layer: 'Walls' });
  });

  it('refuses to edit entities on a locked layer', () => {
    const s = sceneWithLine();
    s.updateLayer('0', { locked: true });
    click(s, 5, 0);
    expect(s.selection.size).toBe(0);
    s.updateLayer('0', { locked: false });
    click(s, 5, 0);
    s.updateLayer('0', { locked: true });
    s.setSelectionColor('#ff0000');
    expect(s.drawing.entities()[0]).toMatchObject({ color: null });
  });

  it('deleting a layer moves its entities to layer 0 in one undo step', () => {
    const s = newSession();
    s.addLayer('Temp');
    s.setTool('line');
    click(s, 0, 0);
    click(s, 4, 0);
    s.cancel();
    s.cancel();
    s.deleteLayer('Temp');
    expect(s.drawing.entities()[0]).toMatchObject({ layer: '0' });
    expect(s.drawing.getLayer('Temp')).toBeUndefined();
    s.undo();
    expect(s.drawing.getLayer('Temp')).toBeDefined();
    expect(s.drawing.entities()[0]).toMatchObject({ layer: 'Temp' });
  });

  it('renames a layer and carries its entities along', () => {
    const s = newSession();
    s.addLayer('Old');
    s.setTool('line');
    click(s, 0, 0);
    click(s, 10, 0);
    s.cancel();
    s.cancel();
    s.renameLayer('Old', 'New');
    expect(s.drawing.entities()[0]).toMatchObject({ layer: 'New' });
    expect(s.drawing.getLayer('Old')).toBeUndefined();
    expect(s.activeLayerName).toBe('New');
  });

  it('keeps layer 0 from being renamed or deleted', () => {
    const s = newSession();
    s.renameLayer('0', 'Base');
    s.deleteLayer('0');
    expect(s.drawing.getLayer('0')).toBeDefined();
  });
});

describe('commands and status', () => {
  it('reports unknown commands', () => {
    const s = newSession();
    s.submitCommand('FOO');
    expect(s.log.at(-1)).toMatch(/Unknown command "FOO"/);
  });

  it('toggles snap and grid flags from commands', () => {
    const s = newSession();
    s.submitCommand('SNAP');
    expect(s.snap.grid).toBe(true);
    s.submitCommand('SNAP');
    expect(s.snap.grid).toBe(false);
  });

  it('grid snapping rounds drawn points to the configured spacing', () => {
    const s = newSession();
    s.setSnap({ grid: true, gridSize: 5, objectSnap: false });
    s.setTool('line');
    click(s, 7.4, 2.4);
    click(s, 12.6, 9.9);
    expect(s.drawing.entities()[0]).toMatchObject({ start: { x: 5, y: 0 }, end: { x: 15, y: 10 } });
  });

  it('ortho constrains the rubber band to the dominant axis', () => {
    const s = newSession();
    s.setSnap({ ortho: true, objectSnap: false });
    s.setTool('line');
    click(s, 0, 0);
    click(s, 10, 2);
    expect(s.drawing.entities()[0]).toMatchObject({ end: { x: 10, y: 0 } });
  });

  it('marks the document dirty after edits and clean after a save point', () => {
    const s = newSession();
    expect(s.isDirty).toBe(false);
    s.setTool('line');
    click(s, 0, 0);
    click(s, 1, 0);
    expect(s.isDirty).toBe(true);
    s.markSaved('x.opendraft.json');
    expect(s.isDirty).toBe(false);
  });

  it('zoom extents frames all entities', () => {
    const s = sceneWithLine();
    s.zoomExtents();
    const a = worldToScreen(s.camera, s.view, 0, 0);
    const b = worldToScreen(s.camera, s.view, 10, 0);
    expect(a.x).toBeGreaterThan(0);
    expect(b.x).toBeLessThan(800);
  });

  it('pointer movement does not change the drawing or history', () => {
    const s = sceneWithLine();
    const before = s.history.entries.length;
    s.pointerMove(vec2(100, 100));
    expect(s.history.entries.length).toBe(before);
    expect(s.cursor).not.toBeNull();
  });
});

function sceneWithLine(): EditorSession {
  const s = newSession();
  s.setTool('line');
  click(s, 0, 0);
  click(s, 10, 0);
  s.cancel();
  s.cancel();
  return s;
}
