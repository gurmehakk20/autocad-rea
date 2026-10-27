import type { Drawing, Mutation } from '../document/Drawing';
import type { Entity } from '../entities/types';
import type { History } from '../history/History';
import type { Selection } from '../selection/selection';
import type { Vec2 } from '../geometry/vector';

/** Services a tool may use. The editor session provides these; tools never reach into UI state. */
export interface ToolContext {
  readonly drawing: Drawing;
  readonly history: History;
  readonly selection: Selection;
  /** Layer that new entities are created on. */
  readonly activeLayer: () => string;
  /** Pick capture radius in drawing units. */
  readonly pickTolerance: () => number;
  /** Feedback shown in the command line. */
  readonly notify: (message: string) => void;
}

/** Transient geometry shown while a tool is in progress. Preview entities are never stored in the drawing. */
export interface Preview {
  readonly entities: readonly Entity[];
  readonly markers: readonly Vec2[];
}

export type ToolId =
  | 'select'
  | 'line'
  | 'polyline'
  | 'rectangle'
  | 'circle'
  | 'arc'
  | 'move'
  | 'copy'
  | 'rotate';

/**
 * Interaction state machine for one tool instance. A new instance is created each
 * time the tool is activated. Points passed in are already snapped.
 *
 * - Escape calls `cancel()`. It abandons the step in progress, or finishes the tool when nothing is in progress.
 * - Enter calls `confirm()`.
 * - When `finished` becomes true the session returns to the Select tool.
 */
export interface Tool {
  readonly id: ToolId;
  readonly label: string;
  readonly finished: boolean;
  /** Prompt for the current step, shown in the command line. */
  prompt(): string;
  /** Point the tool picked, either from the pointer or from typed coordinates. */
  pick(point: Vec2, shift: boolean): void;
  /** Typed numeric value for steps such as radius or angle. Returns false when the step does not accept numbers. */
  submitNumber?(value: number): boolean;
  /** Drag gesture (window selection). Only tools that use drags implement this. */
  drag?(from: Vec2, to: Vec2, shift: boolean): void;
  confirm(): void;
  cancel(): void;
  /** Geometry to show for the given cursor position, or null. */
  preview(cursor: Vec2): Preview | null;
  /** Last picked point, used to resolve relative coordinates such as `@10,5`. */
  readonly basePoint: Vec2 | null;
  /** Whether the current step takes a point (ortho and snapping apply). */
  readonly wantsPoint: boolean;
}

/** Applies a mutation and reports failures to the command line instead of throwing. */
export function commit(ctx: ToolContext, mutation: Mutation, label: string): boolean {
  try {
    ctx.history.execute(mutation, label);
    return true;
  } catch (error) {
    ctx.notify(error instanceof Error ? error.message : 'Unknown error.');
    return false;
  }
}
