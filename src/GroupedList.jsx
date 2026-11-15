import { Fragment } from 'react';
import { cx } from './cx.js';
import { highlight } from './highlight.jsx';
import { EmptyState, SkeletonRows } from './States.jsx';

/**
 * A list in groups, each row: ID chip · badge · title + description · small
 * side cells. A header row on desktop; stacked cards on phones. String
 * ids, titles, descriptions and side cells get search matches marked.
 *   <GroupedList query={q} columns={['ID', 'Status', 'Feature', 'Area', 'Live since']}
 *     groups={[{ key: 'kit', title: 'Blocks', note: '3 shown', items: [
 *       { key: 'F-001', id: 'F-001', badge: <Badge tone="success">Live</Badge>,
 *         title: 'Buttons', description: 'One system', links: <a href="…">Spec</a>, aside: ['Components', '2026-11-13'] },
 *     ] }]} />
 * States: `loading` shows skeleton rows, `error` an error with `onRetry`, and
 * `empty` (default: a plain EmptyState) shows when no group has items.
 * Column widths are fixed so every row lines up; set --mk-glist-id-w /
 * --mk-glist-badge-w / --mk-glist-aside-w to change them.
 */
export function GroupedList({ groups = [], columns, query = '', empty, loading = false, error, onRetry, label, className = '' }) {
  const asideCount = Math.max(
    columns ? Math.max(columns.length - 3, 0) : 0,
    ...groups.flatMap((g) => g.items.map((it) => (it.aside || []).length)),
    0,
  );
  const template = `var(--mk-glist-id-w, 96px) var(--mk-glist-badge-w, 112px) minmax(0, 1fr)${asideCount ? ` repeat(${asideCount}, var(--mk-glist-aside-w, 120px))` : ''}`;
  const has = groups.some((g) => g.items.length);
  const hl = (v) => (typeof v === 'string' ? highlight(v, query) : v);
  // Header is visual only; each side cell carries its column name for screen readers.
  const asideName = (i) => columns?.[i + 3];

  let body;
  if (loading) body = <SkeletonRows rows={5} cols={4} />;
  else if (error) body = <EmptyState variant="error" compact body={typeof error === 'string' ? error : undefined} onRetry={onRetry} />;
  else if (!has) body = empty === undefined ? <EmptyState compact /> : empty;

  return (
    <section className={cx('mk-glist', className)} aria-label={label} style={{ '--mk-glist-cols': template }}>
      {has && !loading && !error && columns && (
        <div className="mk-glist-head" aria-hidden>
          {columns.map((c, i) => <div key={i}>{c}</div>)}
        </div>
      )}
      {body ?? groups.map((g) => (
        g.items.length ? (
          <Fragment key={g.key}>
            {g.title != null && (
              <div className="mk-glist-group">
                <h3 className="mk-glist-group-title">{g.title}</h3>
                {g.note != null && <span className="mk-glist-note">{g.note}</span>}
              </div>
            )}
            {g.items.map((it) => (
              <div key={it.key ?? it.id} className="mk-glist-row">
                <div className="mk-glist-id">{hl(it.id)}</div>
                <div className="mk-glist-badge">{it.badge}</div>
                <div className="mk-glist-main">
                  <div className="mk-glist-title">{hl(it.title)}</div>
                  {it.description && <div className="mk-glist-desc">{hl(it.description)}</div>}
                  {it.links && <div className="mk-glist-links">{it.links}</div>}
                </div>
                {Array.from({ length: asideCount }, (_, i) => (
                  <div key={i} className="mk-glist-aside">
                    {asideName(i) && it.aside?.[i] ? <span className="mk-sr-only">{asideName(i)}: </span> : null}
                    {hl(it.aside?.[i] ?? '')}
                  </div>
                ))}
              </div>
            ))}
          </Fragment>
        ) : null
      ))}
    </section>
  );
}
