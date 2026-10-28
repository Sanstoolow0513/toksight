import { cx } from './ui';

// Decorative brand mark (names always appear as text). Monochrome marks are
// CSS masks filled with the current text colour so they follow the theme;
// colour marks are plain images. Unknown providers get a letter tile.
export default function ProviderLogo({ logo, letter = '?', size = 'sm', className }) {
  const cls = cx('plogo', `plogo--${size}`, className);
  if (!logo) return <span className={cx(cls, 'plogo--letter')} aria-hidden="true"><span>{letter.slice(0, 1).toUpperCase()}</span></span>;
  return <span className={cls} aria-hidden="true">
    {logo.mono ? <span className="plogo-mask" style={{ '--logo': `url(/logos/${logo.file}.svg)` }} />
      : <img src={`/logos/${logo.file}.svg`} alt="" />}
  </span>;
}
