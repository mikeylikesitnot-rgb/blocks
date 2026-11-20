import { useEffect, useRef, useState } from 'react';
import { Button } from './Button.jsx';
import { CheckIcon, CopyIcon } from './icons.jsx';
import { cx } from './cx.js';
import { useToast } from './Overlay.jsx';

// execCommand path: navigator.clipboard is missing on an insecure origin
// (http://<lan-ip> dev server) and can reject when focus is elsewhere.
function legacyCopy(text) {
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/** Copy text to the clipboard; resolves true when it worked. Call it from the click itself. */
export function copyText(text) {
  const s = text == null ? '' : String(text);
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return Promise.resolve(legacyCopy(s));
    return navigator.clipboard.writeText(s).then(() => true, () => legacyCopy(s));
  } catch {
    return Promise.resolve(legacyCopy(s));
  }
}

/**
 * Icon button that copies text, shows a check for a moment and a toast.
 *   <CopyButton text={line} label="Copy car info" />
 *   <CopyButton text={() => build()} toast="Copied car info">Copy</CopyButton>
 * Clicks don't bubble (safe inside a clickable table row).
 * toast: true shows "Copied" + the text; a string replaces "Copied"; false shows none.
 */
export function CopyButton({
  text, label = 'Copy', toast = true, variant = 'ghost', size = 'sm', children,
  onCopied, className, ...rest
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef();
  const notify = useToast();
  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = (e) => {
    e.stopPropagation();
    const value = typeof text === 'function' ? text() : text;
    copyText(value).then((ok) => {
      if (!ok) {
        if (toast) notify.error('Couldn’t copy');
        return;
      }
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
      if (toast) notify(`${typeof toast === 'string' ? toast : 'Copied'}: ${value}`);
      onCopied?.(value);
    });
  };

  return (
    <Button
      variant={variant}
      size={size}
      icon={copied ? CheckIcon : CopyIcon}
      label={copied ? 'Copied' : label}
      className={cx('mk-copy', copied && 'mk-copy-done', className)}
      onClick={onClick}
      {...rest}
    >
      {children}
    </Button>
  );
}

export default CopyButton;
