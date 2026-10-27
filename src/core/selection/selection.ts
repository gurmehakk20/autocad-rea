import type { Drawing } from '../document/Drawing';
import { arcExtremePoints } from '../geometry/arc';
import { type Bounds, boundsContainsBounds, boundsContainsPoint, boundsFromCorners, boundsIntersect } from '../geometry/bounds';
import { type Vec2, vec2 } from '../geometry/vector';
import type { Entity, EntityId, LineEntity } from '../entities/types';
import { distanceToEntity, entityBounds, intersectEntities } from '../entities/geometry';

/** Ordered set of selected entity ids. Insertion order is kept for stable previews. */
export class Selection {
  private readonly ids = new Set<EntityId>();

  get size(): number {
    return this.ids.size;
  }

  has(id: EntityId): boolean {
    return this.ids.has(id);
  }

  toArray(): EntityId[] {
    return [...this.ids];
  }

  add(ids: Iterable<EntityId>): void {
    for (const id of ids) this.ids.add(id);
  }

  remove(ids: Iterable<EntityId>): void {
    for (const id of ids) this.ids.delete(id);
  }

  toggle(id: EntityId): void {
    if (this.ids.has(id)) this.ids.delete(id);
    else this.ids.add(id);
  }

  replace(ids: Iterable<EntityId>): void {
    this.ids.clear();
    this.add(ids);
  }

  clear(): void {
    this.ids.clear();
  }

  /** Drops ids that no longer refer to a pickable entity, such as after hide or lock. */
  prune(drawing: Drawing): void {
    for (const id of [...this.ids]) {
      const entity = drawing.getEntity(id);
      if (!entity || !drawing.isEditable(entity)) this.ids.delete(id);
    }
  }
}

/**
 * Topmost pickable entity whose outline lies within `tolerance` of `p`. Hidden
 * and locked entities are never picked.
 */
export function pickEntity(drawing: Drawing, p: Vec2, tolerance: number): Entity | undefined {
  const entities = drawing.entities();
  for (let i = entities.length - 1; i >= 0; i--) {
    const entity = entities[i]!;
    if (!drawing.isEditable(entity)) continue;
    if (distanceToEntity(entity, p) <= tolerance) return entity;
  }
  return undefined;
}

/**
 * Entities selected by a rectangular window.
 *
 * - `window` (left to right): entities fully inside the rectangle.
 * - `crossing` (right to left): entities that touch the rectangle at all.
 *
 * This matches the common CAD convention, but the implementation is original.
 */
export function selectByRectangle(
  drawing: Drawing,
  corner1: Vec2,
  corner2: Vec2,
  mode: 'window' | 'crossing',
): EntityId[] {
  const rect = boundsFromCorners(corner1, corner2);
  const edges = rectangleEdges(rect);
  const result: EntityId[] = [];
  for (const entity of drawing.entities()) {
    if (!drawing.isEditable(entity)) continue;
    const bounds = entityBounds(entity);
    if (!bounds) continue;
    if (mode === 'window') {
      if (boundsContainsBounds(rect, bounds)) result.push(entity.id);
    } else if (crosses(entity, bounds, rect, edges)) {
      result.push(entity.id);
    }
  }
  return result;
}

/** A crossing hit: the entity lies inside the window, has a vertex inside it, or its outline crosses an edge. */
function crosses(entity: Entity, bounds: Bounds, rect: Bounds, edges: LineEntity[]): boolean {
  if (!boundsIntersect(bounds, rect)) return false;
  if (boundsContainsBounds(rect, bounds)) return true;
  if (vertexPoints(entity).some((p) => boundsContainsPoint(rect, p))) return true;
  return edges.some((edge) => intersectEntities(entity, edge).length > 0);
}

/** Vertices of lines and polylines, and the extreme points of arcs. Circles have none, so they rely on edge crossings. */
function vertexPoints(entity: Entity): Vec2[] {
  switch (entity.type) {
    case 'line':
      return [entity.start, entity.end];
    case 'polyline':
      return [...entity.vertices];
    case 'circle':
      return [];
    case 'arc':
      return arcExtremePoints(entity);
  }
}

function rectangleEdges(rect: Bounds): LineEntity[] {
  const corners: Vec2[] = [
    vec2(rect.minX, rect.minY),
    vec2(rect.maxX, rect.minY),
    vec2(rect.maxX, rect.maxY),
    vec2(rect.minX, rect.maxY),
  ];
  return corners.map((start, i) => ({
    id: '',
    type: 'line',
    layer: '',
    color: null,
    start,
    end: corners[(i + 1) % 4]!,
  }));
}

/** Convenience: every pickable entity id. Used by Select All. */
export function selectableIds(drawing: Drawing): EntityId[] {
  return drawing.entities().filter((e) => drawing.isEditable(e)).map((e) => e.id);
}
