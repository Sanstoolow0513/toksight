import { Activity, CalendarDays, ChevronRight, Coins, Cpu, Globe2, PanelLeftClose, PanelLeftOpen, Settings2, ShieldCheck } from 'lucide-react';

const groups = [
  { label: 'navInsights', items: [['today', Activity], ['calendar', CalendarDays]] },
  { label: 'navManage', items: [['prices', Coins], ['settings', Settings2]] },
];

export default function Sidebar({ view, onView, timezone, collapsed, onCollapse, tx }) {
  return <aside className="sidebar">
    <button type="button" className="workspace-card" onClick={() => onView('settings')} title={tx('navsettings')}><span className="workspace-symbol"><Cpu size={20} strokeWidth={1.5} /></span>
      <div><span>{tx('localWorkspace')}</span><strong>{tx('personalWorkspace')}</strong></div><ChevronRight className="workspace-chevron" size={14} strokeWidth={1.5} /></button>
    <button type="button" className="sidebar-zone" title={timezone ?? tx('timezoneTitle')} onClick={() => onView('settings')}><Globe2 size={16} strokeWidth={1.5} /><span>{timezone?.replaceAll('_', ' ') ?? '…'}</span><ChevronRight size={14} strokeWidth={1.5} /></button>
    <div className="sidebar-panel"><nav className="sidebar-navigation" aria-label={tx('navigation')}>
      {groups.map(({ label, items }) => <div className="nav-group" key={label}><div className="sidebar-label">{tx(label)}</div>
        {items.map(([id, Icon]) => <button key={id} type="button" title={tx('nav' + id)} className={'nav-item' + (view === id ? ' is-active' : '')} aria-current={view === id ? 'page' : undefined} onClick={() => onView(id)}>
          <Icon size={19} strokeWidth={1.6} /><span>{tx('nav' + id)}</span>{view === id ? <i className="nav-indicator" /> : null}
        </button>)}
      </div>)}
    </nav>
    <div className="sidebar-bottom">
      <div className="privacy-note"><ShieldCheck size={21} strokeWidth={1.5} /><strong>{tx('privacyTitle')}</strong><p>{tx('privacyDescription')}</p></div>
      <div className="sidebar-foot"><span>LOCAL WORKSPACE</span><button type="button" className="icon-btn" onClick={onCollapse} aria-expanded={!collapsed} aria-label={tx(collapsed ? 'expandSidebar' : 'collapseSidebar')} title={tx(collapsed ? 'expandSidebar' : 'collapseSidebar')}>
        {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button></div>
    </div></div>
  </aside>;
}
