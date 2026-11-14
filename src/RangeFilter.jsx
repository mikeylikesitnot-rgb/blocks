import { useEffect, useId, useRef, useState } from 'react';
import { cx } from './cx.js';
import { ChevronDownIcon } from './icons.jsx';
import { money, rangeSummary, shortMoney } from './filters.js';

const SETTLE_MS = 300;

/**
 * Filter-bar dropdown for a number range (price, cost). Dressed like
 * FilterMenu; opens a two-handle slider with Min and Max boxes, because
 * dragging is quick for "about $5k–$12k" and typing suits an exact figure.
 *
 *   const price = rangeParam(filters, 'minPrice', 'maxPrice');
 *   <RangeFilter label="Price" allLabel="Any price" value={price}
 *     bounds={rangeBounds(cars.map((c) => c.price), 500, price)} step={500}
 *     onChange={(min, max) => setFilters({ minPrice: min, maxPrice: max })} />
 *
 * `value` is [min, max] with null for an open end; onChange(min, max) hands
 * back the same shape. A handle at its end means no limit (null), so the
 * param drops out of the URL. Dragging reports once the hand rests (~300ms);
 * typing reports on Enter or leaving the box; closing reports anything pending.
 * `format` is the short figure on the button, `formatValue` the exact one in
 * the boxes and for screen readers (both default to dollars).
 */
export function RangeFilter({
  label, allLabel, value = [null, null], bounds, step = 1, onChange,
  format = shortMoney, formatValue = money, upTo = 'Up to', className = '', align = 'start',
}) {
  const [lo, hi] = bounds;
  const [open, setOpen] = useState(false);
  // The handles while a hand is on them; null otherwise, when they show `value`
  // (so a reset, Back or a saved set arriving moves them).
  const [drag, setDrag] = useState(null);
  const root = useRef(null);
  const btn = useRef(null);
  const panelId = useId();

  const [dMin, dMax] = drag ?? [value[0] ?? lo, value[1] ?? hi];
  const asValue = ([a, b]) => [a <= lo ? null : a, b >= hi ? null : b];

  const commit = (d) => {
    setDrag(null);
    const [a, b] = asValue(d);
    if (a !== (value[0] ?? null) || b !== (value[1] ?? null)) onChange(a, b);
  };
  // Handlers read the newest render through a ref (no stale closures in timers/listeners).
  const live = useRef({});
  live.current = { drag, commit };

  useEffect(() => {
    if (!drag) return undefined;
    const t = setTimeout(() => { const l = live.current; if (l.drag) l.commit(l.drag); }, SETTLE_MS);
    return () => clearTimeout(t);
  }, [drag]);

  const close = (refocus) => {
    const l = live.current;
    if (l.drag) l.commit(l.drag);
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!root.current?.contains(e.target)) closeRef.current(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(true); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey, true);
    root.current?.querySelector('.mk-range-slider input')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const pct = (n) => `${((n - lo) / (hi - lo || 1)) * 100}%`;
  const shown = drag ? asValue(drag) : [value[0] ?? null, value[1] ?? null];
  const summary = rangeSummary(shown, { allLabel: allLabel || label, upTo, format });
  const active = shown[0] != null || shown[1] != null;

  return (
    <div ref={root} className={cx('mk-filter', 'mk-range', className)}>
      <button
        ref={btn}
        type="button"
        className={cx('mk-filter-btn', active && 'mk-filter-btn-active')}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={active ? `${label}: ${summary}` : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <span className="mk-filter-text">{summary}</span>
        <ChevronDownIcon className="mk-filter-chevron" />
      </button>
      {open && (
        <div id={panelId} role="group" aria-label={label} className={cx('mk-filter-menu', 'mk-range-menu', align === 'end' && 'mk-filter-menu-end')}>
          <div className="mk-range-slider" style={{ '--mk-lo': pct(dMin), '--mk-hi': pct(dMax) }}>
            <input
              type="range" min={lo} max={hi} step={step} value={dMin}
              aria-label={`${label} minimum`}
              aria-valuetext={dMin <= lo ? 'No minimum' : formatValue(dMin)}
              // Pushed to the top end, the low handle sits under the high one; lift it.
              style={{ zIndex: dMin > lo + (hi - lo) / 2 ? 2 : 1 }}
              onChange={(e) => setDrag([Math.min(Number(e.target.value), dMax), dMax])}
            />
            <input
              type="range" min={lo} max={hi} step={step} value={dMax}
              aria-label={`${label} maximum`}
              aria-valuetext={dMax >= hi ? 'No limit' : formatValue(dMax)}
              onChange={(e) => setDrag([dMin, Math.max(Number(e.target.value), dMin)])}
            />
          </div>
          <div className="mk-range-fields">
            <NumberBox
              key={`min-${dMin}`} label="Min" value={dMin <= lo ? null : dMin} placeholder={formatValue(lo)}
              onCommit={(n) => {
                const min = n == null ? lo : Math.max(lo, n);
                commit(min > dMax ? [min, hi] : [min, dMax]);
              }}
            />
            <NumberBox
              key={`max-${dMax}`} label="Max" value={dMax >= hi ? null : dMax} placeholder="No limit"
              onCommit={(n) => {
                const max = n == null ? hi : n;
                commit(max < dMin ? [lo, max] : [dMin, max]);
              }}
            />
          </div>
          {active && (
            <div className="mk-filter-foot">
              <button type="button" className="mk-link-btn" onClick={() => { setDrag(null); onChange(null, null); }}>Clear</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// A number box that reports on Enter or blur, not per keystroke ("1" on the
// way to "12000" isn't a filter). "$" and commas are forgiven; empty = no limit.
function NumberBox({ label, value, placeholder, onCommit }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const commit = () => {
    const raw = text.replace(/[$,\s]/g, '');
    if (raw === '') { if (value != null) onCommit(null); return; }
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n < 0) { setText(value == null ? '' : String(value)); return; }
    if (n !== value) onCommit(n);
  };
  return (
    <label className="mk-range-field">
      <span>{label}</span>
      <input
        className="mk-input"
        type="text"
        inputMode="numeric"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      />
    </label>
  );
}
