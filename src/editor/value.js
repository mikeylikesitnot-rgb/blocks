/* Helpers for rich-text values. No Tiptap import, so the read-only side
   (RichText, RichTextField's placeholder) can use them without loading the editor.
   Lifted from AutoDealer's src/components/richTextValue.js unchanged. */

/** True when the HTML renders as no visible text: "", null, "<p></p>", "<p>&nbsp;</p>". */
export function isBlankHtml(html) {
  if (!html) return true;
  return String(html).replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim() === '';
}

/** Whether two values mean the same thing, so an outside update that changes nothing never moves the caret. */
export const sameHtml = (a, b) => (a || '') === (b || '') || (isBlankHtml(a) && isBlankHtml(b));

/** Rich text flattened to one line of plain text (change history, previews, exports). */
export function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<\/(p|li|blockquote|ul|ol|h[1-6]|pre)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// NEVER LOOSEN THIS TEST. Servers store tag-less text raw (sanitizeRich plainText 'keep')
// and it is safe only because toRichHtml escapes it by this same test: a wider test
// would turn rows already stored raw into live HTML.
// HTML = starts with a tag, or contains a tag an editor writes. A plain note that
// merely mentions "<tag>" must stay plain text, or its line breaks are lost.
export const HTML_TAG = /<\/?(p|div|span|br|b|i|u|s|strong|em|a|ul|ol|li|blockquote|pre|code|h[1-6]|hr|img|mark|sub|sup|table|tr|td|th)(\s[^>]*)?\/?>/i;
export const looksLikeHtml = (text) => /^\s*<[a-z!]/i.test(text) || HTML_TAG.test(text);

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A stored value as HTML. Columns that held plain text before an app had an editor
 * still have those rows: a value with no tags is escaped, blank lines become
 * paragraphs and single newlines become <br>. Anything with a tag passes through untouched.
 */
export function toRichHtml(value) {
  if (!value) return '';
  const text = String(value);
  if (looksLikeHtml(text)) return text;
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
