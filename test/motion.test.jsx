import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { OverlayProvider, useToast, Modal, StatCard, useCountUp } from '../src/index.js';

// jsdom has no PointerEvent, so fireEvent.pointer* would drop clientX and pointerType.
if (typeof window.PointerEvent !== 'function') {
  window.PointerEvent = class extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
      if (init.timeStamp != null) Object.defineProperty(this, 'timeStamp', { value: init.timeStamp });
    }
  };
}
const realMatch = window.matchMedia;
function media({ reduce = false, phone = false } = {}) {
  window.matchMedia = (q) => ({
    matches: q.includes('reduce') ? reduce : q.includes('max-width') ? phone : false,
    media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
}
afterEach(() => { cleanup(); vi.useRealTimers(); window.matchMedia = realMatch; });

function Many({ n = 5 }) {
  const toast = useToast();
  return <button type="button" onClick={() => { for (let i = 1; i <= n; i++) toast.info(`T${i}`, 0); }}>go</button>;
}
const visible = () => [...document.querySelectorAll('.mk-toast')].filter((el) => !el.classList.contains('mk-toast-hidden')).map((el) => el.textContent);

describe('toast stack', () => {
  it('more than 3 collapse to the newest 3 plus "+N more"; hover or the chip expands', () => {
    render(<OverlayProvider><Many /></OverlayProvider>);
    fireEvent.click(screen.getByText('go'));
    expect(visible()).toEqual(['T3', 'T4', 'T5']);
    fireEvent.click(screen.getByRole('button', { name: '+2 more' }));
    expect(visible()).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
    fireEvent.mouseLeave(document.querySelector('.mk-toasts'));
    expect(visible()).toHaveLength(3);
    fireEvent.mouseEnter(document.querySelector('.mk-toasts'));
    expect(visible()).toHaveLength(5);
  });

  it('the chip stays put when focused (keyboard) and reads "Show less" when open', () => {
    render(<OverlayProvider><Many /></OverlayProvider>);
    fireEvent.click(screen.getByText('go'));
    const chip = screen.getByRole('button', { name: '+2 more' });
    act(() => chip.focus());
    expect(document.activeElement).toBe(chip);
    expect(chip.textContent).toBe('Show less');
    expect(visible()).toHaveLength(5);
    fireEvent.click(chip);
    expect(visible()).toHaveLength(3);
    expect(document.activeElement).toBe(chip);
  });

  it('the mouse leaving does not hide a toast that holds focus', () => {
    render(<OverlayProvider><Many /></OverlayProvider>);
    fireEvent.click(screen.getByText('go'));
    const stack = document.querySelector('.mk-toasts');
    fireEvent.mouseEnter(stack);
    const x = screen.getAllByRole('button', { name: 'Dismiss' })[0];
    x.focus();
    fireEvent.mouseLeave(stack);
    expect(visible()).toHaveLength(5);
    expect(document.activeElement).toBe(x);
  });

  it('a hidden toast that leaves stays hidden, so the shown ones do not jump', () => {
    vi.useFakeTimers();
    media();
    function Timed() {
      const toast = useToast();
      return <button type="button" onClick={() => { toast.info('Old', 1000); for (let i = 1; i <= 4; i++) toast.info(`N${i}`, 0); }}>go</button>;
    }
    render(<OverlayProvider><Timed /></OverlayProvider>);
    fireEvent.click(screen.getByText('go'));
    act(() => { vi.advanceTimersByTime(1050); });
    expect(document.querySelector('.mk-toast-leave').classList.contains('mk-toast-hidden')).toBe(true);
    expect(visible()).toEqual(['N2', 'N3', 'N4']);
  });

  it('a tap on a link inside a toast is a click, not a swipe', () => {
    const onLink = vi.fn();
    function Link() {
      const toast = useToast();
      return <button type="button" onClick={() => toast.info(<a href="#v" onClick={(e) => { e.preventDefault(); onLink(); }}>View</a>, 0)}>go</button>;
    }
    media();
    render(<OverlayProvider><Link /></OverlayProvider>);
    fireEvent.click(screen.getByText('go'));
    const a = screen.getByText('View');
    const el = document.querySelector('.mk-toast');
    el.setPointerCapture = vi.fn();
    fireEvent.pointerDown(a, { pointerId: 4, pointerType: 'touch', clientX: 10, clientY: 10, timeStamp: 100 });
    fireEvent.pointerMove(a, { pointerId: 4, pointerType: 'touch', clientX: 12, clientY: 11, timeStamp: 150 });
    fireEvent.pointerUp(a, { pointerId: 4, pointerType: 'touch', clientX: 12, clientY: 11, timeStamp: 200 });
    fireEvent.click(a);
    expect(el.setPointerCapture).not.toHaveBeenCalled();
    expect(onLink).toHaveBeenCalledTimes(1);
    expect(screen.getByText('View')).toBeTruthy();
  });

  it('dismissing a leaving toast again does nothing', () => {
    vi.useFakeTimers();
    media();
    render(<OverlayProvider><Many n={1} /></OverlayProvider>);
    fireEvent.click(screen.getByText('go'));
    const x = screen.getByRole('button', { name: 'Dismiss' });
    fireEvent.click(x);
    const el = document.querySelector('.mk-toast');
    fireEvent.click(x);
    expect(el.className).toContain('mk-toast-leave-down');
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.queryByText('T1')).toBeNull();
  });

  it('3 or fewer show no chip', () => {
    render(<OverlayProvider><Many n={3} /></OverlayProvider>);
    fireEvent.click(screen.getByText('go'));
    expect(visible()).toHaveLength(3);
    expect(screen.queryByText(/more$/)).toBeNull();
  });

  it('a touch swipe past 80px dismisses; a short one springs back', () => {
    vi.useFakeTimers();
    media();
    render(<OverlayProvider><Many n={1} /></OverlayProvider>);
    fireEvent.click(screen.getByText('go'));
    const el = document.querySelector('.mk-toast');
    const swipe = (to, t0) => {
      fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 10, timeStamp: t0 });
      fireEvent.pointerMove(el, { pointerId: 1, pointerType: 'touch', clientX: to, clientY: 10, timeStamp: t0 + 400 });
      fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'touch', clientX: to, clientY: 10, timeStamp: t0 + 800 });
    };
    swipe(130, 100);
    expect(el.className).not.toContain('mk-toast-leave');
    expect(el.style.transform).toBe('');
    swipe(220, 1000);
    expect(el.className).toContain('mk-toast-leave-right');
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.queryByText('T1')).toBeNull();
  });

  it('a mouse drag does not dismiss', () => {
    render(<OverlayProvider><Many n={1} /></OverlayProvider>);
    fireEvent.click(screen.getByText('go'));
    const el = document.querySelector('.mk-toast');
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 10 });
    fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'mouse', clientX: 300, clientY: 10 });
    expect(screen.getByText('T1')).toBeTruthy();
  });

  it('with motion on, × plays the exit before removing', () => {
    vi.useFakeTimers();
    media();
    render(<OverlayProvider><Many n={1} /></OverlayProvider>);
    fireEvent.click(screen.getByText('go'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(document.querySelector('.mk-toast-leave')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.queryByText('T1')).toBeNull();
  });
});

describe('sheet drag', () => {
  const drag = (el, dy) => {
    fireEvent.pointerDown(el, { pointerId: 2, pointerType: 'touch', clientX: 0, clientY: 100, timeStamp: 100 });
    fireEvent.pointerMove(el, { pointerId: 2, pointerType: 'touch', clientX: 0, clientY: 100 + dy, timeStamp: 600 });
    fireEvent.pointerUp(el, { pointerId: 2, pointerType: 'touch', clientX: 0, clientY: 100 + dy, timeStamp: 1100 });
  };
  it('on phones, a long drag down closes and a short one springs back', () => {
    media({ reduce: true, phone: true });
    const onClose = vi.fn();
    render(<Modal open title="Edit" onClose={onClose}>Body</Modal>);
    const grab = document.querySelector('.mk-modal-grab');
    const panel = screen.getByRole('dialog');
    Object.defineProperty(panel, 'offsetHeight', { value: 400 });
    drag(grab, 60);
    expect(onClose).not.toHaveBeenCalled();
    expect(panel.style.transform).toBe('');
    drag(grab, 200);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does nothing on desktop or from a button in the title row', () => {
    media({ reduce: true, phone: false });
    const onClose = vi.fn();
    render(<Modal open title="Edit" onClose={onClose}>Body</Modal>);
    const panel = screen.getByRole('dialog');
    Object.defineProperty(panel, 'offsetHeight', { value: 400 });
    drag(document.querySelector('.mk-modal-head'), 300);
    expect(onClose).not.toHaveBeenCalled();
    media({ reduce: true, phone: true });
    drag(screen.getByRole('button', { name: 'Close' }), 300);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('with motion on, a drag-close slides out then closes once, even if Esc comes meanwhile', () => {
    vi.useFakeTimers();
    media({ phone: true });
    const onClose = vi.fn();
    render(<Modal open title="Edit" onClose={onClose}>Body</Modal>);
    const panel = screen.getByRole('dialog');
    Object.defineProperty(panel, 'offsetHeight', { value: 400 });
    drag(document.querySelector('.mk-modal-grab'), 300);
    expect(panel.style.transform).toBe('translateY(100%)');
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(document.querySelector('.mk-modal-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(250); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('has no grab handle without onClose', () => {
    render(<Modal open title="Locked">Body</Modal>);
    expect(document.querySelector('.mk-modal-grab')).toBeNull();
  });
});

describe('StatCard count', () => {
  const fmt = (n) => `$${Math.round(n).toLocaleString()}`;
  it('formats count, keeps value working, and jumps under reduce motion', () => {
    media({ reduce: true });
    const { rerender } = render(<StatCard label="Rev" count={48210} format={fmt} />);
    expect(screen.getByText('$48,210')).toBeTruthy();
    rerender(<StatCard label="Rev" count={50000} format={fmt} />);
    expect(screen.getByText('$50,000')).toBeTruthy();
    rerender(<StatCard label="Rev" value="n/a" />);
    expect(screen.getByText('n/a')).toBeTruthy();
  });

  it('useCountUp ticks through in-between values with motion on', () => {
    media();
    let now = 0;
    const frames = [];
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const seen = [];
    function C({ n }) { const v = useCountUp(n); seen.push(v); return null; }
    const { rerender } = render(<C n={0} />);
    rerender(<C n={100} />);
    act(() => { now = 300; frames.shift()(now); });
    act(() => { now = 700; frames.shift()(now); });
    expect(seen.find((v) => v > 0 && v < 100)).toBeGreaterThan(50);
    expect(seen.at(-1)).toBe(100);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
