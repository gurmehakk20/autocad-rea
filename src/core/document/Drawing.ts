import { type Entity, type EntityId, entityValidationError } from '../entities/types';

export const DEFAULT_LAYER_NAME = '0';

export interface Layer {
  readonly name: string;
  /** `#rrggbb` colour used by entities that inherit their colour ("ByLayer"). */
  readonly color: string;
  readonly visible: boolean;
  readonly locked: boolean;
}

/**
 * Units are declared for the drawing and used for display and DXF metadata.
 * Coordinates are always stored as plain numbers in these units. No conversion
 * happens inside the geometry engine.
 */
export type DrawingUnits = 'unitless' | 'inch' | 'foot' | 'mm' | 'cm' | 'm';

export const DRAWING_UNITS: readonly DrawingUnits[] = ['unitless', 'inch', 'foot', 'mm', 'cm', 'm'];

/**
 * A reversible change to a drawing. `Drawing.apply` executes a mutation and
 * returns the mutation that undoes it, so history stores small deltas rather
 * than full snapshots.
 */
export type Mutation =
  | { readonly kind: 'insert'; readonly entity: Entity; readonly index: number }
  | { readonly kind: 'remove'; readonly id: EntityId }
  | { readonly kind: 'replace'; readonly entity: Entity }
  | { readonly kind: 'put-layer'; readonly layer: Layer }
  | { readonly kind: 'delete-layer'; readonly name: string }
  | { readonly kind: 'set-units'; readonly units: DrawingUnits }
  | { readonly kind: 'batch'; readonly mutations: readonly Mutation[] };

export class DrawingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DrawingError';
  }
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Characters DXF does not allow in layer names, plus control characters. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_LAYER_CHARS = /[<>/\\":;?*|=`\u0000-\u001f]/;
export const MAX_LAYER_NAME_LENGTH = 255;

/**
 * Returns why `name` cannot be used as a layer name, or null when it can.
 * `existing` lists the current names. DXF layer names are case-insensitive, so a name
 * that differs from another only by case counts as a duplicate. `renaming` is the layer
 * being renamed, which may keep its own name apart from case.
 */
export function layerNameError(name: string, existing: readonly string[], renaming?: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Layer name cannot be empty.';
  if (trimmed.length > MAX_LAYER_NAME_LENGTH) {
    return `Layer names are limited to ${MAX_LAYER_NAME_LENGTH} characters.`;
  }
  if (FORBIDDEN_LAYER_CHARS.test(trimmed)) {
    return 'Layer names cannot contain the characters < > / \\ " : ; ? * | = or `.';
  }
  const clash = existing.find((n) => n !== renaming && n.toLowerCase() === trimmed.toLowerCase());
  if (clash) return `Layer "${clash}" already exists. Layer names are not case-sensitive.`;
  return null;
}

export class Drawing {
  private readonly entityById = new Map<EntityId, Entity>();
  /** Creation order. Later entries draw on top and win hit tests. */
  private order: EntityId[] = [];
  private readonly layerByName = new Map<string, Layer>();
  private idCounter = 0;
  private unitsValue: DrawingUnits = 'unitless';

  constructor() {
    this.layerByName.set(DEFAULT_LAYER_NAME, {
      name: DEFAULT_LAYER_NAME,
      color: '#e6e6e6',
      visible: true,
      locked: false,
    });
  }

  get units(): DrawingUnits {
    return this.unitsValue;
  }

  get entityCount(): number {
    return this.order.length;
  }

  /**
   * Stable id allocation. Ids are never reused, even after deletions or undo.
   * An id that is already present (for example from a hand-edited file) is skipped.
   */
  nextId(): EntityId {
    do {
      this.idCounter += 1;
    } while (this.entityById.has(`e${this.idCounter}`));
    return `e${this.idCounter}`;
  }

  get idSequence(): number {
    return this.idCounter;
  }

  /** Restores the id sequence after loading a saved drawing. */
  setIdSequence(value: number): void {
    if (!Number.isInteger(value) || value < 0) throw new DrawingError('Id sequence must be a non-negative integer.');
    this.idCounter = Math.max(this.idCounter, value);
  }

  getEntity(id: EntityId): Entity | undefined {
    return this.entityById.get(id);
  }

  /** Entities in creation order. */
  entities(): Entity[] {
    return this.order.map((id) => this.entityById.get(id)!);
  }

  getLayer(name: string): Layer | undefined {
    return this.layerByName.get(name);
  }

  layers(): Layer[] {
    return [...this.layerByName.values()];
  }

  /** True when `layerName` allows selection and editing. */
  isEditable(entity: Entity): boolean {
    const layer = this.layerByName.get(entity.layer);
    return !!layer && layer.visible && !layer.locked;
  }

  /** Entities on a layer in creation order. */
  entitiesOnLayer(name: string): Entity[] {
    return this.entities().filter((e) => e.layer === name);
  }

  /** Resolves the effective `#rrggbb` colour of an entity. */
  effectiveColor(entity: Entity): string {
    if (entity.color) return entity.color;
    return this.layerByName.get(entity.layer)?.color ?? '#e6e6e6';
  }

  /**
   * Executes `mutation` and returns its inverse. Invalid mutations throw a
   * `DrawingError` and leave the drawing unchanged.
   */
  apply(mutation: Mutation): Mutation {
    switch (mutation.kind) {
      case 'insert': {
        this.assertNewEntity(mutation.entity);
        const index = Math.min(Math.max(0, mutation.index), this.order.length);
        this.entityById.set(mutation.entity.id, mutation.entity);
        this.order.splice(index, 0, mutation.entity.id);
        return { kind: 'remove', id: mutation.entity.id };
      }
      case 'remove': {
        const entity = this.requireEntity(mutation.id);
        const index = this.order.indexOf(mutation.id);
        this.order.splice(index, 1);
        this.entityById.delete(mutation.id);
        return { kind: 'insert', entity, index };
      }
      case 'replace': {
        const previous = this.requireEntity(mutation.entity.id);
        this.assertValidEntity(mutation.entity);
        this.entityById.set(mutation.entity.id, mutation.entity);
        return { kind: 'replace', entity: previous };
      }
      case 'put-layer': {
        this.assertValidLayer(mutation.layer);
        const previous = this.layerByName.get(mutation.layer.name);
        this.layerByName.set(mutation.layer.name, mutation.layer);
        return previous ? { kind: 'put-layer', layer: previous } : { kind: 'delete-layer', name: mutation.layer.name };
      }
      case 'delete-layer': {
        if (mutation.name === DEFAULT_LAYER_NAME) throw new DrawingError('Layer 0 cannot be deleted.');
        const previous = this.layerByName.get(mutation.name);
        if (!previous) throw new DrawingError(`Layer "${mutation.name}" does not exist.`);
        const users = this.entitiesOnLayer(mutation.name).length;
        if (users > 0) throw new DrawingError(`Layer "${mutation.name}" still has ${users} entities.`);
        this.layerByName.delete(mutation.name);
        return { kind: 'put-layer', layer: previous };
      }
      case 'set-units': {
        const previous = this.unitsValue;
        this.unitsValue = mutation.units;
        return { kind: 'set-units', units: previous };
      }
      case 'batch': {
        const inverses: Mutation[] = [];
        try {
          for (const step of mutation.mutations) {
            inverses.push(this.apply(step));
          }
        } catch (error) {
          // Roll back the steps that already ran so a failed batch leaves no partial state.
          for (const inverse of inverses.reverse()) this.apply(inverse);
          throw error;
        }
        return { kind: 'batch', mutations: inverses.reverse() };
      }
    }
  }

  /** Replaces the whole drawing contents. Used by loaders after validation. */
  loadParts(parts: { units: DrawingUnits; layers: Layer[]; entities: Entity[]; idSequence: number }): void {
    this.entityById.clear();
    this.order = [];
    this.layerByName.clear();
    this.unitsValue = parts.units;
    for (const layer of parts.layers) {
      this.assertValidLayer(layer);
      this.layerByName.set(layer.name, layer);
    }
    if (!this.layerByName.has(DEFAULT_LAYER_NAME)) {
      throw new DrawingError('Drawing must contain layer "0".');
    }
    for (const entity of parts.entities) {
      this.assertNewEntity(entity);
      this.entityById.set(entity.id, entity);
      this.order.push(entity.id);
    }
    this.idCounter = 0;
    // Trust the saved counter, but never let it sit behind ids that are already in use.
    const highestUsed = parts.entities.reduce((max, e) => {
      const match = /^e(\d+)$/.exec(e.id);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    this.setIdSequence(Math.max(parts.idSequence, highestUsed));
  }

  private requireEntity(id: EntityId): Entity {
    const entity = this.entityById.get(id);
    if (!entity) throw new DrawingError(`Entity "${id}" does not exist.`);
    return entity;
  }

  private assertNewEntity(entity: Entity): void {
    if (this.entityById.has(entity.id)) throw new DrawingError(`Entity "${entity.id}" already exists.`);
    this.assertValidEntity(entity);
  }

  private assertValidEntity(entity: Entity): void {
    const reason = entityValidationError(entity);
    if (reason) throw new DrawingError(reason);
    if (!this.layerByName.has(entity.layer)) throw new DrawingError(`Layer "${entity.layer}" does not exist.`);
    if (entity.color !== null && !HEX_COLOR.test(entity.color)) {
      throw new DrawingError(`Colour "${entity.color}" must be #rrggbb or null.`);
    }
  }

  private assertValidLayer(layer: Layer): void {
    if (layer.name.trim() === '') throw new DrawingError('Layer name cannot be empty.');
    if (!HEX_COLOR.test(layer.color)) throw new DrawingError(`Layer colour "${layer.color}" must be #rrggbb.`);
  }
}
