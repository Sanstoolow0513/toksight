'use client';

// Collection-warning and active-filter banners (white cards with a semantic
// side bar). The filter banner restates client/since/until so the scope of
// every number on the page is visible at a glance. The separator after
// warnPrefix lives in the i18n table, not here, so each locale gets its own
// colon.

import { Filter, TriangleAlert } from 'lucide-react';
import { fmtDateTime } from '@/lib/format';
import { clientLabel } from '@/lib/clients';

export default function DashboardBanners({ data, tx }) {
  const filtered = Boolean(data.clientsFilter?.length || data.range?.since != null || data.range?.until != null);
  return (
    <>
      {data.warnings?.length > 0 && (
        <div className="banner warn">
          <TriangleAlert size={14} strokeWidth={1.5} aria-hidden="true" />
          <div>
            {data.warnings.map((w, i) => (
              <div key={i}>
                {tx('warnPrefix')}
                {w}
              </div>
            ))}
          </div>
        </div>
      )}
      {filtered && (
        <div className="banner filter">
          <Filter size={14} strokeWidth={1.5} aria-hidden="true" />
          <span>
            {tx('filterNote')}
            {[
              data.clientsFilter?.length ? tx('filterClient', { clients: data.clientsFilter.map(clientLabel).join(', ') }) : null,
              data.range?.since != null ? tx('filterSince', { date: data.view?.since || fmtDateTime(data.range.since).slice(0, 10) }) : null,
              data.range?.until != null ? tx('filterUntil', { date: data.view?.until || fmtDateTime(data.range.until).slice(0, 10) }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      )}
    </>
  );
}
