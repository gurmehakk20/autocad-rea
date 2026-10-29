import { type Vec2, fromPolar, vec2 } from '../core/geometry/vector';

export type ParsedInput =
  | { readonly kind: 'empty' }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'point'; readonly point: Vec2 }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'invalid'; readonly reason: string };

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const ABS_POINT = new RegExp(String.raw`^(${NUM})\s*,\s*(${NUM})$`);
const REL_POINT = new RegExp(String.raw`^@\s*(${NUM})\s*,\s*(${NUM})$`);
const POLAR = new RegExp(String.raw`^@\s*(${NUM})\s*<\s*(${NUM})$`);
const PLAIN_NUMBER = new RegExp(String.raw`^${NUM}$`);

/**
 * Classifies command-line input.
 *
 * - `x,y` is an absolute point.
 * - `@dx,dy` is a relative point from the tool's base point.
 * - `@d<a` is a polar offset from the base point, with the angle in degrees.
 * - A plain number is a distance or angle, depending on the active step.
 * - Anything else is treated as a command name.
 *
 * `basePoint` is used only to resolve the relative and polar forms, so the
 * function stays pure. Callers pass the tool's base point or the origin.
 */
export function parseInput(raw: string, basePoint: Vec2 | null): ParsedInput {
  const text = raw.trim();
  if (text === '') return { kind: 'empty' };

  const parsed = parseNumeric(text, basePoint ?? vec2(0, 0));
  if (parsed) {
    // The patterns accept any digits, so "1e999" reads as Infinity. Refuse it here, once, before a tool builds geometry from it.
    const finite = parsed.kind === 'point' ? Number.isFinite(parsed.point.x) && Number.isFinite(parsed.point.y) : Number.isFinite(parsed.value);
    return finite ? parsed : { kind: 'invalid', reason: `"${text}" is out of range. Numbers must be finite.` };
  }

  if (/^[@\d,<\s.+-]+$/.test(text) && /[,<@]/.test(text)) {
    return { kind: 'invalid', reason: `Could not read coordinate "${text}". Use x,y, @dx,dy or @distance<angle.` };
  }
  return { kind: 'text', text: text.toUpperCase() };
}

function parseNumeric(text: string, base: Vec2): Extract<ParsedInput, { kind: 'point' | 'number' }> | null {
  const abs = ABS_POINT.exec(text);
  if (abs) return { kind: 'point', point: vec2(Number(abs[1]), Number(abs[2])) };

  const rel = REL_POINT.exec(text);
  if (rel) return { kind: 'point', point: vec2(base.x + Number(rel[1]), base.y + Number(rel[2])) };

  const polar = POLAR.exec(text);
  if (polar) {
    const angle = (Number(polar[2]) * Math.PI) / 180;
    return { kind: 'point', point: fromPolar(Number(polar[1]), angle, base) };
  }

  if (PLAIN_NUMBER.test(text)) return { kind: 'number', value: Number(text) };
  return null;
}
