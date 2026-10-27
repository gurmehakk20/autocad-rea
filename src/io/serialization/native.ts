import { Drawing, DRAWING_UNITS, type DrawingUnits, type Layer } from '../../core/document/Drawing';
import type { Entity, EntityType } from '../../core/entities/types';
import { isFiniteNumber } from '../../core/geometry/tolerance';
import type { Vec2 } from '../../core/geometry/vector';

export const NATIVE_FORMAT = 'opendraft-drawing';
export const NATIVE_VERSION = 1;

/** Error for files that cannot be read. The message is safe to show to users. */
export class DrawingFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DrawingFileError';
  }
}

interface NativeDocument {
  readonly format: typeof NATIVE_FORMAT;
  readonly version: typeof NATIVE_VERSION;
  readonly units: DrawingUnits;
  readonly idSequence: number;
  readonly layers: readonly Layer[];
  readonly entities: readonly Entity[];
}

export function serializeDrawing(drawing: Drawing): string {
  const doc: NativeDocument = {
    format: NATIVE_FORMAT,
    version: NATIVE_VERSION,
    units: drawing.units,
    idSequence: drawing.idSequence,
    layers: drawing.layers(),
    entities: drawing.entities(),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * Parses a native drawing file. Every field is checked before anything is loaded,
 * so an invalid file never produces a partially loaded drawing.
 */
export function parseDrawing(text: string): Drawing {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DrawingFileError('The file is not valid JSON.');
  }
  if (!isRecord(raw)) throw new DrawingFileError('The file does not contain a drawing object.');
  if (raw.format !== NATIVE_FORMAT) throw new DrawingFileError('This is not an OpenDraft drawing file.');
  if (raw.version !== NATIVE_VERSION) {
    throw new DrawingFileError(
      `Drawing format version ${String(raw.version)} is not supported (expected ${NATIVE_VERSION}).`,
    );
  }
  const units = raw.units;
  if (typeof units !== 'string' || !(DRAWING_UNITS as readonly string[]).includes(units)) {
    throw new DrawingFileError(`Unknown drawing units "${String(units)}".`);
  }
  if (!Array.isArray(raw.layers)) throw new DrawingFileError('"layers" must be an array.');
  if (!Array.isArray(raw.entities)) throw new DrawingFileError('"entities" must be an array.');
  if (!Number.isInteger(raw.idSequence) || (raw.idSequence as number) < 0) {
    throw new DrawingFileError('"idSequence" must be a non-negative integer.');
  }

  const layers = raw.layers.map((l, i) => parseLayer(l, i));
  const entities = raw.entities.map((e, i) => parseEntity(e, i));
  const seen = new Set<string>();
  for (const entity of entities) {
    if (seen.has(entity.id)) throw new DrawingFileError(`Duplicate entity id "${entity.id}".`);
    seen.add(entity.id);
  }

  const drawing = new Drawing();
  try {
    drawing.loadParts({ units: units as DrawingUnits, layers, entities, idSequence: raw.idSequence as number });
  } catch (error) {
    throw new DrawingFileError(error instanceof Error ? error.message : 'Invalid drawing data.');
  }
  return drawing;
}

function parseLayer(raw: unknown, index: number): Layer {
  if (!isRecord(raw)) throw new DrawingFileError(`Layer ${index + 1} is not an object.`);
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    throw new DrawingFileError(`Layer ${index + 1} needs a name.`);
  }
  if (typeof raw.color !== 'string') throw new DrawingFileError(`Layer "${raw.name}" needs a colour.`);
  if (typeof raw.visible !== 'boolean' || typeof raw.locked !== 'boolean') {
    throw new DrawingFileError(`Layer "${raw.name}" needs boolean "visible" and "locked" flags.`);
  }
  return { name: raw.name, color: raw.color, visible: raw.visible, locked: raw.locked };
}

const ENTITY_TYPES: readonly EntityType[] = ['line', 'circle', 'arc', 'polyline'];

function parseEntity(raw: unknown, index: number): Entity {
  const where = `Entity ${index + 1}`;
  if (!isRecord(raw)) throw new DrawingFileError(`${where} is not an object.`);
  if (typeof raw.id !== 'string' || raw.id === '') throw new DrawingFileError(`${where} needs an id.`);
  if (typeof raw.layer !== 'string') throw new DrawingFileError(`${where} needs a layer name.`);
  if (raw.color !== null && typeof raw.color !== 'string') {
    throw new DrawingFileError(`${where} colour must be a string or null.`);
  }
  const base = { id: raw.id, layer: raw.layer, color: raw.color as string | null };
  const type = raw.type;
  if (typeof type !== 'string' || !(ENTITY_TYPES as readonly string[]).includes(type)) {
    throw new DrawingFileError(`${where} has unknown type "${String(type)}".`);
  }

  switch (type as EntityType) {
    case 'line':
      return { ...base, type: 'line', start: parsePoint(raw.start, where), end: parsePoint(raw.end, where) };
    case 'circle':
      return {
        ...base,
        type: 'circle',
        center: parsePoint(raw.center, where),
        radius: parseNumber(raw.radius, `${where} radius`),
      };
    case 'arc':
      return {
        ...base,
        type: 'arc',
        center: parsePoint(raw.center, where),
        radius: parseNumber(raw.radius, `${where} radius`),
        startAngle: parseNumber(raw.startAngle, `${where} startAngle`),
        endAngle: parseNumber(raw.endAngle, `${where} endAngle`),
      };
    case 'polyline': {
      if (!Array.isArray(raw.vertices)) throw new DrawingFileError(`${where} vertices must be an array.`);
      if (typeof raw.closed !== 'boolean') throw new DrawingFileError(`${where} "closed" must be a boolean.`);
      return {
        ...base,
        type: 'polyline',
        vertices: raw.vertices.map((v) => parsePoint(v, where)),
        closed: raw.closed,
      };
    }
  }
}

function parsePoint(raw: unknown, where: string): Vec2 {
  if (!isRecord(raw) || !isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) {
    throw new DrawingFileError(`${where} contains an invalid point.`);
  }
  return { x: raw.x, y: raw.y };
}

function parseNumber(raw: unknown, label: string): number {
  if (!isFiniteNumber(raw)) throw new DrawingFileError(`${label} must be a finite number.`);
  return raw;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
