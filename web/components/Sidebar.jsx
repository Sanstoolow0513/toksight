import { CalendarDays, Globe2, HardDrive, Settings2, Sun } from 'lucide-react';

const items = [['today', Sun], ['calendar', CalendarDays], ['settings', Settings2]];

export default function Sidebar({ view, onView, timezone, tx }) {
  return <aside className="sidebar">
    <div className="sidebar-label">{tx('workspace')}</div>
    <nav aria-label={tx('navigation')}>
      {items.map(([id, Icon]) => <button key={id} type="button" className={`nav-item${view === id ? ' is-active' : ''}`}
        aria-current={view === id ? 'page' : undefined} onClick={() => onView(id)}>
        <Icon size={18} strokeWidth={1.7} aria-hidden="true" /><span>{tx(`nav${id}`)}</span>
      </button>)}
    </nav>
    <div className="sidebar-bottom">
      <button type="button" className="sidebar-zone" onClick={() => onView('settings')} title={tx('timezoneTitle')}>
        <Globe2 size={15} aria-hidden="true" /><span>{timezone?.replaceAll('_', ' ') ?? '…'}</span>
      </button>
      <span className="local-badge"><HardDrive size={13} aria-hidden="true" />{tx('localWorkspace')}</span>
    </div>
  </aside>;
}
