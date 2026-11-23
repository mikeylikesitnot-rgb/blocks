import { useLayoutEffect, useRef } from 'react';
import { cx } from '../cx.js';
import { isBlankHtml, toRichHtml } from './value.js';
import { cleanRichNodes } from './clean.js';
import './editor.css';

/**
 * Read-only rendering of a stored rich-text value, styled exactly like the editor's content.
 * No Tiptap import, so showing a note never loads the editor.
 *   <RichText html={row.notes} />
 *   <RichText html={guestPost} clean />        // other people's HTML: cleaned again in the browser
 * The HTML is rendered as-is unless `clean` is set: sanitize it on the server when it is saved
 * (server/richText.js sanitizeRich). `clean` (true, or a tag list) also cleans it here, to
 * RICH_TAGS by default, and builds the nodes with DOM calls instead of innerHTML.
 * Plain-text values get their line breaks kept.
 */
export function RichText({ html, className = '', as: Tag = 'div', clean = false }) {
  const ref = useRef(null);
  const tags = Array.isArray(clean) ? clean : undefined;
  const tagKey = tags ? tags.join(',') : '';
  useLayoutEffect(() => {
    if (!clean || !ref.current) return;
    ref.current.replaceChildren(cleanRichNodes(toRichHtml(html), tags ? { tags } : undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clean ? 1 : 0, tagKey, html, Tag]);
  if (isBlankHtml(html)) return null;
  if (clean) return <Tag ref={ref} className={cx('mk-rte-view', className)} />;
  return <Tag className={cx('mk-rte-view', className)} dangerouslySetInnerHTML={{ __html: toRichHtml(html) }} />;
}

export default RichText;
