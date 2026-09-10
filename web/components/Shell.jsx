'use client';

// Shared page shell: wrap → frame → masthead. The masthead carries the mono
// logo, a page-meta slot on the left, and on the right the dashboard/config
// text nav (active page marked), the language segmented switch and a
// page-actions slot. Both `/` and `/config` render through this shell so the
// chrome exists exactly once.

import Link from 'next/link';

export function LangSwitch({ locale, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      <button type="button" className={locale === 'zh-CN' ? 'on' : ''} onClick={() => onChange('zh-CN')}>
        中文
      </button>
      <button type="button" className={locale === 'en' ? 'on' : ''} onClick={() => onChange('en')}>
        EN
      </button>
    </div>
  );
}

export default function Shell({ active, meta, actions, frameClass, tx, locale, setLocale, children }) {
  return (
    <div className="wrap">
      <div className={frameClass ? `frame ${frameClass}` : 'frame'}>
        <header className="masthead">
          <div className="brand">
            <h1 className="logo-chip">toksight</h1>
            {meta}
          </div>
          <div className="head-actions">
            <nav className="top-nav" aria-label={tx('navAria')}>
              <Link className={active === 'dashboard' ? 'active' : undefined} href="/" aria-current={active === 'dashboard' ? 'page' : undefined}>
                {tx('navDashboard')}
              </Link>
              <Link className={active === 'config' ? 'active' : undefined} href="/config" aria-current={active === 'config' ? 'page' : undefined}>
                {tx('navConfig')}
              </Link>
            </nav>
            <LangSwitch locale={locale} onChange={setLocale} label={tx('langGroup')} />
            {actions}
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
