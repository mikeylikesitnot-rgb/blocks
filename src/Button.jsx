import { forwardRef } from 'react';
import { cx } from './cx.js';
import { SpinnerIcon } from './icons.jsx';

export const BUTTON_VARIANTS = ['primary', 'accent', 'danger', 'secondary', 'soft', 'soft-danger', 'ghost'];

/**
 * The one button.
 *   <Button>Save</Button>                                 primary, md
 *   <Button variant="secondary" size="sm" icon={PlusIcon}>Add</Button>
 *   <Button variant="ghost" icon={XIcon} label="Close" />  icon-only: label becomes aria-label + tooltip
 *   <Button loading>Saving…</Button>                        spinner, disabled, aria-busy
 *   <Button href="/x">Go</Button>                           renders <a>
 * Solid variants (primary/accent/danger) commit something; soft ones
 * (secondary/soft/soft-danger/ghost) are row actions.
 */
export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', icon: Icon, iconRight: IconRight, loading = false,
    label, block = false, className = '', children, href, type = 'button', disabled, ...rest },
  ref,
) {
  const iconOnly = !children && Boolean(Icon || loading);
  const cls = cx(
    'mk-btn',
    `mk-btn-${BUTTON_VARIANTS.includes(variant) ? variant : 'primary'}`,
    size !== 'md' && `mk-btn-${size}`,
    iconOnly && 'mk-btn-icon',
    block && 'mk-btn-block',
    className,
  );
  const content = (
    <>
      {loading ? <SpinnerIcon className="mk-spin" /> : Icon && <Icon className="mk-icon" aria-hidden />}
      {children}
      {IconRight && !loading && <IconRight className="mk-icon" aria-hidden />}
    </>
  );
  const a11y = iconOnly ? { 'aria-label': label, title: label } : label ? { title: label } : {};
  if (href) {
    return (
      <a ref={ref} href={disabled ? undefined : href} aria-disabled={disabled || undefined} className={cls} {...a11y} {...rest}>
        {content}
      </a>
    );
  }
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...a11y} {...rest}>
      {content}
    </button>
  );
});

export default Button;
