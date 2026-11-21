import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, renderHook, act, cleanup, screen, fireEvent } from '@testing-library/react';
import { useAutosave, SaveStatus } from '../src/index.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const setup = (opts = {}) => {
  const calls = [];
  const save = opts.save || vi.fn(async (patch) => { calls.push(patch); });
  const hook = renderHook(() => useAutosave({ save, debounceMs: 5, ...opts }));
  act(() => hook.result.current.reset({ color: 'Black', vin: 'A', notes: '' }));
  return { hook, save, calls, a: () => hook.result.current };
};

describe('useAutosave', () => {
  it('sends only the changed fields, once, after the pause', async () => {
    const { a, calls } = setup();
    act(() => { a().setField('color', 'W'); a().setField('color', 'White'); });
    expect(a().dirty).toBe(true);
    await act(async () => { await a().flush(); });
    expect(calls).toEqual([{ color: 'White' }]);
    expect(a().status).toBe('saved');
    expect(a().dirty).toBe(false);
  });

  it('undo puts the last save back and redo re-applies it', async () => {
    const { a, calls } = setup();
    act(() => a().setField('color', 'White'));
    await act(async () => { await a().flush(); });
    await act(async () => { await a().undo(); });
    expect(a().form.color).toBe('Black');
    expect(a().canRedo).toBe(true);
    await act(async () => { await a().redo(); });
    expect(a().form.color).toBe('White');
    expect(calls).toEqual([{ color: 'White' }, { color: 'Black' }, { color: 'White' }]);
  });

  it('a failed save keeps the edit, reports it, and Retry sends it again', async () => {
    let fail = true;
    const save = vi.fn(async () => { if (fail) throw new Error('offline'); });
    const { a } = setup({ save });
    act(() => a().setField('color', 'Red'));
    let r;
    await act(async () => { r = await a().flush(); });
    expect(r.ok).toBe(false);
    expect(a().status).toBe('error');
    expect(a().form.color).toBe('Red');
    fail = false;
    await act(async () => { r = await a().flush(); });
    expect(r.ok).toBe(true);
    expect(save).toHaveBeenLastCalledWith({ color: 'Red' }, { unloading: false });
  });

  it('a failed undo keeps the step for another try', async () => {
    let fail = false;
    const save = vi.fn(async () => { if (fail) throw new Error('offline'); });
    const { a } = setup({ save });
    act(() => a().setField('color', 'White'));
    await act(async () => { await a().flush(); });
    fail = true;
    await act(async () => { await a().undo(); });
    expect(a().canUndo).toBe(true);
    expect(a().form.color).toBe('White'); // what the server still has
  });

  it('edits made while a save is running go out right after it', async () => {
    let release;
    const calls = [];
    const save = vi.fn((patch) => { calls.push(patch); return calls.length === 1 ? new Promise((r) => { release = r; }) : Promise.resolve(); });
    const { a } = setup({ save });
    act(() => a().setField('color', 'White'));
    let p;
    act(() => { p = a().flush(); });
    act(() => a().setField('vin', 'B'));
    const q = a().flush();
    await act(async () => { release(); await p; await q; });
    expect(calls).toEqual([{ color: 'White' }, { vin: 'B' }]);
  });

  it('validate holds back bad values with a message; apply (put back) skips it', async () => {
    const validate = (patch) => ('vin' in patch && patch.vin.length !== 3 ? { vin: 'Three letters' } : {});
    const { a, calls } = setup({ validate });
    act(() => a().setField('vin', 'TOOLONG'));
    let r;
    await act(async () => { r = await a().flush(); });
    expect(r.invalid).toBe(true);
    expect(a().errors.vin).toBe('Three letters');
    expect(calls).toEqual([]);
    await act(async () => { await a().apply({ vin: 'A' }); }); // the opening value, even though it fails the rule
    expect(a().dirty).toBe(false);
  });

  it('undo never sends another field that validate is holding back', async () => {
    const validate = (patch) => ('notes' in patch && patch.notes === 'BAD' ? { notes: 'No' } : {});
    const { a, calls } = setup({ validate });
    act(() => a().setField('color', 'White'));
    await act(async () => { await a().flush(); });
    act(() => a().setField('notes', 'BAD'));
    await act(async () => { await a().flush(); });
    await act(async () => { await a().undo(); });
    expect(calls).toEqual([{ color: 'White' }, { color: 'Black' }]); // notes never sent
    expect(a().errors.notes).toBe('No');
    expect(a().form.notes).toBe('BAD');
  });

  it('a save queued behind one in flight keeps keepalive when the page is closing', async () => {
    let release;
    const opts = [];
    const save = vi.fn((patch, o) => { opts.push(o); return opts.length === 1 ? new Promise((r) => { release = r; }) : Promise.resolve(); });
    const { a } = setup({ save });
    act(() => a().setField('color', 'White'));
    let p;
    act(() => { p = a().flush(); });
    act(() => a().setField('vin', 'B'));
    const q = a().flush('edit', { unloading: true });
    await act(async () => { release(); await p; await q; });
    expect(opts.map((o) => o.unloading)).toEqual([false, true]);
  });

  it('revertAll puts back the opening values', async () => {
    const { a, calls } = setup();
    act(() => a().setField('color', 'White'));
    await act(async () => { await a().flush(); });
    expect(a().canRevert).toBe(true);
    await act(async () => { await a().revertAll(); });
    expect(a().form.color).toBe('Black');
    expect(calls.at(-1)).toEqual({ color: 'Black' });
    expect(a().canRevert).toBe(false);
  });

  it('⌘Z is ignored while a dialog that does not hold the form is open', async () => {
    const { a } = setup();
    act(() => a().setField('color', 'White'));
    await act(async () => { await a().flush(); });
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    document.body.appendChild(dlg);
    await act(async () => { fireEvent.keyDown(document.body, { key: 'z', metaKey: true }); });
    expect(a().form.color).toBe('White');
    dlg.remove();
    await act(async () => { fireEvent.keyDown(document.body, { key: 'z', metaKey: true }); await new Promise((r) => setTimeout(r, 0)); });
    expect(a().form.color).toBe('Black');
  });
});

describe('SaveStatus', () => {
  it('shows each state', () => {
    const base = { status: 'idle', savedAt: null, dirty: false, canUndo: false, canRevert: false, undo() {}, revertAll() {}, flush: vi.fn() };
    const { rerender } = render(<SaveStatus autosave={base} />);
    expect(screen.getByText('Changes save automatically')).toBeTruthy();
    rerender(<SaveStatus autosave={{ ...base, status: 'saving' }} />);
    expect(screen.getByText('Saving…')).toBeTruthy();
    rerender(<SaveStatus autosave={{ ...base, status: 'saved', savedAt: Date.now(), canUndo: true, canRevert: true }} />);
    expect(screen.getByText(/Saved just now/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revert all' })).toBeTruthy();
    const flush = vi.fn();
    rerender(<SaveStatus autosave={{ ...base, status: 'error', error: 'offline', flush }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(flush).toHaveBeenCalled();
  });
});
