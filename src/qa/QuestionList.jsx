import { cx } from '../cx.js';
import { CheckIcon } from '../icons.jsx';
import { EmptyState, SkeletonRows } from '../States.jsx';
import { highlight } from '../highlight.jsx';

/** "just now", "5 min ago", "3 h ago", "2 d ago", then "Nov 3" (or "Nov 3, 2025"). */
export function timeAgo(value, now = new Date()) {
  if (!value) return '';
  const d = new Date(value);
  const s = Math.round((now - d) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  const opts = { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) };
  return d.toLocaleDateString(undefined, opts);
}

/** A date as "3 h ago" with the full date and time as its tooltip. */
export function Ago({ value, prefix = '' }) {
  if (!value) return null;
  return <time dateTime={value} title={new Date(value).toLocaleString()}>{prefix}{timeAgo(value)}</time>;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The board's question rows: votes, answers (green when one is accepted) and
 * views beside the title, excerpt, tags, author and time. Stacks on phones.
 *   <QuestionList items={list.items} onOpen={(q) => go(q.id)} onTag={addTag} query={q} />
 * hrefFor(q) makes each title a real link (open in a new tab); onOpen still handles a plain click.
 */
export function QuestionList({
  items = [], loading = false, error, onRetry, onOpen, onTag, hrefFor, query = '',
  filtered = false, onClearFilters, empty, className = '',
}) {
  if (loading && !items.length) return <SkeletonRows rows={5} cols={3} />;
  if (error && !items.length) return <EmptyState variant="error" body={error.message || String(error)} onRetry={onRetry} />;
  if (!items.length) {
    return filtered
      ? <EmptyState variant="filtered" title="No questions match" onClear={onClearFilters} />
      : empty || <EmptyState title="No questions yet" body="Ask the first one." />;
  }
  return (
    <ul className={cx('mk-qa-list', className)} aria-busy={loading || undefined}>
      {items.map((q) => {
        const href = hrefFor?.(q);
        const open = (e) => {
          if (!onOpen) return;
          if (href && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) return;
          e.preventDefault();
          onOpen(q);
        };
        return (
          <li key={q.id} className="mk-qa-row">
            <div className="mk-qa-stats" aria-label={`${plural(q.score, 'vote', 'votes')}, ${plural(q.answerCount, 'answer', 'answers')}, ${plural(q.views, 'view', 'views')}`}>
              <span className="mk-qa-stat"><b>{q.score}</b> {q.score === 1 || q.score === -1 ? 'vote' : 'votes'}</span>
              <span className={cx('mk-qa-stat', q.answerCount > 0 && 'mk-qa-stat-answered', q.accepted && 'mk-qa-stat-accepted')}>
                {q.accepted && <CheckIcon className="mk-icon" aria-hidden />}
                <b>{q.answerCount}</b> {q.answerCount === 1 ? 'answer' : 'answers'}
              </span>
              <span className="mk-qa-stat mk-qa-stat-views">{plural(q.views, 'view', 'views')}</span>
            </div>
            <div className="mk-qa-row-main">
              <h3 className="mk-qa-row-title">
                <a href={href || '#'} onClick={open}>{highlight(q.title, query)}</a>
                {q.closed && <span className="mk-qa-closed"> [closed]</span>}
              </h3>
              {q.excerpt && <p className="mk-qa-row-excerpt">{highlight(q.excerpt, query)}</p>}
              <div className="mk-qa-row-foot">
                <TagList tags={q.tags} onTag={onTag} />
                <span className="mk-qa-byline">{q.authorName} · <Ago value={q.createdAt} prefix="asked " /></span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Tags as small pills; with onTag each one is a button that filters by it. */
export function TagList({ tags = [], onTag }) {
  if (!tags.length) return null;
  return (
    <ul className="mk-qa-tag-list" aria-label="Tags">
      {tags.map((t) => (
        <li key={t}>
          {onTag
            ? <button type="button" className="mk-qa-tag mk-qa-tag-btn" onClick={() => onTag(t)} title={`Show questions tagged ${t}`}>{t}</button>
            : <span className="mk-qa-tag">{t}</span>}
        </li>
      ))}
    </ul>
  );
}

export default QuestionList;
