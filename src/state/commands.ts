import { TOOL_INFO } from '../core/tools/factory';
import { parseInput } from './input-parse';

/** Command names that are not tools. `runCommandName` in the session accepts each of these. */
export const OTHER_COMMANDS: readonly string[] = ['ERASE', 'DELETE', 'UNDO', 'REDO', 'ZOOM', 'GRID', 'SNAP'];

/** Every full command name that Tab can complete, upper case. Aliases such as `L` or `REC` are typed in full, so they are not listed. */
export const COMMAND_NAMES: readonly string[] = [...TOOL_INFO.map((t) => t.label.toUpperCase()), ...OTHER_COMMANDS];

export interface Completion {
  /** The text the field should now hold. */
  readonly text: string;
  /** Every command that starts with what was typed. More than one means the user still has to choose. */
  readonly candidates: readonly string[];
}

/**
 * Tab completion for a command name. Returns null when Tab should do nothing special and move focus on:
 * empty input, a coordinate or number, a command that is already complete, or no match. Returning null there
 * keeps Tab from trapping keyboard users in the field.
 */
export function completeCommand(typed: string): Completion | null {
  const prefix = typed.trim().toUpperCase();
  if (prefix === '' || parseInput(prefix, null).kind !== 'text') return null;
  const candidates = COMMAND_NAMES.filter((name) => name.startsWith(prefix));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] === prefix ? null : { text: candidates[0]!, candidates };
  return { text: commonPrefix(candidates), candidates };
}

function commonPrefix(names: readonly string[]): string {
  let prefix = names[0]!;
  for (const name of names) {
    while (!name.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
}
