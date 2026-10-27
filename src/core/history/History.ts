import type { Drawing, Mutation } from '../document/Drawing';

export interface HistoryEntry {
  readonly label: string;
  readonly forward: Mutation;
  /** Mutation that restores the drawing to its state before `forward`. */
  readonly backward: Mutation;
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

  /** Applies a mutation, records it, and clears the redo stack. */
  execute(forward: Mutation, label: string): HistoryEntry {
    const backward = this.drawing.apply(forward);
    const entry: HistoryEntry = { label, forward, backward };
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
