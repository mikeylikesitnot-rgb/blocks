import { cx } from './cx.js';
import { Button } from './Button.jsx';
import { InboxIcon, SearchXIcon, AlertIcon } from './icons.jsx';

/**
 * Empty / no-results / error. Pick the variant that matches why it's empty.
 *   <EmptyState title="No trips yet" body="Import an export to start." action={<Button>Import</Button>} />
 *   <EmptyState variant="filtered" onClear={clear} />
 *   <EmptyState variant="error" body={err.message} onRetry={load} />
 */
export function EmptyState({ variant = 'empty', icon, title, body, action, onClear, onRetry, compact = false, className = '' }) {
  const Icon = icon || (variant === 'filtered' ? SearchXIcon : variant === 'error' ? AlertIcon : InboxIcon);
  const t = title || (variant === 'filtered' ? 'Nothing matches these filters' : variant === 'error' ? 'Couldn’t load this' : 'Nothing here yet');
  return (
    <div className={cx('mk-empty', compact && 'mk-empty-compact', variant === 'error' && 'mk-empty-error', className)} role={variant === 'error' ? 'alert' : undefined}>
      <div className="mk-empty-icon"><Icon className="mk-icon" aria-hidden /></div>
      <p className="mk-empty-title">{t}</p>
      {body && <p className="mk-empty-body">{body}</p>}
      <div className="mk-empty-actions">
        {variant === 'filtered' && onClear && <Button variant="secondary" size="sm" onClick={onClear}>Clear filters</Button>}
        {variant === 'error' && onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
        {action}
      </div>
    </div>
  );
}

/** Grey placeholder block. Size it with style or a class. */
export function Skeleton({ className = '', style }) {
  return <div className={cx('mk-skeleton', className)} style={{ height: 14, ...style }} aria-hidden />;
}

/** Table-shaped skeleton so the layout doesn't jump when rows arrive. */
export function SkeletonRows({ rows = 6, cols = 5 }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="mk-skel-row">
          {Array.from({ length: cols }, (__, c) => (
            <Skeleton key={c} style={c === 0 ? { width: '25%' } : { flex: 1 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Stat tile skeletons, same grid as StatGrid. */
export function SkeletonStats({ count = 4 }) {
  return (
    <div className="mk-stat-grid" style={{ '--mk-cols': count }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="mk-stat">
          <Skeleton style={{ height: 12, width: 80 }} />
          <Skeleton style={{ height: 28, width: 112, marginTop: 12 }} />
          <Skeleton style={{ height: 12, width: 96, marginTop: 8 }} />
        </div>
      ))}
    </div>
  );
}

/**
 * Inline banner. Defaults to an error for a failed load that leaves stale
 * content visible; `tone` makes it an info/success/warning note.
 *   <Banner onRetry={load}>Couldn’t refresh. Showing data from 2 min ago.</Banner>
 */
export function Banner({ children, tone = 'danger', onRetry, className = '' }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('mk-banner', `mk-tone-${tone}`, className)}>
      <AlertIcon />
      <div className="mk-banner-body">{children}</div>
      {onRetry && <button type="button" className="mk-link-btn" onClick={onRetry}>Retry</button>}
    </div>
  );
}

/** TuroApp name, kept so ported code works unchanged. */
export const ErrorBanner = Banner;
