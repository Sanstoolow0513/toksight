import { REASON_KEYS } from '@/lib/transfer';

export default function ImportResults({ results, tx }) {
  if (!results) return null;
  return <div className="config-xfer-results" role="status">
    <b>{tx('cfgXferResultTitle')}</b>
    <ul>{results.map((row) => <li key={row.id}>
      <span>{row.id}</span>
      <span className={`tag ${row.status === 'written' ? 'tag-ok' : row.status === 'failed' ? 'tag-error' : ''}`}>
        {tx(row.status === 'written' ? 'cfgXferWritten' : REASON_KEYS[row.reason] || (row.status === 'failed' ? 'cfgXferFailed' : 'cfgXferSkipped'))}
      </span>
      {row.backupPath && <code>{tx('cfgXferBackupAt')} {row.backupPath}</code>}
      {row.error && <code>{row.error}</code>}
    </li>)}</ul>
    {results.some((row) => row.backupPath) && <p className="muted">{tx('cfgRestoreHint')}</p>}
  </div>;
}
