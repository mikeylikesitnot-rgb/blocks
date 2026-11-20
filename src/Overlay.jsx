import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx.js';
import { Button } from './Button.jsx';
import { XIcon, CheckCircleIcon, AlertIcon, InfoIcon } from './icons.jsx';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open modals, oldest first. Only the last one answers Esc and traps Tab, so a
// modal opened over another (e.g. "Edit options…" over an edit form) closes alone.
const openModals = [];

/**
 * Centered dialog on desktop, bottom sheet on phones. Esc and backdrop
 * close it; focus is trapped inside and returned to the trigger. With modals
 * stacked, Esc closes only the top one.
 *   <Modal open={open} onClose={close} title="Edit task" footer={<>…buttons…</>}>…</Modal>
 */
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', className = '' }) {
  const panel = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const lastFocus = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
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
      document.body.style.overflow = prevOverflow;
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
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={cx('mk-modal', `mk-modal-${size}`, className)}
      >
        {(title || onClose) && (
          <div className="mk-modal-head">
            <div style={{ minWidth: 0 }}>
              {title && <h2 className="mk-modal-title">{title}</h2>}
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

  const push = useCallback((message, tone, ms) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
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
        <div className="mk-toasts" aria-live="polite">
          {toasts.map((t) => {
            const Icon = TOAST_ICON[t.tone];
            return (
              <div key={t.id} className={`mk-toast mk-toast-${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
                <Icon />
                <span style={{ minWidth: 0 }}>{t.message}</span>
              </div>
            );
          })}
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
