import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { useSavedPref } from '../src/index.js';

afterEach(() => { cleanup(); localStorage.clear(); });

function Probe({ k = 'x.side', load, save }) {
  const [v, set] = useSavedPref(k, { load, save, fallback: { pinned: true } });
  return (
    <>
      <output>{v.pinned ? 'pinned' : 'hidden'}</output>
      <button type="button" onClick={() => set({ pinned: !v.pinned })}>toggle</button>
      <button type="button" onClick={() => set(null)}>reset</button>
    </>
  );
}

describe('useSavedPref', () => {
  it('starts at the fallback, then takes the account value and keeps a browser copy', async () => {
    const load = vi.fn().mockResolvedValue({ pinned: false });
    render(<Probe load={load} save={vi.fn()} />);
    expect(document.querySelector('output').textContent).toBe('pinned');
    await act(async () => {});
    expect(load).toHaveBeenCalledWith('x.side');
    expect(document.querySelector('output').textContent).toBe('hidden');
    expect(JSON.parse(localStorage.getItem('x.side'))).toEqual({ pinned: false });
  });

  it('uses the browser copy first and sends it up when the account has none', async () => {
    localStorage.setItem('x.side', JSON.stringify({ pinned: false }));
    const save = vi.fn().mockResolvedValue(null);
    render(<Probe load={vi.fn().mockResolvedValue(null)} save={save} />);
    expect(document.querySelector('output').textContent).toBe('hidden');
    await act(async () => {});
    expect(save).toHaveBeenCalledWith('x.side', { pinned: false });
    expect(document.querySelector('output').textContent).toBe('hidden');
  });

  it('a change is saved in both places and beats a slow account load; null resets', async () => {
    let resolve;
    const load = vi.fn(() => new Promise((r) => { resolve = r; }));
    const save = vi.fn().mockResolvedValue(null);
    render(<Probe load={load} save={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
    await act(async () => {});
    expect(save).toHaveBeenCalledWith('x.side', { pinned: false });
    await act(async () => { resolve({ pinned: true }); });
    expect(document.querySelector('output').textContent).toBe('hidden'); // the person's change wins
    fireEvent.click(screen.getByRole('button', { name: 'reset' }));
    await act(async () => {});
    expect(document.querySelector('output').textContent).toBe('pinned');
    expect(localStorage.getItem('x.side')).toBeNull();
    expect(save).toHaveBeenLastCalledWith('x.side', null);
  });

  it('works without an account (browser only)', () => {
    render(<Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(JSON.parse(localStorage.getItem('x.side'))).toEqual({ pinned: false });
  });
});
