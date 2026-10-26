import { Activity, CalendarDays, ChevronRight, Coins, Cpu, Globe2, PanelLeftClose, PanelLeftOpen, Settings2, ShieldCheck } from 'lucide-react';
import { IconButton } from './ui';

const groups = [
  { label: 'navInsights', items: [['today', Activity], ['calendar', CalendarDays]] },
  { label: 'navManage', items: [['prices', Coins], ['settings', Settings2]] },
];
// Index numbers continue across groups: 01 Today … 04 Settings.
export const NAV_INDEX = Object.fromEntries(groups.flatMap((group) => group.items).map(([id], i) => [id, String(i + 1).padStart(2, '0')]));

export default function Sidebar({ view, onView, timezone, collapsed, onCollapse, tx }) {
  return <aside className="sidebar">
    <button type="button" className="rail-card" onClick={() => onView('settings')} title={tx('navsettings')}><span className="rail-symbol"><Cpu size={18} strokeWidth={1.5} /></span>
      <span className="rail-card-text"><span>{tx('localWorkspace')}</span><strong>{tx('personalWorkspace')}</strong></span><ChevronRight className="rail-chevron" size={14} strokeWidth={1.5} /></button>
    <button type="button" className="rail-zone" title={timezone ?? tx('timezoneTitle')} onClick={() => onView('settings')}><Globe2 size={15} strokeWidth={1.5} /><span>{timezone?.replaceAll('_', ' ') ?? '…'}</span><ChevronRight size={14} strokeWidth={1.5} /></button>
    <nav className="rail-nav" aria-label={tx('navigation')}>
      {groups.map(({ label, items }) => <div className="nav-group" key={label}><div className="rail-label">{tx(label)}</div>
        {items.map(([id, Icon]) => <button key={id} type="button" data-nav={id} title={tx('nav' + id)} className={'nav-item' + (view === id ? ' is-active' : '')} aria-current={view === id ? 'page' : undefined} onClick={() => onView(id)}>
          <span className="nav-index" aria-hidden="true">{NAV_INDEX[id]}</span><Icon size={17} strokeWidth={1.6} aria-hidden="true" /><span className="nav-text">{tx('nav' + id)}</span>
        </button>)}
      </div>)}
    </nav>
    <div className="rail-bottom">
      <div className="privacy-note"><ShieldCheck size={18} strokeWidth={1.5} aria-hidden="true" /><strong>{tx('privacyTitle')}</strong><p>{tx('privacyDescription')}</p></div>
      <div className="rail-foot"><span>LOCAL WORKSPACE</span><IconButton size="sm" onClick={onCollapse} aria-expanded={!collapsed} label={tx(collapsed ? 'expandSidebar' : 'collapseSidebar')}>
        {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</IconButton></div>
    </div>
  </aside>;
}
