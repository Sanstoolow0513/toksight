import { useMemo, useRef } from 'react';
import { DatabaseBackup, DatabaseZap, Globe2, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { Button, Field, Panel, Segmented } from './ui';
import { timezoneOptions } from '@/lib/period';
import { fmtDateTime } from '@/lib/format';
import GitHubBackup from './GitHubBackup';

export default function Settings({ tx, timezone, timezonePref, systemZone, onTimezone, now, loading, theme, locale, onTheme, onLocale,
  databaseBusy, onImportDatabase, onExportDatabase, backup, onBackupSave, onBackupUpload, onBackupRestore }) {
  const databaseInput = useRef(null);
  const zones = useMemo(() => timezoneOptions(timezone), [timezone]);
  return <div className="settings-content">
    <Panel className="settings-section appearance-settings" level={2} icon={<Palette size={18} aria-hidden="true" />} title={tx('appearanceTitle')}>
      <div className="settings-row"><h3>{tx('themeGroup')}</h3><Segmented wrap label={tx('themeGroup')} value={theme} onChange={onTheme} options={[
        { value: 'light', label: tx('themeLight'), icon: <Sun size={15} /> }, { value: 'dark', label: tx('themeDark'), icon: <Moon size={15} /> }, { value: 'system', label: tx('themeSystem'), icon: <Monitor size={15} /> },
      ]} /></div>
      <div className="settings-row"><h3>{tx('langGroup')}</h3><Segmented wrap label={tx('langGroup')} value={locale} onChange={onLocale} options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }]} /></div>
    </Panel>
    <Panel className="settings-section" level={2} icon={<Globe2 size={18} aria-hidden="true" />} title={tx('timezoneTitle')} note={tx('timezoneDescription')}>
      <div className="settings-body">
      <Field label={tx('timezoneLabel')} className="timezone-field">
        <select value={timezonePref ?? 'auto'} onChange={(e) => onTimezone(e.target.value)}>
          <option value="auto">{tx('timezoneAuto', { zone: systemZone ?? '…' })}</option>
          {zones.map((zone) => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}
        </select>
      </Field>
      <p className="timezone-preview">{tx('timezonePreview', { time: timezone ? fmtDateTime(now, timezone) : '…' })}</p>
      <p className="muted-note">{tx('timezoneNote')}</p>
      </div>
    </Panel>
    <Panel className="settings-section" level={2} icon={<DatabaseBackup size={18} aria-hidden="true" />} title={tx('databaseActions')} note={tx('databaseDescription')}>
      <input ref={databaseInput} type="file" className="visually-hidden" tabIndex={-1} accept=".sqlite,.sqlite3,.db,application/vnd.sqlite3" aria-label={tx('importDatabase')}
        onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) onImportDatabase(file); }} />
      <div className="settings-row"><div><h3>{tx('exportDatabase')}</h3><p>{tx('databaseAllHint')}</p></div>
        <Button disabled={loading} loading={databaseBusy === 'export'} icon={<DatabaseBackup size={15} />} onClick={onExportDatabase}>
          {tx(databaseBusy === 'export' ? 'exportingDatabase' : 'exportDatabase')}
        </Button>
      </div>
      <div className="settings-row"><div><h3>{tx('importDatabase')}</h3><p>{tx('databaseMergeHint')}</p></div>
        <Button disabled={loading} loading={databaseBusy === 'import'} icon={<DatabaseZap size={15} />} onClick={() => databaseInput.current?.click()}>
          {tx(databaseBusy === 'import' ? 'importingDatabase' : 'importDatabase')}
        </Button>
      </div>
    </Panel>
    {backup ? <GitHubBackup backup={backup} loading={loading} timezone={timezone} tx={tx} onSave={onBackupSave} onUpload={onBackupUpload} onConfirmRestore={onBackupRestore} onDetect={() => void backup.detect()} /> : null}
  </div>;
}
