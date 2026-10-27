import { Drawing, DEFAULT_LAYER_NAME, type DrawingUnits, type Layer } from '../../core/document/Drawing';
import type { CircleEntity, Entity, ArcEntity, LineEntity, PolylineEntity } from '../../core/entities/types';
import { entityValidationError } from '../../core/entities/types';
import { type Vec2, distance, equalPoints, vec2 } from '../../core/geometry/vector';
import { ACI_PALETTE, INSUNITS_TO_DRAWING, toHex } from './units';

export class DxfFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DxfFileError';
  }
}

export interface DxfImportResult {
  readonly drawing: Drawing;
  /** Data that was skipped, approximated or defaulted. Show these to the user. */
  readonly warnings: string[];
  readonly imported: number;
  readonly skipped: number;
}

/** Maximum angle between flattened bulge segments, in radians (5 degrees). */
const BULGE_STEP = (5 * Math.PI) / 180;

interface Pair {
  readonly code: number;
  readonly value: string;
}

interface RecordGroup {
  readonly type: string;
  readonly pairs: Pair[];
}

/**
 * Reads the supported subset of DXF text: HEADER $INSUNITS, TABLES LAYER, and
 * ENTITIES LINE, CIRCLE, ARC and LWPOLYLINE. Anything else is counted and reported.
 */
export function importDxf(text: string): DxfImportResult {
  const pairs = tokenize(text);
  const sections = splitSections(pairs);
  if (sections.size === 0) throw new DxfFileError('No DXF sections found. This does not look like a DXF file.');

  const warnings: string[] = [];
  const units = readUnits(sections.get('HEADER') ?? [], warnings);
  const layers = readLayers(sections.get('TABLES') ?? [], warnings);
  const entitySource = sections.get('ENTITIES') ?? [];
  if (!sections.has('ENTITIES')) warnings.push('The file has no ENTITIES section. The drawing is empty.');

  const unsupported = new Map<string, number>();
  const entities: Entity[] = [];
  let skipped = 0;
  let approximatedBulges = 0;
  const colourWarnings = new Set<number>();

  for (const record of splitRecords(entitySource)) {
    const common = readCommon(record.pairs, colourWarnings, warnings);
    if (!layers.has(common.layer)) {
      warnings.push(`Layer "${common.layer}" is used by entities but not defined. It was created with default settings.`);
      layers.set(common.layer, defaultLayer(common.layer));
    }
    try {
      switch (record.type) {
        case 'LINE': {
          const line = readLine(record.pairs, common);
          addOrSkip(line, entities, () => skipped++, warnings);
          break;
        }
        case 'CIRCLE':
        case 'ARC':
        case 'LWPOLYLINE': {
          // These entities live in their own coordinate system (OCS), set by the extrusion direction.
          const plane = planeOf(record.pairs);
          if (plane === 'tilted') {
            const key = `${record.type} (tilted 3D plane)`;
            unsupported.set(key, (unsupported.get(key) ?? 0) + 1);
            skipped++;
            break;
          }
          const mirrored = plane === 'mirrored';
          if (record.type === 'CIRCLE') {
            addOrSkip(readCircle(record.pairs, common, mirrored), entities, () => skipped++, warnings);
            break;
          }
          if (record.type === 'ARC') {
            addOrSkip(readArc(record.pairs, common, mirrored), entities, () => skipped++, warnings);
            break;
          }
          const polylines = readPolyline(record.pairs, common, mirrored);
          approximatedBulges += polylines.approximated;
          if (polylines.entity) addOrSkip(polylines.entity, entities, () => skipped++, warnings);
          else skipped++;
          break;
        }
        default:
          unsupported.set(record.type, (unsupported.get(record.type) ?? 0) + 1);
          skipped++;
      }
    } catch (error) {
      skipped++;
      warnings.push(error instanceof Error ? error.message : 'Skipped an invalid entity.');
    }
  }

  if (unsupported.size > 0) {
    const list = [...unsupported].map(([type, count]) => `${type} x${count}`).join(', ');
    warnings.push(`Skipped unsupported entities (not imported): ${list}.`);
  }
  if (approximatedBulges > 0) {
    warnings.push(`${approximatedBulges} polyline arc segment(s) were approximated with straight segments.`);
  }

  const orderedLayers = [...layers.values()];

  const drawing = new Drawing();
  // Assign sequential ids in the same format the editor uses.
  const numbered = entities.map((entity, i) => ({ ...entity, id: `e${i + 1}` }) as Entity);
  drawing.loadParts({ units, layers: orderedLayers, entities: numbered, idSequence: numbered.length });

  return { drawing, warnings, imported: numbered.length, skipped };
}

function addOrSkip(entity: Entity, entities: Entity[], onSkip: () => void, warnings: string[]): void {
  const reason = entityValidationError(entity);
  if (reason) {
    onSkip();
    warnings.push(`Skipped an invalid ${entity.type}: ${reason}`);
    return;
  }
  entities.push(entity);
}

interface Common {
  readonly layer: string;
  readonly color: string | null;
}

function readCommon(pairs: Pair[], colourWarnings: Set<number>, warnings: string[]): Common {
  // A missing or blank layer name means the default layer. A blank name cannot be a layer.
  const layer = firstValue(pairs, 8)?.trim() || DEFAULT_LAYER_NAME;
  const trueColor = firstNumber(pairs, 420);
  if (trueColor !== undefined) return { layer, color: toHex(trueColor) };
  const index = firstNumber(pairs, 62);
  if (index === undefined || index === 0 || index === 256 || index < 0) return { layer, color: null };
  const palette = ACI_PALETTE[index];
  if (palette) return { layer, color: palette };
  if (!colourWarnings.has(index)) {
    colourWarnings.add(index);
    warnings.push(`Colour index ${index} is not in the supported palette. Entities use their layer colour instead.`);
  }
  return { layer, color: null };
}

function readLine(pairs: Pair[], common: Common): LineEntity {
  return {
    id: '',
    type: 'line',
    layer: common.layer,
    color: common.color,
    start: readPoint(pairs, 10, 20, 'LINE start'),
    end: readPoint(pairs, 11, 21, 'LINE end'),
  };
}

/**
 * How an entity's own coordinate system (OCS) relates to the drawing plane, from its
 * extrusion direction (group codes 210, 220, 230).
 *
 * - `flat`: extrusion is +Z, the default. Coordinates are used as written.
 * - `mirrored`: extrusion is -Z. AutoCAD's arbitrary-axis rule makes the OCS X axis point
 *   along -X, so the entity appears mirrored left to right.
 * - `tilted`: any other direction places the entity on a 3D plane, which a 2D drawing cannot represent.
 */
function planeOf(pairs: Pair[]): 'flat' | 'mirrored' | 'tilted' {
  const nx = firstNumber(pairs, 210) ?? 0;
  const ny = firstNumber(pairs, 220) ?? 0;
  const nz = firstNumber(pairs, 230) ?? 1;
  const tolerance = 1e-6;
  if (Math.abs(nx) > tolerance || Math.abs(ny) > tolerance) return 'tilted';
  if (nz > 0) return 'flat';
  if (nz < 0) return 'mirrored';
  return 'tilted'; // the zero vector is not a valid direction
}

function readCircle(pairs: Pair[], common: Common, mirrored: boolean): CircleEntity {
  const center = readPoint(pairs, 10, 20, 'CIRCLE centre');
  return {
    id: '',
    type: 'circle',
    layer: common.layer,
    color: common.color,
    center: mirrored ? vec2(-center.x, center.y) : center,
    radius: requireNumber(pairs, 40, 'CIRCLE radius'),
  };
}

function readArc(pairs: Pair[], common: Common, mirrored: boolean): ArcEntity {
  const degrees = (code: number, label: string) => (requireNumber(pairs, code, label) * Math.PI) / 180;
  const center = readPoint(pairs, 10, 20, 'ARC centre');
  const start = degrees(50, 'ARC start angle');
  const end = degrees(51, 'ARC end angle');
  return {
    id: '',
    type: 'arc',
    layer: common.layer,
    color: common.color,
    center: mirrored ? vec2(-center.x, center.y) : center,
    radius: requireNumber(pairs, 40, 'ARC radius'),
    // Reflecting across the Y axis maps angle a to π − a, and reverses the sweep direction,
    // so the old end becomes the new start.
    startAngle: mirrored ? Math.PI - end : start,
    endAngle: mirrored ? Math.PI - start : end,
  };
}

interface PolylineRead {
  readonly entity: PolylineEntity | null;
  /** Number of bulge arcs that were flattened into straight segments. */
  readonly approximated: number;
}

/**
 * LWPOLYLINE. Bulge values describe arc segments. Those segments are flattened into
 * straight segments within 5 degrees, and the import reports how many were changed.
 */
function readPolyline(pairs: Pair[], common: Common, mirrored: boolean): PolylineRead {
  const flags = firstNumber(pairs, 70) ?? 0;
  const closed = (flags & 1) === 1;
  // A mirror reverses orientation, so x flips and every bulge changes sign.
  const xSign = mirrored ? -1 : 1;
  const vertices: { p: Vec2; bulge: number }[] = [];
  for (const pair of pairs) {
    if (pair.code === 10) {
      vertices.push({ p: vec2(xSign * parseNumber(pair.value, 'LWPOLYLINE x'), 0), bulge: 0 });
    } else if (pair.code === 20) {
      const last = vertices.at(-1);
      if (!last) throw new DxfFileError('LWPOLYLINE has a Y value without an X value.');
      vertices[vertices.length - 1] = { p: vec2(last.p.x, parseNumber(pair.value, 'LWPOLYLINE y')), bulge: last.bulge };
    } else if (pair.code === 42) {
      const last = vertices.at(-1);
      if (last) vertices[vertices.length - 1] = { p: last.p, bulge: xSign * parseNumber(pair.value, 'LWPOLYLINE bulge') };
    }
  }
  if (vertices.length < 2) return { entity: null, approximated: 0 };

  const out: Vec2[] = [vertices[0]!.p];
  let approximated = 0;
  const segmentCount = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < segmentCount; i++) {
    const from = vertices[i]!;
    const to = vertices[(i + 1) % vertices.length]!;
    if (from.bulge !== 0) {
      const interior = flattenBulge(from.p, to.p, from.bulge);
      if (interior.length > 0) approximated++;
      out.push(...interior);
    }
    const isClosingRepeat = closed && i === segmentCount - 1;
    if (!isClosingRepeat) out.push(to.p);
  }

  const cleaned = removeConsecutiveDuplicates(out);
  const entity: PolylineEntity = {
    id: '',
    type: 'polyline',
    layer: common.layer,
    color: common.color,
    vertices: cleaned,
    closed,
  };
  return { entity: cleaned.length >= 2 ? entity : null, approximated };
}

/**
 * Interior points of a bulge arc from `p1` to `p2`. Positive bulge means a
 * counter-clockwise arc, negative means clockwise. Returns [] for straight
 * segments and degenerate chords.
 */
export function flattenBulge(p1: Vec2, p2: Vec2, bulge: number): Vec2[] {
  const chord = distance(p1, p2);
  if (bulge === 0 || chord === 0) return [];
  const included = 4 * Math.atan(Math.abs(bulge));
  const radius = chord / (2 * Math.sin(included / 2));
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const leftNormal = vec2(-dy / chord, dx / chord);
  const offset = radius * Math.cos(included / 2);
  const sign = bulge > 0 ? 1 : -1;
  const centre = vec2(
    (p1.x + p2.x) / 2 + sign * leftNormal.x * offset,
    (p1.y + p2.y) / 2 + sign * leftNormal.y * offset,
  );
  const startAngle = Math.atan2(p1.y - centre.y, p1.x - centre.x);
  const sweep = sign * included;
  const steps = Math.max(2, Math.ceil(included / BULGE_STEP));
  const points: Vec2[] = [];
  for (let i = 1; i < steps; i++) {
    const angle = startAngle + (sweep * i) / steps;
    points.push(vec2(centre.x + radius * Math.cos(angle), centre.y + radius * Math.sin(angle)));
  }
  return points;
}

function removeConsecutiveDuplicates(points: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (!last || !equalPoints(last, p)) out.push(p);
  }
  if (out.length > 1 && equalPoints(out[0]!, out[out.length - 1]!)) out.pop();
  return out;
}

function readUnits(header: Pair[], warnings: string[]): DrawingUnits {
  for (let i = 0; i < header.length - 1; i++) {
    if (header[i]!.code === 9 && header[i]!.value === '$INSUNITS' && header[i + 1]!.code === 70) {
      const code = Number(header[i + 1]!.value);
      const units = INSUNITS_TO_DRAWING[code];
      if (units) return units;
      warnings.push(`Drawing units code ${code} is not supported. The drawing is treated as unitless.`);
    }
  }
  return 'unitless';
}

function readLayers(tables: Pair[], warnings: string[]): Map<string, Layer> {
  // Layer 0 always exists in DXF, even when the file has no LAYER table or leaves it out of the
  // table. Seeding it first keeps it first in the list, and a table entry for it overrides this
  // default in place. Without this, entities on layer 0 triggered a false "undefined layer" warning.
  const layers = new Map<string, Layer>([[DEFAULT_LAYER_NAME, defaultLayer(DEFAULT_LAYER_NAME)]]);
  let table = '';
  for (const record of splitRecords(tables)) {
    if (record.type === 'TABLE') {
      table = firstValue(record.pairs, 2) ?? '';
      continue;
    }
    if (record.type !== 'LAYER' || table !== 'LAYER') continue;
    const name = firstValue(record.pairs, 2);
    if (!name) {
      warnings.push('A layer record without a name was ignored.');
      continue;
    }
    const colourCode = firstNumber(record.pairs, 62) ?? 7;
    const flags = firstNumber(record.pairs, 70) ?? 0;
    const index = Math.abs(colourCode);
    let color = ACI_PALETTE[index];
    if (!color) {
      warnings.push(`Layer "${name}" uses colour index ${index}, which is not supported. The default colour is used.`);
      color = ACI_PALETTE[7]!;
    }
    layers.set(name, {
      name,
      color,
      // A negative colour index or the frozen flag means the layer is off.
      visible: colourCode >= 0 && (flags & 1) === 0,
      locked: (flags & 4) === 4,
    });
  }
  return layers;
}

function defaultLayer(name: string): Layer {
  return { name, color: ACI_PALETTE[7]!, visible: true, locked: false };
}

/** Tokenises group code / value pairs. Each line pair is validated. */
function tokenize(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  if (lines.length % 2 !== 0) throw new DxfFileError('The file ends with a group code that has no value.');
  const pairs: Pair[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const codeText = lines[i]!.trim();
    const code = Number(codeText);
    if (!Number.isInteger(code) || codeText === '') {
      throw new DxfFileError(`Expected a group code at line ${i + 1}, found "${codeText}".`);
    }
    pairs.push({ code, value: lines[i + 1]!.trim() });
  }
  return pairs;
}

/** Splits the file into named sections, using SECTION/NAME ... ENDSEC markers. */
function splitSections(pairs: Pair[]): Map<string, Pair[]> {
  const sections = new Map<string, Pair[]>();
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]!;
    if (pair.code !== 0 || pair.value !== 'SECTION') continue;
    const name = pairs[i + 1];
    if (!name || name.code !== 2) continue;
    const body: Pair[] = [];
    let j = i + 2;
    for (; j < pairs.length; j++) {
      if (pairs[j]!.code === 0 && pairs[j]!.value === 'ENDSEC') break;
      body.push(pairs[j]!);
    }
    sections.set(name.value.toUpperCase(), body);
    i = j;
  }
  return sections;
}

/** Splits a section body into records. Each record starts at a group code 0. */
function splitRecords(pairs: Pair[]): RecordGroup[] {
  const records: { type: string; pairs: Pair[] }[] = [];
  let current: { type: string; pairs: Pair[] } | null = null;
  for (const pair of pairs) {
    if (pair.code === 0) {
      current = { type: pair.value, pairs: [] };
      records.push(current);
    } else if (current) {
      current.pairs.push(pair);
    }
  }
  return records;
}

function firstValue(pairs: Pair[], code: number): string | undefined {
  return pairs.find((p) => p.code === code)?.value;
}

function firstNumber(pairs: Pair[], code: number): number | undefined {
  const value = firstValue(pairs, code);
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function requireNumber(pairs: Pair[], code: number, label: string): number {
  const value = firstValue(pairs, code);
  if (value === undefined) throw new DxfFileError(`${label} is missing (group ${code}).`);
  return parseNumber(value, label);
}

function readPoint(pairs: Pair[], xCode: number, yCode: number, label: string): Vec2 {
  return vec2(requireNumber(pairs, xCode, `${label} X`), requireNumber(pairs, yCode, `${label} Y`));
}

function parseNumber(value: string, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new DxfFileError(`${label} is not a number: "${value}".`);
  return n;
}
