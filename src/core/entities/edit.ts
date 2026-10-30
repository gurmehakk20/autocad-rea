import { normalizeAngle } from '../geometry/arc';
import { vec2 } from '../geometry/vector';
import { type Entity, entityValidationError } from './types';

/** Geometry values the properties panel can edit by number. Angles are in degrees at this boundary. */
export type GeometryField =
  | 'startX'
  | 'startY'
  | 'endX'
  | 'endY'
  | 'centerX'
  | 'centerY'
  | 'radius'
  | 'startAngle'
  | 'endAngle';

export interface FieldSpec {
  readonly field: GeometryField;
  readonly label: string;
  /** Shown after the value. Empty for lengths, which use the drawing's units. */
  readonly unit: '' | '°';
}

const spec = (field: GeometryField, label: string, unit: '' | '°' = ''): FieldSpec => ({ field, label, unit });

const FIELDS: Record<Entity['type'], readonly FieldSpec[]> = {
  line: [spec('startX', 'Start X'), spec('startY', 'Start Y'), spec('endX', 'End X'), spec('endY', 'End Y')],
  circle: [spec('centerX', 'Centre X'), spec('centerY', 'Centre Y'), spec('radius', 'Radius')],
  arc: [
    spec('centerX', 'Centre X'),
    spec('centerY', 'Centre Y'),
    spec('radius', 'Radius'),
    spec('startAngle', 'Start angle', '°'),
    spec('endAngle', 'End angle', '°'),
  ],
  // Vertex editing needs vertex-level selection and is milestone 3.
  polyline: [],
};

export function editableFields(entity: Entity): readonly FieldSpec[] {
  return FIELDS[entity.type];
}

export function fieldLabel(field: GeometryField): string {
  for (const specs of Object.values(FIELDS)) {
    const found = specs.find((s) => s.field === field);
    if (found) return found.label;
  }
  return field;
}

const RAD_TO_DEG = 180 / Math.PI;

/** Current value of a field, in degrees for angles. Null when the entity has no such field. */
export function readField(entity: Entity, field: GeometryField): number | null {
  switch (entity.type) {
    case 'line':
      if (field === 'startX') return entity.start.x;
      if (field === 'startY') return entity.start.y;
      if (field === 'endX') return entity.end.x;
      if (field === 'endY') return entity.end.y;
      return null;
    case 'circle':
      if (field === 'centerX') return entity.center.x;
      if (field === 'centerY') return entity.center.y;
      if (field === 'radius') return entity.radius;
      return null;
    case 'arc':
      if (field === 'centerX') return entity.center.x;
      if (field === 'centerY') return entity.center.y;
      if (field === 'radius') return entity.radius;
      if (field === 'startAngle') return normalizeAngle(entity.startAngle) * RAD_TO_DEG;
      if (field === 'endAngle') return normalizeAngle(entity.endAngle) * RAD_TO_DEG;
      return null;
    case 'polyline':
      return null;
  }
}

export type FieldEdit = { readonly entity: Entity } | { readonly error: string };

/**
 * Returns a copy of `entity` with one field set, or the reason the result would be invalid.
 * Only the named field changes, so editing one field never rewrites the others. Angles are
 * given in degrees and stored as radians in [0, 2π).
 */
export function withField(entity: Entity, field: GeometryField, value: number): FieldEdit {
  if (!editableFields(entity).some((s) => s.field === field)) {
    return { error: `${fieldLabel(field)} cannot be edited on this object.` };
  }
  if (!Number.isFinite(value)) return { error: `${fieldLabel(field)} must be a finite number.` };

  const next = apply(entity, field, value);
  const reason = entityValidationError(next);
  return reason ? { error: reason } : { entity: next };
}

function apply(entity: Entity, field: GeometryField, value: number): Entity {
  switch (entity.type) {
    case 'line':
      switch (field) {
        case 'startX':
          return { ...entity, start: vec2(value, entity.start.y) };
        case 'startY':
          return { ...entity, start: vec2(entity.start.x, value) };
        case 'endX':
          return { ...entity, end: vec2(value, entity.end.y) };
        default:
          return { ...entity, end: vec2(entity.end.x, value) };
      }
    case 'circle':
      switch (field) {
        case 'centerX':
          return { ...entity, center: vec2(value, entity.center.y) };
        case 'centerY':
          return { ...entity, center: vec2(entity.center.x, value) };
        default:
          return { ...entity, radius: value };
      }
    case 'arc':
      switch (field) {
        case 'centerX':
          return { ...entity, center: vec2(value, entity.center.y) };
        case 'centerY':
          return { ...entity, center: vec2(entity.center.x, value) };
        case 'radius':
          return { ...entity, radius: value };
        case 'startAngle':
          return { ...entity, startAngle: normalizeAngle((value * Math.PI) / 180) };
        default:
          return { ...entity, endAngle: normalizeAngle((value * Math.PI) / 180) };
      }
    case 'polyline':
      return entity;
  }
}

/**
 * Number as shown in an edit field: up to 12 significant digits, with no fixed decimal count. Display
 * rounding to a few decimals would let a field that is only focused and left change the geometry.
 */
export function formatFieldValue(value: number): string {
  if (Math.abs(value) < 5e-13) return '0';
  return Number(value.toPrecision(12)).toString();
}
