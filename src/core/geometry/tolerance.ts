/**
 * Numerical tolerances for geometry.
 *
 * All coordinates are in drawing units (see `DrawingUnits`). Comparisons use a
 * relative tolerance so that behaviour stays consistent for very small and very
 * large coordinates: two values are "equal" when they differ by at most
 * `EPSILON * max(1, |a|, |b|)`.
 */
export const EPSILON = 1e-9;

/** Angular tolerance in radians, used for parallel checks and angle comparisons. */
export const ANGLE_EPSILON = 1e-9;

export function nearlyEqual(a: number, b: number, eps = EPSILON): boolean {
  return Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
