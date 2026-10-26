// Join class names, skipping falsy parts.
export const cx = (...parts) => parts.filter(Boolean).join(' ');
