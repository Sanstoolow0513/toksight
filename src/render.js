// Text rendering for the terminal commands. All table/section builders live
// here; src/cli.js only dispatches and prints. Nothing in this module does
// I/O beyond console.error (printWarnings/printEmpty write to the same
// streams the CLI used).

import * as agg from './aggregate.js';
import { renderTable } from './format.js';
import { clients } from './clients/index.js';

export function rangeLabel(opts, fmt) {
  if (opts.since == null && opts.until == null) return 'all time';
  const since = opts.since != null ? fmt.datetime(opts.since).slice(0, 10) : '…';
  const until = opts.until != null ? fmt.datetime(opts.until).slice(0, 10) : '…';
  return `${since} → ${until}`;
}

function clientsLabel(opts) {
  if (!opts.clients) return 'all';
  return opts.clients.join(', ');
}

export function totalsSection(entries, opts, fmt) {
  const t = agg.summarize(entries);
  const hit = agg.cacheHitRate(t);
  const lines = [];
  lines.push(
    `${fmt.bold('Tokens')} ${fmt.cyan(fmt.int(t.totalTokens))}  ${fmt.bold('Cost')} ${fmt.cyan(fmt.cost(t.costUsd))}  ${fmt.dim(`${t.requests} requests · ${t.sessions} sessions`)}`,
  );
  lines.push(
    `${fmt.dim('input')} ${fmt.tokens(t.inputTokens)} ${fmt.dim('· cache read')} ${fmt.tokens(t.cacheReadTokens)} ${fmt.dim('(' + fmt.pct(hit) + ' hit · write')} ${fmt.tokens(t.cacheWriteTokens)}${fmt.dim(') · output')} ${fmt.tokens(t.outputTokens)}`,
  );
  lines.push(`${fmt.dim('range:')} ${rangeLabel(opts, fmt)} ${fmt.dim('· clients:')} ${clientsLabel(opts)}`);
  return { lines, totals: t };
}

export function pricingModelsTable(entries, opts, fmt) {
  const rows = agg.byModel(entries).slice(0, opts.top);
  return renderTable({
    columns: [
      { header: 'Client', value: (r) => r.client },
      { header: 'Model', value: (r) => r.model },
      { header: 'Req', align: 'right', value: (r) => fmt.int(r.totals.requests) },
      { header: 'Input', align: 'right', value: (r) => fmt.tokens(r.totals.inputTokens) },
      { header: 'Cache R', align: 'right', value: (r) => fmt.tokens(r.totals.cacheReadTokens) },
      { header: 'Cache W', align: 'right', value: (r) => fmt.tokens(r.totals.cacheWriteTokens) },
      { header: 'Output', align: 'right', value: (r) => fmt.tokens(r.totals.outputTokens) },
      { header: 'Hit', align: 'right', value: (r) => fmt.pct(agg.cacheHitRate(r.totals)) },
      { header: 'Cost', align: 'right', value: (r) => fmt.cost(r.totals.costUsd) },
    ],
    rows,
  });
}

// Same filtered entries as the JSON payload's `clients`, so --since/--until
// apply here like they do to the header totals.
export function clientsTable(entries, fmt) {
  const rows = agg.byClient(entries);
  return renderTable({
    columns: [
      { header: 'Client', value: (r) => r.client },
      { header: 'Req', align: 'right', value: (r) => fmt.int(r.totals.requests) },
      { header: 'Sessions', align: 'right', value: (r) => fmt.int(r.totals.sessions) },
      { header: 'Tokens', align: 'right', value: (r) => fmt.tokens(r.totals.totalTokens) },
      { header: 'Hit', align: 'right', value: (r) => fmt.pct(agg.cacheHitRate(r.totals)) },
      { header: 'Cost', align: 'right', value: (r) => fmt.cost(r.totals.costUsd) },
    ],
    rows,
  });
}

export function dailyTable(entries, opts, fmt) {
  const rows = agg.byDay(entries).slice(-opts.top);
  return renderTable({
    columns: [
      { header: 'Date', value: (r) => r.key },
      { header: 'Req', align: 'right', value: (r) => fmt.int(r.totals.requests) },
      { header: 'Input', align: 'right', value: (r) => fmt.tokens(r.totals.inputTokens) },
      { header: 'Cache R', align: 'right', value: (r) => fmt.tokens(r.totals.cacheReadTokens) },
      { header: 'Cache W', align: 'right', value: (r) => fmt.tokens(r.totals.cacheWriteTokens) },
      { header: 'Output', align: 'right', value: (r) => fmt.tokens(r.totals.outputTokens) },
      { header: 'Hit', align: 'right', value: (r) => fmt.pct(agg.cacheHitRate(r.totals)) },
      { header: 'Cost', align: 'right', value: (r) => fmt.cost(r.totals.costUsd) },
    ],
    rows,
  });
}

export function monthlyTable(entries, opts, fmt) {
  const rows = agg.byMonth(entries).slice(-opts.top);
  return renderTable({
    columns: [
      { header: 'Month', value: (r) => r.key },
      { header: 'Req', align: 'right', value: (r) => fmt.int(r.totals.requests) },
      { header: 'Tokens', align: 'right', value: (r) => fmt.tokens(r.totals.totalTokens) },
      { header: 'Hit', align: 'right', value: (r) => fmt.pct(agg.cacheHitRate(r.totals)) },
      { header: 'Cost', align: 'right', value: (r) => fmt.cost(r.totals.costUsd) },
    ],
    rows,
  });
}

export function sessionsTable(entries, opts, fmt) {
  const rows = agg.bySession(entries).slice(0, opts.top);
  return renderTable({
    columns: [
      { header: 'Client', value: (r) => r.client },
      { header: 'Session', value: (r) => String(r.sessionId).replace(/^sess_/, '').slice(0, 12) },
      { header: 'Models', value: (r) => r.models.join(',').slice(0, 28) },
      { header: 'Req', align: 'right', value: (r) => fmt.int(r.totals.requests) },
      { header: 'Tokens', align: 'right', value: (r) => fmt.tokens(r.totals.totalTokens) },
      { header: 'Cost', align: 'right', value: (r) => fmt.cost(r.totals.costUsd) },
      { header: 'Last active', value: (r) => fmt.datetime(r.lastAt === Infinity ? null : r.lastAt) },
      { header: 'Directory', value: (r) => (r.directory ? String(r.directory).slice(-40) : '—') },
    ],
    rows,
  });
}

export function printWarnings(warnings, fmt) {
  for (const w of warnings) console.error(fmt.yellow(`! ${w}`));
}

export function printEmpty({ fmt }) {
  console.log('No session data found.');
  console.log('');
  console.log('Scanned locations:');
  for (const id of Object.keys(clients)) {
    for (const root of clients[id].sourceRoots()) {
      console.log(`  ${fmt.dim(id.padEnd(9))} ${root}`);
    }
  }
  console.log('');
  console.log('Run some agent sessions first, or set env vars like CLAUDE_CONFIG_DIR / CODEX_HOME / ZCODE_HOME to point at custom locations.');
}
