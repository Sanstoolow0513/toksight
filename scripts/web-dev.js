import path from 'node:path';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs as parseOptions } from 'node:util';
import { parseArgs } from '../src/args.js';
import { runWeb } from '../src/cli.js';
import { startNode, stopChild } from './lib/process.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const web = path.join(root, 'web');
const nextCli = path.join(web, 'node_modules', 'next', 'dist', 'bin', 'next');

function port(value, flag) {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`${flag} must be an integer between 1 and 65535`);
  }
  return Number(value);
}

let server;
let frontend;
let stopping;
function stop(code = 0) {
  if (!stopping) {
    process.exitCode = code;
    stopping = Promise.all([
      stopChild(frontend, { tree: true }),
      server?.close(),
    ]).catch((err) => {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    });
  }
  return stopping;
}

async function main() {
  const { values } = parseOptions({ options: {
    port: { type: 'string', default: '3000' },
    'api-port': { type: 'string', default: '4729' },
    offline: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: npm run web:dev -- [--port 3000] [--api-port 4729] [--offline]\nStarts the dashboard and its local API together. Ctrl+C stops both.');
    return;
  }
  const uiPort = port(values.port, '--port');
  const apiPort = port(values['api-port'], '--api-port');
  if (uiPort === apiPort) throw new Error('--port and --api-port must be different');
  await access(nextCli).catch(() => {
    throw new Error('Dashboard dependencies missing. Run `npm run web:ci` first (Node >=20.9).');
  });

  const opts = parseArgs(['web', '--api-only', '--no-open', '--port', String(apiPort)]);
  opts.offline = values.offline;
  server = await runWeb(opts);
  frontend = startNode([nextCli, 'dev', '--hostname', '127.0.0.1', '--port', String(uiPort)], {
    cwd: web,
    detached: process.platform !== 'win32',
    env: { ...process.env, TOKSIGHT_DEV_API: `http://127.0.0.1:${apiPort}` },
  });
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
  console.log(`\nDashboard: http://127.0.0.1:${uiPort}\nAPI:       http://127.0.0.1:${apiPort}\nCtrl+C stops both.\n`);
  const { code, signal } = await frontend.done;
  if (!stopping) {
    if (code !== 0) console.error(`error: dashboard exited (${signal || code}); stopping API`);
    await stop(code === 0 ? 0 : 1);
  }
}

main().catch(async (err) => {
  console.error(`error: ${err.message}`);
  await stop(1);
});
