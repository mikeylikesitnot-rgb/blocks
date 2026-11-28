import { useEffect } from 'react';

/** Status words an app can pass; anything else is used as the prefix as-is. */
export const TITLE_STATUS = {
  busy: '⏳',      // building, running, syncing
  attention: '⚠', // failed, needs input, blocked
  done: '✓',       // ready to try, finished
  new: '●',        // something new to look at
};

const clip = (s, max) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/**
 * Tab title, most useful words first so the tab stays readable when Chrome
 * cuts it short: "⏳ ImageViewer · IV-015 Fixed-ratio… · Hub".
 *   pageTitle(['ImageViewer', 'IV-015 Fixed-ratio and exact-size selection'], { app: 'Hub', status: 'busy' })
 * parts: strings (falsy and blank skipped, whitespace squashed, each cut to `max`).
 * app: short app name added last. status: a TITLE_STATUS key or any symbol.
 */
export function pageTitle(parts, { app, status, sep = ' · ', max = 40 } = {}) {
  const list = (Array.isArray(parts) ? parts : [parts])
    .map((p) => (p == null || p === false ? '' : String(p).replace(/\s+/g, ' ').trim()))
    .filter(Boolean)
    .map((p) => clip(p, max));
  if (app) list.push(String(app));
  const mark = status ? (TITLE_STATUS[status] ?? String(status)) : '';
  const text = list.join(sep);
  return mark ? `${mark} ${text}` : text;
}

/**
 * Sets document.title from pageTitle() while the component is mounted and puts
 * the previous title back when it unmounts. The deepest page wins (its effect
 * runs last), so call it once per screen with that screen's parts.
 *   usePageTitle([project?.name, story && `${story.id} ${story.title}`], { app: 'Hub', status: building ? 'busy' : null });
 */
export function usePageTitle(parts, opts = {}) {
  const title = pageTitle(parts, opts);
  useEffect(() => {
    if (typeof document === 'undefined' || !title) return undefined;
    const before = document.title;
    document.title = title;
    return () => { if (document.title === title) document.title = before; };
  }, [title]);
  return title;
}
