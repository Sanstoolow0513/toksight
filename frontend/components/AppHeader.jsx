import { useRef } from 'react';
import { ExternalLink, House, Languages, Monitor, Moon, Settings2, Sun } from 'lucide-react';
import BrandMark from './BrandMark';
import Segmented from './Segmented';

export default function AppHeader({ view, onView, locale, theme, onTheme, onLocale, tx }) {
  const menu = useRef(null);
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return <header className="app-header">
    <div className="header-home"><button type="button" className="brand" aria-label="toksight" onClick={() => onView('today')}><BrandMark size={24} /><span>toksight</span></button>
      <button type="button" className="header-home-link" onClick={() => onView('today')}><House size={13} strokeWidth={1.5} /><span>{tx('home')}</span></button></div>
    <div className="header-tab"><span>{tx('title' + view)}</span><span className="header-tab-dot" aria-hidden="true" /></div>
    <div className="header-tools">
      <span className="local-status"><i />{tx('localWorkspace')}</span><span className="header-divider" />
      <details className="theme-menu" ref={menu} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false; }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); menu.current.open = false; menu.current.querySelector('summary').focus(); } }}>
        <summary className="icon-btn" title={tx('themeGroup')} aria-label={tx('themeGroup')}><ThemeIcon size={18} /></summary>
        <div className="theme-panel"><span>{tx('themeGroup')}</span><Segmented label={tx('themeGroup')} value={theme} onChange={onTheme} options={[
          { value: 'light', icon: <Sun size={16} />, title: tx('themeLight') }, { value: 'dark', icon: <Moon size={16} />, title: tx('themeDark') },
          { value: 'system', icon: <Monitor size={16} />, title: tx('themeSystem') },
        ]} /></div>
      </details>
      <button type="button" className="icon-btn language-button" onClick={() => onLocale(locale === 'en' ? 'zh-CN' : 'en')} title={tx('langGroup')} aria-label={tx('langGroup')}><Languages size={18} /><span>{locale === 'en' ? 'EN' : '中'}</span></button>
      <a className="icon-btn github-link" href="https://github.com/Sanstoolow0513/toksight" target="_blank" rel="noreferrer" title="GitHub" aria-label="GitHub"><ExternalLink size={17} /></a>
      <button type="button" className="icon-btn" onClick={() => onView('settings')} title={tx('navsettings')} aria-label={tx('navsettings')}><Settings2 size={18} /></button>
    </div>
  </header>;
}
