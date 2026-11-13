/** Join class names, skipping falsy ones. */
export const cx = (...c) => c.filter(Boolean).join(' ');
