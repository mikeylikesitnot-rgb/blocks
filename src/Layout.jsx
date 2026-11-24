import { cx } from './cx.js';
import { useCountUp } from './motion.js';

/**
 * Top of every page. Title left, actions right; stacks on phones.
 *   <PageHeader title="Trips" subtitle="1,370 trips" actions={<Button>New</Button>} />
 */
export function PageHeader({ title, subtitle, actions, meta, children, className = '' }) {
  return (
    <header className={cx('mk-page-header', className)}>
      <div className="mk-page-header-row">
        <div style={{ minWidth: 0 }}>
          <div className="mk-page-title-row">
            <h1 className="mk-page-title">{title}</h1>
            {meta}
          </div>
          {subtitle && <p className="mk-page-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="mk-actions">{actions}</div>}
      </div>
      {children && <div className="mk-page-header-extra">{children}</div>}
    </header>
  );
}

/**
 * Surface with an optional title bar. Border only, no shadow.
 *   <Panel title="Revenue" actions={…}>…</Panel>
 *   <Panel flush>…edge-to-edge table…</Panel>
 */
export function Panel({ title, subtitle, actions, children, flush = false, className = '', bodyClassName = '', as: Tag = 'section', ...rest }) {
  return (
    <Tag className={cx('mk-panel', className)} {...rest}>
      {(title || actions) && (
        <div className="mk-panel-head">
          <div style={{ minWidth: 0 }}>
            {title && <h2 className="mk-panel-title">{title}</h2>}
            {subtitle && <p className="mk-panel-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="mk-actions">{actions}</div>}
        </div>
      )}
      <div className={cx(!flush && 'mk-panel-body', bodyClassName)}>{children}</div>
    </Tag>
  );
}

/**
 * KPI tile: label, big number, comparison.
 *   <StatCard label="Net, May" value="$5,916" delta={-12.4} deltaLabel="vs last year" />
 * `invert` when down is good (costs). Clickable when given onClick.
 * `note` is a short visible line saying how the number is defined (works on
 * phones, unlike a tooltip); `title` holds the longer explanation for mouse users.
 * `count` (a number) instead of `value` ticks to each new figure instead of
 * jumping; `format` turns it into text (default: rounded, with thousands commas).
 *   <StatCard label="Revenue" count={48210} format={(n) => money(n)} />
 */
const defaultCountFormat = (n) => Math.round(n).toLocaleString();
export function StatCard({ label, value, count, format = defaultCountFormat, sub, note, title, delta, deltaSuffix = '%', deltaLabel, invert = false, onClick, className = '' }) {
  const hasDelta = typeof delta === 'number' && Number.isFinite(delta);
  const good = hasDelta && (invert ? delta < 0 : delta > 0);
  const bad = hasDelta && (invert ? delta > 0 : delta < 0);
  const Tag = onClick ? 'button' : 'div';
  const counting = typeof count === 'number' && Number.isFinite(count);
  const shown = useCountUp(counting ? count : NaN);
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} title={title} className={cx('mk-stat', className)}>
      <p className="mk-eyebrow mk-eyebrow-trunc">{label}</p>
      <p className="mk-stat-value mk-tabular">{counting ? format(Number.isFinite(shown) ? shown : count) : value}</p>
      {(hasDelta || sub) && (
        <p className="mk-stat-foot">
          {hasDelta && (
            <span className={cx('mk-delta mk-tabular', good && 'mk-delta-good', bad && 'mk-delta-bad')}>
              {delta > 0 ? '▲' : delta < 0 ? '▼' : ''} {Math.abs(delta).toLocaleString(undefined, { maximumFractionDigits: 1 })}{deltaSuffix}
            </span>
          )}
          {hasDelta && deltaLabel && <span>{deltaLabel}</span>}
          {sub && <span>{hasDelta ? `· ${sub}` : sub}</span>}
        </p>
      )}
      {note && <p className="mk-stat-note">{note}</p>}
    </Tag>
  );
}

/** 2 columns on phones, `cols` on desktop. */
export function StatGrid({ children, cols = 4, className = '' }) {
  return <div className={cx('mk-stat-grid', className)} style={{ '--mk-cols': cols }}>{children}</div>;
}

/**
 * Underline tabs; scroll sideways on phones instead of wrapping.
 *   <Tabs value={tab} onChange={setTab} items={[{ value: 'a', label: 'All', count: 3 }]} />
 * Keyboard: one Tab stop (the selected tab); ← / → move and select, Home / End jump.
 */
export function Tabs({ items, value, onChange, className = '', label }) {
  const selected = items.findIndex((it) => it.value === value);
  const stop = selected >= 0 ? selected : 0;
  const onKeyDown = (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    let next = null;
    if (step) next = (stop + step + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next == null) return;
    e.preventDefault();
    onChange(items[next].value);
    e.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus();
  };
  return (
    <div className={cx('mk-tabs', className)}>
      <div role="tablist" aria-label={label} className="mk-tablist" onKeyDown={onKeyDown}>
        {items.map((it, i) => (
          <button
            key={it.value}
            role="tab"
            type="button"
            className="mk-tab"
            aria-selected={it.value === value}
            tabIndex={i === stop ? 0 : -1}
            onClick={() => onChange(it.value)}
          >
            {it.icon && <it.icon className="mk-icon" aria-hidden />}
            {it.label}
            {it.count != null && <span className="mk-count mk-tabular">{it.count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Few-option toggle, e.g. List / Board. */
export function Segmented({ items, value, onChange, className = '', label }) {
  return (
    <div className={cx('mk-segmented', className)} role="group" aria-label={label}>
      {items.map((it) => (
        <button key={it.value} type="button" className="mk-seg-btn" aria-pressed={it.value === value} onClick={() => onChange(it.value)}>
          {it.icon && <it.icon className="mk-icon" aria-hidden />}
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Filter row: wraps; `right` slot (counts, totals) pushed right. */
export function Toolbar({ children, right, className = '' }) {
  return (
    <div className={cx('mk-toolbar', className)}>
      {children}
      {right && <div className="mk-toolbar-right">{right}</div>}
    </div>
  );
}
