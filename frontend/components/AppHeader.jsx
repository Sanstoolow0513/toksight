import { useRef } from 'react';
import { ExternalLink, Languages, Monitor, Moon, Settings2, Sun } from 'lucide-react';
import BrandMark from './BrandMark';
import { IconButton, Segmented, iconButtonClass } from './ui';

export default function AppHeader({ view, onView, locale, theme, onTheme, onLocale, tx }) {
  const menu = useRef(null);
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return <header className="app-header">
    <button type="button" className="brand" aria-label="toksight" onClick={() => onView('today')}><BrandMark size={22} /><span>toksight</span></button>
    <nav className="header-crumb" aria-label={tx('navigation')}>
      <button type="button" onClick={() => onView('today')}>{tx('home')}</button>
      <span aria-hidden="true">/</span><span aria-current="page">{tx('title' + view)}</span>
    </nav>
    <div className="header-tools">
      <span className="local-status"><i aria-hidden="true" />{tx('localWorkspace')}</span>
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
      <IconButton label={tx('navsettings')} onClick={() => onView('settings')}><Settings2 size={17} /></IconButton>
    </div>
  </header>;
}
