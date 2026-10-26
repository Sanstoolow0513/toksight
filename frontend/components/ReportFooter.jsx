import BrandMark from '@/components/BrandMark';
import { fmtDateTime } from '@/lib/format';

export default function ReportFooter({ data, tx }) {
  const unpriced = data.pricing?.unpricedModels ?? [];
  return (
    <footer className="report-foot">
      <span className="foot-brand">
        <BrandMark size={14} />
        toksight v{data.version}
      </span>
      <span>{tx('footRefreshed', { time: fmtDateTime(data.snapshot?.refreshedAt ?? data.generatedAt, data.timezone) })}</span>
      {data.pricing?.updates?.litellm?.fetchedAt ? <span>{tx('footPriceUpdated', { source: 'LiteLLM', time: fmtDateTime(data.pricing.updates.litellm.fetchedAt, data.timezone) })}</span> : null}
      {data.timezone ? <span>{tx('footTimezone', { tz: data.timezone })}</span> : null}
      <span>{tx('footEstimate')}</span>
      <span>{tx('footLocal')}</span>
      {unpriced.length ? <span className="foot-unpriced">{tx('footUnpriced', { models: unpriced.join(', ') })}</span> : null}
    </footer>
  );
}
