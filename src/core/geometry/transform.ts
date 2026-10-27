import { type Vec2, vec2 } from './vector';

/**
 * 2D affine transform in the form
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 */
export interface Matrix2D {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function translation(dx: number, dy: number): Matrix2D {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}

/** Counter-clockwise rotation by `angle` radians around `center`. */
export function rotation(angle: number, center: Vec2 = vec2(0, 0)): Matrix2D {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: center.x - (cos * center.x - sin * center.y),
    f: center.y - (sin * center.x + cos * center.y),
  };
}

/** Returns the transform that applies `m2` first, then `m1`. */
export function compose(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function applyToPoint(m: Matrix2D, p: Vec2): Vec2 {
  return vec2(m.a * p.x + m.c * p.y + m.e, m.b * p.x + m.d * p.y + m.f);
}

export function determinant(m: Matrix2D): number {
  return m.a * m.d - m.b * m.c;
}

/**
 * True when the transform only translates and rotates. Those transforms keep
 * circles and arcs as circles and arcs, so they can be applied exactly.
 */
export function isRigid(m: Matrix2D): boolean {
  const scaleX = Math.hypot(m.a, m.b);
  const scaleY = Math.hypot(m.c, m.d);
  const orthogonal = Math.abs(m.a * m.c + m.b * m.d) <= 1e-9;
  return orthogonal && Math.abs(scaleX - 1) <= 1e-9 && Math.abs(scaleY - 1) <= 1e-9 && determinant(m) > 0;
}
