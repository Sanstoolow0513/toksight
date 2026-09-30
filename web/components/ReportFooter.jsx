import BrandMark from '@/components/BrandMark';
import { fmtDateTime } from '@/lib/format';

export default function ReportFooter({ data, tx }) {
  const unpriced = data.pricing?.unpricedModels ?? [];
  const cursorUnpriced = (data.clients?.cursor?.pricedRequests ?? 0) < (data.clients?.cursor?.requests ?? 0);
  return (
    <footer className="report-foot">
          <span className="foot-brand">
            <BrandMark size={14} />
            toksight v{data.version}
          </span>
          <span>{tx('footRefreshed', { time: fmtDateTime(data.snapshot?.refreshedAt ?? data.generatedAt, data.timezone) })}</span>
          {data.pricing?.updates?.litellm?.fetchedAt ? <span>{tx('footPriceUpdated', { source: 'LiteLLM', time: fmtDateTime(data.pricing.updates.litellm.fetchedAt, data.timezone) })}</span> : null}
          {data.pricing?.updates?.cursor?.fetchedAt ? <span>{tx('footPriceUpdated', { source: 'Cursor', time: fmtDateTime(data.pricing.updates.cursor.fetchedAt, data.timezone) })}</span> : null}
          {data.timezone ? <span>{tx('footTimezone', { tz: data.timezone })}</span> : null}
          <span>{tx(data.costCoverage?.sources?.cursor?.requests ? 'footEstimateCursor' : cursorUnpriced ? 'footEstimateCursorUnpriced' : 'footEstimate')}</span>
          {data.costCoverage?.sources?.cursor?.requests ? <a href="https://cursor.com/docs/models-and-pricing" target="_blank" rel="noreferrer">{tx('footCursorSource')}</a> : null}
          <span>{tx('footLocal')}</span>
          {unpriced.length ? <span className="foot-unpriced">{tx('footUnpriced', { models: unpriced.join(', ') })}</span> : null}
    </footer>
  );
}
