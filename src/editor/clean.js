/* Browser-side cleaning for rich text, and a Trusted Types default policy built on it.
   No dependency: an allow-list walk over a parsed, inert document (DOMParser runs no
   scripts and loads no images). It mirrors server/richText.js sanitizeRich, so the
   server stays the real gate; this is the second lock for pages that show other
   people's HTML (QaBoard), and what makes `require-trusted-types-for 'script'` usable.

   CSP note: if the page's CSP lists policy names (`trusted-types ...`), include
   `default` and `mk-rich-parse`. Leaving the names list out works too. */

/** Same list as server/richText.js EDITOR_TAGS (a test keeps them equal). */
export const RICH_TAGS = Object.freeze(['p', 'br', 'strong', 'em', 'u', 's', 'code', 'ul', 'ol', 'li', 'blockquote', 'a', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr']);

/** Script URL Blocks itself loads (Google sign-in in auth.jsx). */
export const GOOGLE_GSI_URL = 'https://accounts.google.com/gsi/client';

// Dropped with their text: the "text" is the payload, or never meant to show.
const DROP = new Set(['script', 'style', 'textarea', 'option', 'noscript', 'template', 'iframe', 'object', 'embed', 'svg', 'math', 'title', 'head', 'select']);
const RENAME = { div: 'p', b: 'strong', i: 'em' };
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

let parsePolicy = null;
function parse(html) {
  const tt = typeof window !== 'undefined' ? window.trustedTypes : undefined;
  // Module-private: parsing into an inert document is the one raw-HTML sink this file uses.
  if (tt && !parsePolicy) parsePolicy = tt.createPolicy('mk-rich-parse', { createHTML: (s) => s });
  return new DOMParser().parseFromString(parsePolicy ? parsePolicy.createHTML(html) : html, 'text/html');
}

/** An href worth keeping: relative, or one of the safe schemes. Control characters and spaces are
    stripped first, as browsers do ("java\tscript:" is javascript:). */
export function safeHref(href) {
  if (href == null) return null;
  const squashed = String(href).replace(/[\u0000- \u007f]/g, '');
  if (!squashed) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(squashed);
  if (scheme && !SAFE_SCHEMES.has(scheme[1].toLowerCase() + ':')) return null;
  return String(href).trim();
}

function copy(from, to, allowed, doc) {
  for (const n of Array.from(from.childNodes)) {
    if (n.nodeType === 3) { to.appendChild(doc.createTextNode(n.data)); continue; }
    if (n.nodeType !== 1) continue; // comments, processing instructions
    const name = n.localName;
    if (DROP.has(name)) continue;
    const tag = RENAME[name] || name;
    if (!allowed.has(tag)) { copy(n, to, allowed, doc); continue; } // unwrap, keep the text
    const el = doc.createElement(tag);
    if (tag === 'a') {
      const href = safeHref(n.getAttribute('href'));
      if (href) el.setAttribute('href', href);
      const title = n.getAttribute('title');
      if (title) el.setAttribute('title', title);
      el.setAttribute('rel', 'noopener noreferrer');
      el.setAttribute('target', '_blank');
    }
    copy(n, el, allowed, doc);
    to.appendChild(el);
  }
}

/** HTML cleaned to `tags`, as DOM nodes in this document (no innerHTML needed to show them). */
export function cleanRichNodes(html, { tags = RICH_TAGS } = {}) {
  const frag = document.createDocumentFragment();
  if (html == null || html === '') return frag;
  copy(parse(String(html)).body, frag, new Set(tags), document);
  return frag;
}

/** HTML cleaned to `tags`, as a string. */
export function cleanRichHtml(html, opts) {
  const box = document.createElement('div');
  box.appendChild(cleanRichNodes(html, opts));
  return box.innerHTML;
}

/**
 * Creates the Trusted Types `default` policy, so a page can send
 * `Content-Security-Policy: require-trusted-types-for 'script'`: every string that reaches an
 * HTML sink (innerHTML, the editor's paste and load) is cleaned to `tags`; script URLs must be
 * same-origin or listed; string-to-code sinks (eval, setTimeout("...")) stay blocked.
 * Call once, before rendering. Returns the policy, or null where Trusted Types isn't supported.
 *   installRichTrustedTypes();
 */
export function installRichTrustedTypes({ tags = RICH_TAGS, scriptUrls = [GOOGLE_GSI_URL] } = {}) {
  const tt = typeof window !== 'undefined' ? window.trustedTypes : undefined;
  if (!tt) return null;
  if (tt.defaultPolicy) return tt.defaultPolicy;
  return tt.createPolicy('default', {
    createHTML: (s) => cleanRichHtml(s, { tags }),
    createScriptURL: (u) => {
      const url = new URL(String(u), window.location.href);
      if (url.origin === window.location.origin || scriptUrls.includes(url.href)) return String(u);
      throw new TypeError(`Blocked script URL: ${url.href}`);
    },
  });
}
