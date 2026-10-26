import { LoaderCircle, RefreshCw } from 'lucide-react';
import { useQuota } from '@/lib/useQuota';
import { fmtDateTime } from '@/lib/format';
import { spanLabel } from '@/lib/i18n';

const pct = (value) => `${Number.isInteger(value) ? value : value.toFixed(1)}%`;

function QuotaWindow({ window: w, now, timezone, locale, tx }) {
  const at = Date.parse(w.resetsAt);
  const label = w.id === '5h' ? tx('quota5h') : w.id === 'week' ? tx('quotaWeek') : w.id === 'month' ? tx('quotaMonth') : w.label;
  const reset = w.reset ? tx('quotaRolledOver') : Number.isFinite(at)
    ? tx('quotaResetsAt', { time: fmtDateTime(at, timezone), span: spanLabel(locale, at - now) }) : tx('quotaResetUnknown');
  const used = w.usedPercent;
  return <li className="quota-window">
    <span className="quota-window-label">{label}</span>
    <span className="quota-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={used ?? undefined}
      aria-valuetext={used == null ? tx('quotaRolledOver') : pct(used)}><i style={{ width: `${used ?? 0}%` }} /></span>
    <span className="quota-used">{used == null ? '—' : pct(used)}{w.used != null && w.limit != null ? <em>{w.used}/{w.limit}</em> : null}</span>
    <span className="quota-reset">{reset}</span>
  </li>;
}

export default function QuotaCard({ revision, timezone, locale, tx }) {
  const { payload, error, busy, refresh } = useQuota(revision);
  const now = payload ? Date.parse(payload.generatedAt) : Date.now();
  const quotas = payload?.quotas ?? [];
  if (!quotas.length && !error) return null;
  const offline = Boolean(payload?.offline);
  const hasKimi = quotas.some((q) => q.client === 'kimi');
  return <section className="quota-card no-export" aria-labelledby="quota-title">
    <header className="quota-head">
      <div><h3 id="quota-title">{tx('quotaTitle')}</h3><p>{tx('quotaNote')}</p></div>
      {hasKimi ? <button type="button" className="btn-secondary quota-refresh" disabled={busy || offline} title={offline ? tx('quotaOffline') : undefined} onClick={() => void refresh()}>
        {busy ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}{tx(busy ? 'quotaRefreshing' : 'quotaRefresh')}</button> : null}
    </header>
    {error ? <p className="quota-error" role="alert">{error}</p> : null}
    <div className="quota-clients">{quotas.map((q) => <div key={q.client} className="quota-client">
      <div className="quota-client-head">
        <span className="agent-title"><i className="agent-dot" style={{ '--agent': `var(--agent-${q.client}, var(--text-3))` }} /><span className="agent-name">{q.label}</span></span>
        {q.plan ? <span className="quota-plan">{q.plan}</span> : null}
      </div>
      {q.windows.length ? <ul className="quota-windows">{q.windows.map((w) => <QuotaWindow key={w.id} window={w} now={now} timezone={timezone} locale={locale} tx={tx} />)}</ul> : null}
      {q.error ? <p className="quota-message">{q.error.code === 'KIMI_NOT_FETCHED' ? tx('quotaNotFetched') : q.error.code === 'KIMI_OFFLINE' ? tx('quotaOffline')
        : q.error.code === 'KIMI_TOKEN_EXPIRED' ? tx('quotaExpired') : q.error.message}</p>
        : <p className="quota-source">{q.source === 'local' ? tx('quotaLocal', { time: fmtDateTime(q.observedAt, timezone) }) : tx('quotaApi', { time: fmtDateTime(q.fetchedAt, timezone) })}</p>}
    </div>)}</div>
  </section>;
}
