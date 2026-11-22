import { forwardRef, useId, useMemo, useState } from 'react';
import { cx } from '../cx.js';
import { XIcon } from '../icons.jsx';
import { Button } from '../Button.jsx';
import { normalizeTag } from './tags.js';

/**
 * Tag box: chips plus a text field. Enter, comma or Tab adds what was typed;
 * ↑ ↓ pick a suggestion; Backspace in an empty field removes the last tag.
 *   <TagInput value={tags} onChange={setTags} suggestions={[{ tag: 'billing', count: 4 }]} max={5} />
 * Tags are lowercased, spaces become dashes (normalizeTag); anything else is refused.
 */
export const TagInput = forwardRef(function TagInput(
  { value = [], onChange, suggestions = [], max = 5, placeholder = 'Add a tag', id, invalid, className = '', ...rest },
  ref,
) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(-1);
  const [focused, setFocused] = useState(false);
  const listId = useId();
  const full = value.length >= max;

  const matches = useMemo(() => {
    const t = text.trim().toLowerCase();
    if (!t) return [];
    return suggestions
      .map((s) => (typeof s === 'string' ? { tag: s } : s))
      .filter((s) => s.tag.startsWith(t) && !value.includes(s.tag))
      .slice(0, 6);
  }, [text, suggestions, value]);
  const open = focused && matches.length > 0 && !full;

  const add = (raw) => {
    const t = normalizeTag(raw);
    setText('');
    setActive(-1);
    if (!t || value.includes(t) || full) return;
    onChange?.([...value, t]);
  };
  const remove = (t) => onChange?.(value.filter((v) => v !== t));

  const onKeyDown = (e) => {
    if (open && e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % matches.length); return; }
    if (open && e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i <= 0 ? matches.length - 1 : i - 1)); return; }
    if (e.key === 'Escape' && open) { e.preventDefault(); setActive(-1); setText(''); return; }
    if (e.key === 'Enter' || e.key === ',' || (e.key === 'Tab' && text.trim())) {
      if (!text.trim() && e.key !== ',') return;
      e.preventDefault();
      add(open && active >= 0 ? matches[active].tag : text);
      return;
    }
    if (e.key === 'Backspace' && !text && value.length) remove(value[value.length - 1]);
  };

  return (
    <div className={cx('mk-qa-tags-input mk-input', focused && 'mk-qa-tags-focus', className)} aria-invalid={invalid || undefined}>
      {value.map((t) => (
        <span key={t} className="mk-qa-tag mk-qa-tag-chip">
          {t}
          <Button variant="ghost" size="xs" icon={XIcon} label={`Remove tag ${t}`} className="mk-qa-tag-x" onClick={() => remove(t)} />
        </span>
      ))}
      <input
        ref={ref}
        id={id}
        className="mk-qa-tags-field"
        value={text}
        disabled={full}
        placeholder={full ? `${max} tags max` : value.length ? '' : placeholder}
        onChange={(e) => { setText(e.target.value.replace(',', '')); setActive(-1); }}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); if (text.trim()) add(text); }}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        {...rest}
      />
      {open && (
        <ul id={listId} role="listbox" className="mk-qa-tags-list">
          {matches.map((s, i) => (
            <li
              key={s.tag}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={cx('mk-qa-tags-option', i === active && 'mk-qa-tags-option-on')}
              onMouseDown={(e) => { e.preventDefault(); add(s.tag); }}
            >
              <span className="mk-qa-tag">{s.tag}</span>
              {s.count != null && <span className="mk-qa-tags-count">{s.count}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

export default TagInput;
