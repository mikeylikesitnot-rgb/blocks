import { useEffect, useRef, useState } from 'react';
import { cx } from './cx.js';
import { Button } from './Button.jsx';
import { Modal } from './Overlay.jsx';
import { XIcon, PaperclipIcon, FileIcon, SpinnerIcon, AlertIcon } from './icons.jsx';

/* ───────── Attachments ─────────
   UI only: the app uploads, stores and serves the files.
     const add = (files) => upload(files);           // your API call
     usePasteFiles(panelRef, add);                   // ⌘V a screenshot anywhere in the panel
     <FileDrop onFiles={add} accept={ACCEPT} maxSize={20e6} onReject={(r) => toast.error(r[0].reason)} />
     <AttachmentGrid items={files} onRemove={remove} />
   Item shape: { id, name, size, mime, url, thumbUrl?, pending?, error?, preview? }.
   preview: false keeps an image the browser can't show (HEIC in Chrome) as a download row. */

/** "1.4 MB", "820 KB", "12 B". */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1000) return `${n} B`;
  if (n < 1e6) return `${Math.round(n / 1000)} KB`;
  return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;
}

export const isImage = (mime) => typeof mime === 'string' && mime.startsWith('image/');

/** Does a file match an accept list like ['image/*', 'application/pdf', '.log']? Empty list = anything. */
export function fileAccepted(file, accept) {
  if (!accept || accept.length === 0) return true;
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  return accept.some((a) => {
    const rule = a.trim().toLowerCase();
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

/** Split files into accepted and rejected ({ file, reason }) by type and size. */
export function checkFiles(files, { accept, maxSize } = {}) {
  const ok = [];
  const rejected = [];
  for (const file of files) {
    if (!fileAccepted(file, accept)) rejected.push({ file, reason: `${file.name || 'That file'}: this file type isn't allowed.` });
    else if (maxSize && file.size > maxSize) rejected.push({ file, reason: `${file.name || 'That file'} is ${formatBytes(file.size)}. The limit is ${formatBytes(maxSize)}.` });
    else ok.push(file);
  }
  return { ok, rejected };
}

/** A pasted screenshot has no useful name ("image.png"); give it a dated one. */
export function nameClipboardFile(file, now = new Date()) {
  if (file.name && file.name !== 'image.png' && file.name !== 'image.jpeg') return file;
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}.${p(now.getMinutes())}.${p(now.getSeconds())}`;
  return new File([file], `Screenshot ${stamp}.${ext}`, { type: file.type, lastModified: now.getTime() });
}

const isEditable = (el) => !!el && (el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'file'].includes(el.type)));

/**
 * Files on a paste event, or [] when the paste should stay text.
 * Pasting into a text field keeps text when the clipboard has any (Word and
 * Excel put a picture of the text on the clipboard too); otherwise files win.
 */
export function filesFromPaste(e) {
  const dt = e.clipboardData;
  if (!dt) return [];
  const files = [];
  for (const item of Array.from(dt.items || [])) {
    if (item.kind === 'file') { const f = item.getAsFile(); if (f) files.push(f); }
  }
  if (!files.length && dt.files?.length) files.push(...Array.from(dt.files));
  if (!files.length) return [];
  const text = dt.getData?.('text/plain') || '';
  if (text.trim() && isEditable(e.target)) return [];
  return files.map((f) => nameClipboardFile(f));
}

/** Calls onFiles with pasted files anywhere inside ref (or the whole page when ref is null). */
export function usePasteFiles(ref, onFiles, { enabled = true } = {}) {
  const cb = useRef(onFiles);
  cb.current = onFiles;
  useEffect(() => {
    if (!enabled) return undefined;
    const target = ref ? ref.current : document;
    if (!target) return undefined;
    const onPaste = (e) => {
      const files = filesFromPaste(e);
      if (!files.length) return;
      e.preventDefault();
      cb.current?.(files);
    };
    target.addEventListener('paste', onPaste);
    return () => target.removeEventListener('paste', onPaste);
  }, [ref, enabled]);
}

/**
 * Drop zone with a pick button. Drag files onto it, or click "Add files".
 * Rejected files (type or size) go to onReject; the rest to onFiles.
 */
export function FileDrop({ onFiles, onReject, accept, maxSize, multiple = true, disabled = false, label = 'Add files', hint, compact = false, className = '' }) {
  const input = useRef(null);
  const depth = useRef(0);
  const [over, setOver] = useState(false);

  const take = (list) => {
    const files = Array.from(list || []);
    if (!files.length || disabled) return;
    const { ok, rejected } = checkFiles(multiple ? files : files.slice(0, 1), { accept, maxSize });
    if (rejected.length) onReject?.(rejected);
    if (ok.length) onFiles?.(ok);
  };
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

  const defaultHint = hint ?? `Drop, paste or pick${maxSize ? ` · up to ${formatBytes(maxSize)} each` : ''}`;
  return (
    <div
      className={cx('mk-drop', over && 'mk-drop-over', compact && 'mk-drop-compact', disabled && 'mk-drop-disabled', className)}
      onDragEnter={(e) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current += 1; setOver(true); }}
      onDragOver={(e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = disabled ? 'none' : 'copy'; }}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
      onDrop={(e) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current = 0; setOver(false); take(e.dataTransfer.files); }}
    >
      <Button variant="secondary" size="sm" icon={PaperclipIcon} disabled={disabled} onClick={() => input.current?.click()}>{label}</Button>
      <span className="mk-drop-hint">{over ? 'Drop to add' : defaultHint}</span>
      <input
        ref={input}
        type="file"
        hidden
        multiple={multiple}
        accept={accept?.join(',')}
        onChange={(e) => { take(e.target.files); e.target.value = ''; }}
        data-testid="mk-file-input"
      />
    </div>
  );
}

/** Full-size image in a modal (bottom sheet on phones). */
export function Lightbox({ open, onClose, src, alt = '', title, footer }) {
  return (
    <Modal open={open} onClose={onClose} title={title || alt || 'Image'} size="full" className="mk-lightbox" footer={footer}>
      {src && <img className="mk-lightbox-img" src={src} alt={alt} />}
    </Modal>
  );
}

/**
 * Images as thumbnails (click → Lightbox), other files as rows that download.
 * onRemove(item) shows a remove button on each; the app confirms.
 */
export function AttachmentGrid({ items = [], onRemove, removeLabel = 'Remove', className = '' }) {
  const [open, setOpen] = useState(null);
  if (!items.length) return null;
  const thumb = (a) => !a.error && (a.preview ?? isImage(a.mime));
  const images = items.filter(thumb);
  const files = items.filter((a) => !thumb(a));
  const shown = open && items.find((a) => a.id === open);

  const remove = (a) => onRemove && !a.pending && (
    <Button variant="ghost" size="xs" icon={XIcon} label={`${removeLabel} ${a.name}`} className="mk-att-remove" onClick={() => onRemove(a)} />
  );

  return (
    <div className={cx('mk-att', className)}>
      {images.length > 0 && (
        <ul className="mk-att-thumbs">
          {images.map((a) => (
            <li key={a.id} className={cx('mk-att-thumb', a.pending && 'mk-att-pending')}>
              <button type="button" className="mk-att-thumb-btn" onClick={() => !a.pending && setOpen(a.id)} aria-label={`Open ${a.name}`} disabled={a.pending}>
                {a.thumbUrl || a.url ? <img src={a.thumbUrl || a.url} alt="" loading="lazy" /> : null}
                {a.pending && <span className="mk-att-spin"><SpinnerIcon className="mk-spin" /></span>}
              </button>
              {remove(a)}
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="mk-att-files">
          {files.map((a) => (
            <li key={a.id} className={cx('mk-att-file', a.pending && 'mk-att-pending', a.error && 'mk-att-error')}>
              <span className="mk-att-file-icon">{a.pending ? <SpinnerIcon className="mk-spin" /> : a.error ? <AlertIcon /> : <FileIcon />}</span>
              {a.url && !a.pending && !a.error
                ? <a className="mk-att-name" href={a.url} download={a.name}>{a.name}</a>
                : <span className="mk-att-name">{a.name}</span>}
              <span className="mk-att-meta">{a.error || formatBytes(a.size)}</span>
              {remove(a)}
            </li>
          ))}
        </ul>
      )}
      <Lightbox
        open={!!shown}
        onClose={() => setOpen(null)}
        src={shown?.url}
        alt={shown?.name}
        footer={shown && <Button variant="secondary" size="sm" href={shown.url} download={shown.name}>Download</Button>}
      />
    </div>
  );
}
