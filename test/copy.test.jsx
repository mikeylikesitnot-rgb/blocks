import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { CopyButton, copyText, OverlayProvider } from '../src/index.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); delete navigator.clipboard; });

function mockClipboard(impl = () => Promise.resolve()) {
  const writeText = vi.fn(impl);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

describe('copyText', () => {
  it('writes through navigator.clipboard', async () => {
    const w = mockClipboard();
    expect(await copyText('abc')).toBe(true);
    expect(w).toHaveBeenCalledWith('abc');
  });
  it('falls back to execCommand when the clipboard API is missing', async () => {
    document.execCommand = vi.fn(() => true);
    expect(await copyText('x')).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });
  it('falls back when the clipboard API rejects', async () => {
    mockClipboard(() => Promise.reject(new Error('no')));
    document.execCommand = vi.fn(() => false);
    expect(await copyText('x')).toBe(false);
  });
});

describe('CopyButton', () => {
  it('is icon-only with the label as its name, copies, shows Copied and a toast', async () => {
    const w = mockClipboard();
    render(<OverlayProvider><CopyButton text={() => '37 | X'} label="Copy car info" toast="Copied car info" /></OverlayProvider>);
    const b = screen.getByRole('button', { name: 'Copy car info' });
    expect(b.className).toContain('mk-btn-icon');
    await act(async () => { fireEvent.click(b); });
    expect(w).toHaveBeenCalledWith('37 | X');
    expect(screen.getByRole('button', { name: 'Copied' }).className).toContain('mk-copy-done');
    expect(screen.getByText('Copied car info: 37 | X')).toBeTruthy();
  });
  it('does not bubble the click to a clickable row', async () => {
    mockClipboard();
    const row = vi.fn();
    render(<div onClick={row}><CopyButton text="a" toast={false} /></div>);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });
    expect(row).not.toHaveBeenCalled();
  });
  it('returns to the copy icon after 1.5s', async () => {
    vi.useFakeTimers();
    mockClipboard();
    render(<CopyButton text="a" toast={false} />);
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1600); });
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
  });
});
