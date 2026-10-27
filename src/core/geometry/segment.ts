import { ANGLE_EPSILON, EPSILON } from './tolerance';
import { type Vec2, cross, distance, dot, lerp, sub } from './vector';

export interface ClosestPoint {
  readonly point: Vec2;
  /** Parameter along the segment: 0 at `a`, 1 at `b`, clamped to [0, 1]. */
  readonly t: number;
}

/**
 * Closest point on segment `ab` to `p`. A degenerate (zero-length) segment
 * returns its single endpoint with t = 0.
 */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): ClosestPoint {
  const ab = sub(b, a);
  const lenSq = dot(ab, ab);
  if (lenSq === 0) return { point: a, t: 0 };
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / lenSq));
  return { point: lerp(a, b, t), t };
}

export function distancePointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  return distance(p, closestPointOnSegment(p, a, b).point);
}

/**
 * True when `p` lies on segment `ab` within `tolerance` (absolute distance in
 * drawing units, scaled up for large coordinates).
 */
export function isPointOnSegment(p: Vec2, a: Vec2, b: Vec2, tolerance = EPSILON): boolean {
  const magnitude = Math.max(1, Math.abs(p.x), Math.abs(p.y));
  return distancePointToSegment(p, a, b) <= tolerance * magnitude;
}

/**
 * Intersection point of two finite segments, or an empty array.
 *
 * - Parallel and collinear segments return no point. Callers that need overlap
 *   handling must use endpoints explicitly.
 * - Nearly parallel segments (sin(angle) below ANGLE_EPSILON) are treated as
 *   parallel to avoid unstable parameters.
 * - Endpoints are accepted with a small parametric tolerance so that segments
 *   that meet end-to-end are reported as intersecting.
 */
export function intersectSegments(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2[] {
  const d1 = sub(a2, a1);
  const d2 = sub(b2, b1);
  const denom = cross(d1, d2);
  const len1 = Math.hypot(d1.x, d1.y);
  const len2 = Math.hypot(d2.x, d2.y);
  if (len1 === 0 || len2 === 0) return [];
  if (Math.abs(denom) <= ANGLE_EPSILON * len1 * len2) return [];

  const w = sub(b1, a1);
  const t = cross(w, d2) / denom;
  const u = cross(w, d1) / denom;
  const paramEps = EPSILON;
  if (t < -paramEps || t > 1 + paramEps || u < -paramEps || u > 1 + paramEps) return [];

  return [lerp(a1, a2, Math.min(1, Math.max(0, t)))];
}
