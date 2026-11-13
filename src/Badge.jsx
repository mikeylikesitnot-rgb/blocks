import { cx } from './cx.js';

export const TONES = ['neutral', 'info', 'success', 'warning', 'danger', 'accent'];

/* Common status words -> tone. Apps extend it: toneFor(text, { Sold: 'success' }). */
export const STATUS_TONE = {
  active: 'info', new: 'info', 'in progress': 'info', 'in-progress': 'info', open: 'warning',
  pending: 'warning', waiting: 'warning', booked: 'warning', draft: 'neutral',
  completed: 'success', done: 'success', paid: 'success', approved: 'success', on: 'success',
  overdue: 'danger', failed: 'danger', cancelled: 'danger', canceled: 'danger', rejected: 'danger', off: 'danger',
  closed: 'neutral', archived: 'neutral',
};

export function toneFor(text, extra) {
  if (!text) return 'neutral';
  const s = String(text).trim();
  if (extra?.[s]) return extra[s];
  return STATUS_TONE[s.toLowerCase()] || 'neutral';
}

/**
 * Status/label pill. Always text + tint, never colour alone.
 *   <Badge text="Completed" />              tone guessed from the word
 *   <Badge tone="warning" dot>3 overdue</Badge>
 */
export function Badge({ text, children, tone, tones, dot = false, size = 'sm', className = '', title }) {
  const content = children ?? text;
  if (content == null || content === '') return null;
  const t = TONES.includes(tone) ? tone : toneFor(typeof content === 'string' ? content : text, tones);
  return (
    <span title={title} className={cx('mk-badge', `mk-tone-${t}`, size === 'xs' && 'mk-badge-xs', className)}>
      {dot && <span className="mk-badge-dot" aria-hidden />}
      {content}
    </span>
  );
}

export default Badge;
