import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEditor, useEditorState, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Button } from '../Button.jsx';
import { cx } from '../cx.js';
import { XIcon } from '../icons.jsx';
import { sameHtml, toRichHtml } from './value.js';
import {
  UndoIcon, RedoIcon, BoldIcon, ItalicIcon, UnderlineIcon, StrikeIcon, LinkIcon,
  BulletListIcon, OrderedListIcon, QuoteIcon, CodeBlockIcon, PencilIcon,
} from './icons.jsx';
import './editor.css';

/* Link schemes the editor will create. javascript: and data: are absent on purpose:
   a data: URL on an <a> is a script the reader clicks. Matches AutoDealer's sanitizer. */
export const LINK_PROTOCOLS = ['http', 'https', 'mailto', 'tel'];

/* TuroApp's toolbar. '|' is a separator. */
export const DEFAULT_TOOLBAR = [
  'undo', 'redo', '|', 'bold', 'italic', 'underline', 'strike', '|', 'link', '|',
  'bulletList', 'orderedList', '|', 'blockquote', 'codeBlock',
];

/**
 * The Tiptap extensions behind RichTextEditor, exported so a server-side or test
 * round trip can use exactly the same schema. StarterKit (v3 bundles Link and
 * Underline) with the link settings both apps already used, so stored <a> tags
 * come out as <a target="_blank" rel="noopener noreferrer" href="...">.
 *   disable: StarterKit extension names to switch off, e.g. ['heading', 'codeBlock', 'horizontalRule'].
 */
export function editorExtensions({ disable = [] } = {}) {
  const off = Object.fromEntries(disable.map((name) => [name, false]));
  return [
    StarterKit.configure({
      ...off,
      link: off.link === false ? false : {
        openOnClick: false, // a click inside the editor places the caret
        autolink: true,
        defaultProtocol: 'https',
        protocols: LINK_PROTOCOLS,
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
      },
    }),
  ];
}

// key → [label, shortcut hint, icon, extension it needs, command, active-check name]
const ITEMS = {
  undo: ['Undo', 'Ctrl+Z', UndoIcon, 'undoRedo', (c) => c.undo()],
  redo: ['Redo', 'Ctrl+Y', RedoIcon, 'undoRedo', (c) => c.redo()],
  bold: ['Bold', 'Ctrl+B', BoldIcon, 'bold', (c) => c.toggleBold(), 'bold'],
  italic: ['Italic', 'Ctrl+I', ItalicIcon, 'italic', (c) => c.toggleItalic(), 'italic'],
  underline: ['Underline', 'Ctrl+U', UnderlineIcon, 'underline', (c) => c.toggleUnderline(), 'underline'],
  strike: ['Strikethrough', '', StrikeIcon, 'strike', (c) => c.toggleStrike(), 'strike'],
  link: ['Link', 'Ctrl+K', LinkIcon, 'link', null, 'link'],
  bulletList: ['Bulleted list', '', BulletListIcon, 'bulletList', (c) => c.toggleBulletList(), 'bulletList'],
  orderedList: ['Numbered list', '', OrderedListIcon, 'orderedList', (c) => c.toggleOrderedList(), 'orderedList'],
  blockquote: ['Quote', '', QuoteIcon, 'blockquote', (c) => c.toggleBlockquote(), 'blockquote'],
  codeBlock: ['Code block', '', CodeBlockIcon, 'codeBlock', (c) => c.toggleCodeBlock(), 'codeBlock'],
};
const ACTIVE = Object.values(ITEMS).map((i) => i[5]).filter(Boolean);

// Drop unknown keys, items whose extension is off, and leading/trailing/double separators.
function toolbarKeys(toolbar, disable) {
  const keys = toolbar.filter((k) => k === '|' || (ITEMS[k] && !disable.includes(ITEMS[k][3])));
  return keys.filter((k, i) => k !== '|' || (i > 0 && i < keys.length - 1 && keys[i - 1] !== '|'));
}

// "example.com" → "https://example.com"; returns null for a scheme the editor won't link.
function normalizeHref(raw) {
  const url = raw.trim();
  if (!url) return '';
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (scheme) return LINK_PROTOCOLS.includes(scheme[1].toLowerCase()) ? url : null;
  if (url.startsWith('/') || url.startsWith('#')) return url;
  if (url.includes('@') && !url.includes('/')) return `mailto:${url}`;
  return `https://${url}`;
}

function readHeight(key) {
  if (!key) return null;
  try { return Number(localStorage.getItem(key)) || null; } catch { return null; }
}

/**
 * Rich-text field (Tiptap). Emits HTML.
 *   <RichTextEditor value={notes} onChange={setNotes} />
 *   <RichTextEditor value={note} onChange={setNote} ariaLabel="Note" minRows={3}
 *     toolbar={['bold', 'italic', 'underline', '|', 'bulletList', 'orderedList', '|', 'link']}
 *     disable={['heading', 'codeBlock', 'horizontalRule']} />
 *
 * - value / content: the HTML (or legacy plain text). Pushed in only when it really differs and the
 *   editor is not focused, so a parent re-render never moves the caret.
 * - onChange / onUpdate: called with the HTML on every edit; "" when the editor is empty.
 * - toolbar: button keys in order, '|' for a separator (DEFAULT_TOOLBAR). Buttons whose extension is
 *   in `disable` are dropped. disable also stops the markup being typed or pasted in.
 * - minRows (4) or minHeight (px) set the content height. storageKey makes it user-resizable and
 *   remembers the height in localStorage; resizable without storageKey just allows resizing.
 * - id, ariaLabel, disabled, className as usual. Ctrl/Cmd+K opens the link form.
 */
export function RichTextEditor({
  value, content, onChange, onUpdate, id, ariaLabel, disabled = false,
  minRows = 4, minHeight, storageKey, resizable = Boolean(storageKey),
  toolbar = DEFAULT_TOOLBAR, disable = [], className = '',
}) {
  const html = value !== undefined ? value : content;
  const emit = useRef(null);
  emit.current = onChange || onUpdate;
  const openLinkRef = useRef(null);
  const wrapRef = useRef(null);
  const bodyRef = useRef(null);
  const [link, setLink] = useState(null); // { text, href, editing } while the link form is open
  const [chip, setChip] = useState(null); // { top, left } of the link preview under the caret
  const [height] = useState(() => readHeight(storageKey));

  const disableKey = disable.join(',');
  // Memoized: a fresh extensions array on every render makes useEditor rebuild the editor.
  const extensions = useMemo(() => editorExtensions({ disable }), [disableKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const editor = useEditor({
    extensions,
    content: toRichHtml(html),
    editable: !disabled,
    editorProps: {
      attributes: {
        class: 'mk-rte-input',
        role: 'textbox',
        'aria-multiline': 'true',
        ...(id ? { id } : {}),
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      },
      handleKeyDown: (_view, e) => {
        if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k' && openLinkRef.current) {
          e.preventDefault();
          openLinkRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => emit.current?.(ed.isEmpty ? '' : ed.getHTML()),
  }, [extensions]);

  // Outside-in updates only (a different record opened, a form reset). Skipped while focused so
  // typing is never fought, and never emits, so loading a value cannot trigger a save.
  // isDestroyed: React 19 StrictMode remounts effects and can hand over a torn-down editor.
  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isFocused) return;
    const incoming = toRichHtml(html);
    if (sameHtml(incoming, editor.getHTML())) return;
    editor.commands.setContent(incoming, { emitUpdate: false });
  }, [editor, html]);

  // emitUpdate false: setEditable otherwise fires onUpdate, which would report an unchanged note as an edit.
  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.isEditable === disabled) editor.setEditable(!disabled, false);
  }, [editor, disabled]);

  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed || ed.isDestroyed) return null;
      const s = { focused: ed.isFocused, from: ed.state.selection.from, href: null };
      for (const name of ACTIVE) s[name] = ed.schema.nodes[name] || ed.schema.marks[name] ? ed.isActive(name) : false;
      if (s.link) s.href = ed.getAttributes('link').href || null;
      s.canUndo = ed.can().undo?.() ?? false;
      s.canRedo = ed.can().redo?.() ?? false;
      return s;
    },
  }) || {};

  const openLink = useCallback(() => {
    if (!editor || disabled) return;
    if (editor.isActive('link')) editor.commands.extendMarkRange('link');
    const { from, to } = editor.state.selection;
    const href = editor.getAttributes('link').href || '';
    setLink({ text: editor.state.doc.textBetween(from, to, ' '), href, editing: Boolean(href), from, to });
    setChip(null);
  }, [editor, disabled]);
  openLinkRef.current = openLink;

  const closeLink = useCallback(() => {
    setLink(null);
    editor?.commands.focus();
  }, [editor]);

  const removeLink = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setLink(null);
    setChip(null);
  }, [editor]);

  const [linkError, setLinkError] = useState('');
  const applyLink = useCallback(() => {
    if (!editor || !link) return;
    const href = normalizeHref(link.href);
    if (href === null) { setLinkError('Use an http, https, mailto or tel link.'); return; }
    if (!href) { removeLink(); return; }
    const { from, to } = link;
    const original = editor.state.doc.textBetween(from, to, ' ');
    const text = link.text.trim() ? link.text : original || href;
    const chain = editor.chain().focus().setTextSelection({ from, to });
    if (from !== to && text === original) {
      chain.setLink({ href }).run(); // keeps bold/italic on the linked words
    } else {
      chain.insertContentAt({ from, to }, { type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }).run();
    }
    setLink(null);
    setLinkError('');
  }, [editor, link, removeLink]);

  // The preview chip under a link the caret is in (TuroApp's Google Docs-style chip).
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed || !state.href || !state.focused || link) { setChip(null); return; }
    try {
      const at = editor.view.coordsAtPos(state.from);
      const box = wrapRef.current.getBoundingClientRect();
      setChip({ top: at.bottom - box.top + 4, left: Math.max(0, Math.min(at.left - box.left, box.width - 240)) });
    } catch { setChip(null); }
  }, [editor, state.href, state.focused, state.from, link]);

  const saveHeight = () => {
    if (!storageKey || !bodyRef.current) return;
    try { localStorage.setItem(storageKey, String(bodyRef.current.offsetHeight)); } catch { /* storage off */ }
  };

  if (!editor) return null;

  const keys = toolbarKeys(toolbar, disable);
  const bodyStyle = { '--mk-rte-rows': minRows };
  if (minHeight) bodyStyle.minHeight = minHeight;
  if (resizable && height) bodyStyle.height = height;

  return (
    <div ref={wrapRef} className={cx('mk-rte', disabled && 'mk-rte-disabled', className)}>
      {keys.length > 0 && (
        <div className="mk-rte-toolbar" role="toolbar" aria-label="Formatting">
          {keys.map((k, i) => {
            if (k === '|') return <span key={i} className="mk-rte-sep" aria-hidden="true" />;
            const [label, hint, Icon, , cmd, activeName] = ITEMS[k];
            const on = activeName ? Boolean(state[activeName]) : undefined;
            const off = disabled || (k === 'undo' && !state.canUndo) || (k === 'redo' && !state.canRedo);
            return (
              <Button
                key={k}
                variant="ghost"
                size="sm"
                icon={Icon}
                label={label}
                title={hint ? `${label} (${hint})` : label}
                className={cx('mk-rte-btn', on && 'mk-rte-on')}
                aria-pressed={on}
                disabled={off}
                // mousedown, not click: the default mousedown blurs the editor and drops the selection.
                onMouseDown={(e) => { e.preventDefault(); if (cmd) cmd(editor.chain().focus()).run(); else openLink(); }}
                onClick={(e) => { if (e.detail === 0) { if (cmd) cmd(editor.chain().focus()).run(); else openLink(); } }}
              />
            );
          })}
        </div>
      )}

      {link && (
        <div className="mk-rte-link" role="group" aria-label={link.editing ? 'Edit link' : 'Add link'}>
          <input
            className="mk-input"
            value={link.text}
            placeholder="Text to display"
            aria-label="Text to display"
            onChange={(e) => setLink({ ...link, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
              if (e.key === 'Escape') { e.preventDefault(); closeLink(); }
            }}
          />
          <input
            className="mk-input"
            value={link.href}
            placeholder="Paste a link"
            aria-label="Link address"
            aria-invalid={linkError ? true : undefined}
            autoFocus
            onChange={(e) => { setLink({ ...link, href: e.target.value }); setLinkError(''); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
              if (e.key === 'Escape') { e.preventDefault(); closeLink(); }
            }}
          />
          <div className="mk-rte-link-actions">
            <Button size="sm" variant="soft" onClick={applyLink}>Apply</Button>
            {link.editing && <Button size="sm" variant="ghost" onClick={removeLink}>Remove link</Button>}
            <Button size="sm" variant="ghost" onClick={closeLink}>Cancel</Button>
          </div>
          {linkError && <p className="mk-rte-link-error" role="alert">{linkError}</p>}
        </div>
      )}

      <div
        ref={bodyRef}
        className={cx('mk-rte-body', resizable && 'mk-rte-resizable')}
        style={bodyStyle}
        onMouseUp={saveHeight}
        onTouchEnd={saveHeight}
      >
        <EditorContent editor={editor} />
      </div>

      {chip && state.href && (
        <div className="mk-rte-chip" style={{ top: chip.top, left: chip.left }} onMouseDown={(e) => { if (e.target.tagName !== 'A') e.preventDefault(); }}>
          <a href={state.href} target="_blank" rel="noopener noreferrer">{state.href}</a>
          <Button variant="ghost" size="xs" icon={PencilIcon} label="Edit link" onClick={openLink} />
          <Button variant="ghost" size="xs" icon={XIcon} label="Remove link" onClick={removeLink} />
        </div>
      )}
    </div>
  );
}

export default RichTextEditor;
