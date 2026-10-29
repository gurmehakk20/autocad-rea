import type { Drawing } from '../document/Drawing';
import type { Entity, EntityId } from '../entities/types';
import { boundsFromPoints, boundsIntersect, expandBounds } from '../geometry/bounds';
import { intersectEntities, snapCandidatesOf } from '../entities/geometry';
import { type Vec2, distance, vec2 } from '../geometry/vector';

export interface SnapSettings {
  /** Master switch for object snaps (endpoint, midpoint, centre, intersection). */
  readonly objectSnap: boolean;
  readonly endpoint: boolean;
  readonly midpoint: boolean;
  readonly center: boolean;
  readonly intersection: boolean;
  /** When no object snap applies, snap the cursor to the grid. */
  readonly grid: boolean;
  /** Grid spacing in drawing units. Must be positive. */
  readonly gridSize: number;
  /** Constrains the segment from the base point to horizontal or vertical. */
  readonly ortho: boolean;
}

export const DEFAULT_SNAP_SETTINGS: SnapSettings = {
  objectSnap: true,
  endpoint: true,
  midpoint: true,
  center: true,
  intersection: true,
  grid: false,
  gridSize: 10,
  ortho: false,
};

export type SnapKind = 'endpoint' | 'intersection' | 'midpoint' | 'center' | 'grid' | 'none';

export interface SnapResult {
  readonly point: Vec2;
  readonly kind: SnapKind;
}

/** Lower value wins when several object snaps are within tolerance. */
const PRIORITY: Record<Exclude<SnapKind, 'grid' | 'none'>, number> = {
  endpoint: 0,
  intersection: 1,
  midpoint: 2,
  center: 3,
};

export interface FindSnapInput {
  readonly drawing: Drawing;
  readonly cursor: Vec2;
  /** Capture radius in drawing units (pixels divided by zoom). */
  readonly tolerance: number;
  readonly settings: SnapSettings;
  /** Base point of the current rubber-band segment, used by ortho mode. */
  readonly base?: Vec2 | null;
  /** Entities to ignore, such as the selection being moved. */
  readonly exclude?: ReadonlySet<EntityId>;
}

export function findSnap(input: FindSnapInput): SnapResult {
  const { drawing, cursor, tolerance, settings, base, exclude } = input;
  const objectHit = settings.objectSnap ? findObjectSnap(drawing, cursor, tolerance, settings, exclude) : null;
  if (objectHit) return objectHit;

  const point = settings.grid ? snapToGrid(cursor, settings.gridSize) : cursor;
  const kind: SnapKind = settings.grid ? 'grid' : 'none';
  if (settings.ortho && base) {
    return { point: constrainOrtho(base, point), kind };
  }
  return { point, kind };
}

function findObjectSnap(
  drawing: Drawing,
  cursor: Vec2,
  tolerance: number,
  settings: SnapSettings,
  exclude: ReadonlySet<EntityId> | undefined,
): SnapResult | null {
  const candidates: { kind: Exclude<SnapKind, 'grid' | 'none'>; point: Vec2; d: number }[] = [];
  // Every snap candidate within `tolerance` of the cursor lies inside this box, and the index covers snap points. The pad absorbs rounding.
  const pad = tolerance + 1e-9 * Math.max(1, Math.abs(cursor.x), Math.abs(cursor.y));
  const entities = drawing
    .entitiesIn({ minX: cursor.x - pad, minY: cursor.y - pad, maxX: cursor.x + pad, maxY: cursor.y + pad })
    .filter((e) => drawing.isEditable(e) && !exclude?.has(e.id));

  for (const entity of entities) {
    for (const candidate of snapCandidatesOf(entity)) {
      if (!isEnabled(settings, candidate.kind)) continue;
      const d = distance(candidate.point, cursor);
      if (d <= tolerance) candidates.push({ kind: candidate.kind, point: candidate.point, d });
    }
  }

  if (settings.intersection) {
    for (const { point, d } of nearbyIntersections(drawing, entities, cursor, tolerance)) {
      candidates.push({ kind: 'intersection', point, d });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.d - b.d);
  const best = candidates[0]!;
  return { point: best.point, kind: best.kind };
}

/** Intersections within `tolerance` of the cursor. Only entities whose bounds reach the cursor are compared. */
function nearbyIntersections(
  drawing: Drawing,
  entities: readonly Entity[],
  cursor: Vec2,
  tolerance: number,
): { point: Vec2; d: number }[] {
  const reach = expandBounds(boundsFromPoints([cursor])!, tolerance);
  const near = entities.filter((e) => {
    const b = drawing.boundsOf(e.id);
    return !!b && boundsIntersect(b, reach);
  });
  const hits: { point: Vec2; d: number }[] = [];
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      for (const point of intersectEntities(near[i]!, near[j]!)) {
        const d = distance(point, cursor);
        if (d <= tolerance) hits.push({ point, d });
      }
    }
  }
  return hits;
}

function isEnabled(settings: SnapSettings, kind: 'endpoint' | 'midpoint' | 'center'): boolean {
  return settings[kind];
}

export function snapToGrid(p: Vec2, gridSize: number): Vec2 {
  if (!(gridSize > 0)) throw new Error('Grid size must be positive.');
  return vec2(Math.round(p.x / gridSize) * gridSize, Math.round(p.y / gridSize) * gridSize);
}

/**
 * Projects `p` onto the horizontal or vertical axis through `base`, whichever is
 * closer to the cursor direction.
 */
export function constrainOrtho(base: Vec2, p: Vec2): Vec2 {
  const dx = Math.abs(p.x - base.x);
  const dy = Math.abs(p.y - base.y);
  return dx >= dy ? vec2(p.x, base.y) : vec2(base.x, p.y);
}
