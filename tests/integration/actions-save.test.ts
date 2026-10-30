import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileHandle } from '../../src/app/files';

// `actions.ts` keeps the current file handle in a module variable and uses the shared `session`, so each test loads fresh copies.
const files = vi.hoisted(() => ({ saveTextFile: vi.fn(), openTextFile: vi.fn() }));
vi.mock('../../src/app/files', () => files);

const handle = (name: string): FileHandle => ({
  name,
  getFile: async () => ({ text: async () => '' }),
  createWritable: async () => {
    throw new Error('unused');
  },
});

async function load() {
  vi.resetModules();
  const actions = await import('../../src/app/actions');
  const { session } = await import('../../src/state/session');
  const draw = () => {
    session.setViewSize(800, 600);
    for (const c of ['L', '0,0', '10,0', '']) session.submitCommand(c);
  };
  return { actions, session, draw };
}

/** The text of a valid native file: whatever a fresh session serialises. */
async function nativeText(): Promise<string> {
  const { EditorSession } = await import('../../src/state/EditorSession');
  return new EditorSession().serializeNative();
}

const saveArg = (n: number) => files.saveTextFile.mock.calls[n]?.[0] as Record<string, unknown>;

beforeEach(() => {
  files.saveTextFile.mockReset();
  files.openTextFile.mockReset();
  (globalThis as Record<string, unknown>).window = { confirm: vi.fn(() => true) };
});

describe('saveNative (real actions and session, mocked file layer)', () => {
  it('after a failed save the guard is released: a second save works and marks the drawing saved', async () => {
    const { actions, session, draw } = await load();
    draw();
    const report = vi.fn();
    files.saveTextFile.mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce({ kind: 'saved', name: 'a.opendraft.json', handle: null });
    await actions.saveNative(report);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ lines: ['disk full'] }));
    expect(session.isDirty).toBe(true);
    await actions.saveNative(report);
    expect(files.saveTextFile).toHaveBeenCalledTimes(2);
    expect(session.isDirty).toBe(false);
    expect(session.fileName).toBe('a.opendraft.json');
  });

  it('a save started while another is running is ignored', async () => {
    const { actions, draw } = await load();
    draw();
    let release!: (v: unknown) => void;
    files.saveTextFile.mockReturnValueOnce(new Promise((r) => (release = r)));
    const first = actions.saveNative(vi.fn());
    await actions.saveNative(vi.fn());
    expect(files.saveTextFile).toHaveBeenCalledTimes(1);
    release({ kind: 'cancelled' });
    await first;
  });

  it('a rejection that is not an Error gets a generic reason, and a cancel changes nothing', async () => {
    const { actions, session, draw } = await load();
    draw();
    const report = vi.fn();
    files.saveTextFile.mockRejectedValueOnce('boom');
    await actions.saveNative(report);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ lines: ['The browser refused the request.'] }));
    files.saveTextFile.mockResolvedValueOnce({ kind: 'cancelled' });
    await actions.saveNative(report);
    expect(report).toHaveBeenCalledTimes(1);
    expect(session.isDirty).toBe(true);
    expect(session.fileName).toBeNull();
  });

  it('keeps the handle from a save and reuses it; Save As passes askForFile', async () => {
    const { actions, draw } = await load();
    draw();
    const h = handle('a.opendraft.json');
    files.saveTextFile.mockResolvedValue({ kind: 'saved', name: 'a.opendraft.json', handle: h });
    await actions.saveNative(vi.fn());
    await actions.saveNative(vi.fn());
    expect(saveArg(0)).toMatchObject({ handle: null, askForFile: false });
    expect(saveArg(1)).toMatchObject({ handle: h, askForFile: false, suggestedName: 'a.opendraft.json' });
    await actions.saveNative(vi.fn(), { saveAs: true });
    expect(saveArg(2)).toMatchObject({ askForFile: true });
  });

  it('a handle returned after the document was replaced during the write is not adopted', async () => {
    const { actions, session, draw } = await load();
    draw();
    let release!: (v: unknown) => void;
    files.saveTextFile.mockReturnValueOnce(new Promise((r) => (release = r)));
    const pending = actions.saveNative(vi.fn());
    actions.newDrawing(); // the confirm stub says yes
    release({ kind: 'saved', name: 'late.opendraft.json', handle: handle('late.opendraft.json') });
    await pending;
    expect(session.fileName).toBeNull();
    files.saveTextFile.mockResolvedValueOnce({ kind: 'cancelled' });
    await actions.saveNative(vi.fn());
    expect(saveArg(1).handle).toBeNull();
  });
});

describe('the handle follows the document', () => {
  async function withOpenFile() {
    const ctx = await load();
    const h = handle('opened.opendraft.json');
    files.openTextFile.mockResolvedValueOnce({ name: 'opened.opendraft.json', text: await nativeText(), handle: h });
    await ctx.actions.openNative(vi.fn());
    files.saveTextFile.mockResolvedValue({ kind: 'saved', name: 'opened.opendraft.json', handle: h });
    return { ...ctx, h };
  }
  const nextHandle = async (actions: Awaited<ReturnType<typeof load>>['actions']) => {
    files.saveTextFile.mockClear();
    await actions.saveNative(vi.fn());
    return saveArg(0).handle;
  };

  it('a successful native Open sets it', async () => {
    const { actions, session, h } = await withOpenFile();
    expect(session.fileName).toBe('opened.opendraft.json');
    expect(await nextHandle(actions)).toBe(h);
  });

  it('New clears it', async () => {
    const { actions } = await withOpenFile();
    actions.newDrawing();
    expect(await nextHandle(actions)).toBeNull();
  });

  it('a failed Open (bad file) leaves it', async () => {
    const { actions, h } = await withOpenFile();
    const report = vi.fn();
    files.openTextFile.mockResolvedValueOnce({ name: 'bad.json', text: 'not json', handle: handle('bad.json') });
    await actions.openNative(report);
    expect(report).toHaveBeenCalledTimes(1);
    expect(await nextHandle(actions)).toBe(h);
  });

  it('a picker error that is not a cancel is reported, and the document and handle stay', async () => {
    const { actions, session, h } = await withOpenFile();
    const report = vi.fn();
    files.openTextFile.mockRejectedValueOnce(new Error('blocked by policy'));
    await actions.openNative(report);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cannot open a file', lines: ['blocked by policy'] }));
    expect(session.fileName).toBe('opened.opendraft.json');
    expect(await nextHandle(actions)).toBe(h);
  });

  it('a cancelled Open changes nothing', async () => {
    const { actions, h } = await withOpenFile();
    files.openTextFile.mockResolvedValueOnce(null);
    await actions.openNative(vi.fn());
    expect(await nextHandle(actions)).toBe(h);
  });

  it('a DXF import clears it', async () => {
    const { actions, session } = await withOpenFile();
    const dxf = session.exportDxfText().text;
    files.openTextFile.mockResolvedValueOnce({ name: 'x.dxf', text: dxf, handle: null });
    await actions.openDxf(vi.fn());
    expect(session.fileName).toBeNull();
    expect(await nextHandle(actions)).toBeNull();
  });
});

describe('exportDxf', () => {
  it('always asks for a file and never passes or changes the native handle', async () => {
    const { actions, draw } = await load();
    draw();
    const h = handle('a.opendraft.json');
    files.saveTextFile.mockResolvedValueOnce({ kind: 'saved', name: 'a.opendraft.json', handle: h });
    await actions.saveNative(vi.fn());
    files.saveTextFile.mockResolvedValueOnce({ kind: 'saved', name: 'a.dxf', handle: handle('a.dxf') });
    await actions.exportDxf(vi.fn());
    expect(saveArg(1)).toMatchObject({ suggestedName: 'a.dxf', handle: null, askForFile: true });
    files.saveTextFile.mockResolvedValueOnce({ kind: 'cancelled' });
    await actions.saveNative(vi.fn());
    expect(saveArg(2).handle).toBe(h);
  });

  it('a failed export is reported as not exported, and a cancel is silent', async () => {
    const { actions, draw } = await load();
    draw();
    const report = vi.fn();
    files.saveTextFile.mockRejectedValueOnce(new Error('no space'));
    await actions.exportDxf(report);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cannot export drawing.dxf', lines: ['no space'], intro: 'Nothing was exported.' }));
    files.saveTextFile.mockResolvedValueOnce({ kind: 'cancelled' });
    await actions.exportDxf(report);
    expect(report).toHaveBeenCalledTimes(1);
  });
});
