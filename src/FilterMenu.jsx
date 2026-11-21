import { useEffect, useId, useRef, useState } from 'react';
import { cx } from './cx.js';
import { ChevronDownIcon } from './icons.jsx';

/** What the closed button says: "All makes", "Honda, Toyota", "Make: 3 selected". */
export function filterSummary(label, options, value, allLabel) {
  if (!value.length) return allLabel || label;
  if (value.length <= 2) {
    return value.map((v) => options.find((o) => o.value === v)?.label ?? v).join(', ');
  }
  return `${label}: ${value.length} selected`;
}

/**
 * Checklist dropdown for category filters. Nothing ticked = no filter.
 * Stays open while boxes are ticked; closes on outside click or Esc.
 *   <FilterMenu label="Status" allLabel="All statuses" value={status} onChange={setStatus}
 *     options={[{ value: 'live', label: 'Live', count: 12 }]} />
 * Rows pass when they match ANY ticked value; separate menus combine with AND.
 * Pair with useUrlList() so the choice survives a reload, and a
 * "Reset filters" button that clears every menu and the saved copy.
 * `search` puts a search box at the top of the open menu (matches labels,
 * any case; Enter ticks the only match): true, or a number = only when there
 * are more options than that. `searchPlaceholder` defaults to "Search".
 */
export function FilterMenu({ label, allLabel, options = [], value = [], onChange, className = '', align = 'start', search = false, searchPlaceholder = 'Search' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef(null);
  const btn = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) { setQuery(''); return undefined; }
    const onDown = (e) => { if (!root.current?.contains(e.target)) setOpen(false); };
    // Capture phase, and marked handled: a Modal around the menu listens on document
    // too and would otherwise close along with the menu.
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const toggle = (v) => {
    const next = value.includes(v) ? value.filter((x) => x !== v) : [...value, v];
    // Keep the options' order so the URL and summary are stable.
    onChange(options.map((o) => o.value).filter((x) => next.includes(x)).concat(next.filter((x) => !options.some((o) => o.value === x))));
  };
  const active = value.length > 0;
  const showSearch = options.length > 0 && (search === true || (typeof search === 'number' && options.length > search));
  const q = query.trim().toLowerCase();
  const shown = showSearch && q ? options.filter((o) => String(o.label ?? o.value).toLowerCase().includes(q)) : options;

  return (
    <div ref={root} className={cx('mk-filter', className)}>
      <button
        ref={btn}
        type="button"
        className={cx('mk-filter-btn', active && 'mk-filter-btn-active')}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={active && value.length <= 2 ? `${label}: ${filterSummary(label, options, value, allLabel)}` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="mk-filter-text">{filterSummary(label, options, value, allLabel)}</span>
        <ChevronDownIcon className="mk-filter-chevron" />
      </button>
      {open && (
        <div id={menuId} className={cx('mk-filter-menu', align === 'end' && 'mk-filter-menu-end')} role="group" aria-label={label}>
          {showSearch && (
            <input
              type="search"
              className="mk-filter-search"
              placeholder={searchPlaceholder}
              aria-label={`Search ${label}`}
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (q && shown.length === 1) toggle(shown[0].value); } }}
            />
          )}
          {options.length === 0 ? (
            <p className="mk-filter-none">Nothing to filter yet</p>
          ) : shown.length === 0 ? (
            <p className="mk-filter-none">No matches</p>
          ) : (
            shown.map((o) => (
              <label key={o.value} className="mk-filter-option">
                <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
                <span className="mk-filter-option-label">{o.label}</span>
                {o.count != null && <span className="mk-filter-option-count mk-tabular">{o.count}</span>}
              </label>
            ))
          )}
          {active && (
            <div className="mk-filter-foot">
              <button type="button" className="mk-link-btn" onClick={() => onChange([])}>Clear</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
