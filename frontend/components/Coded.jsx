// Renders `backticked` spans of an i18n string as <code>.
export function coded(text) {
  return String(text)
    .split(/`([^`]+)`/)
    .map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));
}
