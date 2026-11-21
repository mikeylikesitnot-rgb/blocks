import { useEffect, useState } from 'react';
import { AlertIcon, CheckIcon, SpinnerIcon } from './icons.jsx';
import { cx } from './cx.js';

/* "Saving…", "Saved just now · Undo", "Unsaved", "Couldn't save · Retry" and "Revert all"
   for a form saved by useAutosave. Pass the hook's return value as `autosave`. */
function ago(t, now) {
  const s = Math.round((now - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function SaveStatus({ autosave, idleText = 'Changes save automatically', revert = true, className }) {
  const { status, savedAt, error, dirty, canUndo, canRevert, undo, revertAll, flush } = autosave;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!savedAt) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [savedAt]);

  let body;
  if (status === 'error') {
    body = (
      <span className="mk-save-error" role="alert">
        <AlertIcon />
        <span title={error || undefined}>Couldn’t save</span>
        <span aria-hidden>·</span>
        <button type="button" className="mk-link-btn" onClick={() => flush()}>Retry</button>
      </span>
    );
  } else if (status === 'saving') {
    body = <span><SpinnerIcon className="mk-spin" />Saving…</span>;
  } else if (dirty) {
    body = <span><span className="mk-save-dot" aria-hidden />Unsaved</span>;
  } else if (savedAt) {
    body = (
      <span>
        <CheckIcon className="mk-save-ok" />
        Saved {ago(savedAt, now)}
        {canUndo && <><span aria-hidden>·</span><button type="button" className="mk-link-btn" onClick={() => undo()} title="Undo (⌘Z)">Undo</button></>}
      </span>
    );
  } else {
    body = idleText ? <span>{idleText}</span> : null;
  }

  return (
    <div className={cx('mk-save-status', className)}>
      <span aria-live="polite">{body}</span>
      {revert && canRevert && status !== 'saving' && (
        <>
          <span aria-hidden>·</span>
          <button type="button" className="mk-link-btn" onClick={() => revertAll()} title="Put back every field as it was when you opened this">Revert all</button>
        </>
      )}
    </div>
  );
}
