import { REASON_KEYS, NOTE_KEYS } from '@/lib/transfer';

export default function ImportPlan({ plan, selected, onToggle, busy, tx }) {
  return <div className="config-plan">
    <p className="muted">{tx('cfgDiffIntro')}</p>
    {plan.map((row) => <article className="config-plan-file" key={row.id}>
      <div className="config-plan-head">
        <label>
          {row.action === 'write' && <input type="checkbox" checked={selected.has(row.id)} disabled={busy} onChange={() => onToggle(row.id)} />}
          <b>{row.agentId} · {row.fileName || row.id}</b>
        </label>
        <span className={`tag ${row.action === 'write' ? row.existing ? 'tag-warn' : 'tag-ok' : ''}`}>
          {tx(row.action === 'write' ? row.existing ? 'cfgXferActionReplace' : 'cfgXferActionNew' : REASON_KEYS[row.reason] || 'cfgXferActionSkip')}
        </span>
      </div>
      {row.targetPath && <p className="config-plan-path">{tx('cfgXferColTarget')}: <code>{row.targetPath}</code></p>}
      {row.notes?.length > 0 && <ul className="config-migration-notes">{row.notes.map((note) => <li key={note}>{tx(NOTE_KEYS[note])}</li>)}</ul>}
      {row.diff && row.change !== 'unchanged' && <details className="config-diff" open>
        <summary>{tx('cfgDiffTitle')}</summary>
        {row.diff.hiddenChanges && <p className="muted">{tx('cfgDiffHidden')}</p>}
        {row.diff.truncated && <p className="muted">{tx('cfgDiffTruncated')}</p>}
        <pre>{row.diff.lines.map((line, index) => <span className={`config-diff-${line.kind}`} key={index}>{line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '- ' : '  '}{line.text}{'\n'}</span>)}</pre>
      </details>}
    </article>)}
  </div>;
}
