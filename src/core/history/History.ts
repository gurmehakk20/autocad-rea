import type { Drawing, Mutation } from '../document/Drawing';

export interface HistoryEntry {
  readonly label: string;
  readonly forward: Mutation;
  /** Mutation that restores the drawing to its state before `forward`. */
  readonly backward: Mutation;
  /** Edits that share a key and arrive back to back are merged into one undo step. */
  readonly coalesceKey?: string;
}

/**
 * Undo/redo built on drawing mutations. Each command records only its delta, so
 * memory grows with the size of the change rather than the size of the drawing.
 */
export class History {
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  /** Top of the undo stack at the last save. `undefined` means "saved empty". */
  private savedTop: HistoryEntry | undefined = undefined;

  constructor(private readonly drawing: Drawing) {}

  /**
   * Applies a mutation, records it, and clears the redo stack.
   *
   * With a `coalesceKey`, a mutation that directly follows an entry with the same key
   * is merged into it. This is for continuous edits such as dragging a colour picker,
   * which would otherwise create dozens of undo steps. The merged entry keeps the
   * original `backward`, so one undo restores the state before the first edit. Merging
   * is only valid for mutations that set absolute values on the same targets, which
   * `replace` and `put-layer` do.
   */
  execute(forward: Mutation, label: string, coalesceKey?: string): HistoryEntry {
    const top = this.undoStack.at(-1);
    if (coalesceKey && top?.coalesceKey === coalesceKey && this.redoStack.length === 0) {
      this.drawing.apply(forward);
      // A new entry object, so a save point that pointed at `top` correctly reads as dirty.
      const merged: HistoryEntry = { label, forward, backward: top.backward, coalesceKey };
      this.undoStack[this.undoStack.length - 1] = merged;
      return merged;
    }
    const backward = this.drawing.apply(forward);
    const entry: HistoryEntry = coalesceKey ? { label, forward, backward, coalesceKey } : { label, forward, backward };
    this.undoStack.push(entry);
    this.redoStack.length = 0;
    return entry;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | undefined {
    return this.undoStack.at(-1)?.label;
  }

  get redoLabel(): string | undefined {
    return this.redoStack.at(-1)?.label;
  }

  /** Recorded command labels, oldest first. */
  get entries(): readonly HistoryEntry[] {
    return this.undoStack;
  }

  undo(): HistoryEntry | undefined {
    const entry = this.undoStack.pop();
    if (!entry) return undefined;
    this.drawing.apply(entry.backward);
    this.redoStack.push(entry);
    return entry;
  }

  redo(): HistoryEntry | undefined {
    const entry = this.redoStack.pop();
    if (!entry) return undefined;
    this.drawing.apply(entry.forward);
    this.undoStack.push(entry);
    return entry;
  }

  markSaved(): void {
    this.savedTop = this.undoStack.at(-1);
  }

  get isDirty(): boolean {
    return this.undoStack.at(-1) !== this.savedTop;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.savedTop = undefined;
  }
}
