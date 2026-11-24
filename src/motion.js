import { useEffect, useRef, useState } from 'react';

/** True when animating is fine: a real browser and no "reduce motion" setting. */
export function motionOk() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** True on phone widths, where Modal is a bottom sheet (matches kit.css's 640px). */
export function isPhone() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 639.98px)').matches;
}

const easeOut = (t) => 1 - (1 - t) ** 3;

/**
 * A number that ticks from its old value to a new one instead of jumping.
 * The first value shows as-is; later changes animate over `duration` ms.
 * No animation under "reduce motion" or without requestAnimationFrame.
 *   const shown = useCountUp(total);  // then format(shown)
 */
export function useCountUp(target, { duration = 600 } = {}) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const raf = useRef(0);
  useEffect(() => {
    if (!Number.isFinite(target)) { setShown(target); return undefined; }
    const start = Number.isFinite(from.current) ? from.current : target;
    if (start === target || !motionOk() || typeof requestAnimationFrame !== 'function') {
      from.current = target; setShown(target); return undefined;
    }
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const v = start + (target - start) * easeOut(p);
      from.current = v;
      setShown(p < 1 ? v : target);
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);
  return shown;
}

/**
 * Drag tracking for swipe/drag-to-dismiss. Calls onMove(dx, dy) while dragging
 * and onEnd({dx, dy, vx, vy}) on release (velocity in px/ms over the last ~80ms).
 * Returns pointer handlers to spread on the drag surface.
 */
const SLOP = 6;
export function dragHandlers({ accept = () => true, onStart, onMove, onEnd }) {
  let s = null;
  return {
    onPointerDown(e) {
      if (e.button > 0 || !accept(e)) return;
      s = { id: e.pointerId, x: e.clientX, y: e.clientY, started: false, pts: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }] };
    },
    onPointerMove(e) {
      if (!s || e.pointerId !== s.id) return;
      // A drag starts only past SLOP px, so a tap still clicks the link or control
      // under it (capturing the pointer would send the click to the drag surface).
      if (!s.started) {
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < SLOP) return;
        s.started = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        onStart?.(e);
      }
      s.pts.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      while (s.pts.length > 2 && e.timeStamp - s.pts[0].t > 80) s.pts.shift();
      onMove?.(e.clientX - s.x, e.clientY - s.y);
    },
    onPointerUp(e) { finish(e); },
    onPointerCancel(e) { finish(e, true); },
  };
  function finish(e, cancelled) {
    if (!s || e.pointerId !== s.id) return;
    if (!s.started) { s = null; return; }
    const a = s.pts[0];
    const dt = e.timeStamp - a.t; // a clock mix-up (dt <= 0) counts as no flick
    const r = { dx: e.clientX - s.x, dy: e.clientY - s.y, vx: dt > 0 ? (e.clientX - a.x) / dt : 0, vy: dt > 0 ? (e.clientY - a.y) / dt : 0, cancelled };
    s = null;
    onEnd?.(cancelled ? { ...r, dx: 0, dy: 0, vx: 0, vy: 0 } : r);
  }
}
