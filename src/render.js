// Text rendering for the terminal commands. All table/section builders and
// the per-command page layouts (renderCommand) live here; src/cli.js only
// parses, dispatches and prints process-lifecycle messages. Rendering reads
// only what the collection pipeline (src/collect.js) returns — never the
// client registry or process defaults — so injected env/home fixtures render
// exactly what was scanned.

import { createRequire } from 'node:module';

import * as agg from './aggregate.js';
import { renderTable } from './format.js';
import { buildPayload } from './payload.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

function rangeLabel(opts, fmt) {
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
  return lines;
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
      { header: 'Last active', value: (r) => fmt.datetime(r.lastAt) },
      { header: 'Directory', value: (r) => (r.directory ? String(r.directory).slice(-40) : '—') },
    ],
    rows,
  });
}

export function printWarnings(warnings, fmt) {
  for (const w of warnings) console.error(fmt.yellow(`! ${w}`));
}

// The `--json` output and the web API share buildPayload; this is its
// terminal-side printer.
export function renderJson(ctx) {
  console.log(JSON.stringify(buildPayload(ctx), null, 2));
}

// Totals header, the command's section, then trailing warnings — one entry
// point for every text command so cli.js stays dispatch-only.
export function renderCommand(ctx, fmt) {
  const { opts, entries, warnings, perClient, pricing } = ctx;

  const section = (title, table) => {
    for (const line of totalsSection(entries, opts, fmt)) console.log(line);
    console.log('');
    console.log(fmt.bold(title));
    console.log(fmt.dim(table));
  };

  switch (opts.command) {
    case 'overview':
      section('By client', clientsTable(entries, fmt));
      console.log('');
      console.log(fmt.bold(`Top models (up to ${opts.top})`));
      console.log(fmt.dim(pricingModelsTable(entries, opts, fmt)));
      break;
    case 'daily':
      section('Daily usage', dailyTable(entries, opts, fmt));
      break;
    case 'monthly':
      section('Monthly usage', monthlyTable(entries, opts, fmt));
      break;
    case 'models':
      section('By model', pricingModelsTable(entries, opts, fmt));
      break;
    case 'sessions':
      section(`Top sessions (up to ${opts.top})`, sessionsTable(entries, opts, fmt));
      break;
    case 'env': {
      console.log(`${fmt.bold('toksight')} v${pkg.version}`);
      console.log(`${fmt.dim('config:')} ${pricing.configDir}`);
      console.log('');
      console.log(fmt.bold('Data sources'));
      for (const c of perClient) {
        console.log(`  ${fmt.bold(c.label)} (${c.id})`);
        for (const root of c.roots) {
          console.log(`    ${fmt.dim(root)}`);
        }
        console.log(`    ${fmt.dim('entries:')} ${c.entries.length}`);
      }
      console.log('');
      console.log(fmt.bold('Pricing'));
      console.log(`  litellm: ${pricing.sources.litellm}`);
      console.log(`  user overrides: ${pricing.sources.user ? 'loaded' : 'none'}`);
      console.log(`  builtin: always available (${fmt.dim('best-effort estimates')})`);
      break;
    }
  }

  if (warnings.length) {
    console.log('');
    printWarnings(warnings, fmt);
  }
}

// Empty-state page: prints the roots the pipeline actually scanned (from
// perClient — injected env/home), not a fresh registry lookup with process
// defaults.
export function printEmpty({ fmt, perClient }) {
  console.log('No session data found.');
  console.log('');
  console.log('Scanned locations:');
  for (const c of perClient) {
    for (const root of c.roots) {
      console.log(`  ${fmt.dim(c.id.padEnd(9))} ${root}`);
    }
  }
  console.log('');
  console.log('Run some agent sessions first, or set env vars like CLAUDE_CONFIG_DIR / CODEX_HOME / ZCODE_HOME to point at custom locations.');
}
