import { Suspense, lazy } from 'react';
import { cx } from '../cx.js';
import './editor.css';

const Editor = lazy(() => import('./RichTextEditor.jsx'));

/**
 * RichTextEditor, loaded on demand: Tiptap (~125KB gzipped) arrives as its own chunk
 * the first time a field renders. Same props as RichTextEditor. Until then it shows a
 * box the editor's size, so nothing below it jumps.
 */
export function RichTextField(props) {
  const { minRows = 4, minHeight, className } = props;
  return (
    <Suspense
      fallback={
        <div className={cx('mk-rte mk-rte-loading', className)} aria-busy="true">
          <div className="mk-rte-toolbar" />
          <div className="mk-rte-body" style={{ '--mk-rte-rows': minRows, minHeight }}><div className="mk-rte-input" /></div>
        </div>
      }
    >
      <Editor {...props} />
    </Suspense>
  );
}

export default RichTextField;
