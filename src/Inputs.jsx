import { forwardRef, useId, useRef, cloneElement, isValidElement } from 'react';
import { cx } from './cx.js';
import { SearchIcon, XIcon, ChevronDownIcon } from './icons.jsx';

/** Text input. Same height as Select and md Button. */
export const Input = forwardRef(function Input({ className = '', invalid, ...rest }, ref) {
  return <input ref={ref} className={cx('mk-input', className)} aria-invalid={invalid || undefined} {...rest} />;
});

export const Textarea = forwardRef(function Textarea({ className = '', invalid, ...rest }, ref) {
  return <textarea ref={ref} className={cx('mk-input', className)} aria-invalid={invalid || undefined} {...rest} />;
});

/**
 * Search box with magnifier and clear button. Controlled; Esc clears.
 *   <SearchInput value={q} onChange={setQ} placeholder="Name, phone, VIN" />
 */
export const SearchInput = forwardRef(function SearchInput(
  { value, onChange, placeholder = 'Search', className = '', onKeyDown, ...rest }, ref,
) {
  const inner = useRef(null);
  const el = ref || inner;
  return (
    <div className={cx('mk-search', className)}>
      <SearchIcon className="mk-search-icon" />
      <input
        ref={el}
        type="search"
        className="mk-input"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) { e.preventDefault(); onChange(''); }
          onKeyDown?.(e);
        }}
        placeholder={placeholder}
        aria-label={rest['aria-label'] || placeholder}
        {...rest}
      />
      {value ? (
        <button type="button" className="mk-icon-btn" aria-label="Clear search" onClick={() => { onChange(''); el.current?.focus(); }}>
          <XIcon />
        </button>
      ) : null}
    </div>
  );
});

/**
 * Styled native <select>. `active` tints it when a filter is applied.
 *   <Select value={v} onChange={(e) => setV(e.target.value)} active={v !== 'all'}>…</Select>
 */
export const Select = forwardRef(function Select({ className = '', active = false, children, ...rest }, ref) {
  return (
    <div className={cx('mk-select-wrap', className)}>
      <select ref={ref} className={cx('mk-select', active && 'mk-select-active')} {...rest}>{children}</select>
      <ChevronDownIcon className="mk-select-chevron" />
    </div>
  );
});

const NATIVE_CONTROLS = ['input', 'select', 'textarea'];

/**
 * Label above, hint or error below. Wires id/aria onto a single child control
 * (a native input/select/textarea or the kit's Input, Textarea, Select,
 * SearchInput). Any other child, such as a wrapper div, is left alone: give the
 * real input an id and pass the same id as htmlFor.
 *   <Field label="Email" hint="We never share it" error={err}><Input type="email" /></Field>
 *   <Field label="Price" htmlFor="price"><div className="row"><input id="price" /></div></Field>
 */
export function Field({ label, hint, error, htmlFor, children, className = '' }) {
  const auto = useId();
  const control = isValidElement(children)
    && (NATIVE_CONTROLS.includes(children.type) || [Input, Textarea, Select, SearchInput].includes(children.type));
  const id = htmlFor || (control ? children.props.id || auto : undefined);
  const msgId = `${id || auto}-msg`;
  const child = control
    ? cloneElement(children, {
        id: children.props.id || id,
        // Keeps an aria-describedby the control already has (e.g. a form-level error).
        'aria-describedby': [children.props['aria-describedby'], error || hint ? msgId : null].filter(Boolean).join(' ') || undefined,
        ...(error ? { 'aria-invalid': true } : {}),
      })
    : children;
  return (
    <div className={cx('mk-field', className)}>
      {label && <label htmlFor={id} className="mk-label">{label}</label>}
      {child}
      {error ? <p id={msgId} className="mk-error-text">{error}</p> : hint ? <p id={msgId} className="mk-hint">{hint}</p> : null}
    </div>
  );
}
