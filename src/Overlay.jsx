import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx.js';
import { Button } from './Button.jsx';
import { XIcon, CheckCircleIcon, AlertIcon, InfoIcon } from './icons.jsx';
import { motionOk, isPhone, dragHandlers } from './motion.js';

const NO_DRAG = 'button, a, input, select, textarea, [contenteditable], [data-no-drag]';

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
 * stacked, Esc closes only the top one. On phones the sheet has a grab
 * handle: drag it (or the title row) down past ~30% of its height, or flick
 * it down, to close; a shorter drag springs back.
 *   <Modal open={open} onClose={close} title="Edit task" footer={<>…buttons…</>}>…</Modal>
 */
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', className = '' }) {
  const panel = useRef(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Drag-to-close on phones. Styles are set on the panel directly so a drag
  // doesn't re-render the modal's contents on every pointer move. The close after
  // the slide-out runs once, even if Esc or the backdrop closes it meanwhile.
  const closeTimer = useRef(0);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => { if (!open) { clearTimeout(closeTimer.current); closeTimer.current = 0; } }, [open]);
  const drag = useMemo(() => dragHandlers({
    accept: (e) => !!onCloseRef.current && isPhone() && !e.target.closest(NO_DRAG),
    onStart: () => { if (panel.current) panel.current.style.transition = 'none'; },
    onMove: (dx, dy) => { if (panel.current) panel.current.style.transform = `translateY(${Math.max(0, dy)}px)`; },
    onEnd: ({ dy, vy }) => {
      const p = panel.current;
      if (!p) return;
      p.style.transition = '';
      const h = p.offsetHeight || 1;
      if (dy > h * 0.3 || (vy > 0.5 && dy > 24)) {
        if (!motionOk()) { p.style.transform = ''; onCloseRef.current?.(); return; }
        if (closeTimer.current) return;
        p.style.transform = 'translateY(100%)';
        closeTimer.current = setTimeout(() => {
          closeTimer.current = 0;
          if (panel.current) panel.current.style.transform = '';
          onCloseRef.current?.();
        }, 200);
      } else {
        p.style.transform = '';
      }
    },
  }), []);

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
        if (!closeTimer.current) onCloseRef.current?.(); // a drag-close is already on its way
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
      <div className="mk-modal-backdrop" onClick={() => { if (!closeTimer.current) onClose?.(); }} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cx('mk-modal', `mk-modal-${size}`, className)}
      >
        {onClose && <div className="mk-modal-grab" aria-hidden {...drag}><span /></div>}
        {(title || onClose) && (
          <div className="mk-modal-head" {...(onClose ? drag : {})}>
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
     const toast = useToast();  toast('Saved');  toast.error('Couldn’t save');
     The second argument is how long it stays, in ms; 0 keeps it until dismissed:
     toast.error('SMTP said: 550 …', 0).   */
const Ctx = createContext(null);
const TOAST_ICON = { success: CheckCircleIcon, error: AlertIcon, info: InfoIcon };

export function OverlayProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const [toasts, setToasts] = useState([]);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    setDialog({ ...(typeof opts === 'string' ? { title: opts } : opts), resolve });
  }), []);

  const [expanded, setExpanded] = useState(false);
  // Leaving toasts play their exit animation first (skipped under reduce motion).
  // A toast already leaving ignores a second dismiss (its timer, a swipe, its ×).
  const leaving = useRef(new Map()); // id -> removal timer
  useEffect(() => () => { leaving.current.forEach(clearTimeout); leaving.current.clear(); }, []);
  const dismiss = useCallback((id, dir) => {
    if (leaving.current.has(id)) return;
    if (!motionOk()) { setToasts((t) => t.filter((x) => x.id !== id)); return; }
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: dir || 'down' } : x)));
    leaving.current.set(id, setTimeout(() => {
      leaving.current.delete(id);
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 200));
  }, []);
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
        <ToastStack toasts={toasts} dismiss={dismiss} expanded={expanded} setExpanded={setExpanded} />,
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

/* Toasts, newest at the bottom (nearest the edge). More than TOAST_MAX collapse to
   the newest TOAST_MAX plus a "+N more" chip; pointer over the stack, focus inside it,
   or the chip expands it. Older ones keep their own clocks while hidden.
   The chip stays mounted while there are too many ("Show less" when open), so
   focusing it never pulls it out from under the keyboard. */
const TOAST_MAX = 3;
function ToastStack({ toasts, dismiss, expanded, setExpanded }) {
  const live = toasts.filter((t) => !t.leaving);
  const many = live.length > TOAST_MAX;
  const hidden = expanded ? 0 : Math.max(0, live.length - TOAST_MAX);
  // Collapsed: hide everything older than the oldest shown live toast, including
  // ones leaving from back there, so the visible ones never jump.
  const firstShown = hidden ? toasts.indexOf(live[hidden]) : 0;
  useEffect(() => { if (!many && expanded) setExpanded(false); }, [many, expanded, setExpanded]);
  return (
    <div
      className={cx('mk-toasts', expanded && 'mk-toasts-expanded')}
      onMouseEnter={() => many && setExpanded(true)}
      onMouseLeave={(e) => { if (!e.currentTarget.contains(document.activeElement)) setExpanded(false); }}
      onFocus={() => many && setExpanded(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setExpanded(false); }}
    >
      {many && (
        <button type="button" className="mk-toasts-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : `+${hidden} more`}
        </button>
      )}
      {/* One always-mounted live region; the toasts inside carry no role of their own,
          so each is announced once. */}
      <div className="mk-toasts-list" role="status" aria-live="polite">
        {toasts.map((t, i) => <Toast key={t.id} toast={t} hidden={i < firstShown} onDismiss={dismiss} />)}
      </div>
    </div>
  );
}

/* One toast. Leaves after `ms`, but the clock stops while the pointer is over it or
   focus is inside it (reading it, reaching for Undo), and its × closes it at once.
   On touch screens a sideways swipe past 80px (or a flick) dismisses it. */
function Toast({ toast, hidden, onDismiss }) {
  const { id, message, tone, ms, leaving } = toast;
  const el = useRef(null);
  const swipe = useMemo(() => dragHandlers({
    accept: (e) => e.pointerType !== 'mouse' && !e.target.closest(NO_DRAG),
    onStart: () => { setPaused(true); if (el.current) el.current.style.transition = 'none'; },
    onMove: (dx) => {
      if (!el.current) return;
      el.current.style.transform = `translateX(${dx}px)`;
      el.current.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 240));
    },
    onEnd: ({ dx, vx }) => {
      setPaused(false);
      if (!el.current) return;
      el.current.style.transition = '';
      if (Math.abs(dx) > 80 || (Math.abs(vx) > 0.5 && Math.abs(dx) > 16)) {
        const dir = dx < 0 ? 'left' : 'right';
        el.current.style.transform = '';
        el.current.style.opacity = '';
        onDismiss(id, dir);
      } else {
        el.current.style.transform = '';
        el.current.style.opacity = '';
      }
    },
  }), [id, onDismiss]);
  const [paused, setPaused] = useState(false);
  const left = useRef(ms);
  useEffect(() => {
    // ms 0 (or Infinity): stays until its × is pressed, e.g. an error someone may need to copy.
    if (leaving || paused || !ms || !Number.isFinite(ms)) return undefined;
    const started = Date.now();
    const t = setTimeout(() => onDismiss(id), left.current);
    return () => { clearTimeout(t); left.current = Math.max(left.current - (Date.now() - started), 1000); };
  }, [leaving, paused, id, onDismiss, ms]);
  const Icon = TOAST_ICON[tone];
  return (
    <div
      ref={el}
      className={cx('mk-toast', `mk-toast-${tone}`, hidden && 'mk-toast-hidden', leaving && `mk-toast-leave mk-toast-leave-${leaving}`)}
      aria-hidden={hidden || leaving ? true : undefined}
      {...swipe}
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
