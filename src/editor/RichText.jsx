import { cx } from '../cx.js';
import { isBlankHtml, toRichHtml } from './value.js';
import './editor.css';

/**
 * Read-only rendering of a stored rich-text value, styled exactly like the editor's content.
 * No Tiptap import, so showing a note never loads the editor.
 *   <RichText html={row.notes} />
 * The HTML is rendered as-is: sanitize it on the server when it is saved (AutoDealer's
 * server/lib/richText.js is the model). Plain-text values get their line breaks kept.
 */
export function RichText({ html, className = '', as: Tag = 'div' }) {
  if (isBlankHtml(html)) return null;
  return <Tag className={cx('mk-rte-view', className)} dangerouslySetInnerHTML={{ __html: toRichHtml(html) }} />;
}

export default RichText;
