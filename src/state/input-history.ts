/**
 * Recall of earlier command-line input with the Up and Down arrows.
 *
 * The first Up keeps whatever was typed as a draft, and Down past the newest entry
 * brings the draft back. Typing leaves recall mode (`reset`), so Up from edited text
 * starts again with that text as the draft. Kept in memory only: nothing is written
 * to storage, so what a user typed does not outlive the page.
 */
export class InputHistory {
  private readonly entries: string[] = [];
  /** Index of the entry on show, or null when the field holds the user's own text. */
  private position: number | null = null;
  private draft = '';

  constructor(private readonly limit = 200) {}

  get size(): number {
    return this.entries.length;
  }

  /** Records a submitted line. Blank input and a repeat of the newest entry are ignored. */
  push(text: string): void {
    this.reset();
    const trimmed = text.trim();
    if (trimmed === '' || this.entries.at(-1) === trimmed) return;
    this.entries.push(trimmed);
    if (this.entries.length > this.limit) this.entries.shift();
  }

  /** Up arrow. `current` is the field's text. Returns the text to show, or null when there is nothing to recall. */
  previous(current: string): string | null {
    if (this.entries.length === 0) return null;
    if (this.position === null) {
      this.draft = current;
      this.position = this.entries.length - 1;
    } else if (this.position > 0) {
      this.position -= 1;
    }
    return this.entries[this.position]!;
  }

  /** Down arrow. Returns the text to show, or null when not recalling. */
  next(): string | null {
    if (this.position === null) return null;
    if (this.position < this.entries.length - 1) {
      this.position += 1;
      return this.entries[this.position]!;
    }
    this.position = null;
    return this.draft;
  }

  /** Leaves recall mode and forgets the draft. */
  reset(): void {
    this.position = null;
    this.draft = '';
  }
}
