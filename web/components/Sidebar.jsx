import { CalendarDays, Globe2, HardDrive, Monitor, Moon, Settings2, Sun } from 'lucide-react';
import BrandMark from '@/components/BrandMark';
import Segmented from '@/components/Segmented';

const items = [['today', Sun], ['calendar', CalendarDays], ['settings', Settings2]];
const icon = { size: 18, strokeWidth: 1.7, 'aria-hidden': true };

export default function Sidebar({ view, onView, timezone, locale, theme, onTheme, onLocale, tx }) {
  return <aside className="sidebar">
    <div className="brand sidebar-brand">
      <BrandMark />
      <span className="brand-name">toksight</span>
    </div>
    <div className="sidebar-navigation">
      <div className="sidebar-label">{tx('workspace')}</div>
      <nav aria-label={tx('navigation')}>
        {items.map(([id, Icon]) => <button key={id} type="button" className={`nav-item${view === id ? ' is-active' : ''}`}
          aria-current={view === id ? 'page' : undefined} onClick={() => onView(id)}>
          <Icon {...icon} /><span>{tx(`nav${id}`)}</span>
        </button>)}
      </nav>
    </div>
    <div className="sidebar-bottom">
      <div className="sidebar-preferences">
        <Segmented label={tx('themeGroup')} value={theme} onChange={onTheme} options={[
          { value: 'light', icon: <Sun {...icon} />, title: tx('themeLight') },
          { value: 'dark', icon: <Moon {...icon} />, title: tx('themeDark') },
          { value: 'system', icon: <Monitor {...icon} />, title: tx('themeSystem') },
        ]} />
        <Segmented label={tx('langGroup')} value={locale} onChange={onLocale}
          options={[{ value: 'zh-CN', label: '中' }, { value: 'en', label: 'EN' }]} />
      </div>
      <div className="sidebar-meta">
        <button type="button" className="sidebar-zone" onClick={() => onView('settings')} title={tx('timezoneTitle')}>
          <Globe2 size={15} aria-hidden="true" /><span>{timezone?.replaceAll('_', ' ') ?? '…'}</span>
        </button>
        <span className="local-badge"><HardDrive size={13} aria-hidden="true" />{tx('localWorkspace')}</span>
      </div>
    </div>
  </aside>;
}
