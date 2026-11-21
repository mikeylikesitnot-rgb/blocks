import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * Autosave for an edit form or edit window (from TuroApp's Car edit page).
 *
 *   const a = useAutosave({ save: (patch) => api.updateX(id, patch), validate });
 *   a.reset(values)              // after loading the record
 *   a.setField('VIN', v)         // saves 1s after the last change
 *   a.setField('Status', v, 0)   // saves now
 *   a.flush()                    // save pending edits now (blur, ⌘S, leaving)
 *
 * Only changed fields are sent. Each save is one undo step (⌘Z / ⌘⇧Z outside a
 * text field, or a.undo / a.redo); a.revertAll() puts back the values the page
 * opened with. validate(patch) returns { field: message } for values not to save
 * (values put back by undo, revert or apply skip it: they were saved before).
 * flush / apply / undo / redo resolve to { ok } so callers can tell a failed save.
 * save(patch, { unloading }) — unloading is true when the page is closing (use keepalive).
 *
 * Options: debounceMs (1000), keysEnabled (true), scope (a ref to the form: inside a
 * Modal, ⌘Z/⌘S only act when that form is in the top dialog; without it any open
 * dialog turns the keys off, so a page's undo never fires under a modal).
 */
const MAX_UNDO = 20;
const same = (a, b) => String(a ?? '') === String(b ?? '');

export function useAutosave({ save, validate, onSaved, debounceMs = 1000, keysEnabled = true, scope } = {}) {
  const [form, setForm] = useState({});
  const formRef = useRef({});
  const savedRef = useRef(null);   // what the server has
  const openingRef = useRef(null); // what the page opened with
  const timer = useRef(null);
  const inFlight = useRef(null);
  const queued = useRef(false);
  const queuedUnloading = useRef(false);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const [status, setStatus] = useState('idle'); // idle | saving | saved | error
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState(null);
  const [errors, setErrors] = useState({});
  const [, setVersion] = useState(0); // re-render when the undo stacks change
  const cfg = useRef({});
  cfg.current = { save, validate, onSaved };

  const pendingPatch = () => {
    const out = {};
    if (!savedRef.current) return out;
    for (const [k, v] of Object.entries(formRef.current)) if (!same(v, savedRef.current[k])) out[k] = v;
    return out;
  };

  const reset = useCallback((values) => {
    clearTimeout(timer.current);
    formRef.current = { ...values };
    savedRef.current = { ...values };
    openingRef.current = { ...values };
    undoStack.current = [];
    redoStack.current = [];
    setForm(formRef.current);
    setStatus('idle');
    setSavedAt(null);
    setError(null);
    setErrors({});
  }, []);

  // Values the server set itself on a save (a stamped date, a derived flag): they become
  // the saved values without a save or an undo step. A field with an edit still pending
  // keeps the edit on screen.
  const adopt = useCallback((values) => {
    if (!savedRef.current) return;
    const next = { ...formRef.current };
    for (const [k, v] of Object.entries(values)) {
      if (same(next[k], savedRef.current[k])) next[k] = v;
      savedRef.current[k] = v;
    }
    formRef.current = next;
    setForm(next);
  }, []);

  // mode: 'edit' (a new undo step, clears redo), 'undo' (goes on the redo stack), 'redo' (back on the undo stack).
  // trusted: the keys being put back (undo, revert, apply): validate is skipped for those only,
  // so another field held back by validate stays held back. Resolves to { ok, invalid }.
  const flush = useCallback((mode = 'edit', { trusted = [], unloading = false } = {}) => {
    clearTimeout(timer.current);
    if (!savedRef.current) return Promise.resolve({ ok: true });
    if (inFlight.current) {
      queued.current = true;
      if (unloading) queuedUnloading.current = true; // the follow-up save must survive the page closing too
      return inFlight.current; // resolves after the save in flight and the queued one that follows it
    }
    const patch = pendingPatch();
    const bad = cfg.current.validate ? { ...(cfg.current.validate(patch) || {}) } : {};
    for (const k of trusted) delete bad[k];
    setErrors(bad);
    for (const k of Object.keys(bad)) delete patch[k];
    const invalid = Object.keys(bad).length > 0;
    if (!Object.keys(patch).length) {
      setStatus((st) => (st === 'error' ? 'idle' : st)); // nothing left to send (e.g. a failed undo was rolled back)
      return Promise.resolve({ ok: true, invalid });
    }
    const saved = savedRef.current; // this record's baseline, even if reset() loads another meanwhile
    const before = {};
    for (const k of Object.keys(patch)) before[k] = saved[k];
    setStatus('saving');
    const p = (async () => {
      let ok = false;
      try {
        await cfg.current.save(patch, { unloading });
        ok = true;
        Object.assign(saved, patch);
        if (saved !== savedRef.current) { cfg.current.onSaved?.(patch); return { ok, invalid }; } // another record was loaded meanwhile
        // Undo saved `patch` over `before`; redo puts `before` back (it applies step.after).
        if (mode === 'undo') redoStack.current.push({ before: patch, after: before });
        else {
          const step = { before, after: patch };
          undoStack.current.push(step);
          if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
          if (mode === 'edit') redoStack.current = [];
        }
        setSavedAt(Date.now());
        setError(null);
        setStatus('saved');
        setVersion((v) => v + 1);
        cfg.current.onSaved?.(patch);
      } catch (e) {
        setError(e.message || 'Couldn’t save');
        setStatus('error');
      } finally {
        inFlight.current = null;
      }
      if (queued.current) {
        queued.current = false;
        const unloadingNext = queuedUnloading.current;
        queuedUnloading.current = false;
        if (Object.keys(pendingPatch()).length) {
          const next = flush('edit', { unloading: unloadingNext });
          return next.then((r) => ({ ok: ok && r.ok, invalid: invalid || r.invalid }));
        }
      }
      return { ok, invalid };
    })();
    inFlight.current = p;
    return p;
  }, []);

  const setField = useCallback((key, value, delay = debounceMs) => {
    formRef.current = { ...formRef.current, [key]: value };
    setForm(formRef.current);
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), delay);
  }, [debounceMs, flush]);

  // Put values back on the form and save them now as one step (no validation: they were saved before).
  const apply = useCallback(async (values, mode = 'edit') => {
    const first = await flush();
    if (!first.ok) return first;
    formRef.current = { ...formRef.current, ...values };
    setForm(formRef.current);
    return flush(mode, { trusted: Object.keys(values) });
  }, [flush]);

  // A failed undo/redo puts its step back, so Retry or another ⌘Z can try again.
  const step = useCallback(async (from, mode, pick) => {
    const first = await flush();
    if (!first.ok) return first;
    const s = from.current.pop();
    if (!s) return { ok: true };
    setVersion((v) => v + 1);
    const back = pick(s);
    formRef.current = { ...formRef.current, ...back };
    setForm(formRef.current);
    const r = await flush(mode, { trusted: Object.keys(back) });
    if (!r.ok) {
      from.current.push(s);
      formRef.current = { ...formRef.current, ...(mode === 'undo' ? s.after : s.before) };
      setForm(formRef.current);
      setVersion((v) => v + 1);
    }
    return r;
  }, [flush]);
  const undo = useCallback(() => step(undoStack, 'undo', (s) => s.before), [step]);
  const redo = useCallback(() => step(redoStack, 'redo', (s) => s.after), [step]);

  const revertAll = useCallback(() => apply({ ...openingRef.current }), [apply]);

  const dirty = Object.keys(pendingPatch()).length > 0;
  const canRevert = !!openingRef.current && !!savedRef.current
    && Object.keys(openingRef.current).some((k) => !same(openingRef.current[k], savedRef.current[k]));

  // Keyboard: ⌘S saves now; ⌘Z / ⌘⇧Z undo and redo saved changes when not typing in a field.
  const keys = useRef({});
  keys.current = { flush, undo, redo, enabled: keysEnabled, scope };
  useEffect(() => {
    const onKey = (e) => {
      if (!keys.current.enabled || !(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k !== 's' && k !== 'z' && k !== 'y') return;
      // [role=dialog] and native <dialog open> (a closed <dialog> stays in the DOM and doesn't count)
      const dialogs = document.querySelectorAll('[role="dialog"], dialog[open]');
      const top = dialogs[dialogs.length - 1];
      const root = keys.current.scope?.current;
      if (top && !(root && top.contains(root))) return; // a dialog over this form (or this page)
      if (k === 's') { e.preventDefault(); keys.current.flush(); return; }
      const t = e.target;
      // A text box keeps its own undo; a select, checkbox or button has none, so ⌘Z is ours there.
      const typing = t && (t.isContentEditable || t.tagName === 'TEXTAREA'
        || (t.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|color|file|image)$/i.test(t.type)));
      if (typing) return;
      e.preventDefault();
      if (k === 'y' || e.shiftKey) keys.current.redo(); else keys.current.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Leaving: save when the tab is hidden or the page unmounts; warn on close while edits are unsaved.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    const onBeforeUnload = (e) => {
      if (inFlight.current || Object.keys(pendingPatch()).length) { flush('edit', { unloading: true }); e.preventDefault(); e.returnValue = ''; }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      flush('edit', { unloading: true });
    };
  }, [flush]);

  return {
    form, setField, flush, reset, adopt, apply, undo, redo, revertAll,
    status, savedAt, error, errors, dirty, canRevert,
    canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0,
  };
}
