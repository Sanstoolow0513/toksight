'use client';

// Dashboard footer: timezone, data range, generation time, unpriced models,
// version + the local-first declaration. Unpriced models must stay visible
// (design-spec §8) — never drop that span.

import { fmtDateTime } from '@/lib/format';

export default function DashboardFooter({ data, tx }) {
  const unpriced = data.pricing?.unpricedModels ?? [];
  return (
    <footer className="foot">
      <span>{tx('footTimezone', { tz: data.timezone ?? '—' })}</span>
      <span>
        {tx('footRange', {
          range: data.activityRange?.firstAt
            ? `${fmtDateTime(data.activityRange.firstAt)} → ${fmtDateTime(data.activityRange.lastAt)}`
            : '—',
        })}
      </span>
      <span>{tx('footGenerated', { time: fmtDateTime(data.generatedAt) })}</span>
      {unpriced.length > 0 && <span>{tx('footUnpriced', { models: unpriced.join(', ') })}</span>}
      <span>{tx('footLocal', { version: data.version })}</span>
    </footer>
  );
}
