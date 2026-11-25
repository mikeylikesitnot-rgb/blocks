/*
 * Contact-form spam checks: bots (honeypot, filled too fast, no timing value)
 * and content (fake 555 phone, off-site link, sales pitch). Pure functions,
 * no I/O beyond reading the phrase list once: the app decides what to do with
 * a hit (keep it as spam, skip the alert, show a "please fix" page).
 *
 * The phrase groups live in spamPhrases.json so a PHP site (Munger) can read
 * the same list; patterns there are written to work in both PCRE and JS.
 */
import phrases from './spamPhrases.json' with { type: 'json' };

export const SPAM_PHRASES = phrases;

const compile = (list) => Object.fromEntries(Object.entries(list.groups).map(([name, g]) => [name, [
  ...(g.ci || []).map((p) => new RegExp(p, 'iu')),
  ...(g.cs || []).map((p) => new RegExp(p, 'u')),
]]));

const COMPILED = compile(SPAM_PHRASES);

/** Reasons a human might have caused (worth a "please fix it" or a Not spam button), vs. pure bot signals. */
export const SPAM_MAYBE_HUMAN = ['no-timing', 'fake-phone', 'link', 'sales-pitch'];

/** The phrase groups `text` hits, in list order. */
export function pitchGroups(text, { phrases } = {}) {
  const s = String(text || '');
  if (!s.trim()) return [];
  const groups = phrases ? compile(phrases) : COMPILED;
  return Object.keys(groups).filter((name) => groups[name].some((re) => re.test(s)));
}

/** A sales pitch: at least minGroups different groups, at least one of them strong. */
export function isSalesPitch(text, { phrases = SPAM_PHRASES } = {}) {
  const hit = pitchGroups(text, phrases === SPAM_PHRASES ? {} : { phrases });
  return hit.length >= (phrases.minGroups || 2) && hit.some((g) => phrases.strong.includes(g));
}

/** A US number in the fictional 555-0100..0199 range, any format. */
export function isFakePhone(phone) {
  let digits = String(phone || '').replace(/\D+/g, '');
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
  if (digits.length === 10) digits = digits.slice(3);
  return /^55501\d\d$/.test(digits);
}

const LINK = /https?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+|\[url|<a\s/giu;

/**
 * A link in the text. `allowHosts` (e.g. ['example.com']) lets links to the
 * site itself through, subdomains included: a shopper pasting the page they mean.
 */
export function hasLink(text, { allowHosts = [] } = {}) {
  const s = String(text || '');
  const allow = allowHosts.map((h) => String(h).toLowerCase().replace(/^www\./, ''));
  for (const m of s.matchAll(LINK)) {
    // Sentence punctuation after a link ("…nextgencarstrucks.com.") is not
    // part of its host.
    const raw = m[0].replace(/[.,;:!?)\]}'"…]+$/u, '');
    if (raw === '[url' || /^<a\s/i.test(raw)) return true;
    let host = '';
    try { host = new URL(/^https?:/i.test(raw) ? raw : `http://${raw}`).hostname.toLowerCase().replace(/^www\./, ''); } catch { return true; }
    if (!allow.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  }
  return false;
}

/**
 * Bot signals from the form itself: 'honeypot' (the hidden field was filled),
 * 'no-timing' (no time-to-fill value: posted without the page's script),
 * 'too-fast' (under minMs), or null.
 */
export function botReason({ honeypot, elapsedMs } = {}, { minMs = 3000 } = {}) {
  if (honeypot != null && String(honeypot).trim() !== '') return 'honeypot';
  const n = typeof elapsedMs === 'number' ? elapsedMs : /^\d{1,12}$/.test(String(elapsedMs ?? '')) ? Number(elapsedMs) : NaN;
  if (!Number.isFinite(n)) return 'no-timing';
  if (n < minMs) return 'too-fast';
  return null;
}

/** Content signals: 'fake-phone', 'link', 'sales-pitch' or null. */
export function contentReason({ name, phone, message } = {}, { allowHosts = [], phrases } = {}) {
  if (isFakePhone(phone)) return 'fake-phone';
  if (hasLink(`${name || ''} ${message || ''}`, { allowHosts })) return 'link';
  if (isSalesPitch(message, phrases ? { phrases } : {})) return 'sales-pitch';
  return null;
}

/**
 * Every check in order (bot first). Returns {reason, groups} or null; groups
 * are the phrase groups the message hit, for showing why.
 */
export function spamCheck(fields = {}, opts = {}) {
  const reason = botReason(fields, opts) || contentReason(fields, opts);
  if (!reason) return null;
  return { reason, groups: pitchGroups(fields.message, opts.phrases ? { phrases: opts.phrases } : {}) };
}
