import { nearlyEqual } from './tolerance';

/** Immutable 2D point or vector in world coordinates. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const vec2 = (x: number, y: number): Vec2 => ({ x, y });

export const ZERO: Vec2 = vec2(0, 0);

export const add = (a: Vec2, b: Vec2): Vec2 => vec2(a.x + b.x, a.y + b.y);
export const sub = (a: Vec2, b: Vec2): Vec2 => vec2(a.x - b.x, a.y - b.y);
export const scale = (a: Vec2, s: number): Vec2 => vec2(a.x * s, a.y * s);
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const distanceSq = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 =>
  vec2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
export const midpoint = (a: Vec2, b: Vec2): Vec2 => lerp(a, b, 0.5);
export const angleOf = (v: Vec2): number => Math.atan2(v.y, v.x);
export const fromPolar = (radius: number, angle: number, center: Vec2 = ZERO): Vec2 =>
  vec2(center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle));

export function normalize(v: Vec2): Vec2 | null {
  const len = length(v);
  return len === 0 ? null : scale(v, 1 / len);
}

/** Rotates `p` around `center` by `angle` radians (counter-clockwise positive). */
export function rotateAround(p: Vec2, center: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return vec2(center.x + dx * c - dy * s, center.y + dx * s + dy * c);
}

export function equalPoints(a: Vec2, b: Vec2, eps?: number): boolean {
  return nearlyEqual(a.x, b.x, eps) && nearlyEqual(a.y, b.y, eps);
}
