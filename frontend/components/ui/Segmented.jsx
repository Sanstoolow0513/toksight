import { cx } from './cx';

// The single segmented control: theme, language, metric, calendar mode,
// quick ranges and agent tabs all use it. A radiogroup with one Tab stop;
// arrow keys, Home and End move and select.
export default function Segmented({ label, value, options, onChange, size = 'md', mono = false, wrap = false, block = false, className }) {
  const selected = options.some((option) => option.value === value);
  return (
    <div className={cx('seg', size === 'sm' && 'seg--sm', mono && 'seg--mono', wrap && 'seg--wrap', block && 'seg--block', className)} role="radiogroup" aria-label={label}>
      {options.map((o, current) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.label ? undefined : o.title}
          title={o.title}
          tabIndex={value === o.value || (!selected && current === 0) ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(event) => {
            const index = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (current + 1) % options.length
              : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (current - 1 + options.length) % options.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : null;
            if (index == null) return;
            event.preventDefault();
            onChange(options[index].value);
            event.currentTarget.parentElement.children[index].focus();
          }}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
