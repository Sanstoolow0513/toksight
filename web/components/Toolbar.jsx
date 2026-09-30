import { Monitor, Moon, Sun } from 'lucide-react';
import BrandMark from '@/components/BrandMark';
import Segmented from '@/components/Segmented';

const icon = { size: 15, strokeWidth: 2, 'aria-hidden': true };

export default function Toolbar({ locale, tx, theme, onTheme, onLocale }) {
  return (
    <header className="topbar">
      <div className="topbar-inner is-plain">
        <div className="brand">
          <BrandMark />
          <span className="brand-name">toksight</span>
        </div>
        <span className="topbar-caption">{tx('topbarCaption')}</span>
        <div className="toolbar" role="toolbar" aria-label={tx('toolbarAria')}>
          <Segmented
            label={tx('themeGroup')}
            value={theme}
            onChange={onTheme}
            options={[
              { value: 'light', icon: <Sun {...icon} />, title: tx('themeLight') },
              { value: 'dark', icon: <Moon {...icon} />, title: tx('themeDark') },
              { value: 'system', icon: <Monitor {...icon} />, title: tx('themeSystem') },
            ]}
          />
          <Segmented
            label={tx('langGroup')}
            value={locale}
            onChange={onLocale}
            options={[{ value: 'zh-CN', label: '中' }, { value: 'en', label: 'EN' }]}
          />

        </div>
      </div>
    </header>
  );
}
