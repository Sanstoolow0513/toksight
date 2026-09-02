// Command-line argument parsing. Kept dependency-free and side-effect-free so
// it is trivially testable: `now` is injectable (window shortcuts like
// --today are otherwise midnight-racy in tests).
//
// Value options accept both forms: `--since 2026-08-01` and
// `--since=2026-08-01`. Boolean flags ignore an attached `=` value.

import { resolveClientIds } from './clients/index.js';
import { endOfDay, parseDateArg, startOfDay, stepDay } from './dates.js';

const COMMANDS = ['overview', 'daily', 'monthly', 'models', 'sessions', 'web', 'env', 'help'];

export function parseArgs(argv, { now = Date.now() } = {}) {
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

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    let inline = null; // value taken from `--flag=value`
    let name = arg;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 2) {
        name = arg.slice(0, eq);
        inline = arg.slice(eq + 1);
      }
    }
    const next = () => {
      if (inline != null) return inline;
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${name}`);
      return argv[i];
    };
    switch (name) {
      case '--json': opts.json = true; break;
      case '--offline': opts.offline = true; break;
      case '--no-color': opts.noColor = true; break;
      case '--client': opts.clients = resolveClientIds(next()); break;
      case '--since': opts.since = parseDateArg(next(), 'start'); break;
      case '--until': opts.until = parseDateArg(next(), 'end'); break;
      case '--today': opts.since = startOfDay(now); opts.until = endOfDay(now); break;
      // "Last 7 days (inclusive)" = today plus the previous 6 calendar days.
      case '--week': opts.since = stepDay(startOfDay(now), -6); opts.until = endOfDay(now); break;
      case '--month': {
        const d = new Date(now);
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
      case '--host': {
        const v = String(next());
        // Fail closed on an empty value: `--host=` (typically an unset env
        // var expansion) would otherwise pass `''` to listen() and bind ALL
        // interfaces while the startup URL still shows 127.0.0.1.
        if (!v.trim()) throw new Error('invalid --host value');
        opts.host = v;
        break;
      }
      case '--no-open': opts.open = false; break;
      case '--api-only': opts.apiOnly = true; break;
      case '--version': case '-v': opts.version = true; break;
      case '--help': case '-h': opts.help = true; break;
      default:
        if (name.startsWith('--')) throw new Error(`unknown option "${name}" (see toksight --help)`);
        positional.push(name);
    }
  }
  if (positional.length > 1) throw new Error(`unexpected extra arguments: ${positional.slice(1).join(' ')}`);
  if (positional.length === 1) {
    const cmd = positional[0];
    if (!COMMANDS.includes(cmd)) {
      throw new Error(`unknown command "${cmd}" (see toksight --help)`);
    }
    opts.command = cmd;
  }
  return opts;
}
