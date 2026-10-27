import { EPSILON } from './tolerance';
import { type Vec2, add, distance, dot, length, scale, sub, vec2 } from './vector';

export interface Circle {
  readonly center: Vec2;
  readonly radius: number;
}

/** Absolute distance from `p` to the circle's perimeter. */
export function distancePointToCircle(p: Vec2, c: Circle): number {
  return Math.abs(distance(p, c.center) - c.radius);
}

/**
 * Closest point on the perimeter. When `p` is exactly at the centre every point
 * is equally close, so the rightmost point (angle 0) is returned.
 */
export function closestPointOnCircle(p: Vec2, c: Circle): Vec2 {
  const v = sub(p, c.center);
  const len = length(v);
  if (len === 0) return vec2(c.center.x + c.radius, c.center.y);
  return add(c.center, scale(v, c.radius / len));
}

/**
 * Intersections of two circles.
 *
 * Returns 0, 1 (tangent) or 2 points. Concentric circles return no points, and
 * they are not treated as an infinite intersection.
 */
export function intersectCircles(c1: Circle, c2: Circle): Vec2[] {
  const dVec = sub(c2.center, c1.center);
  const d = length(dVec);
  if (d <= EPSILON * Math.max(1, d)) return [];

  const r1 = c1.radius;
  const r2 = c2.radius;
  const tol = EPSILON * Math.max(1, r1, r2, d);
  if (d > r1 + r2 + tol) return [];
  if (d < Math.abs(r1 - r2) - tol) return [];

  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const hSq = r1 * r1 - a * a;
  const h = hSq <= 0 ? 0 : Math.sqrt(hSq);
  const unit = scale(dVec, 1 / d);
  const base = add(c1.center, scale(unit, a));
  if (h === 0) return [base];
  const perp = vec2(-unit.y, unit.x);
  return [add(base, scale(perp, h)), sub(base, scale(perp, h))];
}

/**
 * Intersections of the finite segment `a`→`b` with a circle. Tangent contact
 * yields one point. Points outside the segment are dropped.
 */
export function intersectSegmentCircle(a: Vec2, b: Vec2, c: Circle): Vec2[] {
  const d = sub(b, a);
  const f = sub(a, c.center);
  const A = dot(d, d);
  if (A === 0) return [];
  const B = 2 * dot(f, d);
  const C = dot(f, f) - c.radius * c.radius;
  const disc = B * B - 4 * A * C;
  const discTol = EPSILON * Math.max(1, B * B, Math.abs(4 * A * C));
  if (disc < -discTol) return [];

  const params: number[] = [];
  if (Math.abs(disc) <= discTol) {
    params.push(-B / (2 * A));
  } else {
    const root = Math.sqrt(disc);
    params.push((-B - root) / (2 * A), (-B + root) / (2 * A));
  }

  return params
    .filter((t) => t >= -EPSILON && t <= 1 + EPSILON)
    .map((t) => add(a, scale(d, Math.min(1, Math.max(0, t)))));
}
