import { ChevronLeft, ChevronRight, ImageDown, LoaderCircle, Monitor, Moon, RefreshCw, Sun } from 'lucide-react';
import BrandMark from '@/components/BrandMark';
import Segmented from '@/components/Segmented';
import { periodLabel } from '@/lib/i18n';

const icon = { size: 15, strokeWidth: 2, 'aria-hidden': true };

export default function Toolbar({ locale, tx, period, nav, onMode, onShift, theme, onTheme, onLocale, loading, onRefresh, exporting, onExport, canExport }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <BrandMark />
          <span className="brand-name">toksight</span>
        </div>
        <div className="toolbar" role="toolbar" aria-label={tx('toolbarAria')}>
          {period ? (
            <div className="toolbar-group">
              <Segmented
                label={tx('modeGroup')}
                value={period.mode}
                onChange={onMode}
                options={[{ value: 'month', label: tx('modeMonth') }, { value: 'year', label: tx('modeYear') }]}
              />
              <div className="period-nav">
                <button type="button" className="icon-btn" onClick={() => onShift(-1)} disabled={!nav.canPrev} aria-label={tx('prev')} title={tx('prev')}>
                  <ChevronLeft {...icon} />
                </button>
                <span className="period-label" aria-live="polite">{periodLabel(locale, period)}</span>
                <button type="button" className="icon-btn" onClick={() => onShift(1)} disabled={!nav.canNext} aria-label={tx('next')} title={tx('next')}>
                  <ChevronRight {...icon} />
                </button>
              </div>
            </div>
          ) : null}
          <div className="toolbar-group">
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
            <button type="button" className="icon-btn" onClick={onRefresh} disabled={loading} aria-label={tx(loading ? 'refreshing' : 'refresh')} title={tx(loading ? 'refreshing' : 'refresh')}>
              <RefreshCw {...icon} className={loading ? 'spin' : undefined} />
            </button>
            <button type="button" className="btn-primary" onClick={onExport} disabled={!canExport || exporting}>
              {exporting ? <LoaderCircle {...icon} className="spin" /> : <ImageDown {...icon} />}
              {tx(exporting ? 'exporting' : 'exportImage')}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
