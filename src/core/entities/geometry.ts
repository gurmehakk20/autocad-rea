import {
  type Arc,
  angleInArc,
  arcEndPoint,
  arcExtremePoints,
  arcMidPoint,
  arcStartPoint,
  distancePointToArc,
  normalizeAngle,
} from '../geometry/arc';
import { type Bounds, boundsFromPoints, boundsOfCircle, unionBounds } from '../geometry/bounds';
import {
  type Circle,
  distancePointToCircle,
  intersectCircles,
  intersectSegmentCircle,
} from '../geometry/circle';
import { type Matrix2D, applyToPoint, isRigid } from '../geometry/transform';
import { distancePointToSegment, intersectSegments } from '../geometry/segment';
import { type Vec2, angleOf, midpoint, sub, vec2 } from '../geometry/vector';
import type { ArcEntity, CircleEntity, Entity, LineEntity, PolylineEntity } from './types';

export type Segment = readonly [Vec2, Vec2];

export type SnapKind = 'endpoint' | 'midpoint' | 'center' | 'intersection';

export interface SnapCandidate {
  readonly kind: Exclude<SnapKind, 'intersection'>;
  readonly point: Vec2;
}

/** Straight segments that make up a line or polyline. Other entities return []. */
export function segmentsOf(entity: Entity): Segment[] {
  if (entity.type === 'line') return [[entity.start, entity.end]];
  if (entity.type === 'polyline') {
    const segments: Segment[] = [];
    for (let i = 1; i < entity.vertices.length; i++) {
      segments.push([entity.vertices[i - 1]!, entity.vertices[i]!]);
    }
    if (entity.closed && entity.vertices.length > 2) {
      segments.push([entity.vertices[entity.vertices.length - 1]!, entity.vertices[0]!]);
    }
    return segments;
  }
  return [];
}

export function entityBounds(entity: Entity): Bounds | null {
  switch (entity.type) {
    case 'line':
      return boundsFromPoints([entity.start, entity.end]);
    case 'circle':
      return boundsOfCircle(entity.center, entity.radius);
    case 'arc':
      return boundsFromPoints(arcExtremePoints(entity));
    case 'polyline':
      return boundsFromPoints(entity.vertices);
  }
}

/** Bounds of several entities, or null when the list is empty. */
export function unionEntityBounds(entities: readonly Entity[]): Bounds | null {
  let result: Bounds | null = null;
  for (const entity of entities) {
    const b = entityBounds(entity);
    if (!b) continue;
    result = result ? unionBounds(result, b) : b;
  }
  return result;
}

/** Distance from a point to the entity outline. Circles and arcs use their perimeter. */
export function distanceToEntity(entity: Entity, p: Vec2): number {
  switch (entity.type) {
    case 'line':
      return distancePointToSegment(p, entity.start, entity.end);
    case 'circle':
      return distancePointToCircle(p, circleOf(entity));
    case 'arc':
      return distancePointToArc(p, entity);
    case 'polyline': {
      let best = Infinity;
      for (const [a, b] of segmentsOf(entity)) {
        best = Math.min(best, distancePointToSegment(p, a, b));
      }
      return best;
    }
  }
}

/** Object-snap candidates. Intersections are computed between entities, not here. */
export function snapCandidatesOf(entity: Entity): SnapCandidate[] {
  switch (entity.type) {
    case 'line':
      return [
        { kind: 'endpoint', point: entity.start },
        { kind: 'endpoint', point: entity.end },
        { kind: 'midpoint', point: midpoint(entity.start, entity.end) },
      ];
    case 'circle':
      return [{ kind: 'center', point: entity.center }];
    case 'arc':
      return [
        { kind: 'endpoint', point: arcStartPoint(entity) },
        { kind: 'endpoint', point: arcEndPoint(entity) },
        { kind: 'midpoint', point: arcMidPoint(entity) },
        { kind: 'center', point: entity.center },
      ];
    case 'polyline': {
      const candidates: SnapCandidate[] = entity.vertices.map((point) => ({ kind: 'endpoint', point }));
      for (const [a, b] of segmentsOf(entity)) {
        candidates.push({ kind: 'midpoint', point: midpoint(a, b) });
      }
      return candidates;
    }
  }
}

/** Applies a rigid transform (translation and rotation) and returns a new entity with the same id. */
export function transformEntity(entity: Entity, m: Matrix2D): Entity {
  if (!isRigid(m)) {
    throw new Error('Only rigid transforms (translation and rotation) are supported for entities.');
  }
  const rotationAngle = angleOf(vec2(m.a, m.b));
  switch (entity.type) {
    case 'line':
      return { ...entity, start: applyToPoint(m, entity.start), end: applyToPoint(m, entity.end) } satisfies LineEntity;
    case 'circle':
      return { ...entity, center: applyToPoint(m, entity.center) } satisfies CircleEntity;
    case 'arc':
      return {
        ...entity,
        center: applyToPoint(m, entity.center),
        // Keep angles in [0, 2π). Repeated rotations would otherwise drift to large
        // values, which other CAD programs may read as out-of-range DXF angles.
        startAngle: normalizeAngle(entity.startAngle + rotationAngle),
        endAngle: normalizeAngle(entity.endAngle + rotationAngle),
      } satisfies ArcEntity;
    case 'polyline':
      return {
        ...entity,
        vertices: entity.vertices.map((v) => applyToPoint(m, v)),
      } satisfies PolylineEntity;
  }
}

/**
 * Intersection points between two entities, restricted to their actual extents
 * (arc sweeps and finite segments). Overlapping collinear segments yield no
 * point. Circles that touch tangentially yield one point.
 */
export function intersectEntities(a: Entity, b: Entity): Vec2[] {
  const primsA = primitivesOf(a);
  const primsB = primitivesOf(b);
  const points: Vec2[] = [];
  for (const pa of primsA) {
    for (const pb of primsB) {
      points.push(...intersectPrimitives(pa, pb));
    }
  }
  return points;
}

type Primitive =
  | { readonly kind: 'segment'; readonly a: Vec2; readonly b: Vec2 }
  | { readonly kind: 'circle'; readonly circle: Circle; readonly arc: Arc | null };

function primitivesOf(entity: Entity): Primitive[] {
  switch (entity.type) {
    case 'line':
    case 'polyline':
      return segmentsOf(entity).map(([a, b]) => ({ kind: 'segment', a, b }));
    case 'circle':
      return [{ kind: 'circle', circle: circleOf(entity), arc: null }];
    case 'arc':
      return [{ kind: 'circle', circle: circleOf(entity), arc: entity }];
  }
}

function intersectPrimitives(p: Primitive, q: Primitive): Vec2[] {
  if (p.kind === 'segment' && q.kind === 'segment') {
    return intersectSegments(p.a, p.b, q.a, q.b);
  }
  if (p.kind === 'segment' && q.kind === 'circle') return filterArc(intersectSegmentCircle(p.a, p.b, q.circle), q.arc);
  if (p.kind === 'circle' && q.kind === 'segment') return filterArc(intersectSegmentCircle(q.a, q.b, p.circle), p.arc);
  if (p.kind === 'circle' && q.kind === 'circle') {
    const points = intersectCircles(p.circle, q.circle);
    return points.filter((pt) => onArc(pt, p.arc) && onArc(pt, q.arc));
  }
  return [];
}

function filterArc(points: Vec2[], arc: Arc | null): Vec2[] {
  return arc ? points.filter((pt) => onArc(pt, arc)) : points;
}

function onArc(p: Vec2, arc: Arc | null): boolean {
  if (!arc) return true;
  return angleInArc(arc, angleOf(sub(p, arc.center)));
}

function circleOf(entity: CircleEntity | ArcEntity): Circle {
  return { center: entity.center, radius: entity.radius };
}
