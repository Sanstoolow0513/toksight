'use client';

// The calendar's detail pane: the selection's header and totals, the hourly
// strip (single day only) and the usage split, which can swap to sessions.

import { useMemo, useState } from 'react';
import { ArrowUpRight, ChartColumn, ChartPie, ChevronLeft, ChevronRight, RefreshCw, TriangleAlert } from 'lucide-react';
import { Button, IconButton, cx } from '@/components/ui';
import { CostValue, agentStyle } from '@/components/Marks';
import { SessionRow } from '@/components/DayDetail';
import { coded } from '@/components/Coded';
import { agentRows, cacheHitRate, costPerMillion, hourlyBars, mergedModelRows, pricing, sessionRows, sumDays } from '@/lib/report';
import { isoWeek, shiftDay, weekKeys } from '@/lib/period';
import { fmtCost, fmtInt, fmtPct, fmtTokens, fmtTokensShort } from '@/lib/format';
import { dayLabel, weekdayLabel } from '@/lib/i18n';

const icon = { size: 15, strokeWidth: 2, 'aria-hidden': true };
const hourText = (hour) => `${String(hour).padStart(2, '0')}:00`;

function Header({ selected, days, today, start, timezone, onSelect, locale, tx }) {
  const single = selected.length === 1;
  if (single) {
    const day = selected[0];
    const prev = shiftDay(day, -1), next = shiftDay(day, 1);
    return <div className="dhead-row">
      <h2 className="dtitle" aria-live="polite">{dayLabel(locale, day)} {weekdayLabel(locale, day)}</h2>
      <span className="dmeta">{[day === today ? tx('dayToday') : null, timezone].filter(Boolean).join(' · ')}</span>
      <div className="dnav no-export">
        <IconButton size="sm" label={tx('dayPrev')} disabled={prev < start} onClick={() => onSelect([prev], prev)}><ChevronLeft {...icon} /></IconButton>
        <IconButton size="sm" label={tx('dayNext')} disabled={next > today} onClick={() => onSelect([next], next)}><ChevronRight {...icon} /></IconButton>
      </div>
    </div>;
  }
  const first = selected[0], last = selected.at(-1);
  const week = weekKeys(first).filter((key) => key >= start && key <= today);
  const isWeek = week.length === selected.length && week.every((key, i) => key === selected[i]);
  const { year, week: number } = isoWeek(first);
  const contiguous = shiftDay(first, selected.length - 1) === last;
  const to = `${dayLabel(locale, last)}${contiguous ? '' : ` · ${tx('calNonContiguous')}`}`;
  return <div className="dhead-row">
    <h2 className="dtitle" aria-live="polite">{isWeek ? tx('calWeekHeading', { year, n: number }) : tx('calSelectedDays', { n: fmtInt(selected.length) })}</h2>
    <span className="dmeta">{tx('calRangeMeta', { from: dayLabel(locale, first), to, n: fmtInt(sumDays(days, selected).activeDays) })}</span>
    <div className="dnav no-export"><Button variant="text" size="sm" onClick={() => onSelect([last], last)}>{tx('calClear')}</Button></div>
  </div>;
}

function Stats({ data, selected, days, tx }) {
  const totals = data.totals ?? {};
  const unpriced = totals.requests > 0 && !totals.pricedRequests;
  const items = [
    [tx('kpiTokens'), fmtTokens(totals.totalTokens)],
    [tx('kpiCost'), unpriced ? tx('rowUnpriced') : <>{fmtCost(totals.costUsd)}{pricing(totals) === 'partial' ? <sup className="partial-mark" title={tx('rowPartial')}>*</sup> : null}</>],
    [tx('kpiCache'), fmtPct(cacheHitRate(totals))],
    [tx('kpiRequests'), fmtInt(totals.requests)],
  ];
  let sub;
  if (selected.length === 1) {
    const rate = pricing(totals) === 'none' ? null : costPerMillion(totals);
    sub = tx('calDaySub', { output: fmtTokens(totals.outputTokens), rate: rate == null ? '—' : fmtCost(rate), n: fmtInt(totals.sessions) });
  } else {
    const active = sumDays(days, selected).activeDays || 1;
    sub = tx('calRangeSub', { tokens: fmtTokens(totals.totalTokens / active), cost: fmtCost((totals.costUsd || 0) / active), n: fmtInt(totals.sessions) });
  }
  return <>
    <dl className="dstats">{items.map(([label, value]) => <div key={label}><dd>{value}</dd><dt>{label}</dt></div>)}</dl>
    <p className="dsub" title={sub}>{sub}</p>
  </>;
}

function Hourly({ data, tx }) {
  const { bars, max, peak } = useMemo(() => hourlyBars(data.hourly), [data.hourly]);
  return <section className="dcard hourly plate" aria-label={tx('secHourly')}>
    <header className="dcard-head">
      <ChartColumn {...icon} /><h3>{tx('secHourly')}</h3><span className="dcard-sub">{tx('hourlySub')}</span>
      <span className="dcard-aside">{peak ? tx('hourlyPeak', { hour: hourText(peak.hour), value: fmtTokensShort(max) }) : tx('tipIdle')}</span>
    </header>
    <div className="hbars" role="img" aria-label={peak ? tx('hourlyPeak', { hour: hourText(peak.hour), value: fmtTokens(max) }) : tx('tipIdle')}>
      {bars.map((bar) => {
        const tiny = bar.value < max * 0.01;
        return <i key={bar.hour} className={cx(bar === peak && 'is-peak', tiny && 'is-tiny')} title={`${hourText(bar.hour)} · ${fmtTokens(bar.value)}`}
          style={tiny ? undefined : { height: `${bar.height * 100}%` }} />;
      })}
    </div>
    <div className="haxis" aria-hidden="true">{['00', '06', '12', '18', '24'].map((h) => <span key={h}>{h}</span>)}</div>
  </section>;
}

function SplitRow({ name, nameClass, style, title, row, share, fill, sub, tx }) {
  return <li className="srow" style={style}>
    <div className="srow-main">
      <span className={cx('sname', nameClass)} title={title}>{fill === 'agent' ? <i className="swatch agent-dot" aria-hidden="true" /> : null}<span>{name}</span></span>
      <span className="snum">{fmtTokensShort(row.totalTokens)}</span>
      <CostValue row={{ ...row, pricing: pricing(row) }} tx={tx} />
      <span className="sshare">{fmtPct(share)}</span>
    </div>
    <span className={cx('sbar', fill === 'agent' && 'is-agent')} aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }} /></span>
    <div className="ssub">{sub}</div>
  </li>;
}

function Split({ data, agentLabel, tx }) {
  const total = data.totals?.totalTokens || 0;
  const agents = useMemo(() => agentRows(data.clients), [data.clients]);
  const models = useMemo(() => mergedModelRows(data.models), [data.models]);
  const share = (row) => total > 0 ? row.totalTokens / total : 0;
  const head = <div className="shead" aria-hidden="true"><span /><span>Tokens</span><span>{tx('splitCost')}</span><span>{tx('splitShare')}</span></div>;
  return <>
    <div className="sgroup">
      <div className="sgroup-title"><span>{tx('splitByAgent')}</span><span>{tx('splitCount', { n: fmtInt(agents.length) })}</span></div>
      {head}
      <ul className="slist">{agents.map((row) => <SplitRow key={row.id} name={agentLabel(row.id)} fill="agent" style={agentStyle(row.id)} row={row} share={share(row)} tx={tx}
        sub={tx('splitAgentSub', { pct: fmtPct(cacheHitRate(row)), n: fmtInt(row.requests) })} />)}</ul>
    </div>
    <div className="sgroup">
      <div className="sgroup-title"><span>{tx('splitByModel')}</span><span>{tx('splitCount', { n: fmtInt(models.length) })}</span></div>
      {head}
      <ul className="slist">{models.map((row) => {
        const rate = pricing(row) === 'none' ? null : costPerMillion(row);
        return <SplitRow key={row.model} name={row.model} nameClass="is-mono" row={row} share={share(row)} tx={tx}
          title={`${row.model}\n${tx('splitModelAgents', { agents: row.clients.map(agentLabel).join(', ') })}`}
          sub={tx('splitModelSub', { pct: fmtPct(row.cacheHitRate), output: fmtTokens(row.outputTokens), rate: rate == null ? '—' : fmtCost(rate) })} />;
      })}</ul>
    </div>
  </>;
}

export default function CalendarDetail({ report, selected, days, today, start, timezone, onSelect, agentLabel, locale, tx }) {
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const data = report.data;
  const stale = Boolean(data) && (report.loading || report.key !== selected.join(','));
  const empty = data && !data.totals?.requests;
  const sessions = useMemo(() => data ? sessionRows(data.topSessions, 50) : [], [data]);
  const single = selected.length === 1;
  return <section className={cx('dcol', stale && 'is-loading')} aria-busy={stale || !data}>
    <div className="dhead plate">
      <Header selected={selected} days={days} today={today} start={start} timezone={timezone} onSelect={onSelect} locale={locale} tx={tx} />
      {report.error ? <div className="notice is-error" role="alert"><TriangleAlert {...icon} />
        <div><p>{coded(tx('errorBody', { error: report.error }))}</p>
          <Button size="sm" icon={<RefreshCw {...icon} />} onClick={() => void report.reload()}>{tx('retry')}</Button></div></div>
        : !data ? <div className="skel dstats-skel" />
          : empty ? <p className="dempty">{tx(single ? 'dayEmpty' : 'calRangeEmpty')}</p>
            : <Stats data={data} selected={selected} days={days} tx={tx} />}
    </div>
    {data && !empty && single ? <Hourly data={data} tx={tx} /> : null}
    {data && !empty ? <section className="dcard split plate" aria-label={tx(sessionsOpen ? 'secSessions' : 'splitTitle')}>
      <header className="dcard-head">
        <ChartPie {...icon} /><h3>{tx(sessionsOpen ? 'secSessions' : 'splitTitle')}</h3>
        <Button variant="text" size="sm" className="dcard-aside no-export" aria-pressed={sessionsOpen} onClick={() => setSessionsOpen(!sessionsOpen)}>
          {tx(sessionsOpen ? 'viewSplit' : single ? 'viewDaySessions' : 'viewRangeSessions')}{sessionsOpen ? null : <ArrowUpRight {...icon} />}
        </Button>
      </header>
      <div className="dcard-body">
        {sessionsOpen ? <ol className="session-list">{sessions.map((row, index) => <SessionRow key={row.client + '/' + row.sessionId} row={row} index={index} agentLabel={agentLabel} locale={locale} tx={tx} timezone={data.timezone} />)}</ol>
          : <Split data={data} agentLabel={agentLabel} tx={tx} />}
      </div>
    </section> : null}
  </section>;
}
