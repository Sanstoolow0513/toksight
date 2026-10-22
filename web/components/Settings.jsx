import { useMemo, useRef } from 'react';
import { DatabaseBackup, DatabaseZap, Globe2, LoaderCircle } from 'lucide-react';
import { timezoneOptions } from '@/lib/period';
import { fmtDateTime } from '@/lib/format';

export default function Settings({ tx, timezone, timezonePref, systemZone, onTimezone, now, loading,
  databaseBusy, onImportDatabase, onExportDatabase }) {
  const databaseInput = useRef(null);
  const zones = useMemo(() => timezoneOptions(timezone), [timezone]);
  return <div className="settings-content">
    <section className="settings-section">
      <div className="settings-heading"><Globe2 size={20} aria-hidden="true" /><div><h2>{tx('timezoneTitle')}</h2><p>{tx('timezoneDescription')}</p></div></div>
      <label className="timezone-field"><span>{tx('timezoneLabel')}</span>
        <select value={timezonePref ?? 'auto'} onChange={(e) => onTimezone(e.target.value)}>
          <option value="auto">{tx('timezoneAuto', { zone: systemZone ?? '…' })}</option>
          {zones.map((zone) => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}
        </select>
      </label>
      <p className="timezone-preview">{tx('timezonePreview', { time: timezone ? fmtDateTime(now, timezone) : '…' })}</p>
      <p className="settings-note">{tx('timezoneNote')}</p>
    </section>
    <section className="settings-section">
      <div className="settings-heading"><DatabaseBackup size={20} aria-hidden="true" /><div><h2>{tx('databaseActions')}</h2><p>{tx('databaseDescription')}</p></div></div>
      <input ref={databaseInput} type="file" className="visually-hidden" tabIndex={-1} accept=".sqlite,.sqlite3,.db,application/vnd.sqlite3" aria-label={tx('importDatabase')}
        onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) onImportDatabase(file); }} />
      <div className="settings-row"><div><h3>{tx('exportDatabase')}</h3><p>{tx('databaseAllHint')}</p></div>
        <button type="button" className="btn-secondary" disabled={loading} onClick={onExportDatabase}>
          {databaseBusy === 'export' ? <LoaderCircle size={16} className="spin" /> : <DatabaseBackup size={16} />}{tx(databaseBusy === 'export' ? 'exportingDatabase' : 'exportDatabase')}
        </button>
      </div>
      <div className="settings-row"><div><h3>{tx('importDatabase')}</h3><p>{tx('databaseMergeHint')}</p></div>
        <button type="button" className="btn-secondary" disabled={loading} onClick={() => databaseInput.current?.click()}>
          {databaseBusy === 'import' ? <LoaderCircle size={16} className="spin" /> : <DatabaseZap size={16} />}{tx(databaseBusy === 'import' ? 'importingDatabase' : 'importDatabase')}
        </button>
      </div>
    </section>
  </div>;
}
