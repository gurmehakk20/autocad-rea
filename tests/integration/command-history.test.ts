import { describe, expect, it } from 'vitest';
import { COMMAND_NAMES, OTHER_COMMANDS, completeCommand } from '../../src/state/commands';
import { InputHistory } from '../../src/state/input-history';
import { EditorSession } from '../../src/state/EditorSession';
import { TOOL_INFO } from '../../src/core/tools/factory';

function newSession(): EditorSession {
  const s = new EditorSession();
  s.setViewSize(800, 600);
  return s;
}

describe('InputHistory', () => {
  it('recalls nothing when empty', () => {
    const h = new InputHistory();
    expect(h.previous('draft')).toBeNull();
    expect(h.next()).toBeNull();
  });

  it('walks back through entries with Up and forward with Down, then returns the draft', () => {
    const h = new InputHistory();
    ['L', '0,0', '10,5'].forEach((t) => h.push(t));
    expect(h.previous('typing')).toBe('10,5');
    expect(h.previous('ignored')).toBe('0,0');
    expect(h.previous('ignored')).toBe('L');
    expect(h.next()).toBe('0,0');
    expect(h.next()).toBe('10,5');
    expect(h.next()).toBe('typing');
    expect(h.next()).toBeNull();
  });

  it('stays on the oldest entry when Up is pressed past it', () => {
    const h = new InputHistory();
    ['a', 'b'].forEach((t) => h.push(t));
    h.previous('');
    h.previous('');
    expect(h.previous('')).toBe('a');
    expect(h.previous('')).toBe('a');
  });

  it('ignores blank input and a repeat of the newest entry, but keeps a repeat further back', () => {
    const h = new InputHistory();
    ['', '   ', 'L', 'L', ' L ', 'C', 'L'].forEach((t) => h.push(t));
    expect(h.size).toBe(3);
    expect(h.previous('')).toBe('L');
    expect(h.previous('')).toBe('C');
    expect(h.previous('')).toBe('L');
  });

  it('stores trimmed text', () => {
    const h = new InputHistory();
    h.push('  1,2  ');
    expect(h.previous('')).toBe('1,2');
  });

  it('drops the oldest entry past the limit', () => {
    const h = new InputHistory(3);
    ['1', '2', '3', '4'].forEach((t) => h.push(t));
    expect(h.size).toBe(3);
    h.previous('');
    h.previous('');
    expect(h.previous('')).toBe('2');
    expect(h.previous('')).toBe('2');
  });

  it('reset leaves recall, so the next Up starts again from the newest entry with a new draft', () => {
    const h = new InputHistory();
    ['a', 'b'].forEach((t) => h.push(t));
    h.previous('first draft');
    h.previous('');
    h.reset();
    expect(h.next()).toBeNull();
    expect(h.previous('second draft')).toBe('b');
    h.next();
    expect(h.next()).toBeNull();
    expect(h.previous('x')).toBe('b');
    expect(h.next()).toBe('x');
  });

  it('pushing while recalling leaves recall mode', () => {
    const h = new InputHistory();
    h.push('a');
    h.previous('d');
    h.push('b');
    expect(h.next()).toBeNull();
    expect(h.previous('')).toBe('b');
  });
});

describe('completeCommand', () => {
  it('completes a unique prefix to the full upper-case name', () => {
    expect(completeCommand('cir')).toEqual({ text: 'CIRCLE', candidates: ['CIRCLE'] });
    expect(completeCommand('  Poly ')?.text).toBe('POLYLINE');
    expect(completeCommand('z')?.text).toBe('ZOOM');
  });

  it('completes to the longest common prefix and lists every match when several commands match', () => {
    const r = completeCommand('re');
    expect(r?.candidates).toEqual(['RECTANGLE', 'REDO']);
    expect(r?.text).toBe('RE');
    const sel = completeCommand('s');
    expect(sel?.candidates).toEqual(['SELECT', 'SNAP']);
    expect(sel?.text).toBe('S');
    expect(completeCommand('e')?.candidates).toEqual(['ERASE']);
  });

  it('narrows a shared prefix to a single command once one more letter is typed', () => {
    expect(completeCommand('rec')?.text).toBe('RECTANGLE');
    expect(completeCommand('red')?.text).toBe('REDO');
  });

  it('does nothing, so Tab can move focus, for empty input, a complete command, no match, numbers and coordinates', () => {
    expect(completeCommand('')).toBeNull();
    expect(completeCommand('   ')).toBeNull();
    expect(completeCommand('line')).toBeNull();
    expect(completeCommand('LINE')).toBeNull();
    expect(completeCommand('xyz')).toBeNull();
    expect(completeCommand('12')).toBeNull();
    expect(completeCommand('1,2')).toBeNull();
    expect(completeCommand('@5<30')).toBeNull();
    expect(completeCommand('-3.5')).toBeNull();
  });

  it('has no duplicate names and covers every tool label', () => {
    expect(new Set(COMMAND_NAMES).size).toBe(COMMAND_NAMES.length);
    for (const tool of TOOL_INFO) expect(COMMAND_NAMES).toContain(tool.label.toUpperCase());
  });
});

describe('command names stay in step with the dispatcher', () => {
  // Tab must never complete to a name the session then rejects.
  for (const name of COMMAND_NAMES) {
    it(`${name} is accepted as a command`, () => {
      const s = newSession();
      s.submitCommand(name);
      expect(s.log.join('\n')).not.toMatch(/Unknown command/);
    });
  }

  it('an unknown name is still reported', () => {
    const s = newSession();
    s.submitCommand('frobnicate');
    expect(s.log.at(-1)).toMatch(/Unknown command "FROBNICATE"/);
  });

  it('OTHER_COMMANDS holds no tool label', () => {
    for (const name of OTHER_COMMANDS) expect(TOOL_INFO.map((t) => t.label.toUpperCase())).not.toContain(name);
  });
});

describe('session recall and completion', () => {
  it('records every submission, including points and numbers, and recalls newest first', () => {
    const s = newSession();
    s.submitCommand('L');
    s.submitCommand('0,0');
    s.submitCommand('5,5');
    expect(s.recallPrevious('')).toBe('5,5');
    expect(s.recallPrevious('')).toBe('0,0');
    expect(s.recallPrevious('')).toBe('L');
    expect(s.recallNext()).toBe('0,0');
  });

  it('keeps the unsent draft while browsing and restores it after the newest entry', () => {
    const s = newSession();
    s.submitCommand('L');
    expect(s.recallPrevious('half-typed')).toBe('L');
    expect(s.recallNext()).toBe('half-typed');
    expect(s.recallNext()).toBeNull();
  });

  it('does not record blank input, and submitting ends recall', () => {
    const s = newSession();
    s.submitCommand('  ');
    expect(s.recallPrevious('')).toBeNull();
    s.submitCommand('C');
    s.recallPrevious('');
    s.submitCommand('L');
    expect(s.recallNext()).toBeNull();
    expect(s.recallPrevious('')).toBe('L');
  });

  it('endRecall makes the next Up start from the newest entry again', () => {
    const s = newSession();
    s.submitCommand('a1');
    s.submitCommand('a2');
    s.recallPrevious('');
    s.recallPrevious('');
    s.endRecall();
    expect(s.recallPrevious('mine')).toBe('a2');
  });

  it('completeInput returns the completed text and logs the candidates only when there are several', () => {
    const s = newSession();
    const before = s.log.length;
    expect(s.completeInput('cir')).toBe('CIRCLE');
    expect(s.log.length).toBe(before);
    expect(s.completeInput('re')).toBe('RE');
    expect(s.log.at(-1)).toBe('RECTANGLE  REDO');
  });

  it('a second Tab on a prefix that cannot grow returns null, and typing something else starts over', () => {
    const s = newSession();
    expect(s.completeInput('re')).toBe('RE');
    expect(s.completeInput('re')).toBeNull();
    expect(s.completeInput('cir')).toBe('CIRCLE');
    expect(s.completeInput('re')).toBe('RE');
    expect(s.completeInput('nonsense')).toBeNull();
    expect(s.completeInput('re')).toBe('RE');
  });

  it('completeInput returns null where Tab should keep its normal job', () => {
    const s = newSession();
    expect(s.completeInput('')).toBeNull();
    expect(s.completeInput('3,4')).toBeNull();
    expect(s.completeInput('nonsense')).toBeNull();
  });

  it('an invalid line is still recorded, so it can be fixed and resent', () => {
    const s = newSession();
    s.submitCommand('1e999,0');
    expect(s.recallPrevious('')).toBe('1e999,0');
  });
});
