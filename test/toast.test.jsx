import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { OverlayProvider, useToast } from '../src/index.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });

function Fire({ ms }) {
  const toast = useToast();
  return <button type="button" onClick={() => toast.error('SMTP said no', ms)}>go</button>;
}

describe('toast duration', () => {
  it('ms 0 stays until dismissed; a number leaves on time', () => {
    vi.useFakeTimers();
    const { unmount } = render(<OverlayProvider><Fire ms={0} /></OverlayProvider>);
    fireEvent.click(screen.getByText('go'));
    act(() => { vi.advanceTimersByTime(60000); });
    expect(screen.getByText('SMTP said no')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('SMTP said no')).toBeNull();
    unmount();

    render(<OverlayProvider><Fire ms={1000} /></OverlayProvider>);
    fireEvent.click(screen.getByText('go'));
    act(() => { vi.advanceTimersByTime(1100); });
    expect(screen.queryByText('SMTP said no')).toBeNull();
  });
});
