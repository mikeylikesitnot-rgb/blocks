const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Marks every typed word inside `text` (case-insensitive) for search results.
 * Returns the plain string when nothing matches, so it is safe everywhere.
 *   <td>{highlight(row.name, q)}</td>
 */
export function highlight(text, query) {
  if (text == null || text === '') return text;
  const s = String(text);
  const words = String(query || '').trim().split(/\s+/).filter(Boolean)
    .sort((a, b) => b.length - a.length); // longest first so "invoice" beats "in"
  if (!words.length) return s;
  const re = new RegExp(`(${words.map(escapeRe).join('|')})`, 'gi');
  const parts = s.split(re);
  if (parts.length === 1) return s;
  return parts.map((p, i) => (i % 2 ? <mark key={i} className="mk-mark">{p}</mark> : p));
}
