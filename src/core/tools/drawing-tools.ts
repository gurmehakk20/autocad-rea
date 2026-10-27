import type { ArcEntity, CircleEntity, Entity, LineEntity, PolylineEntity } from '../entities/types';
import { arcFromThreePoints } from '../geometry/arc';
import { type Vec2, distance, equalPoints, vec2 } from '../geometry/vector';
import { type Preview, type Tool, type ToolContext, commit } from './types';

/** Preview entities are not stored, so their id is never looked up. */
const PREVIEW_ID = '';

function previewLine(layer: string, start: Vec2, end: Vec2): LineEntity {
  return { id: PREVIEW_ID, type: 'line', layer, color: null, start, end };
}

/** Chained line segments. Each committed segment starts where the previous one ended. */
export class LineTool implements Tool {
  readonly id = 'line';
  readonly label = 'Line';
  readonly wantsPoint = true;
  finished = false;
  private start: Vec2 | null = null;

  constructor(private readonly ctx: ToolContext) {}

  get basePoint(): Vec2 | null {
    return this.start;
  }

  prompt(): string {
    return this.start ? 'Specify next point or [Enter to finish]:' : 'Specify first point:';
  }

  pick(point: Vec2): void {
    if (!this.start) {
      this.start = point;
      return;
    }
    if (equalPoints(this.start, point)) {
      this.ctx.notify('Zero-length line ignored.');
      return;
    }
    const line: LineEntity = {
      id: this.ctx.drawing.nextId(),
      type: 'line',
      layer: this.ctx.activeLayer(),
      color: null,
      start: this.start,
      end: point,
    };
    if (commit(this.ctx, { kind: 'insert', entity: line, index: this.ctx.drawing.entityCount }, 'Line')) {
      this.start = point;
    }
  }

  confirm(): void {
    this.finished = true;
  }

  cancel(): void {
    if (this.start) this.start = null;
    else this.finished = true;
  }

  preview(cursor: Vec2): Preview | null {
    if (!this.start || equalPoints(this.start, cursor)) return null;
    return { entities: [previewLine(this.ctx.activeLayer(), this.start, cursor)], markers: [] };
  }
}

/** Open polyline built vertex by vertex. Enter commits it, Escape discards the pending vertices. */
export class PolylineTool implements Tool {
  readonly id = 'polyline';
  readonly label = 'Polyline';
  readonly wantsPoint = true;
  finished = false;
  private vertices: Vec2[] = [];

  constructor(private readonly ctx: ToolContext) {}

  get basePoint(): Vec2 | null {
    return this.vertices.at(-1) ?? null;
  }

  prompt(): string {
    return this.vertices.length === 0
      ? 'Specify start point:'
      : `Specify next point [Enter to finish, Esc to discard] (${this.vertices.length} vertices):`;
  }

  pick(point: Vec2): void {
    const last = this.vertices.at(-1);
    if (last && equalPoints(last, point)) {
      this.ctx.notify('Duplicate vertex ignored.');
      return;
    }
    this.vertices.push(point);
  }

  confirm(): void {
    if (this.vertices.length >= 2) {
      const polyline: PolylineEntity = {
        id: this.ctx.drawing.nextId(),
        type: 'polyline',
        layer: this.ctx.activeLayer(),
        color: null,
        vertices: this.vertices,
        closed: false,
      };
      if (!commit(this.ctx, { kind: 'insert', entity: polyline, index: this.ctx.drawing.entityCount }, 'Polyline')) {
        return;
      }
    } else if (this.vertices.length === 1) {
      this.ctx.notify('A polyline needs at least two vertices. Discarded.');
    }
    this.vertices = [];
    this.finished = true;
  }

  cancel(): void {
    if (this.vertices.length > 0) this.vertices = [];
    else this.finished = true;
  }

  preview(cursor: Vec2): Preview | null {
    if (this.vertices.length === 0) return null;
    const points = [...this.vertices, cursor];
    const layer = this.ctx.activeLayer();
    const entities: Entity[] = [];
    for (let i = 1; i < points.length; i++) {
      entities.push(previewLine(layer, points[i - 1]!, points[i]!));
    }
    return { entities, markers: [] };
  }
}

/** Corners in counter-clockwise order, or null when the rectangle is degenerate. */
export function rectangleVertices(a: Vec2, b: Vec2): Vec2[] | null {
  if (a.x === b.x || a.y === b.y) return null;
  return [vec2(a.x, a.y), vec2(b.x, a.y), vec2(b.x, b.y), vec2(a.x, b.y)];
}

/** Axis-aligned rectangle from two opposite corners, stored as a closed polyline. */
export class RectangleTool implements Tool {
  readonly id = 'rectangle';
  readonly label = 'Rectangle';
  readonly wantsPoint = true;
  finished = false;
  private corner: Vec2 | null = null;

  constructor(private readonly ctx: ToolContext) {}

  get basePoint(): Vec2 | null {
    return this.corner;
  }

  prompt(): string {
    return this.corner ? 'Specify opposite corner:' : 'Specify first corner:';
  }

  pick(point: Vec2): void {
    if (!this.corner) {
      this.corner = point;
      return;
    }
    const vertices = rectangleVertices(this.corner, point);
    if (!vertices) {
      this.ctx.notify('Rectangle has zero width or height.');
      return;
    }
    const rect: PolylineEntity = {
      id: this.ctx.drawing.nextId(),
      type: 'polyline',
      layer: this.ctx.activeLayer(),
      color: null,
      vertices,
      closed: true,
    };
    if (commit(this.ctx, { kind: 'insert', entity: rect, index: this.ctx.drawing.entityCount }, 'Rectangle')) {
      this.corner = null;
    }
  }

  confirm(): void {
    this.finished = true;
  }

  cancel(): void {
    if (this.corner) this.corner = null;
    else this.finished = true;
  }

  preview(cursor: Vec2): Preview | null {
    if (!this.corner) return null;
    const vertices = rectangleVertices(this.corner, cursor);
    if (!vertices) return null;
    const rect: PolylineEntity = {
      id: PREVIEW_ID,
      type: 'polyline',
      layer: this.ctx.activeLayer(),
      color: null,
      vertices,
      closed: true,
    };
    return { entities: [rect], markers: [] };
  }
}

/** Circle by centre and radius. The radius can be typed, or taken from a second point. */
export class CircleTool implements Tool {
  readonly id = 'circle';
  readonly label = 'Circle';
  readonly wantsPoint = true;
  finished = false;
  private center: Vec2 | null = null;

  constructor(private readonly ctx: ToolContext) {}

  get basePoint(): Vec2 | null {
    return this.center;
  }

  prompt(): string {
    return this.center ? 'Specify radius (point or number):' : 'Specify centre point:';
  }

  pick(point: Vec2): void {
    if (!this.center) {
      this.center = point;
      return;
    }
    this.finish(distance(this.center, point));
  }

  submitNumber(value: number): boolean {
    if (!this.center) return false;
    this.finish(value);
    return true;
  }

  confirm(): void {
    this.finished = true;
  }

  cancel(): void {
    if (this.center) this.center = null;
    else this.finished = true;
  }

  preview(cursor: Vec2): Preview | null {
    if (!this.center) return null;
    const radius = distance(this.center, cursor);
    if (radius === 0) return null;
    const circle: CircleEntity = {
      id: PREVIEW_ID,
      type: 'circle',
      layer: this.ctx.activeLayer(),
      color: null,
      center: this.center,
      radius,
    };
    return { entities: [circle], markers: [this.center] };
  }

  private finish(radius: number): void {
    if (!this.center) return;
    if (!(radius > 0)) {
      this.ctx.notify('Circle radius must be greater than zero.');
      return;
    }
    const circle: CircleEntity = {
      id: this.ctx.drawing.nextId(),
      type: 'circle',
      layer: this.ctx.activeLayer(),
      color: null,
      center: this.center,
      radius,
    };
    if (commit(this.ctx, { kind: 'insert', entity: circle, index: this.ctx.drawing.entityCount }, 'Circle')) {
      this.center = null;
    }
  }
}

/** Three-point arc: start, a point on the arc, then end. */
export class ArcTool implements Tool {
  readonly id = 'arc';
  readonly label = 'Arc';
  readonly wantsPoint = true;
  finished = false;
  private picks: Vec2[] = [];

  constructor(private readonly ctx: ToolContext) {}

  get basePoint(): Vec2 | null {
    return this.picks.at(-1) ?? null;
  }

  prompt(): string {
    if (this.picks.length === 0) return 'Specify start point of arc:';
    if (this.picks.length === 1) return 'Specify second point on arc:';
    return 'Specify end point of arc:';
  }

  pick(point: Vec2): void {
    if (this.picks.length < 2) {
      this.picks.push(point);
      return;
    }
    const [p1, p2] = this.picks as [Vec2, Vec2];
    const geometry = arcFromThreePoints(p1, p2, point);
    if (!geometry) {
      this.ctx.notify('Arc points are collinear or coincident. Pick again.');
      return;
    }
    const arc: ArcEntity = {
      id: this.ctx.drawing.nextId(),
      type: 'arc',
      layer: this.ctx.activeLayer(),
      color: null,
      ...geometry,
    };
    if (commit(this.ctx, { kind: 'insert', entity: arc, index: this.ctx.drawing.entityCount }, 'Arc')) {
      this.picks = [];
    }
  }

  confirm(): void {
    this.finished = true;
  }

  cancel(): void {
    if (this.picks.length > 0) this.picks = [];
    else this.finished = true;
  }

  preview(cursor: Vec2): Preview | null {
    const layer = this.ctx.activeLayer();
    if (this.picks.length === 1) {
      return { entities: [previewLine(layer, this.picks[0]!, cursor)], markers: [] };
    }
    if (this.picks.length === 2) {
      const geometry = arcFromThreePoints(this.picks[0]!, this.picks[1]!, cursor);
      if (!geometry) return null;
      const arc: ArcEntity = { id: PREVIEW_ID, type: 'arc', layer, color: null, ...geometry };
      return { entities: [arc], markers: [] };
    }
    return null;
  }
}
