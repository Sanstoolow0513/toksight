import { ExternalLink, Languages, Monitor, Moon, Sun } from 'lucide-react';
import BrandMark from './BrandMark';
import { IconButton, IconLink, MenuButton, Segmented } from './ui';

const LANGUAGE_NAMES = { 'zh-CN': '中文', en: 'English' };

// The reading strip: the logo (back to Today) and, on the right, page
// actions, a divider, then theme, language and the project link. Every
// control is the same IconButton; its text lives in the tooltip.
export default function AppHeader({ view, onView, locale, theme, onTheme, onLocale, actions, tx }) {
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return <header className="app-header">
    <button type="button" className="brand" aria-label="toksight" onClick={() => onView('today')}><BrandMark size={28} /></button>
    <h1 className="visually-hidden">{tx('nav' + view)}</h1>
    <div className="header-tools">
      {actions}
      {actions ? <span className="header-divider" aria-hidden="true" /> : null}
      <MenuButton className="theme-menu" panelClassName="theme-panel" label={tx('themeGroup')} icon={<ThemeIcon />}>
        <span className="label">{tx('themeGroup')}</span><Segmented label={tx('themeGroup')} value={theme} onChange={onTheme} block options={[
          { value: 'light', icon: <Sun size={15} />, title: tx('themeLight') }, { value: 'dark', icon: <Moon size={15} />, title: tx('themeDark') },
          { value: 'system', icon: <Monitor size={15} />, title: tx('themeSystem') },
        ]} />
      </MenuButton>
      <IconButton className="language-button" label={`${tx('langGroup')} · ${LANGUAGE_NAMES[locale] ?? locale}`} onClick={() => onLocale(locale === 'en' ? 'zh-CN' : 'en')}><Languages /></IconButton>
      <IconLink className="github-link" label="GitHub" href="https://github.com/Sanstoolow0513/toksight" target="_blank" rel="noreferrer"><ExternalLink /></IconLink>
    </div>
  </header>;
}
