import { RefreshCw } from 'lucide-react';
import { useQuota } from '@/lib/useQuota';
import { fmtDateTime } from '@/lib/format';
import { spanLabel } from '@/lib/i18n';
import { AgentDot } from './Marks';
import { Badge, Button, Meter, Panel } from './ui';

const pct = (value) => `${Number.isInteger(value) ? value : value.toFixed(1)}%`;

function QuotaWindow({ window: w, now, timezone, locale, tx }) {
  const at = Date.parse(w.resetsAt);
  const label = w.id === '5h' ? tx('quota5h') : w.id === 'week' ? tx('quotaWeek') : w.id === 'month' ? tx('quotaMonth') : w.label;
  const reset = w.reset ? tx('quotaRolledOver') : Number.isFinite(at)
    ? tx('quotaResetsAt', { time: fmtDateTime(at, timezone), span: spanLabel(locale, at - now) }) : tx('quotaResetUnknown');
  const used = w.usedPercent;
  return <li className="quota-window">
    <span className="quota-window-label">{label}</span>
    <Meter label={label} value={used} valueText={used == null ? tx('quotaRolledOver') : pct(used)} />
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
  return <Panel className="quota-card no-export" aria-labelledby="quota-title" title={tx('quotaTitle')} titleProps={{ id: 'quota-title' }}
    actions={hasKimi ? <Button size="sm" className="quota-refresh" disabled={offline} loading={busy} title={offline ? tx('quotaOffline') : undefined} icon={<RefreshCw size={14} />} onClick={() => void refresh()}>
      {tx(busy ? 'quotaRefreshing' : 'quotaRefresh')}</Button> : null}>
    {error ? <p className="quota-error error-text" role="alert">{error}</p> : null}
    <div className="quota-clients">{quotas.map((q) => <div key={q.client} className="quota-client">
      <div className="quota-client-head">
        <span className="agent-title"><AgentDot id={q.client} /><span className="agent-name">{q.label}</span></span>
        {q.plan ? <Badge className="quota-plan">{q.plan}</Badge> : null}
      </div>
      {q.windows.length ? <ul className="quota-windows">{q.windows.map((w) => <QuotaWindow key={w.id} window={w} now={now} timezone={timezone} locale={locale} tx={tx} />)}</ul> : null}
      {q.error ? <p className="quota-message">{q.error.code === 'KIMI_NOT_FETCHED' ? tx('quotaNotFetched') : q.error.code === 'KIMI_OFFLINE' ? tx('quotaOffline')
        : q.error.code === 'KIMI_TOKEN_EXPIRED' ? tx('quotaExpired') : q.error.message}</p>
        : <p className="quota-source">{q.source === 'local' ? tx('quotaLocal', { time: fmtDateTime(q.observedAt, timezone) }) : tx('quotaApi', { time: fmtDateTime(q.fetchedAt, timezone) })}</p>}
    </div>)}</div>
  </Panel>;
}
