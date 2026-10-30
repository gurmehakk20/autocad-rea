import { ANGLE_EPSILON, EPSILON } from './tolerance';
import { type Vec2, angleOf, distance, fromPolar, sub, vec2 } from './vector';

export const TAU = Math.PI * 2;

/**
 * Circular arc. Angles are in radians and the arc runs counter-clockwise from
 * `startAngle` to `endAngle`. This matches DXF ARC semantics, with the angle
 * unit converted at the file boundary.
 */
export interface Arc {
  readonly center: Vec2;
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
}

/** Normalises an angle into [0, 2π). */
export function normalizeAngle(angle: number): number {
  const wrapped = angle % TAU;
  if (wrapped >= 0) return wrapped;
  // A tiny negative angle such as -1e-17 rounds to exactly TAU when TAU is added, which is outside [0, 2π). It is the same angle as 0.
  const shifted = wrapped + TAU;
  return shifted >= TAU ? 0 : shifted;
}

/** Counter-clockwise sweep in [0, 2π). A zero sweep means a degenerate arc. */
export function arcSweep(arc: Arc): number {
  const sweep = normalizeAngle(arc.endAngle - arc.startAngle);
  return sweep <= ANGLE_EPSILON || TAU - sweep <= ANGLE_EPSILON ? 0 : sweep;
}

/** Returns a human-readable reason when the arc is invalid, otherwise null. */
export function arcValidationError(arc: Arc): string | null {
  if (!Number.isFinite(arc.radius) || arc.radius <= 0) return 'Arc radius must be a positive number.';
  if (!Number.isFinite(arc.startAngle) || !Number.isFinite(arc.endAngle)) return 'Arc angles must be finite.';
  if (arcSweep(arc) === 0) return 'Arc sweep must be greater than zero.';
  return null;
}

export function arcPointAt(arc: Arc, angle: number): Vec2 {
  return fromPolar(arc.radius, angle, arc.center);
}

export function arcStartPoint(arc: Arc): Vec2 {
  return arcPointAt(arc, arc.startAngle);
}

export function arcEndPoint(arc: Arc): Vec2 {
  return arcPointAt(arc, arc.endAngle);
}

export function arcMidPoint(arc: Arc): Vec2 {
  return arcPointAt(arc, arc.startAngle + arcSweep(arc) / 2);
}

/** True when `angle` lies within the arc's counter-clockwise sweep (inclusive). */
export function angleInArc(arc: Arc, angle: number): boolean {
  const offset = normalizeAngle(angle - arc.startAngle);
  return offset <= arcSweep(arc) + ANGLE_EPSILON || TAU - offset <= ANGLE_EPSILON;
}

/** Distance from `p` to the arc, including its endpoints. */
export function distancePointToArc(p: Vec2, arc: Arc): number {
  const v = sub(p, arc.center);
  const dist = Math.hypot(v.x, v.y);
  if (dist > 0 && angleInArc(arc, angleOf(v))) {
    return Math.abs(dist - arc.radius);
  }
  return Math.min(distance(p, arcStartPoint(arc)), distance(p, arcEndPoint(arc)));
}

/**
 * Three-point arc through `p1`, `p2` and `p3`. The arc starts at `p1`, passes
 * through `p2`, and ends at `p3`. Returns null when the points are collinear or
 * coincident.
 */
export function arcFromThreePoints(p1: Vec2, p2: Vec2, p3: Vec2): Arc | null {
  const ax = p1.x;
  const ay = p1.y;
  const bx = p2.x;
  const by = p2.y;
  const cx = p3.x;
  const cy = p3.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  const scaleRef = Math.max(1, Math.abs(ax), Math.abs(ay), Math.abs(bx), Math.abs(by), Math.abs(cx), Math.abs(cy));
  if (Math.abs(d) <= EPSILON * scaleRef * scaleRef) return null;

  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const center = vec2(
    (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d,
    (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d,
  );
  const radius = distance(center, p1);
  const a1 = angleOf(sub(p1, center));
  const aMid = angleOf(sub(p2, center));
  const a3 = angleOf(sub(p3, center));

  // The arc must run from p1 to p3 counter-clockwise through p2.
  const midOnCcwFromStart = normalizeAngle(aMid - a1) < normalizeAngle(a3 - a1);
  const arc = midOnCcwFromStart
    ? { center, radius, startAngle: a1, endAngle: a3 }
    : { center, radius, startAngle: a3, endAngle: a1 };
  return arcValidationError(arc) === null ? arc : null;
}

/** Tight bounding points of the arc: endpoints plus cardinal extremes inside the sweep. */
export function arcExtremePoints(arc: Arc): Vec2[] {
  const points = [arcStartPoint(arc), arcEndPoint(arc)];
  for (let quarter = 0; quarter < 4; quarter++) {
    const angle = quarter * (Math.PI / 2);
    if (angleInArc(arc, angle)) points.push(arcPointAt(arc, angle));
  }
  return points;
}
