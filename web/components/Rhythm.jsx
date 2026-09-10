'use client';

// Pace card: three label-left / value-right rows — current & longest active
// streak, peak day, and the longest session (ranked by activeMs, wall-clock
// span only as a side note).

import { fmtTokens, fmtDuration } from '@/lib/format';
import { clientLabel } from '@/lib/clients';

export default function Rhythm({ streaks, peakDay, longest, tx }) {
  return (
    <dl className="rhythm">
      <div className="rhythm-row">
        <dt>{tx('statStreak')}</dt>
        <dd>
          {Number.isFinite(streaks.current) ? <b>{tx('statStreakValue', { n: streaks.current })}</b> : '—'}
          {Number.isFinite(streaks.longest) ? ` · ${tx('statStreakLongest', { n: streaks.longest })}` : ''}
        </dd>
      </div>
      <div className="rhythm-row">
        <dt>{tx('statPeak')}</dt>
        <dd>{peakDay ? <><b>{fmtTokens(peakDay.tokens)}</b> · {peakDay.date}</> : '—'}</dd>
      </div>
      <div className="rhythm-row">
        <dt>{tx('statLongest')}</dt>
        <dd>
          {longest ? (
            <>
              <b>{fmtDuration(longest.activeMs)}</b> · {clientLabel(longest.client)}
              {longest.durationMs != null ? ` · ${tx('statLongestSpan', { duration: fmtDuration(longest.durationMs) })}` : ''}
            </>
          ) : (
            '—'
          )}
        </dd>
      </div>
    </dl>
  );
}
