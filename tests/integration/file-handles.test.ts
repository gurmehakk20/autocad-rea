import { describe, expect, it, vi } from 'vitest';
import { type FileHandle, type FsPickers, type PickerType, detectPickers, openTextFile, saveTextFile } from '../../src/app/files';
import { Drawing } from '../../src/core/document/Drawing';
import { History } from '../../src/core/history/History';
import { vec2 } from '../../src/core/geometry/vector';
import { EditorSession } from '../../src/state/EditorSession';

const TYPES: PickerType[] = [{ description: 'Drawing', accept: { 'application/json': ['.json'] } }];

interface FakeFile {
  content: string;
  /** Text written but not yet committed. Like a real writable, it replaces `content` only on close. */
  pending: string;
  aborted: number;
  closed: number;
  created: number;
}

interface FakeOptions {
  initial?: string;
  /** What `queryPermission` answers. Omit to leave the method off, as a handle without it would. */
  permission?: 'granted' | 'prompt' | 'denied';
  /** What `requestPermission` answers. */
  request?: 'granted' | 'denied';
  failWrite?: boolean;
  failClose?: boolean;
  failCreate?: boolean;
}

function fakeHandle(name: string, options: FakeOptions = {}): { handle: FileHandle; file: FakeFile; requests: number } {
  const file: FakeFile = { content: options.initial ?? '', pending: '', aborted: 0, closed: 0, created: 0 };
  const state = { requests: 0 };
  const handle: FileHandle = {
    name,
    getFile: async () => ({ text: async () => file.content }),
    createWritable: async () => {
      file.created++;
      if (options.failCreate) throw new Error('could not create');
      file.pending = '';
      return {
        write: async (data: string) => {
          if (options.failWrite) throw new Error('disk full');
          file.pending += data;
        },
        close: async () => {
          if (options.failClose) throw new Error('close failed');
          file.content = file.pending;
          file.closed++;
        },
        abort: async () => {
          file.pending = '';
          file.aborted++;
        },
      };
    },
    ...(options.permission
      ? {
          queryPermission: async () => options.permission!,
          requestPermission: async () => {
            state.requests++;
            return options.request ?? 'denied';
          },
        }
      : {}),
  };
  return {
    handle,
    file,
    get requests() {
      return state.requests;
    },
  };
}

const abortError = () => Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });

function pickers(overrides: Partial<FsPickers> = {}): FsPickers & { saveCalls: unknown[]; openCalls: unknown[] } {
  const saveCalls: unknown[] = [];
  const openCalls: unknown[] = [];
  return {
    saveCalls,
    openCalls,
    showSaveFilePicker: async (o) => {
      saveCalls.push(o);
      throw new Error('showSaveFilePicker not configured');
    },
    showOpenFilePicker: async (o) => {
      openCalls.push(o);
      throw new Error('showOpenFilePicker not configured');
    },
    ...overrides,
  };
}

const baseSave = { suggestedName: 'plan.opendraft.json', text: '{"a":1}', mime: 'application/json', types: TYPES };

describe('saveTextFile with file handles', () => {
  it('writes to an existing handle without opening a dialog, and reports its name', async () => {
    const { handle, file } = fakeHandle('plan.opendraft.json', { initial: 'old' });
    const p = pickers();
    const result = await saveTextFile({ ...baseSave, handle, askForFile: false }, { pickers: p, download: vi.fn() });
    expect(result).toEqual({ kind: 'saved', name: 'plan.opendraft.json', handle });
    expect(p.saveCalls).toHaveLength(0);
    expect(file.content).toBe('{"a":1}');
    expect(file.closed).toBe(1);
  });

  it('asks for a file when there is no handle, suggests the name and types, and keeps the chosen handle', async () => {
    const chosen = fakeHandle('picked.opendraft.json');
    const p = pickers({ showSaveFilePicker: async (o) => { p.saveCalls.push(o); return chosen.handle; } });
    const result = await saveTextFile({ ...baseSave, handle: null, askForFile: false }, { pickers: p, download: vi.fn() });
    expect(p.saveCalls).toEqual([{ suggestedName: 'plan.opendraft.json', types: TYPES }]);
    expect(result).toEqual({ kind: 'saved', name: 'picked.opendraft.json', handle: chosen.handle });
    expect(chosen.file.content).toBe('{"a":1}');
  });

  it('Save As asks for a file even when a handle exists, and leaves the old file alone', async () => {
    const existing = fakeHandle('old.opendraft.json', { initial: 'keep me' });
    const chosen = fakeHandle('new.opendraft.json');
    const p = pickers({ showSaveFilePicker: async () => chosen.handle });
    const result = await saveTextFile({ ...baseSave, handle: existing.handle, askForFile: true }, { pickers: p, download: vi.fn() });
    expect(result).toMatchObject({ kind: 'saved', name: 'new.opendraft.json' });
    expect(existing.file.content).toBe('keep me');
    expect(existing.file.created).toBe(0);
  });

  it('a dismissed dialog is "cancelled": nothing is written and nothing is thrown', async () => {
    const p = pickers({ showSaveFilePicker: async () => { throw abortError(); } });
    const download = vi.fn();
    await expect(saveTextFile({ ...baseSave, handle: null, askForFile: false }, { pickers: p, download })).resolves.toEqual({ kind: 'cancelled' });
    expect(download).not.toHaveBeenCalled();
  });

  it('any other picker error is thrown, not mistaken for a cancel', async () => {
    const p = pickers({ showSaveFilePicker: async () => { throw Object.assign(new Error('blocked'), { name: 'SecurityError' }); } });
    await expect(saveTextFile({ ...baseSave, handle: null, askForFile: false }, { pickers: p, download: vi.fn() })).rejects.toThrow('blocked');
  });

  it('a failed write is thrown, aborts the writable, and leaves the old contents untouched', async () => {
    const { handle, file } = fakeHandle('plan.json', { initial: 'old contents', failWrite: true });
    await expect(saveTextFile({ ...baseSave, handle, askForFile: false }, { pickers: pickers(), download: vi.fn() })).rejects.toThrow('disk full');
    expect(file.aborted).toBe(1);
    expect(file.content).toBe('old contents');
  });

  it('a failure when closing is thrown too, because the file only changes when close succeeds', async () => {
    const { handle, file } = fakeHandle('plan.json', { initial: 'old contents', failClose: true });
    await expect(saveTextFile({ ...baseSave, handle, askForFile: false }, { pickers: pickers(), download: vi.fn() })).rejects.toThrow('close failed');
    expect(file.content).toBe('old contents');
    expect(file.aborted).toBe(1);
  });

  it('a failure creating the writable is thrown', async () => {
    const { handle } = fakeHandle('plan.json', { failCreate: true });
    await expect(saveTextFile({ ...baseSave, handle, askForFile: false }, { pickers: pickers(), download: vi.fn() })).rejects.toThrow('could not create');
  });

  it('asks for write permission when the handle does not have it, and writes once it is given', async () => {
    const fake = fakeHandle('plan.json', { permission: 'prompt', request: 'granted' });
    await saveTextFile({ ...baseSave, handle: fake.handle, askForFile: false }, { pickers: pickers(), download: vi.fn() });
    expect(fake.requests).toBe(1);
    expect(fake.file.content).toBe('{"a":1}');
  });

  it('does not ask when permission is already granted', async () => {
    const fake = fakeHandle('plan.json', { permission: 'granted' });
    await saveTextFile({ ...baseSave, handle: fake.handle, askForFile: false }, { pickers: pickers(), download: vi.fn() });
    expect(fake.requests).toBe(0);
  });

  it('refused permission is a clear error and nothing is written', async () => {
    const fake = fakeHandle('plan.json', { initial: 'old', permission: 'prompt', request: 'denied' });
    await expect(saveTextFile({ ...baseSave, handle: fake.handle, askForFile: false }, { pickers: pickers(), download: vi.fn() })).rejects.toThrow(
      'Permission to write to plan.json was not given.',
    );
    expect(fake.file.created).toBe(0);
    expect(fake.file.content).toBe('old');
  });
});

describe('saveTextFile without the File System Access API', () => {
  it('downloads under the suggested name and returns no handle', async () => {
    const download = vi.fn();
    const result = await saveTextFile({ ...baseSave, handle: null, askForFile: false }, { pickers: null, download });
    expect(download).toHaveBeenCalledWith('plan.opendraft.json', '{"a":1}', 'application/json');
    expect(result).toEqual({ kind: 'saved', name: 'plan.opendraft.json', handle: null });
  });

  it('Save As is a download too, and a stale handle is ignored', async () => {
    const stale = fakeHandle('stale.json', { initial: 'untouched' });
    const download = vi.fn();
    await saveTextFile({ ...baseSave, handle: stale.handle, askForFile: true }, { pickers: null, download });
    expect(download).toHaveBeenCalledTimes(1);
    expect(stale.file.content).toBe('untouched');
  });
});

describe('openTextFile', () => {
  it('returns the name, text and handle of the chosen file', async () => {
    const { handle } = fakeHandle('saved.opendraft.json', { initial: '{"hello":true}' });
    const p = pickers({ showOpenFilePicker: async (o) => { p.openCalls.push(o); return [handle]; } });
    const file = await openTextFile({ accept: '.json', types: TYPES, wantHandle: true }, p);
    expect(file).toEqual({ name: 'saved.opendraft.json', text: '{"hello":true}', handle });
    expect(p.openCalls).toEqual([{ types: TYPES, multiple: false }]);
  });

  it('a dismissed dialog resolves null', async () => {
    const p = pickers({ showOpenFilePicker: async () => { throw abortError(); } });
    await expect(openTextFile({ accept: '.json', types: TYPES, wantHandle: true }, p)).resolves.toBeNull();
  });

  it('an empty selection resolves null', async () => {
    const p = pickers({ showOpenFilePicker: async () => [] });
    await expect(openTextFile({ accept: '.json', types: TYPES, wantHandle: true }, p)).resolves.toBeNull();
  });

  it('any other picker error is thrown', async () => {
    const p = pickers({ showOpenFilePicker: async () => { throw Object.assign(new Error('nope'), { name: 'SecurityError' }); } });
    await expect(openTextFile({ accept: '.json', types: TYPES, wantHandle: true }, p)).rejects.toThrow('nope');
  });

  it('an unreadable file is thrown, not returned empty', async () => {
    const broken: FileHandle = { name: 'x.json', getFile: async () => { throw new Error('read failed'); }, createWritable: async () => { throw new Error('no'); } };
    const p = pickers({ showOpenFilePicker: async () => [broken] });
    await expect(openTextFile({ accept: '.json', types: TYPES, wantHandle: true }, p)).rejects.toThrow('read failed');
  });
});

describe('detectPickers', () => {
  const g = globalThis as Record<string, unknown>;
  const withGlobals = (values: Record<string, unknown>, run: () => void) => {
    const keys = Object.keys(values);
    const saved = keys.map((k) => [k, Object.getOwnPropertyDescriptor(g, k)] as const);
    for (const k of keys) Object.defineProperty(g, k, { value: values[k], configurable: true, writable: true });
    try {
      run();
    } finally {
      for (const [k, d] of saved) {
        if (d) Object.defineProperty(g, k, d);
        else delete g[k];
      }
    }
  };

  it('is null where the functions are missing, which is how Firefox and Safari appear', () => {
    expect(detectPickers()).toBeNull();
  });

  it('is null when only one of the two functions exists', () => {
    withGlobals({ showOpenFilePicker: () => undefined }, () => expect(detectPickers()).toBeNull());
  });

  it('is null in an insecure context even if the functions exist', () => {
    withGlobals({ showOpenFilePicker: () => undefined, showSaveFilePicker: () => undefined, isSecureContext: false }, () => expect(detectPickers()).toBeNull());
  });

  it('returns both pickers when they exist', () => {
    withGlobals({ showOpenFilePicker: () => undefined, showSaveFilePicker: () => undefined }, () => {
      const found = detectPickers();
      expect(found).not.toBeNull();
      expect(typeof found!.showSaveFilePicker).toBe('function');
    });
  });
});

describe('marking a drawing saved after a write that takes time', () => {
  function sessionWithLine(): EditorSession {
    const s = new EditorSession();
    s.setViewSize(800, 600);
    s.submitCommand('L');
    s.submitCommand('0,0');
    s.submitCommand('10,0');
    s.submitCommand('');
    return s;
  }

  it('a fresh edit is dirty, and markSaved with a snapshot makes it clean', () => {
    const s = sessionWithLine();
    expect(s.isDirty).toBe(true);
    const snapshot = s.snapshotForSave();
    s.markSaved('a.opendraft.json', snapshot);
    expect(s.isDirty).toBe(false);
    expect(s.fileName).toBe('a.opendraft.json');
  });

  it('an edit made after the snapshot, while the write was still running, keeps the drawing dirty', () => {
    const s = sessionWithLine();
    const snapshot = s.snapshotForSave();
    s.submitCommand('C');
    s.submitCommand('5,5');
    s.submitCommand('2');
    s.markSaved('a.opendraft.json', snapshot);
    expect(s.isDirty).toBe(true);
    // And undoing back to the saved state makes it clean again.
    s.undo();
    expect(s.isDirty).toBe(false);
  });

  it('the snapshot text is the drawing at snapshot time, not later', () => {
    const s = sessionWithLine();
    const snapshot = s.snapshotForSave();
    s.submitCommand('C');
    s.submitCommand('5,5');
    s.submitCommand('2');
    expect(JSON.parse(snapshot.text).entities).toHaveLength(1);
    expect(JSON.parse(s.serializeNative()).entities).toHaveLength(2);
  });

  it('if the document was replaced during the write, the late result changes nothing', () => {
    const s = sessionWithLine();
    const snapshot = s.snapshotForSave();
    s.newDocument();
    s.markSaved('late.opendraft.json', snapshot);
    expect(s.fileName).toBeNull();
    expect(s.isDirty).toBe(false);
    s.submitCommand('L');
    s.submitCommand('0,0');
    s.submitCommand('1,1');
    s.submitCommand('');
    expect(s.isDirty).toBe(true);
  });

  it('without a snapshot, markSaved marks the current state saved', () => {
    const s = sessionWithLine();
    s.markSaved('b.opendraft.json');
    expect(s.isDirty).toBe(false);
  });

  it('an empty drawing saved before any edit is clean, and dirty after the first edit', () => {
    const s = new EditorSession();
    s.setViewSize(800, 600);
    const snapshot = s.snapshotForSave();
    expect(snapshot.point).toBeUndefined();
    s.markSaved('empty.opendraft.json', snapshot);
    expect(s.isDirty).toBe(false);
    s.submitCommand('L');
    s.submitCommand('0,0');
    s.submitCommand('1,0');
    s.submitCommand('');
    expect(s.isDirty).toBe(true);
  });
});

describe('History.savePoint and markSavedAt', () => {
  const line = (id: string) => ({ id, type: 'line' as const, layer: '0', color: null, start: vec2(0, 0), end: vec2(1, 1) });

  it('savePoint is the newest entry, and undefined for an empty history', () => {
    const d = new Drawing();
    const h = new History(d);
    expect(h.savePoint).toBeUndefined();
    const entry = h.execute({ kind: 'insert', entity: line('e1'), index: 0 }, 'one');
    expect(h.savePoint).toBe(entry);
  });

  it('markSavedAt an earlier point leaves later entries dirty, and a redo past it is dirty again', () => {
    const d = new Drawing();
    const h = new History(d);
    h.execute({ kind: 'insert', entity: line('e1'), index: 0 }, 'one');
    const point = h.savePoint;
    h.execute({ kind: 'insert', entity: line('e2'), index: 1 }, 'two');
    h.markSavedAt(point);
    expect(h.isDirty).toBe(true);
    h.undo();
    expect(h.isDirty).toBe(false);
    h.redo();
    expect(h.isDirty).toBe(true);
  });

  it('markSavedAt a point that was undone meanwhile reads as dirty', () => {
    const d = new Drawing();
    const h = new History(d);
    h.execute({ kind: 'insert', entity: line('e1'), index: 0 }, 'one');
    const point = h.savePoint;
    h.undo();
    h.markSavedAt(point);
    expect(h.isDirty).toBe(true);
  });
});
