import type { Mutation } from '../document/Drawing';
import { type Entity, type EntityId } from '../entities/types';
import { transformEntity } from '../entities/geometry';
import { type Matrix2D, rotation, translation } from '../geometry/transform';
import { type Vec2, angleOf, sub } from '../geometry/vector';
import { pickEntity, selectByRectangle } from '../selection/selection';
import { type Preview, type Tool, type ToolContext, commit } from './types';

/** Select tool: click, Shift-click to toggle, drag for a window (left to right) or crossing (right to left). */
export class SelectTool implements Tool {
  readonly id = 'select';
  readonly label = 'Select';
  readonly wantsPoint = false;
  readonly basePoint = null;
  finished = false;

  constructor(private readonly ctx: ToolContext) {}

  prompt(): string {
    return 'Select objects: click, Shift-click to add or remove, or drag a window.';
  }

  pick(point: Vec2, shift: boolean): void {
    const entity = pickEntity(this.ctx.drawing, point, this.ctx.pickTolerance());
    if (!entity) {
      if (!shift) this.ctx.selection.clear();
      return;
    }
    if (shift) this.ctx.selection.toggle(entity.id);
    else this.ctx.selection.replace([entity.id]);
  }

  drag(from: Vec2, to: Vec2, shift: boolean): void {
    const ids = windowIds(this.ctx, from, to);
    if (shift) this.ctx.selection.add(ids);
    else this.ctx.selection.replace(ids);
  }

  confirm(): void {
    this.finished = true;
  }

  cancel(): void {
    this.ctx.selection.clear();
    this.finished = true;
  }

  preview(): Preview | null {
    return null;
  }
}

export type ModifyKind = 'move' | 'copy' | 'rotate';

type ModifyStep = 'select' | 'base' | 'destination' | 'reference' | 'target';

const LABELS: Record<ModifyKind, string> = { move: 'Move', copy: 'Copy', rotate: 'Rotate' };

/**
 * Move, copy and rotate act on the current selection. If nothing is selected
 * the first step lets the user choose objects. Each operation commits as one
 * batch, so a single undo reverses all of it.
 */
export class ModifyTool implements Tool {
  readonly label: string;
  readonly wantsPoint = true;
  finished = false;
  private step: ModifyStep;
  private base: Vec2 | null = null;
  private reference: Vec2 | null = null;

  constructor(
    private readonly ctx: ToolContext,
    readonly id: ModifyKind,
  ) {
    this.label = LABELS[id];
    this.step = ctx.selection.size > 0 ? 'base' : 'select';
  }

  get basePoint(): Vec2 | null {
    return this.base;
  }

  prompt(): string {
    switch (this.step) {
      case 'select':
        return `Select objects to ${this.id}, then press Enter:`;
      case 'base':
        return 'Specify base point:';
      case 'destination':
        return this.id === 'copy' ? 'Specify second point for copy [Enter to finish]:' : 'Specify second point (destination):';
      case 'reference':
        return 'Specify reference angle point, or type an angle in degrees:';
      case 'target':
        return 'Specify new angle point:';
    }
  }

  pick(point: Vec2): void {
    switch (this.step) {
      case 'select': {
        const entity = pickEntity(this.ctx.drawing, point, this.ctx.pickTolerance());
        if (entity) this.ctx.selection.add([entity.id]);
        return;
      }
      case 'base':
        this.base = point;
        this.step = this.id === 'rotate' ? 'reference' : 'destination';
        return;
      case 'destination':
        this.apply(translation(point.x - this.base!.x, point.y - this.base!.y), LABELS[this.id]);
        return;
      case 'reference':
        this.reference = point;
        this.step = 'target';
        return;
      case 'target': {
        const delta = angleOf(sub(point, this.base!)) - angleOf(sub(this.reference!, this.base!));
        this.apply(rotation(delta, this.base!), LABELS[this.id]);
        return;
      }
    }
  }

  drag(from: Vec2, to: Vec2, shift: boolean): void {
    if (this.step !== 'select') return;
    const ids = windowIds(this.ctx, from, to);
    if (shift) this.ctx.selection.remove(ids);
    else this.ctx.selection.add(ids);
  }

  submitNumber(degrees: number): boolean {
    if (this.step !== 'reference' || this.id !== 'rotate') return false;
    this.apply(rotation((degrees * Math.PI) / 180, this.base!), LABELS[this.id]);
    return true;
  }

  confirm(): void {
    if (this.step === 'select') {
      if (this.ctx.selection.size === 0) {
        this.ctx.notify('Nothing selected.');
        return;
      }
      this.step = 'base';
      return;
    }
    this.finished = true;
  }

  /** Escape cancels the whole operation. Nothing is committed until the final step completes. */
  cancel(): void {
    this.base = null;
    this.reference = null;
    this.finished = true;
  }

  preview(cursor: Vec2): Preview | null {
    if (!this.base) return null;
    const targets = editableEntities(this.ctx);
    if (this.step === 'destination') {
      const m = translation(cursor.x - this.base.x, cursor.y - this.base.y);
      return { entities: targets.map((e) => transformEntity(e, m)), markers: [this.base] };
    }
    if (this.step === 'target' && this.reference) {
      const delta = angleOf(sub(cursor, this.base)) - angleOf(sub(this.reference, this.base));
      const m = rotation(delta, this.base);
      return { entities: targets.map((e) => transformEntity(e, m)), markers: [this.base] };
    }
    return { entities: [], markers: [this.base] };
  }

  private apply(m: Matrix2D, label: string): void {
    const targets = editableEntities(this.ctx);
    if (targets.length === 0) {
      this.ctx.notify('Selection contains no editable entities.');
      return;
    }
    const mutations: Mutation[] = [];
    if (this.id === 'copy') {
      const startIndex = this.ctx.drawing.entityCount;
      targets.forEach((entity, i) => {
        const copy = transformEntity(entity, m);
        const id = this.ctx.drawing.nextId();
        mutations.push({ kind: 'insert', entity: { ...copy, id }, index: startIndex + i });
      });
    } else {
      for (const entity of targets) {
        mutations.push({ kind: 'replace', entity: transformEntity(entity, m) });
      }
    }
    if (!commit(this.ctx, { kind: 'batch', mutations }, label)) return;
    // Copy keeps the base point so repeated copies stay aligned. Move and rotate finish.
    if (this.id !== 'copy') this.finished = true;
  }
}

/** Selected entities that still exist and are editable. Hidden or locked entities are skipped. */
export function editableSelectionIds(ctx: ToolContext): EntityId[] {
  return ctx.selection.toArray().filter((id) => {
    const entity = ctx.drawing.getEntity(id);
    return !!entity && ctx.drawing.isEditable(entity);
  });
}

function editableEntities(ctx: ToolContext): Entity[] {
  return editableSelectionIds(ctx).map((id) => ctx.drawing.getEntity(id)!);
}

/** Window (left to right, fully enclosed) or crossing (right to left, touching) selection. */
function windowIds(ctx: ToolContext, from: Vec2, to: Vec2): EntityId[] {
  const mode = to.x >= from.x ? 'window' : 'crossing';
  return selectByRectangle(ctx.drawing, from, to, mode);
}
