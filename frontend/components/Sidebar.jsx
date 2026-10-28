import { Activity, CalendarDays, Coins, PanelLeftClose, PanelLeftOpen, Settings2, ShieldCheck } from 'lucide-react';
import { IconButton } from './ui';

const groups = [
  { label: 'navInsights', items: [['today', Activity], ['calendar', CalendarDays]] },
  { label: 'navManage', items: [['prices', Coins], ['settings', Settings2]] },
];

// Navigation groups, then the privacy note and one line with the reporting
// time zone (opens Settings) and the collapse button.
export default function Sidebar({ view, onView, timezone, collapsed, onCollapse, tx }) {
  return <aside className="sidebar">
    <nav className="rail-nav" aria-label={tx('navigation')}>
      {groups.map(({ label, items }) => <div className="nav-group" key={label}><div className="rail-label">{tx(label)}</div>
        {items.map(([id, Icon]) => <button key={id} type="button" data-nav={id} title={collapsed ? tx('nav' + id) : undefined} className={'nav-item' + (view === id ? ' is-active' : '')} aria-current={view === id ? 'page' : undefined} onClick={() => onView(id)}>
          <Icon size={17} strokeWidth={1.6} aria-hidden="true" /><span className="nav-text">{tx('nav' + id)}</span>
        </button>)}
      </div>)}
    </nav>
    <div className="rail-bottom">
      <div className="privacy-note"><ShieldCheck size={15} strokeWidth={1.6} aria-hidden="true" /><div><strong>{tx('privacyTitle')}</strong><p>{tx('privacyDescription')}</p></div></div>
      <div className="rail-foot">
        <button type="button" className="rail-zone" title={tx('timezoneTitle')} onClick={() => onView('settings')}>{timezone ?? '…'}</button>
        <IconButton size="sm" variant="ghost" onClick={onCollapse} aria-expanded={!collapsed} label={tx(collapsed ? 'expandSidebar' : 'collapseSidebar')}>
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</IconButton>
      </div>
    </div>
  </aside>;
}
