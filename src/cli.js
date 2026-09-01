import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clients, resolveClientIds } from './clients/index.js';
import { configDir, computeCost, getPricing } from './pricing.js';
import * as agg from './aggregate.js';
import { createFormatter, renderTable } from './format.js';
import { pathExists } from './fsutils.js';
import { createWebServer } from './webserver.js';
import { buildWebExtras } from './webdata.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const HELP = `toksight v${pkg.version} — token usage, cost & cache hit rate for AI coding agents

Usage
  toksight [command] [options]

Commands
  overview      Totals + per-client + top models (default)
  daily         Usage grouped by local day
  monthly       Usage grouped by month
  models        Usage grouped by model
  sessions      Top sessions by cost
  web           Launch the local web dashboard (heatmap, sessions, charts)
  env           Show detected data sources and pricing state
  help          Show this help

Options
  --client <a,b>   Only include these clients (${Object.keys(clients).join(', ')})
  --since <date>   Only include entries on/after a local date (YYYY-MM-DD)
  --until <date>   Only include entries on/before a local date (YYYY-MM-DD)
  --today          Shortcut for today only
  --week           Shortcut for the last 7 days (inclusive)
  --month          Shortcut for the current calendar month
  --top <n>        Row limit for models/sessions tables (default 20)
  --json           Output machine-readable JSON
  --port <n>       Web dashboard port (default 4729)
  --host <addr>    Web dashboard bind address (default 127.0.0.1)
  --no-open        Do not open the browser automatically (web only)
  --api-only       Web: serve only the JSON API, no static dashboard
  --offline        Skip the LiteLLM pricing fetch (use built-in/user prices)
  --no-color       Disable ANSI colors
  --version        Print version
  --help           Print this help

Data stays on your machine: toksight only reads local session files.
Pricing: built-in estimates, refreshed from LiteLLM (1h disk cache), overridable
in ${path.join('<config>', 'toksight', 'pricing.json')} — see README.
Inspired by tokscale.`;

function parseDateArg(value, boundary) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) throw new Error(`invalid date "${value}", expected YYYY-MM-DD`);
  const [, y, mo, d] = m.map(Number);
  if (boundary === 'end') {
    return new Date(y, mo - 1, d, 23, 59, 59, 999).getTime();
  }
  return new Date(y, mo - 1, d, 0, 0, 0, 0).getTime();
}

function startOfDay(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function endOfDay(ts) {
  return startOfDay(ts) + 24 * 3600 * 1000 - 1;
}

function parseArgs(argv) {
  const opts = {
    command: 'overview',
    json: false,
    offline: false,
    noColor: false,
    clients: null,
    since: null,
    until: null,
    top: 20,
    port: 4729,
    host: '127.0.0.1',
    open: true,
    apiOnly: false,
  };
  const positional = [];
  const now = Date.now();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${arg}`);
      return argv[i];
    };
    switch (arg) {
      case '--json': opts.json = true; break;
      case '--offline': opts.offline = true; break;
      case '--no-color': opts.noColor = true; break;
      case '--client': opts.clients = resolveClientIds(next()); break;
      case '--since': opts.since = parseDateArg(next(), 'start'); break;
      case '--until': opts.until = parseDateArg(next(), 'end'); break;
      case '--today': opts.since = startOfDay(now); opts.until = endOfDay(now); break;
      case '--week': opts.since = startOfDay(now - 6 * 24 * 3600 * 1000); opts.until = endOfDay(now); break;
      case '--month': {
        const d = new Date();
        opts.since = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
        opts.until = endOfDay(now);
        break;
      }
      case '--top': {
        const v = parseInt(next(), 10);
        if (!Number.isFinite(v) || v < 1) throw new Error('invalid --top value');
        opts.top = v;
        break;
      }
      case '--port': {
        const v = parseInt(next(), 10);
        if (!Number.isFinite(v) || v < 1 || v > 65535) throw new Error('invalid --port value');
        opts.port = v;
        break;
      }
      case '--host': opts.host = String(next()); break;
      case '--no-open': opts.open = false; break;
      case '--api-only': opts.apiOnly = true; break;
      case '--version': case '-v': opts.version = true; break;
      case '--help': case '-h': opts.help = true; break;
      default:
        if (arg.startsWith('--')) throw new Error(`unknown option "${arg}" (see toksight --help)`);
        positional.push(arg);
    }
  }
  if (positional.length > 1) throw new Error(`unexpected extra arguments: ${positional.slice(1).join(' ')}`);
  if (positional.length === 1) {
    const cmd = positional[0];
    if (!['overview', 'daily', 'monthly', 'models', 'sessions', 'web', 'env', 'help'].includes(cmd)) {
      throw new Error(`unknown command "${cmd}" (see toksight --help)`);
    }
    opts.command = cmd;
  }
  return opts;
}

async function collectAll(opts) {
  const pricing = await getPricing({ offline: opts.offline });
  const warnings = [...pricing.warnings];

  const ids = Object.keys(clients);
  const results = await Promise.allSettled(ids.map((id) => clients[id].collect({})));

  const perClient = [];
  const all = [];
  ids.forEach((id, i) => {
    const r = results[i];
    let entries = [];
    if (r.status === 'fulfilled') {
      entries = r.value.entries;
      warnings.push(...r.value.warnings);
    } else {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      warnings.push(`${id}: collection failed (${reason})`);
    }
    perClient.push({ id, entries });
    all.push(...entries);
  });

  let filtered = all;
  if (opts.clients) filtered = filtered.filter((e) => opts.clients.includes(e.client));
  if (opts.since != null) filtered = filtered.filter((e) => e.timestamp != null && e.timestamp >= opts.since);
  if (opts.until != null) filtered = filtered.filter((e) => e.timestamp != null && e.timestamp <= opts.until);

  for (const e of filtered) {
    e.costUsd = computeCost(e, pricing.priceFor(e.model));
  }

  return { entries: filtered, warnings, pricing, perClient };
}

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

function totalsSection(entries, opts, fmt) {
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

function pricingModelsTable(entries, opts, fmt) {
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
function clientsTable(entries, fmt) {
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

function dailyTable(entries, opts, fmt) {
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

function monthlyTable(entries, opts, fmt) {
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

function sessionsTable(entries, opts, fmt) {
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

function printWarnings(warnings, fmt) {
  for (const w of warnings) console.error(fmt.yellow(`! ${w}`));
}

// The user-facing `--json` contract: totals, cacheHitRate, clients, models,
// daily, monthly, sessions, pricing (incl. unpricedModels), warnings. The web
// API reuses this shape and layers webdata.js extras on top.
export function buildPayload(ctx) {
  const { entries, warnings, pricing, opts } = ctx;
  const totals = agg.summarize(entries);
  return {
    tool: 'toksight',
    version: pkg.version,
    generatedAt: new Date().toISOString(),
    range: { since: opts.since, until: opts.until },
    clientsFilter: opts.clients,
    totals: { ...totals, costUsd: totals.costUsd },
    cacheHitRate: agg.cacheHitRate(totals),
    // Per-agent totals from the filtered entries, so --since/--until/--client
    // apply here just like they do to every other slice of the payload.
    clients: Object.fromEntries(
      agg.byClient(entries).map((r) => [r.client, { ...r.totals, cacheHitRate: agg.cacheHitRate(r.totals) }]),
    ),
    models: agg.byModel(entries).map((r) => ({
      client: r.client,
      model: r.model,
      ...r.totals,
      cacheHitRate: agg.cacheHitRate(r.totals),
      firstAt: r.firstAt === Infinity ? null : r.firstAt,
      lastAt: r.lastAt || null,
    })),
    daily: agg.byDay(entries).map((r) => ({ date: r.key, ...r.totals, cacheHitRate: agg.cacheHitRate(r.totals) })),
    monthly: agg.byMonth(entries).map((r) => ({ month: r.key, ...r.totals, cacheHitRate: agg.cacheHitRate(r.totals) })),
    sessions: agg.bySession(entries).slice(0, opts.top).map((r) => ({
      client: r.client,
      sessionId: r.sessionId,
      directory: r.directory,
      title: r.title,
      models: r.models,
      ...r.totals,
      cacheHitRate: agg.cacheHitRate(r.totals),
      firstAt: r.firstAt === Infinity ? null : r.firstAt,
      lastAt: r.lastAt || null,
    })),
    pricing: {
      sources: pricing.sources,
      configDir: pricing.configDir,
      unpricedModels: agg.unpricedModels(entries),
    },
    warnings,
  };
}

function renderJson(ctx) {
  console.log(JSON.stringify(buildPayload(ctx), null, 2));
}

function printEmpty({ fmt }) {
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

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // best-effort only — the URL is printed above regardless
  }
}

async function runWeb(opts) {
  const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'out');
  const built = await pathExists(path.join(outDir, 'index.html'));

  const server = createWebServer({
    host: opts.host,
    port: opts.port,
    outDir,
    apiOnly: opts.apiOnly,
    getData: async () => {
      // Re-collect on every request so a browser refresh shows fresh data.
      const ctx = { opts, ...(await collectAll(opts)) };
      return { ...buildPayload(ctx), ...buildWebExtras(ctx.entries, { top: opts.top }) };
    },
  });

  const { url } = await server.start();
  console.log(`toksight web`);
  console.log(`  ${url}${opts.apiOnly ? '  (api-only)' : ''}`);
  if (!opts.apiOnly && !built) {
    console.error('warn: dashboard assets not built yet — run `npm run web:build`, then restart toksight web (serving setup instructions at /)');
  }
  console.log('  Press Ctrl+C to stop.');
  if (opts.open && !opts.apiOnly) openBrowser(url);
}

export async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`error: ${err.message}`);
    return 2;
  }

  if (opts.help || opts.command === 'help') {
    console.log(HELP);
    return 0;
  }
  if (opts.version) {
    console.log(pkg.version);
    return 0;
  }

  const fmt = createFormatter({
    color: !opts.noColor && !opts.json && process.stdout.isTTY && !process.env.NO_COLOR,
  });

  try {
    if (opts.command === 'web') {
      await runWeb(opts);
      return 0;
    }

    const ctx = { opts, ...(await collectAll(opts)) };
    const { entries, warnings } = ctx;

    if (opts.json) {
      renderJson(ctx);
      return 0;
    }

    if (entries.length === 0 && opts.command !== 'env') {
      if (warnings.length) printWarnings(warnings, fmt);
      printEmpty({ fmt });
      return 0;
    }

    switch (opts.command) {
      case 'overview': {
        const { lines } = totalsSection(entries, opts, fmt);
        for (const line of lines) console.log(line);
        console.log('');
        console.log(fmt.bold('By client'));
        console.log(fmt.dim(clientsTable(entries, fmt)));
        console.log('');
        console.log(fmt.bold(`Top models (up to ${opts.top})`));
        console.log(fmt.dim(pricingModelsTable(entries, opts, fmt)));
        break;
      }
      case 'daily': {
        const { lines } = totalsSection(entries, opts, fmt);
        for (const line of lines) console.log(line);
        console.log('');
        console.log(fmt.bold('Daily usage'));
        console.log(fmt.dim(dailyTable(entries, opts, fmt)));
        break;
      }
      case 'monthly': {
        const { lines } = totalsSection(entries, opts, fmt);
        for (const line of lines) console.log(line);
        console.log('');
        console.log(fmt.bold('Monthly usage'));
        console.log(fmt.dim(monthlyTable(entries, opts, fmt)));
        break;
      }
      case 'models': {
        const { lines } = totalsSection(entries, opts, fmt);
        for (const line of lines) console.log(line);
        console.log('');
        console.log(fmt.bold('By model'));
        console.log(fmt.dim(pricingModelsTable(entries, opts, fmt)));
        break;
      }
      case 'sessions': {
        const { lines } = totalsSection(entries, opts, fmt);
        for (const line of lines) console.log(line);
        console.log('');
        console.log(fmt.bold(`Top sessions (up to ${opts.top})`));
        console.log(fmt.dim(sessionsTable(entries, opts, fmt)));
        break;
      }
      case 'env': {
        console.log(`${fmt.bold('toksight')} v${pkg.version}`);
        console.log(`${fmt.dim('config:')} ${configDir()}`);
        console.log('');
        console.log(fmt.bold('Data sources'));
        for (const c of ctx.perClient) {
          const roots = clients[c.id].sourceRoots();
          console.log(`  ${fmt.bold(clients[c.id].label)} (${c.id})`);
          for (const root of roots) {
            console.log(`    ${fmt.dim(root)}`);
          }
          console.log(`    ${fmt.dim('entries:')} ${c.entries.length}`);
        }
        console.log('');
        console.log(fmt.bold('Pricing'));
        console.log(`  litellm: ${ctx.pricing.sources.litellm}`);
        console.log(`  user overrides: ${ctx.pricing.sources.user ? 'loaded' : 'none'}`);
        console.log(`  builtin: always available (${fmt.dim('best-effort estimates')})`);
        break;
      }
      default:
        console.log(HELP);
    }

    if (warnings.length) {
      console.log('');
      printWarnings(warnings, fmt);
    }
    return 0;
  } catch (err) {
    console.error(`error: ${err.message}`);
    return 1;
  }
}
