/**
 * "just now", "5 min ago", "3 h ago", "2 d ago", then "Nov 3" (or "Nov 3, 2025").
 * `now` is a Date or ms. `maxDays` (default 7) is how many days count as
 * "N d ago" before it switches to the date; Infinity never switches.
 * Empty or unreadable values give ''; a time a little in the future reads "just now".
 */
export function timeAgo(value, now = new Date(), { maxDays = 7 } = {}) {
  if (value == null || value === '') return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const nowDate = new Date(now);
  const s = Math.round((nowDate - d) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < maxDays * 86400) return `${Math.floor(s / 86400)} d ago`;
  const opts = { month: 'short', day: 'numeric', ...(d.getFullYear() !== nowDate.getFullYear() ? { year: 'numeric' } : {}) };
  return d.toLocaleDateString(undefined, opts);
}

/** A date as "3 h ago" with the full date and time as its tooltip. */
export function Ago({ value, prefix = '', maxDays, className }) {
  if (value == null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return (
    <time dateTime={d.toISOString()} title={d.toLocaleString()} className={className}>
      {prefix}{timeAgo(d, new Date(), maxDays == null ? undefined : { maxDays })}
    </time>
  );
}
