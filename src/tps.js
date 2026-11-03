// Per-request output speed (TPS = outputTokens / request duration). Parsers
// may attach an optional `durationMs` (request start -> end, integer ms) and a
// `durationSource`: 'measured' when the agent logged both ends of the request,
// 'inferred' when the start comes from the adjacent previous message. Neither
// field is part of the usage identity (see usageimports.js); TPS itself is
// never stored, only derived here at aggregation time.

export const DURATION_SOURCES = ['measured', 'inferred'];
// Sanity window applied when computing TPS, not when storing durations, so
// the thresholds can change without re-reading agent logs.
export const MIN_TPS_DURATION_MS = 50;
export const MAX_TPS_DURATION_MS = 60 * 60 * 1000;
export const MAX_TPS = 2000;

// Fields a parser spreads into an entry. Non-positive or non-finite spans are
// dropped so stores only hold plausible positive integer durations.
export function durationFields(startMs, endMs, source) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !DURATION_SOURCES.includes(source)) return {};
  const durationMs = Math.round(endMs - startMs);
  return Number.isSafeInteger(durationMs) && durationMs > 0 ? { durationMs, durationSource: source } : {};
}

export function validDurationFields(entry) {
  const hasDuration = Object.hasOwn(entry, 'durationMs'), hasSource = Object.hasOwn(entry, 'durationSource');
  if (!hasDuration) return !hasSource;
  return Number.isSafeInteger(entry.durationMs) && entry.durationMs >= 0 &&
    (!hasSource || DURATION_SOURCES.includes(entry.durationSource));
}

// TPS of one request, or null when it has no timing, no output, or an
// implausible span / rate.
export function requestTps(entry) {
  const ms = entry?.durationMs, out = entry?.outputTokens;
  if (!Number.isSafeInteger(ms) || ms < MIN_TPS_DURATION_MS || ms > MAX_TPS_DURATION_MS) return null;
  if (!Number.isFinite(out) || out <= 0) return null;
  const tps = out / (ms / 1000);
  return tps > MAX_TPS ? null : tps;
}

export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

// { median, requests, inferredRequests, inferred }: `median` is null when no
// request in the group has usable timing; `inferred` says whether any of the
// requests behind the median used an inferred start (durations without a
// source are treated as inferred, the conservative reading).
export function tpsSummary(entries) {
  const values = [];
  let inferredRequests = 0;
  for (const e of entries) {
    const tps = requestTps(e);
    if (tps == null) continue;
    values.push(tps);
    if (e.durationSource !== 'measured') inferredRequests++;
  }
  return { median: round1(median(values)), requests: values.length, inferredRequests, inferred: inferredRequests > 0 };
}
