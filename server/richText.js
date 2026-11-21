/*
 * The one place HTML from a browser becomes HTML an app is willing to store.
 *
 * Notes written in Blocks' editor arrive as markup, and markup from a client is
 * markup an attacker can choose. A stored <script> or <img onerror> would run
 * with the session of whoever reads the note. So: clean on the SERVER, on write
 * (a client-side clean protects nobody; a forged request talks to the API
 * directly), and the tag list below is the whole of what a note may contain.
 * No style, class, id, data-*, event handlers or <img>. Anything not listed is
 * unwrapped (its text survives) or, for script-like tags, dropped with its text.
 *
 * Lifted from AutoDealer's server/lib/richText.js and TuroApp's server/lib/rich-text.js.
 * Needs the optional peer `sanitize-html`.
 */
import sanitizeHtml from 'sanitize-html';
import { isBlankHtml, looksLikeHtml } from '../src/editor/value.js';

export { isBlankHtml as isBlankRich, htmlToText as richToPlain, looksLikeHtml, HTML_TAG } from '../src/editor/value.js';

/** The editor's toolbar with headings, code blocks and rules turned off (AutoDealer's notes). */
export const NOTE_TAGS = Object.freeze(['p', 'br', 'strong', 'em', 'u', 's', 'code', 'ul', 'ol', 'li', 'blockquote', 'a']);

/** Everything the editor can produce, typing shortcuts included ("# " heading, "---" rule, code block). */
export const EDITOR_TAGS = Object.freeze([...NOTE_TAGS, 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr']);

/** Generous for any real note, small enough that a runaway paste can't fill the column. */
export const MAX_RICH_LENGTH = 20000;

/**
 * Cleans editor HTML down to safe tags. null/undefined come back unchanged.
 *   tags       allowed tags (EDITOR_TAGS; pass NOTE_TAGS when the editor disables headings etc.)
 *   plainText  'keep': a value with no tags is stored exactly as typed ("Tom & Jerry",
 *              "Price<a lot"); it must then be shown escaped (RichText/toRichHtml do).
 *              'html' (default): everything goes through the cleaner.
 */
export function sanitizeRich(value, { tags = EDITOR_TAGS, plainText = 'html' } = {}) {
  if (value == null) return value;
  const text = String(value);
  if (plainText === 'keep' && !looksLikeHtml(text)) return text;
  return sanitizeHtml(text, {
    allowedTags: [...tags],
    allowedAttributes: { a: ['href', 'title', 'rel', 'target'] },
    // javascript: and data: are left out on purpose: a data: URL on an <a> is a script the reader clicks.
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    transformTags: {
      // Older rich text (Access, pasted mail) uses <div> per line and <b>/<i>; keep the lines and the bold.
      div: 'p',
      b: 'strong',
      i: 'em',
      // A link out of a signed-in page must not carry that page's window with it.
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
    },
    // Text inside a removed tag is kept, except here, where the "text" is the payload.
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
  }).replace(/<(br|hr) \/>/g, '<$1>'); // the editor writes <br>/<hr>; matching it keeps unchanged notes unchanged
}

/**
 * sanitizeRich for a column where "no note" is NULL: blank in ("", "<p></p>", "&nbsp;") -> null,
 * otherwise cleaned and trimmed. tooLong lets the caller choose its 400.
 * Options as sanitizeRich, plus maxLength (MAX_RICH_LENGTH).
 */
export function cleanRich(value, { maxLength = MAX_RICH_LENGTH, ...opts } = {}) {
  if (value == null || isBlankHtml(value)) return { value: null, tooLong: false };
  const clean = sanitizeRich(value, opts).trim();
  const out = clean === '' || isBlankHtml(clean) ? null : clean;
  return { value: out, tooLong: (out?.length || 0) > maxLength };
}
