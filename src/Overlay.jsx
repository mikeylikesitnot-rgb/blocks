import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx.js';
import { Button } from './Button.jsx';
import { XIcon, CheckCircleIcon, AlertIcon, InfoIcon } from './icons.jsx';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open modals, oldest first. Only the last one answers Esc and traps Tab, so a
// modal opened over another (e.g. "Edit options…" over an edit form) closes alone.
const openModals = [];

// Page scroll is locked while any modal is open. A count, not a saved value per modal,
// so stacked modals closed in any order never leave the page stuck.
let scrollLocks = 0;
let savedOverflow = '';
function lockScroll() {
  if (scrollLocks++ === 0) { savedOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
}
function unlockScroll() {
  if (scrollLocks > 0 && --scrollLocks === 0) document.body.style.overflow = savedOverflow;
}

/**
 * Centered dialog on desktop, bottom sheet on phones. Esc and backdrop
 * close it; focus is trapped inside and returned to the trigger. With modals
 * stacked, Esc closes only the top one.
 *   <Modal open={open} onClose={close} title="Edit task" footer={<>…buttons…</>}>…</Modal>
 */
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', className = '' }) {
  const panel = useRef(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const lastFocus = document.activeElement;
    lockScroll();
    const t = setTimeout(() => {
      const el = panel.current?.querySelector('[autofocus], [data-autofocus], input:not([type=hidden]), textarea, select, button:not([data-close])');
      (el || panel.current)?.focus();
    }, 0);
    const me = {};
    openModals.push(me);
    const onKey = (e) => {
      if (openModals[openModals.length - 1] !== me) return;
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return; // already handled (another modal, a menu)
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current?.();
      }
      if (e.key === 'Tab' && panel.current) {
        const f = panel.current.querySelectorAll(FOCUSABLE);
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      const i = openModals.indexOf(me);
      if (i >= 0) openModals.splice(i, 1);
      document.removeEventListener('keydown', onKey);
      unlockScroll();
      lastFocus?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="mk-modal-root">
      <div className="mk-modal-backdrop" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cx('mk-modal', `mk-modal-${size}`, className)}
      >
        {(title || onClose) && (
          <div className="mk-modal-head">
            <div style={{ minWidth: 0 }}>
              {title && <h2 id={titleId} className="mk-modal-title">{title}</h2>}
              {subtitle && <p className="mk-modal-subtitle">{subtitle}</p>}
            </div>
            {onClose && <Button data-close variant="ghost" size="sm" icon={XIcon} label="Close" onClick={onClose} className="mk-modal-close" />}
          </div>
        )}
        <div className="mk-modal-body">{children}</div>
        {footer && <div className="mk-modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ───────── Confirm, alert and toast ─────────
   Replaces window.confirm / window.alert. Wrap the app once:
     <OverlayProvider><App /></OverlayProvider>
   then:
     const confirm = useConfirm();
     if (!(await confirm({ title: 'Delete task?', body: '…', confirmLabel: 'Delete', danger: true }))) return;
     const toast = useToast();  toast('Saved');  toast.error('Couldn’t save');   */
const Ctx = createContext(null);
const TOAST_ICON = { success: CheckCircleIcon, error: AlertIcon, info: InfoIcon };

export function OverlayProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const [toasts, setToasts] = useState([]);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    setDialog({ ...(typeof opts === 'string' ? { title: opts } : opts), resolve });
  }), []);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((message, tone, ms) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone, ms }]);
  }, []);

  const value = useMemo(() => ({
    confirm,
    toast: Object.assign((m, ms = 3500) => push(m, 'success', ms), {
      success: (m, ms = 3500) => push(m, 'success', ms),
      error: (m, ms = 6000) => push(m, 'error', ms),
      info: (m, ms = 3500) => push(m, 'info', ms),
    }),
  }), [confirm, push]);

  const close = (v) => { dialog?.resolve(v); setDialog(null); };

  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal
        open={!!dialog}
        onClose={() => close(false)}
        title={dialog?.title}
        size="sm"
        footer={dialog && (
          <>
            {!dialog.alert && <Button variant="secondary" onClick={() => close(false)}>{dialog.cancelLabel || 'Cancel'}</Button>}
            <Button variant={dialog.danger ? 'danger' : 'primary'} onClick={() => close(true)} data-autofocus>
              {dialog.confirmLabel || (dialog.alert ? 'OK' : 'Confirm')}
            </Button>
          </>
        )}
      >
        {dialog?.body && <div className="mk-confirm-body">{dialog.body}</div>}
      </Modal>
      {createPortal(
        // One always-mounted live region; the toasts inside carry no role of their own,
        // so each is announced once.
        <div className="mk-toasts" role="status" aria-live="polite">
          {toasts.map((t) => <Toast key={t.id} toast={t} onDismiss={dismiss} />)}
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  );
}

/** Promise-based confirm. Falls back to window.confirm outside the provider. */
export function useConfirm() {
  const c = useContext(Ctx);
  return c ? c.confirm : async (o) => window.confirm(typeof o === 'string' ? o : `${o.title}${o.body ? `\n\n${o.body}` : ''}`);
}

/** Alert replacement: await alert({ title, body }). */
export function useAlert() {
  const c = useContext(Ctx);
  return c
    ? (o) => c.confirm({ ...(typeof o === 'string' ? { title: o } : o), alert: true })
    : async (o) => window.alert(typeof o === 'string' ? o : o.title);
}

/** toast('Saved'), toast.error('…'), toast.info('…'). */
export function useToast() {
  const c = useContext(Ctx);
  return c ? c.toast : Object.assign((m) => console.info(m), { success: console.info, error: console.error, info: console.info });
}

/* One toast. Leaves after `ms`, but the clock stops while the pointer is over it or
   focus is inside it (reading it, reaching for Undo), and its × closes it at once. */
function Toast({ toast, onDismiss }) {
  const { id, message, tone, ms } = toast;
  const [paused, setPaused] = useState(false);
  const left = useRef(ms);
  useEffect(() => {
    if (paused) return undefined;
    const started = Date.now();
    const t = setTimeout(() => onDismiss(id), left.current);
    return () => { clearTimeout(t); left.current = Math.max(left.current - (Date.now() - started), 1000); };
  }, [paused, id, onDismiss]);
  const Icon = TOAST_ICON[tone];
  return (
    <div
      className={`mk-toast mk-toast-${tone}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false); }}
    >
      <Icon />
      <span style={{ minWidth: 0, flex: 1 }}>{message}</span>
      <button type="button" className="mk-toast-close" aria-label="Dismiss" onClick={() => onDismiss(id)}><XIcon /></button>
    </div>
  );
}
