import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { timeAgo, Ago } from '../src/index.js';
import { timeAgo as qaTimeAgo } from '../src/qa/index.js';

const now = new Date('2026-11-22T12:00:00Z');

describe('timeAgo', () => {
  it('counts up through minutes, hours and days, then gives the date', () => {
    expect(timeAgo('2026-11-22T11:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-11-22T11:55:00Z', now)).toBe('5 min ago');
    expect(timeAgo('2026-11-22T09:00:00Z', now)).toBe('3 h ago');
    expect(timeAgo('2026-11-20T12:00:00Z', now)).toBe('2 d ago');
    expect(timeAgo('2026-11-01T12:00:00Z', now)).toMatch(/Nov 1/);
    expect(timeAgo('2025-11-01T12:00:00Z', now)).toMatch(/2025/);
  });

  it('maxDays moves the switch to a date; Infinity never switches', () => {
    expect(timeAgo('2026-11-10T12:00:00Z', now, { maxDays: 60 })).toBe('12 d ago');
    expect(timeAgo('2025-11-22T12:00:00Z', now, { maxDays: Infinity })).toBe('365 d ago');
  });

  it('takes ms for now, and gives "" for nothing or garbage, "just now" for a little ahead', () => {
    expect(timeAgo('2026-11-22T11:00:00Z', now.getTime())).toBe('1 h ago');
    expect(timeAgo(null, now)).toBe('');
    expect(timeAgo('', now)).toBe('');
    expect(timeAgo('nope', now)).toBe('');
    expect(timeAgo('2026-11-22T12:00:20Z', now)).toBe('just now');
  });

  it('is the same function the Q&A board exports', () => {
    expect(qaTimeAgo).toBe(timeAgo);
  });
});

describe('Ago', () => {
  it('renders a <time> with the full date as tooltip, and nothing for garbage', () => {
    const { container, rerender } = render(<Ago value="2026-11-22T11:55:00Z" prefix="seen " />);
    const t = container.querySelector('time');
    expect(t.getAttribute('dateTime')).toBe('2026-11-22T11:55:00.000Z');
    expect(t.title).toBeTruthy();
    expect(t.textContent.startsWith('seen ')).toBe(true);
    rerender(<Ago value="nope" />);
    expect(container.querySelector('time')).toBeNull();
  });
});
