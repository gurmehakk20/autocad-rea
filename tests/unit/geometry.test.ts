import { describe, expect, it } from 'vitest';
import { arcFromThreePoints, arcSweep, angleInArc, distancePointToArc, normalizeAngle, TAU } from '../../src/core/geometry/arc';
import { boundsContainsBounds, boundsFromPoints, unionBounds } from '../../src/core/geometry/bounds';
import { distancePointToCircle, intersectCircles, intersectSegmentCircle } from '../../src/core/geometry/circle';
import { nearlyEqual } from '../../src/core/geometry/tolerance';
import {
  closestPointOnSegment,
  distancePointToSegment,
  intersectSegments,
  isPointOnSegment,
} from '../../src/core/geometry/segment';
import { applyToPoint, compose, isRigid, rotation, translation } from '../../src/core/geometry/transform';
import { distance, equalPoints, rotateAround, vec2 } from '../../src/core/geometry/vector';

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps * Math.max(1, Math.abs(a), Math.abs(b)));

describe('tolerance', () => {
  it('treats values within relative epsilon as equal, including huge coordinates', () => {
    expect(nearlyEqual(1, 1 + 1e-12)).toBe(true);
    expect(nearlyEqual(1, 1.001)).toBe(false);
    // 1e12 + 1e-4 is representable; a purely absolute 1e-9 test would wrongly reject it.
    expect(nearlyEqual(1e12, 1e12 + 1e-4)).toBe(true);
  });
});

describe('segments', () => {
  it('finds the closest point and clamps to the endpoints', () => {
    const a = vec2(0, 0);
    const b = vec2(10, 0);
    expect(closestPointOnSegment(vec2(5, 3), a, b).point).toEqual({ x: 5, y: 0 });
    expect(closestPointOnSegment(vec2(-4, 3), a, b).point).toEqual({ x: 0, y: 0 });
    expect(distancePointToSegment(vec2(13, 4), a, b)).toBeCloseTo(5, 12);
  });

  it('handles zero-length segments as points', () => {
    const p = vec2(2, 2);
    expect(distancePointToSegment(vec2(5, 6), p, p)).toBeCloseTo(5, 12);
    expect(intersectSegments(p, p, vec2(0, 0), vec2(4, 4))).toEqual([]);
  });

  it('checks points on segments with tolerance', () => {
    expect(isPointOnSegment(vec2(5, 0), vec2(0, 0), vec2(10, 0))).toBe(true);
    expect(isPointOnSegment(vec2(5, 1e-6), vec2(0, 0), vec2(10, 0))).toBe(false);
    expect(isPointOnSegment(vec2(1e9 + 0.5, 0), vec2(0, 0), vec2(2e9, 0))).toBe(true);
  });

  it('intersects crossing segments and reports the exact point', () => {
    const pts = intersectSegments(vec2(0, 0), vec2(10, 10), vec2(0, 10), vec2(10, 0));
    expect(pts).toHaveLength(1);
    expect(equalPoints(pts[0]!, vec2(5, 5), 1e-12)).toBe(true);
  });

  it('reports endpoints that meet end to end as intersecting', () => {
    const pts = intersectSegments(vec2(0, 0), vec2(5, 0), vec2(5, 0), vec2(5, 5));
    expect(pts).toHaveLength(1);
  });

  it('returns no point for segments that do not reach each other', () => {
    expect(intersectSegments(vec2(0, 0), vec2(4, 0), vec2(5, -1), vec2(5, 1))).toEqual([]);
  });

  it('returns no point for parallel and collinear segments', () => {
    expect(intersectSegments(vec2(0, 0), vec2(10, 0), vec2(0, 1), vec2(10, 1))).toEqual([]);
    expect(intersectSegments(vec2(0, 0), vec2(10, 0), vec2(5, 0), vec2(15, 0))).toEqual([]);
  });

  it('treats nearly parallel segments as parallel rather than returning unstable points', () => {
    const pts = intersectSegments(vec2(0, 0), vec2(1e6, 1e-6), vec2(0, 1), vec2(1e6, 1 + 1e-7));
    expect(pts).toEqual([]);
  });
});

describe('circles', () => {
  it('computes point-to-perimeter distance', () => {
    expect(distancePointToCircle(vec2(0, 0), { center: vec2(0, 0), radius: 5 })).toBe(5);
    expect(distancePointToCircle(vec2(8, 0), { center: vec2(0, 0), radius: 5 })).toBe(3);
  });

  it('returns two points for overlapping circles', () => {
    const pts = intersectCircles({ center: vec2(0, 0), radius: 5 }, { center: vec2(6, 0), radius: 5 });
    expect(pts).toHaveLength(2);
    for (const p of pts) {
      close(distance(p, vec2(0, 0)), 5);
      close(distance(p, vec2(6, 0)), 5);
    }
  });

  it('returns a single point for externally tangent circles', () => {
    const pts = intersectCircles({ center: vec2(0, 0), radius: 5 }, { center: vec2(10, 0), radius: 5 });
    expect(pts).toHaveLength(1);
    close(pts[0]!.x, 5);
    close(pts[0]!.y, 0);
  });

  it('returns a single point for internally tangent circles', () => {
    const pts = intersectCircles({ center: vec2(0, 0), radius: 5 }, { center: vec2(2, 0), radius: 3 });
    expect(pts).toHaveLength(1);
    close(pts[0]!.x, 5);
  });

  it('returns nothing for separated, nested or concentric circles', () => {
    expect(intersectCircles({ center: vec2(0, 0), radius: 1 }, { center: vec2(5, 0), radius: 1 })).toEqual([]);
    expect(intersectCircles({ center: vec2(0, 0), radius: 5 }, { center: vec2(0, 0), radius: 2 })).toEqual([]);
    expect(intersectCircles({ center: vec2(0, 0), radius: 5 }, { center: vec2(0, 0), radius: 5 })).toEqual([]);
  });

  it('intersects a bounded segment with a circle and drops points off the segment', () => {
    const c = { center: vec2(0, 0), radius: 5 };
    expect(intersectSegmentCircle(vec2(-10, 0), vec2(10, 0), c)).toHaveLength(2);
    // Starts inside the circle and crosses the perimeter once.
    expect(intersectSegmentCircle(vec2(0, 0), vec2(8, 0), c)).toHaveLength(1);
    // Entirely inside the circle: no perimeter crossing.
    expect(intersectSegmentCircle(vec2(0, 0), vec2(3, 0), c)).toEqual([]);
    expect(intersectSegmentCircle(vec2(6, 0), vec2(10, 0), c)).toEqual([]);
  });

  it('reports a tangent line as one point', () => {
    const pts = intersectSegmentCircle(vec2(-10, 5), vec2(10, 5), { center: vec2(0, 0), radius: 5 });
    expect(pts).toHaveLength(1);
    close(pts[0]!.y, 5);
  });
});

describe('arcs', () => {
  it('normalises angles into [0, 2π)', () => {
    close(normalizeAngle(-Math.PI / 2), (3 * Math.PI) / 2);
    close(normalizeAngle(TAU + 0.5), 0.5);
  });

  it('treats zero sweep and full-turn sweep as degenerate', () => {
    expect(arcSweep({ center: vec2(0, 0), radius: 1, startAngle: 1, endAngle: 1 })).toBe(0);
  });

  it('checks angle membership across the 0 radian seam', () => {
    const arc = { center: vec2(0, 0), radius: 1, startAngle: (3 * Math.PI) / 2, endAngle: Math.PI / 2 };
    expect(angleInArc(arc, 0)).toBe(true);
    expect(angleInArc(arc, Math.PI)).toBe(false);
  });

  it('measures distance to an arc through its sweep and its endpoints', () => {
    const arc = { center: vec2(0, 0), radius: 5, startAngle: 0, endAngle: Math.PI / 2 };
    close(distancePointToArc(vec2(0, 7), arc), 2);
    // (-5,0) is outside the sweep, so the nearest point is the endpoint (0,5) at 5√2.
    close(distancePointToArc(vec2(-5, 0), arc), 5 * Math.SQRT2);
  });

  it('builds the arc through three points in the correct direction', () => {
    const arc = arcFromThreePoints(vec2(5, 0), vec2(0, 5), vec2(-5, 0));
    expect(arc).not.toBeNull();
    close(arc!.radius, 5);
    close(arc!.center.x, 0);
    close(arc!.center.y, 0);
    // Passing through (0, 5) on the way from (5, 0) to (-5, 0) means counter-clockwise.
    close(arcSweep(arc!), Math.PI);
  });

  it('rejects collinear and coincident points', () => {
    expect(arcFromThreePoints(vec2(0, 0), vec2(1, 1), vec2(2, 2))).toBeNull();
    expect(arcFromThreePoints(vec2(0, 0), vec2(0, 0), vec2(2, 2))).toBeNull();
  });

  it('keeps the arc on the requested side when the middle point is clockwise', () => {
    const arc = arcFromThreePoints(vec2(0, 5), vec2(5, 0), vec2(-5, 0))!;
    // From (0,5) clockwise through (5,0) to (-5,0) is a 90° arc, not 270°.
    close(arcSweep(arc), (3 * Math.PI) / 2);
  });

  it('handles very large coordinates', () => {
    const arc = arcFromThreePoints(vec2(1e9, 0), vec2(0, 1e9), vec2(-1e9, 0))!;
    close(arc.radius, 1e9, 1e-6);
  });
});

describe('transforms', () => {
  it('rotates a point about a centre', () => {
    const p = rotateAround(vec2(2, 0), vec2(1, 0), Math.PI / 2);
    close(p.x, 1);
    close(p.y, 1);
  });

  it('composes translation and rotation in the documented order', () => {
    const m = compose(translation(10, 0), rotation(Math.PI / 2));
    const p = applyToPoint(m, vec2(1, 0));
    close(p.x, 10);
    close(p.y, 1);
  });

  it('classifies rigid transforms', () => {
    expect(isRigid(rotation(0.3, vec2(4, 4)))).toBe(true);
    expect(isRigid({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 })).toBe(false);
    expect(isRigid({ a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 })).toBe(false);
  });
});

describe('bounds', () => {
  it('computes and combines bounding boxes, including negative coordinates', () => {
    const a = boundsFromPoints([vec2(-3, 2), vec2(4, -1)])!;
    expect(a).toEqual({ minX: -3, minY: -1, maxX: 4, maxY: 2 });
    const u = unionBounds(a, { minX: 10, minY: 10, maxX: 11, maxY: 11 });
    expect(boundsContainsBounds(u, a)).toBe(true);
  });

  it('returns null for an empty point list', () => {
    expect(boundsFromPoints([])).toBeNull();
  });
});
