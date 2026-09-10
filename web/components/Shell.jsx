'use client';

// Shared page shell: wrap → frame → masthead. The masthead carries the mono
// logo, a page-meta slot on the left, and on the right the dashboard/config
// text nav (active page marked), the theme segmented switch (system / light
// / dark, persisted via lib/theme.js), the language segmented switch and a
// page-actions slot. Both `/` and `/config` render through this shell so the
// chrome exists exactly once.

import Link from 'next/link';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme';

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

export function ThemeSwitch({ tx }) {
  const { theme, setTheme } = useTheme();
  const options = [
    { id: 'system', icon: Monitor, label: tx('themeSystem') },
    { id: 'light', icon: Sun, label: tx('themeLight') },
    { id: 'dark', icon: Moon, label: tx('themeDark') },
  ];
  return (
    <div className="seg" role="group" aria-label={tx('themeGroup')}>
      {options.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          type="button"
          className={theme === id ? 'seg-icon on' : 'seg-icon'}
          title={label}
          aria-label={label}
          aria-pressed={theme === id}
          onClick={() => setTheme(id)}
        >
          <Icon size={13} strokeWidth={1.5} aria-hidden="true" />
        </button>
      ))}
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
            <ThemeSwitch tx={tx} />
            <LangSwitch locale={locale} onChange={setLocale} label={tx('langGroup')} />
            {actions}
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
