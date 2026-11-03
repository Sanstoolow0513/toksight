// Native desktop sidecar protocol. The host must keep stdin open for the
// lifetime of the app. Only the ready message goes to stdout; never log the
// authentication secret, and never accept it through argv or environment.
import { Console } from 'node:console';
import path from 'node:path';

globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });

const MAX_LINE_BYTES = 16 * 1024;
const SHUTDOWN_TIMEOUT_MS = 5000;
let input = '', initialized = false, stopping = false, secret = '';
let server, getData, starting = Promise.resolve(), shutdown;

function diagnostic(code, error) {
  let message = error instanceof Error ? error.message : String(error);
  if (secret) message = message.replaceAll(secret, '[redacted]');
  process.stderr.write(`${JSON.stringify({ type: 'error', code, message })}\n`);
}

function stop(exitCode = 0) {
  if (exitCode) process.exitCode = exitCode;
  if (shutdown) return shutdown;
  stopping = true;
  clearTimeout(handshakeTimer);
  process.stdin.destroy();
  // Unref lets a fully closed service exit immediately. Remaining network
  // requests or a stalled upload cannot keep an orphan alive indefinitely.
  setTimeout(() => {
    diagnostic('DESKTOP_SHUTDOWN_TIMEOUT', 'Desktop service did not close within 5 seconds');
    try { getData?.close(); } catch { /* The OS will release remaining handles on exit. */ }
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
  shutdown = (async () => {
    await starting;
    if (server) await server.close();
    else getData?.close();
  })().catch((error) => {
    diagnostic('DESKTOP_SHUTDOWN_FAILED', error);
    process.exitCode = 1;
  });
  return shutdown;
}

function fail(code, error) {
  diagnostic(code, error);
  void stop(1);
}

function validateHandshake(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !['token', 'offline', 'configDir', 'home'].includes(key))
    || typeof value.token !== 'string' || !/^[a-f\d]{64}$/i.test(value.token)
    || typeof value.offline !== 'boolean'
    || ['configDir', 'home'].some((key) => Object.hasOwn(value, key)
      && (typeof value[key] !== 'string' || !value[key] || value[key].includes('\0') || !path.isAbsolute(value[key])))) {
    throw new Error('Expected token (64 hex characters), offline (boolean), and optional absolute configDir/home paths');
  }
  return value;
}

async function start(config) {
  // Dynamic imports make a missing/incompatible bundled runtime a structured
  // startup error, instead of leaking an uncaught module-load stack to stdout.
  const [{ parseArgs }, { createWebDataService }, { createWebServer }] = await Promise.all([
    import('../src/args.js'), import('../src/webservice.js'), import('../src/webserver.js'),
  ]);
  if (stopping) return;
  const env = { ...process.env, ...(config.configDir ? { TOKSIGHT_CONFIG_DIR: config.configDir } : {}) };
  const opts = parseArgs(['web', '--api-only', '--no-open', ...(config.offline ? ['--offline'] : [])]);
  getData = createWebDataService(opts, { env, home: config.home });
  await getData.initialize();
  if (stopping) return;
  server = createWebServer({ host: '127.0.0.1', port: 0, apiOnly: true, getData, desktopToken: config.token });
  const { url } = await server.start();
  if (!stopping) process.stdout.write(`${JSON.stringify({ type: 'ready', url })}\n`);
}

function acceptLine(line) {
  if (stopping) return;
  let value;
  try { value = JSON.parse(line); }
  catch { fail('DESKTOP_BAD_PROTOCOL', new Error('Expected one JSON object per line')); return; }
  if (!initialized) {
    let config;
    try { config = validateHandshake(value); }
    catch (error) { fail('DESKTOP_BAD_HANDSHAKE', error); return; }
    initialized = true;
    secret = config.token;
    clearTimeout(handshakeTimer);
    starting = start(config).catch((error) => { fail('DESKTOP_START_FAILED', error); });
    return;
  }
  if (value && typeof value === 'object' && value.type === 'shutdown' && Object.keys(value).length === 1) {
    void stop();
  } else {
    fail('DESKTOP_BAD_PROTOCOL', new Error('Only a shutdown command is accepted after initialization'));
  }
}

const handshakeTimer = setTimeout(() => {
  fail('DESKTOP_HANDSHAKE_TIMEOUT', new Error('Desktop host did not initialize the service within 15 seconds'));
}, 15_000);

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  if (stopping) return;
  input += chunk;
  for (;;) {
    const newline = input.indexOf('\n');
    const line = newline === -1 ? input : input.slice(0, newline);
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
      fail('DESKTOP_BAD_PROTOCOL', new Error('Desktop protocol line is too large'));
      return;
    }
    if (newline === -1) return;
    input = input.slice(newline + 1);
    acceptLine(line);
    if (stopping) return;
  }
});
process.stdin.on('end', () => { void stop(); });
process.stdin.on('error', (error) => { fail('DESKTOP_INPUT_FAILED', error); });
process.stdout.on('error', () => { void stop(1); });
process.stderr.on('error', () => { void stop(1); });
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
process.on('uncaughtException', (error) => { fail('DESKTOP_RUNTIME_FAILED', error); });
process.on('unhandledRejection', (error) => { fail('DESKTOP_RUNTIME_FAILED', error); });
