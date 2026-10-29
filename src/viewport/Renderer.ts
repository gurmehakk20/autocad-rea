import type { Drawing } from '../core/document/Drawing';
import { type ArcEntity, type Entity } from '../core/entities/types';
import { arcSweep } from '../core/geometry/arc';
import { type Bounds, boundsIntersect } from '../core/geometry/bounds';
import type { Vec2 } from '../core/geometry/vector';
import type { SnapResult } from '../core/snapping/snap';
import type { Preview } from '../core/tools/types';
import type { RenderState } from '../state/EditorSession';
import { type Camera, type ViewSize, visibleBounds, worldToScreen } from './camera';

export interface Theme {
  readonly background: string;
  readonly gridMinor: string;
  readonly gridMajor: string;
  readonly selection: string;
  readonly preview: string;
  readonly snapMarker: string;
  readonly crosshair: string;
  readonly windowFill: string;
  readonly windowStroke: string;
  readonly crossingFill: string;
  readonly crossingStroke: string;
}

export const DARK_THEME: Theme = {
  background: '#101217',
  gridMinor: '#1c2028',
  gridMajor: '#2a303b',
  selection: '#4da3ff',
  preview: '#9ec5ff',
  snapMarker: '#ffd166',
  crosshair: '#6b7385',
  windowFill: 'rgba(77, 163, 255, 0.10)',
  windowStroke: '#4da3ff',
  crossingFill: 'rgba(39, 201, 63, 0.10)',
  crossingStroke: '#27c93f',
};

/** Upper bound on grid lines per axis. Zooming far out skips the grid instead of looping millions of times. */
const MAX_GRID_LINES = 400;
/** Minimum on-screen spacing between grid lines. */
const MIN_GRID_PX = 8;
/** Major grid lines appear every this many minor steps. */
const MAJOR_EVERY = 5;

/**
 * Canvas 2D renderer. It draws from an immutable `RenderState` snapshot and never
 * reads React state. World points are mapped to screen space through the explicit
 * camera transform in `camera.ts`.
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private size: ViewSize = { width: 0, height: 0 };
  private dpr = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly theme: Theme = DARK_THEME,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
    this.ctx = ctx;
  }

  /** Sizes the backing store for the device pixel ratio so lines stay sharp on high-DPI screens. */
  resize(cssWidth: number, cssHeight: number, dpr: number): ViewSize {
    this.dpr = Math.max(1, dpr);
    this.size = { width: Math.max(1, Math.floor(cssWidth)), height: Math.max(1, Math.floor(cssHeight)) };
    this.canvas.width = Math.round(this.size.width * this.dpr);
    this.canvas.height = Math.round(this.size.height * this.dpr);
    this.canvas.style.width = `${this.size.width}px`;
    this.canvas.style.height = `${this.size.height}px`;
    return this.size;
  }

  draw(state: RenderState): void {
    const ctx = this.ctx;
    const view = this.size;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, view.width, view.height);

    if (state.gridVisible) this.drawGrid(state.camera, view, state.gridSize);
    this.drawEntities(state.drawing, state.camera, view, state.selection);
    if (state.preview) this.drawPreview(state.preview, state.camera, view);
    if (state.rubberBand) {
      this.drawRubberBand(state.rubberBand.a, state.rubberBand.b, state.rubberBand.crossing, state.camera, view);
    }
    if (state.cursor) this.drawCursor(state.cursor, state.snap, state.camera, view);
  }

  /** Minor and major grid lines. Spacing grows until neighbouring lines are at least MIN_GRID_PX apart. */
  private drawGrid(cam: Camera, view: ViewSize, gridSize: number): void {
    let minor = gridSize;
    while (minor * cam.zoom < MIN_GRID_PX) minor *= MAJOR_EVERY;
    const bounds = visibleBounds(cam, view);
    this.strokeGrid(bounds, minor, cam, view, this.theme.gridMinor);
    this.strokeGrid(bounds, minor * MAJOR_EVERY, cam, view, this.theme.gridMajor);
  }

  private strokeGrid(bounds: Bounds, step: number, cam: Camera, view: ViewSize, color: string): void {
    const firstX = Math.floor(bounds.minX / step);
    const lastX = Math.ceil(bounds.maxX / step);
    const firstY = Math.floor(bounds.minY / step);
    const lastY = Math.ceil(bounds.maxY / step);
    if (lastX - firstX > MAX_GRID_LINES || lastY - firstY > MAX_GRID_LINES) return;

    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = firstX; i <= lastX; i++) {
      const x = Math.round(worldToScreen(cam, view, i * step, 0).x) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, view.height);
    }
    for (let j = firstY; j <= lastY; j++) {
      const y = Math.round(worldToScreen(cam, view, 0, j * step).y) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(view.width, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawEntities(drawing: Drawing, cam: Camera, view: ViewSize, selection: ReadonlySet<string>): void {
    const visible = visibleBounds(cam, view);
    // Zoomed in, the index returns only what can reach the screen. Zoomed to fit, it returns everything in creation order.
    for (const entity of drawing.entitiesIn(visible)) {
      const layer = drawing.getLayer(entity.layer);
      if (!layer || !layer.visible) continue;
      const b = drawing.boundsOf(entity.id);
      if (!b || !boundsIntersect(b, visible)) continue; // culling: skip entities off screen
      this.strokeEntity(entity, drawing.effectiveColor(entity), selection.has(entity.id), false, cam, view);
    }
  }

  private drawPreview(preview: Preview, cam: Camera, view: ViewSize): void {
    for (const entity of preview.entities) {
      this.strokeEntity(entity, this.theme.preview, false, true, cam, view);
    }
    for (const marker of preview.markers) {
      const p = worldToScreen(cam, view, marker.x, marker.y);
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      this.ctx.fillStyle = this.theme.preview;
      this.ctx.fill();
    }
  }

  private strokeEntity(
    entity: Entity,
    color: string,
    selected: boolean,
    dashed: boolean,
    cam: Camera,
    view: ViewSize,
  ): void {
    const ctx = this.ctx;
    ctx.beginPath();
    switch (entity.type) {
      case 'line': {
        const a = worldToScreen(cam, view, entity.start.x, entity.start.y);
        const b = worldToScreen(cam, view, entity.end.x, entity.end.y);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        break;
      }
      case 'polyline':
        entity.vertices.forEach((v, i) => {
          const p = worldToScreen(cam, view, v.x, v.y);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        if (entity.closed) ctx.closePath();
        break;
      case 'circle': {
        const c = worldToScreen(cam, view, entity.center.x, entity.center.y);
        ctx.arc(c.x, c.y, entity.radius * cam.zoom, 0, Math.PI * 2);
        break;
      }
      case 'arc':
        this.arcPath(entity, cam, view);
        break;
    }
    ctx.setLineDash(dashed ? [6, 4] : []);
    ctx.strokeStyle = selected ? this.theme.selection : color;
    ctx.lineWidth = selected ? 2 : 1.25;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * Canvas angles increase clockwise on screen because the Y axis points down. A
   * counter-clockwise world arc is therefore drawn anticlockwise from −start to −end.
   */
  private arcPath(arc: ArcEntity, cam: Camera, view: ViewSize): void {
    const sweep = arcSweep(arc);
    if (sweep === 0) return;
    const c = worldToScreen(cam, view, arc.center.x, arc.center.y);
    this.ctx.arc(c.x, c.y, arc.radius * cam.zoom, -arc.startAngle, -arc.startAngle - sweep, true);
  }

  private drawRubberBand(a: Vec2, b: Vec2, crossing: boolean, cam: Camera, view: ViewSize): void {
    const p = worldToScreen(cam, view, a.x, a.y);
    const q = worldToScreen(cam, view, b.x, b.y);
    const x = Math.min(p.x, q.x);
    const y = Math.min(p.y, q.y);
    const w = Math.abs(q.x - p.x);
    const h = Math.abs(q.y - p.y);
    const ctx = this.ctx;
    ctx.fillStyle = crossing ? this.theme.crossingFill : this.theme.windowFill;
    ctx.strokeStyle = crossing ? this.theme.crossingStroke : this.theme.windowStroke;
    ctx.setLineDash(crossing ? [5, 4] : []);
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.setLineDash([]);
  }

  private drawCursor(world: Vec2, snap: SnapResult | null, cam: Camera, view: ViewSize): void {
    const ctx = this.ctx;
    const point = snap ? snap.point : world;
    const p = worldToScreen(cam, view, point.x, point.y);

    ctx.strokeStyle = this.theme.crosshair;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(p.y) + 0.5);
    ctx.lineTo(view.width, Math.round(p.y) + 0.5);
    ctx.moveTo(Math.round(p.x) + 0.5, 0);
    ctx.lineTo(Math.round(p.x) + 0.5, view.height);
    ctx.stroke();

    if (snap && snap.kind !== 'none' && snap.kind !== 'grid') this.drawSnapMarker(snap.kind, p.x, p.y);
  }

  private drawSnapMarker(kind: Exclude<SnapResult['kind'], 'none' | 'grid'>, x: number, y: number): void {
    const ctx = this.ctx;
    const s = 6;
    ctx.strokeStyle = this.theme.snapMarker;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    switch (kind) {
      case 'endpoint':
        ctx.rect(x - s, y - s, s * 2, s * 2);
        break;
      case 'midpoint':
        ctx.moveTo(x, y - s);
        ctx.lineTo(x + s, y + s);
        ctx.lineTo(x - s, y + s);
        ctx.closePath();
        break;
      case 'center':
        ctx.arc(x, y, s, 0, Math.PI * 2);
        break;
      case 'intersection':
        ctx.moveTo(x - s, y - s);
        ctx.lineTo(x + s, y + s);
        ctx.moveTo(x + s, y - s);
        ctx.lineTo(x - s, y + s);
        break;
    }
    ctx.stroke();
  }
}
