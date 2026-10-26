import { useRef } from 'react';
import { ExternalLink, Languages, Monitor, Moon, Sun } from 'lucide-react';
import BrandMark from './BrandMark';
import { IconButton, Segmented, iconButtonClass } from './ui';

// The reading strip: brand, current page, page actions, then global
// preferences (theme, language) and the project link.
export default function AppHeader({ view, onView, locale, theme, onTheme, onLocale, actions, tx }) {
  const menu = useRef(null);
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return <header className="app-header">
    <button type="button" className="brand" aria-label="toksight" onClick={() => onView('today')}><BrandMark size={22} /><span>toksight</span></button>
    <h1 className="header-page">{tx('nav' + view)}</h1>
    <div className="header-tools">
      {actions}
      {actions ? <span className="header-divider" aria-hidden="true" /> : null}
      <details className="theme-menu" ref={menu} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false; }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); menu.current.open = false; menu.current.querySelector('summary').focus(); } }}>
        <summary className={iconButtonClass()} title={tx('themeGroup')} aria-label={tx('themeGroup')}><ThemeIcon size={17} /></summary>
        <div className="theme-panel"><span className="label">{tx('themeGroup')}</span><Segmented label={tx('themeGroup')} value={theme} onChange={onTheme} block options={[
          { value: 'light', icon: <Sun size={15} />, title: tx('themeLight') }, { value: 'dark', icon: <Moon size={15} />, title: tx('themeDark') },
          { value: 'system', icon: <Monitor size={15} />, title: tx('themeSystem') },
        ]} /></div>
      </details>
      <IconButton className="language-button" label={tx('langGroup')} onClick={() => onLocale(locale === 'en' ? 'zh-CN' : 'en')}><Languages size={17} /><span>{locale === 'en' ? 'EN' : '中'}</span></IconButton>
      <a className={iconButtonClass('md', false, 'github-link')} href="https://github.com/Sanstoolow0513/toksight" target="_blank" rel="noreferrer" title="GitHub" aria-label="GitHub"><ExternalLink size={16} /></a>
    </div>
  </header>;
}
