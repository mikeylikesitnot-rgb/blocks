/* Tag rules shared by the board's screens and its server (server/qa.js). */

/** Longest tag, in characters. */
export const QA_TAG_MAX = 25;

const TAG = /^[a-z0-9][a-z0-9.+#-]*$/;

/** "C++", "React JS" -> "c++", "react-js"; null when it can't be a tag. */
export function normalizeTag(raw) {
  const t = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!t || t.length > QA_TAG_MAX || !TAG.test(t)) return null;
  return t;
}
