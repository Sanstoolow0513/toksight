// Command dispatch + orchestration. Rendering lives in render.js, the JSON
// contract in payload.js, arg parsing in args.js; this module wires them
// together: collect → (render | serve).

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clients } from './clients/index.js';
import { configDir, computeCost, getPricing } from './pricing.js';
import { createFormatter } from './format.js';
import { pathExists } from './fsutils.js';
import { createWebServer } from './webserver.js';
import { buildWebExtras } from './webdata.js';
import { buildPayload } from './payload.js';
import { parseArgs } from './args.js';
import {
  clientsTable,
  dailyTable,
  monthlyTable,
  pricingModelsTable,
  printEmpty,
  printWarnings,
  sessionsTable,
  totalsSection,
} from './render.js';

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

// Collects every client, applies filters, prices the result. `env`/`home` are
// threaded through to the parsers and pricing config so tests can point the
// whole pipeline at fixtures. Entries are never mutated here: pricing produces
// copies, so the per-client entry lists stay exactly what the parsers emitted.
export async function collectAll(opts, { env = process.env, home = os.homedir() } = {}) {
  const pricing = await getPricing({ offline: opts.offline, env, home });
  const warnings = [...pricing.warnings];

  const ids = Object.keys(clients);
  const results = await Promise.allSettled(ids.map((id) => clients[id].collect({ env, home })));

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
    // Loop, not spread: `all.push(...entries)` hits the ~65k argument limit
    // on machines with very large histories.
    for (const e of entries) all.push(e);
  });

  let filtered = all;
  if (opts.clients) filtered = filtered.filter((e) => opts.clients.includes(e.client));
  if (opts.since != null || opts.until != null) {
    let noTimestamp = 0;
    filtered = filtered.filter((e) => {
      if (e.timestamp == null) {
        noTimestamp += 1;
        return false;
      }
      if (opts.since != null && e.timestamp < opts.since) return false;
      if (opts.until != null && e.timestamp > opts.until) return false;
      return true;
    });
    // Silent exclusion would look like "no data" — say it instead.
    if (noTimestamp > 0) {
      warnings.push(`${noTimestamp} entries without a timestamp were excluded by --since/--until date filtering`);
    }
  }

  const entries = filtered.map((e) => {
    const costUsd = computeCost(e, pricing.priceFor(e.model));
    return costUsd === e.costUsd ? e : { ...e, costUsd };
  });

  return { entries, warnings, pricing, perClient };
}

function renderJson(ctx) {
  console.log(JSON.stringify(buildPayload(ctx), null, 2));
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

  // Single-flight: concurrent /api/data requests share one in-flight
  // collection run instead of each triggering a parallel full disk scan.
  // Every settled request re-collects on the next call — the fresh-data,
  // no-caching rule is unchanged.
  let inflight = null;
  const getData = async () => {
    if (inflight) return inflight;
    const run = (async () => {
      // Re-collect on every request so a browser refresh shows fresh data.
      const ctx = { opts, ...(await collectAll(opts)) };
      return { ...buildPayload(ctx), ...buildWebExtras(ctx.entries, { top: opts.top }) };
    })();
    inflight = run;
    try {
      return await run;
    } finally {
      if (inflight === run) inflight = null;
    }
  };

  const server = createWebServer({
    host: opts.host,
    port: opts.port,
    outDir,
    apiOnly: opts.apiOnly,
    getData,
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
