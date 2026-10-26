export default function Segmented({ label, value, options, onChange, compact = false }) {
  return (
    <div className={compact ? 'seg seg-compact' : 'seg'} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.title}
          title={o.title}
          className={value === o.value ? 'on' : undefined}
          tabIndex={value === o.value || !options.some((option) => option.value === value) && o === options[0] ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(event) => {
            const current = options.indexOf(o);
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
