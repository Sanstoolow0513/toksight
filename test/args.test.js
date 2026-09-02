import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs } from '../src/args.js';

// Fixed clock so --today/--week/--month windows are deterministic.
const NOW = new Date(2026, 8, 2, 15, 30).getTime(); // 2026-09-02 15:30 local
const parse = (argv) => parseArgs(argv, { now: NOW });

test('defaults: no arguments means the overview command', () => {
  const opts = parse([]);
  assert.equal(opts.command, 'overview');
  assert.equal(opts.json, false);
  assert.equal(opts.offline, false);
  assert.equal(opts.noColor, false);
  assert.equal(opts.clients, null);
  assert.equal(opts.since, null);
  assert.equal(opts.until, null);
  assert.equal(opts.top, 20);
  assert.equal(opts.port, 4729);
  assert.equal(opts.host, '127.0.0.1');
  assert.equal(opts.open, true);
  assert.equal(opts.apiOnly, false);
});

test('accepts every known command and rejects unknown ones', () => {
  for (const cmd of ['overview', 'daily', 'monthly', 'models', 'sessions', 'web', 'env', 'help']) {
    assert.equal(parse([cmd]).command, cmd);
  }
  assert.throws(() => parse(['bogus']), /unknown command "bogus"/);
  assert.throws(() => parse(['daily', 'monthly']), /unexpected extra arguments: monthly/);
});

test('boolean flags', () => {
  const opts = parse(['--json', '--offline', '--no-color', '--no-open', '--api-only']);
  assert.equal(opts.json, true);
  assert.equal(opts.offline, true);
  assert.equal(opts.noColor, true);
  assert.equal(opts.open, false);
  assert.equal(opts.apiOnly, true);
  assert.equal(parse(['-v']).version, true);
  assert.equal(parse(['--version']).version, true);
  assert.equal(parse(['-h']).help, true);
  assert.equal(parse(['--help']).help, true);
});

test('--client resolves aliases, dedupes, and rejects unknown ids', () => {
  assert.deepEqual(parse(['--client', 'claude,claude-code,codex']).clients, ['claude', 'codex']);
  assert.deepEqual(parse(['--client', 'kimi-code']).clients, ['kimi']);
  assert.throws(() => parse(['--client', 'nope']), /unknown client "nope"/);
  // Empty value keeps the "all clients" default (same as `--client ""`).
  assert.equal(parse(['--client=']).clients, null);
});

test('--since/--until map local calendar dates to inclusive boundaries', () => {
  const opts = parse(['--since', '2026-08-10', '--until', '2026-08-12']);
  assert.equal(opts.since, new Date(2026, 7, 10, 0, 0, 0, 0).getTime());
  assert.equal(opts.until, new Date(2026, 7, 12, 23, 59, 59, 999).getTime());
  assert.throws(() => parse(['--since', '2026/08/10']), /invalid date "2026\/08\/10"/);
  assert.throws(() => parse(['--until', 'august']), /invalid date "august"/);
});

test('--today spans the local calendar day', () => {
  const opts = parse(['--today']);
  assert.equal(opts.since, new Date(2026, 8, 2).getTime());
  assert.equal(opts.until, new Date(2026, 8, 3).getTime() - 1);
});

test('--week covers today plus the previous 6 calendar days', () => {
  const opts = parse(['--week']);
  assert.equal(opts.since, new Date(2026, 7, 27).getTime()); // 2026-08-27
  assert.equal(opts.until, new Date(2026, 8, 3).getTime() - 1);
});

test('--month starts at the first of the current calendar month', () => {
  const opts = parse(['--month']);
  assert.equal(opts.since, new Date(2026, 8, 1).getTime());
  assert.equal(opts.until, new Date(2026, 8, 3).getTime() - 1);
});

test('--top and --port validate their values', () => {
  assert.equal(parse(['--top', '50']).top, 50);
  assert.throws(() => parse(['--top', 'abc']), /invalid --top value/);
  assert.throws(() => parse(['--top', '0']), /invalid --top value/);
  assert.equal(parse(['--port', '8080']).port, 8080);
  assert.throws(() => parse(['--port', '70000']), /invalid --port value/);
  assert.throws(() => parse(['--port', '0']), /invalid --port value/);
});

test('value options accept the --flag=value form', () => {
  const opts = parse([
    '--client=claude,codex',
    '--since=2026-08-10',
    '--until=2026-08-12',
    '--top=5',
    '--port=8080',
    '--host=0.0.0.0',
  ]);
  assert.deepEqual(opts.clients, ['claude', 'codex']);
  assert.equal(opts.since, new Date(2026, 7, 10).getTime());
  assert.equal(opts.until, new Date(2026, 7, 12, 23, 59, 59, 999).getTime());
  assert.equal(opts.top, 5);
  assert.equal(opts.port, 8080);
  assert.equal(opts.host, '0.0.0.0');
});

test('equals form with an empty value behaves like an empty value', () => {
  assert.throws(() => parse(['--since=']), /invalid date ""/);
});

test('unknown options and missing values fail loudly', () => {
  assert.throws(() => parse(['--bogus']), /unknown option "--bogus" \(see toksight --help\)/);
  // The flag name is reported without the attached value.
  assert.throws(() => parse(['--bogus=1']), /unknown option "--bogus"/);
  assert.throws(() => parse(['--since']), /missing value for --since/);
  assert.throws(() => parse(['--client']), /missing value for --client/);
});

test('boolean flags tolerate an attached equals value (sugar, not semantics)', () => {
  assert.equal(parse(['--json=anything']).json, true);
  assert.equal(parse(['--offline=1']).offline, true);
});
