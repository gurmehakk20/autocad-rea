import { describe, expect, it } from 'vitest';
import { Drawing, type Mutation } from '../../src/core/document/Drawing';
import type { Entity } from '../../src/core/entities/types';
import { vec2 } from '../../src/core/geometry/vector';
import type { RenderState } from '../../src/state/EditorSession';
import { Renderer, type Theme } from '../../src/viewport/Renderer';

/** The renderer asks the drawing's spatial index for what is on screen. These tests run it on a recording canvas. */

const THEME: Theme = {
  background: 'bg',
  gridMinor: 'gm',
  gridMajor: 'gM',
  selection: 'selected',
  preview: 'preview',
  snapMarker: 'snap',
  crosshair: 'cross',
  windowFill: 'wf',
  windowStroke: 'ws',
  crossingFill: 'cf',
  crossingStroke: 'cs',
};

/** Canvas stub that records the strokeStyle in force at every stroke(). Entity colours are their ids. */
function recorder() {
  const strokes: string[] = [];
  const ctx = new Proxy(
    { strokeStyle: '' } as Record<string, unknown>,
    {
      get: (target, key: string) => (key in target ? target[key] : key === 'stroke' ? () => strokes.push(String(target.strokeStyle)) : () => undefined),
      set: (target, key: string, value) => {
        target[key] = value;
        return true;
      },
    },
  );
  const canvas = { getContext: () => ctx, style: {}, width: 0, height: 0 } as unknown as HTMLCanvasElement;
  const renderer = new Renderer(canvas, THEME);
  renderer.resize(100, 100, 1);
  return { renderer, strokes };
}

/** Entity colours must be #rrggbb, so each id gets a unique one and strokes are mapped back to ids. */
const colourOf = new Map<string, string>();
const idOfColour = new Map<string, string>();
function colour(id: string): string {
  let c = colourOf.get(id);
  if (!c) {
    c = `#${(colourOf.size + 1).toString(16).padStart(6, '0')}`;
    colourOf.set(id, c);
    idOfColour.set(c, id);
  }
  return c;
}

const line = (id: string, x1: number, y1: number, x2: number, y2: number, layer = '0'): Entity => ({
  id,
  type: 'line',
  layer,
  color: colour(id),
  start: vec2(x1, y1),
  end: vec2(x2, y2),
});
const ins = (e: Entity, index: number): Mutation => ({ kind: 'insert', entity: e, index });

function stateOf(drawing: Drawing, zoom: number, selection: string[] = []): RenderState {
  return {
    drawing,
    camera: { cx: 0, cy: 0, zoom },
    selection: new Set(selection),
    preview: null,
    snap: null,
    cursor: null,
    rubberBand: null,
    gridSize: 1,
    gridVisible: false,
  };
}

/** Colours the renderer used for entities, ignoring the background fill (never stroked). */
function drawn(d: Drawing, zoom: number, selection: string[] = []): string[] {
  const { renderer, strokes } = recorder();
  renderer.draw(stateOf(d, zoom, selection));
  return strokes.map((c) => idOfColour.get(c) ?? c);
}

describe('Renderer draws what the spatial index returns', () => {
  it('zoomed in, draws only entities that reach the screen, in creation order', () => {
    const d = new Drawing();
    // Screen is 100 px at zoom 10: world -5..5 on both axes.
    d.apply(ins(line('far-left', -500, 0, -400, 0), 0));
    d.apply(ins(line('on-a', -1, 0, 1, 0), 1));
    d.apply(ins(line('far-up', 0, 900, 10, 900), 2));
    d.apply(ins(line('crossing', -50, 3, 50, 3), 3));
    d.apply(ins(line('on-b', 0, -2, 0, 2), 4));
    expect(drawn(d, 10)).toEqual(['on-a', 'crossing', 'on-b']);
  });

  it('zoomed out to fit, draws every entity in creation order', () => {
    const d = new Drawing();
    d.apply(ins(line('a', -500, 0, -400, 0), 0));
    d.apply(ins(line('b', 0, 900, 10, 900), 1));
    d.apply(ins(line('c', 1, 1, 2, 2), 2));
    expect(drawn(d, 0.05)).toEqual(['a', 'b', 'c']);
  });

  it('skips entities on a hidden layer and still draws the rest', () => {
    const d = new Drawing();
    d.apply({ kind: 'put-layer', layer: { name: 'hid', color: '#ffffff', visible: false, locked: false } });
    d.apply(ins(line('shown', -1, 0, 1, 0), 0));
    d.apply(ins(line('hidden', -1, 1, 1, 1, 'hid'), 1));
    expect(drawn(d, 10)).toEqual(['shown']);
  });

  it('draws an arc whose centre is off screen when the arc itself is visible', () => {
    const d = new Drawing();
    d.apply(ins({ id: 'arc', type: 'arc', layer: '0', color: colour('arc'), center: vec2(0, -100), radius: 100, startAngle: Math.PI / 2 - 0.05, endAngle: Math.PI / 2 + 0.05 }, 0));
    expect(drawn(d, 10)).toEqual(['arc']);
  });

  it('does not draw entities removed or moved off screen, and draws them again after undo-style reinsert', () => {
    const d = new Drawing();
    d.apply(ins(line('a', -1, 0, 1, 0), 0));
    d.apply(ins(line('b', -1, 1, 1, 1), 1));
    const inverse = d.apply({ kind: 'remove', id: 'a' });
    expect(drawn(d, 10)).toEqual(['b']);
    d.apply(inverse);
    expect(drawn(d, 10)).toEqual(['a', 'b']);
    d.apply({ kind: 'replace', entity: line('a', 900, 0, 901, 0) });
    expect(drawn(d, 10)).toEqual(['b']);
  });

  it('uses the selection colour for selected entities that are on screen', () => {
    const d = new Drawing();
    d.apply(ins(line('a', -1, 0, 1, 0), 0));
    d.apply(ins(line('b', -1, 1, 1, 1), 1));
    expect(drawn(d, 10, ['b'])).toEqual(['a', 'selected']);
  });

  it('draws only the visible part of a large drawing', () => {
    const d = new Drawing();
    const steps: Mutation[] = [];
    for (let i = 0; i < 2000; i++) steps.push(ins(line(`e${i}`, i * 100, 0, i * 100 + 50, 0), i));
    d.apply({ kind: 'batch', mutations: steps });
    // View covers x -5..5, so only e0 (0..50) touches it.
    expect(drawn(d, 10)).toEqual(['e0']);
  });
});
