import { cx } from './cx.js';

/**
 * A nav row's count. `note` explains it ("3 waiting over 2 hours"): a tooltip
 * on the count, and read out after it by screen readers. Shared with NavMenu.
 */
export function NavCount({ it }) {
  if (it.count == null || it.count === '') return null;
  return (
    <span className={cx('mk-nav-count mk-tabular', it.hot && 'mk-nav-count-hot')} title={it.note || undefined}>
      {it.count}
      {it.note && <span className="mk-sr-only"> ({it.note})</span>}
    </span>
  );
}
