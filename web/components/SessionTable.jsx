'use client';

// Top sessions table (top 10 by tokens, sliced by the page): rank, agent,
// session (title, falling back to directory / sessionId, truncated with a
// title tooltip), tokens, requests, hit rate, cost, start date and active
// duration (activeMs, idle gaps capped at 5 minutes).

import { fmtTokens, fmtCost, fmtPct, fmtDuration, fmtDateOnly } from '@/lib/format';
import { clientLabel } from '@/lib/clients';

const sessionName = (s) => s.title || s.directory || s.sessionId || '—';

export default function SessionTable({ rows, tx }) {
  if (!rows.length) return <div className="muted">{tx('sessEmpty')}</div>;
  return (
    <div className="table-scroll">
      <table className="tbl">
        <thead>
          <tr>
            <th>{tx('thRank')}</th>
            <th>{tx('thAgent')}</th>
            <th>{tx('thSession')}</th>
            <th className="num">{tx('thTokens')}</th>
            <th className="num">{tx('thRequests')}</th>
            <th className="num">{tx('thHitRate')}</th>
            <th className="num">{tx('thCost')}</th>
            <th>{tx('thStarted')}</th>
            <th className="num">{tx('thActive')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const name = sessionName(s);
            return (
              <tr key={`${s.client}/${s.sessionId}`}>
                <td className="num dim">{i + 1}</td>
                <td>{clientLabel(s.client)}</td>
                <td>
                  <span className="sess-name" title={name}>
                    {name}
                  </span>
                </td>
                <td className="num">{fmtTokens(s.totalTokens)}</td>
                <td className="num">{s.requests}</td>
                <td className="num">{fmtPct(s.cacheHitRate)}</td>
                <td className="num">{fmtCost(s.costUsd)}</td>
                <td className="dim">{fmtDateOnly(s.startedAt)}</td>
                <td className="num">{fmtDuration(s.activeMs)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
