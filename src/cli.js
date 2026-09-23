// Command dispatch + orchestration. Rendering lives in render.js, the JSON
// contract in payload.js, arg parsing in args.js; this module wires them
// together: collect → (render | serve).

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clients } from './clients/index.js';
import { collectAll } from './collect.js';
import { createFormatter } from './format.js';
import { pathExists } from './fsutils.js';
import { createWebServer } from './webserver.js';
import { createWebDataService } from './webservice.js';
import { parseArgs } from './args.js';
import { printEmpty, printWarnings, renderCommand, renderJson } from './render.js';

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
  web           Launch the local dashboard (token usage & cost report)
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
  --open           Open the printed URL in a browser (web only)
  --no-open        Leave the browser closed (web only; default)
  --api-only       Web: serve only the JSON API, no static dashboard
  --offline        Skip the LiteLLM pricing fetch (use built-in/user prices)
  --no-color       Disable ANSI colors
  --version        Print version
  --help           Print this help

Data stays on your machine: toksight only reads your agents' session files.
Pricing: built-in estimates, refreshed from LiteLLM (1h disk cache), overridable
in ${path.join('<config>', 'toksight', 'pricing.json')} — see README.
Inspired by tokscale.`;

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

// Returns the running server so the source-development command can own its lifetime.
export async function runWeb(opts) {
  const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'out');
  const built = await pathExists(path.join(outDir, 'index.html'));

  const getData = createWebDataService(opts);

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
    console.error('warn: dashboard assets missing. From a source checkout, run `npm run web:ci` then `npm run web:build` and refresh. Installed package users should reinstall toksight (serving setup instructions at /).');
  }
  console.log('  Press Ctrl+C to stop.');
  if (opts.open && !opts.apiOnly) openBrowser(url);
  return server;
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

    if (opts.json) {
      renderJson(ctx);
      return 0;
    }

    if (ctx.entries.length === 0 && opts.command !== 'env') {
      if (ctx.warnings.length) printWarnings(ctx.warnings, fmt);
      printEmpty({ fmt, perClient: ctx.perClient });
      return 0;
    }

    renderCommand(ctx, fmt);
    return 0;
  } catch (err) {
    console.error(`error: ${err.message}`);
    return 1;
  }
}
