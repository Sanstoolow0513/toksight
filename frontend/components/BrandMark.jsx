// A 3×3 heat grid: the product in one glyph.
const CELLS = [1, 2, 4, 2, 4, 3, 0, 3, 4];

export default function BrandMark({ size = 22 }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
      {CELLS.map((level, i) => (
        <rect key={i} x={(i % 3) * 7.5} y={Math.floor(i / 3) * 7.5} width="6.5" height="6.5" rx="1.8" className={`lv-${level}`} />
      ))}
    </svg>
  );
}
