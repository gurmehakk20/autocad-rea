import { type Arc, arcValidationError } from '../geometry/arc';
import { type Vec2, equalPoints } from '../geometry/vector';

/** Stable identifier. Assigned once by the drawing and never reused. */
export type EntityId = string;

interface EntityBase {
  readonly id: EntityId;
  /** Name of the layer the entity belongs to. */
  readonly layer: string;
  /**
   * Explicit colour as `#rrggbb`, or `null` to inherit the layer colour
   * (AutoCAD's "ByLayer").
   */
  readonly color: string | null;
}

export interface LineEntity extends EntityBase {
  readonly type: 'line';
  readonly start: Vec2;
  readonly end: Vec2;
}

export interface CircleEntity extends EntityBase {
  readonly type: 'circle';
  readonly center: Vec2;
  readonly radius: number;
}

export interface ArcEntity extends EntityBase, Arc {
  readonly type: 'arc';
}

/**
 * Open or closed sequence of straight segments. Rectangles are stored as closed
 * polylines with four vertices, which matches how DXF LWPOLYLINE represents them.
 */
export interface PolylineEntity extends EntityBase {
  readonly type: 'polyline';
  readonly vertices: readonly Vec2[];
  readonly closed: boolean;
}

export type Entity = LineEntity | CircleEntity | ArcEntity | PolylineEntity;
export type EntityType = Entity['type'];

export const ENTITY_LABELS: Record<EntityType, string> = {
  line: 'Line',
  circle: 'Circle',
  arc: 'Arc',
  polyline: 'Polyline',
};

/**
 * Returns a message describing why the entity is geometrically invalid, or
 * `null` when it is valid. Invalid entities must never reach the drawing.
 */
export function entityValidationError(entity: Entity): string | null {
  switch (entity.type) {
    case 'line': {
      if (!isFinitePoint(entity.start) || !isFinitePoint(entity.end)) return 'Line coordinates must be finite.';
      if (equalPoints(entity.start, entity.end)) return 'Line has zero length.';
      return null;
    }
    case 'circle': {
      if (!isFinitePoint(entity.center)) return 'Circle centre must be finite.';
      if (!Number.isFinite(entity.radius) || entity.radius <= 0) return 'Circle radius must be a positive number.';
      return null;
    }
    case 'arc':
      if (!isFinitePoint(entity.center)) return 'Arc centre must be finite.';
      return arcValidationError(entity);
    case 'polyline': {
      if (entity.vertices.length < 2) return 'Polyline needs at least two vertices.';
      if (!entity.vertices.every(isFinitePoint)) return 'Polyline vertices must be finite.';
      for (let i = 1; i < entity.vertices.length; i++) {
        if (equalPoints(entity.vertices[i - 1]!, entity.vertices[i]!)) {
          return 'Polyline contains consecutive duplicate vertices.';
        }
      }
      if (entity.closed && equalPoints(entity.vertices[0]!, entity.vertices[entity.vertices.length - 1]!)) {
        return 'Closed polyline repeats its first vertex.';
      }
      return null;
    }
  }
}

function isFinitePoint(p: Vec2): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}
