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
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
