import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createWebServer } from '../src/webserver.js';
import { createWebDataService } from '../src/webservice.js';
import { createUsageDatabase } from '../src/database.js';
import { parseArgs } from '../src/args.js';
import { renderQuota } from '../src/render.js';
import { createFormatter } from '../src/format.js';

const NOW = Date.parse('2026-10-26T15:00:00Z');
const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'quota');

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toksight-quotaweb-'));
  const sessions = path.join(dir, '.codex', 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, 'codex-rollout-weekly.jsonl'), path.join(sessions, 'rollout.jsonl'));
  fs.mkdirSync(path.join(dir, '.kimi-code', 'credentials'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.kimi-code', 'credentials', 'kimi-code.json'),
    JSON.stringify({ access_token: 'secret-token', refresh_token: 'r', expires_at: NOW / 1000 + 900 }));
  return dir;
}

function service(opts = []) {
  const calls = [];
  const quotaFetch = async (url, init) => {
    calls.push(url);
    return new Response(fs.readFileSync(path.join(FIXTURES, 'kimi-usages.json')), { status: 200 });
  };
  const database = createUsageDatabase({ file: ':memory:' });
  const getData = createWebDataService(parseArgs(opts), { database, env: {}, home: home(), now: () => NOW, quotaFetch,
    collect: async () => ({ entries: [], warnings: [], perClient: [], reportedCosts: new WeakSet(), pricing: { priceFor: () => null, sources: {}, configDir: '/x' } }) });
  return { getData, calls };
}

async function withServer(getData, fn) {
  const server = createWebServer({ outDir: os.tmpdir(), getData, port: 0, logger: null });
  const { url } = await server.start();
  try { return await fn(url); } finally { await server.close(); }
}

test('GET /api/quota reads Codex locally and never calls Kimi; POST refresh does', async () => {
  const { getData, calls } = service();
  await withServer(getData, async (url) => {
    const res = await fetch(`${url}/api/quota`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.offline, false);
    assert.deepEqual(body.quotas.map((q) => q.client), ['codex', 'kimi']);
    assert.equal(body.quotas[0].windows[0].id, 'week');
    assert.equal(body.quotas[1].error.code, 'KIMI_NOT_FETCHED');
    assert.equal(calls.length, 0);

    assert.equal((await fetch(`${url}/api/quota/refresh`)).status, 405);
    const foreign = await fetch(`${url}/api/quota/refresh`, { method: 'POST', headers: { Origin: 'https://evil.example' } });
    assert.equal(foreign.status, 403);
    const rebinding = await new Promise((resolve, reject) => {
      http.get(`${url}/api/quota`, { headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    assert.equal(rebinding, 403);
    assert.equal(calls.length, 0);

    const refreshed = await (await fetch(`${url}/api/quota/refresh`, { method: 'POST' })).json();
    assert.equal(calls.length, 1);
    assert.equal(calls[0], 'https://api.kimi.com/coding/v1/usages');
    assert.equal(refreshed.quotas[1].windows.length, 3);
    assert.ok(!JSON.stringify(refreshed).includes('secret-token'));
    // The last Kimi result stays in memory for later GETs, without a new request.
    const again = await (await fetch(`${url}/api/quota`)).json();
    assert.equal(again.quotas[1].windows.length, 3);
    assert.equal(calls.length, 1);
  });
});

test('offline web sessions and --client scopes never query Kimi', async () => {
  const offline = service(['--offline']);
  const body = await offline.getData.refreshQuota();
  assert.equal(body.offline, true);
  assert.equal(body.quotas[1].error.code, 'KIMI_OFFLINE');
  assert.equal(offline.calls.length, 0);
  offline.getData.close();
  const scoped = service(['--client', 'codex,claude']);
  const only = await scoped.getData.refreshQuota();
  assert.deepEqual(only.quotas.map((q) => q.client), ['codex']);
  assert.equal(scoped.calls.length, 0);
  scoped.getData.close();
});

test('renderQuota prints a compact table with local reset time and relative span', async () => {
  const { getData } = service();
  const { quotas } = await getData.refreshQuota();
  getData.close();
  quotas[0].windows.push({ id: '5h', label: '5h', windowMinutes: 300, usedPercent: null, resetsAt: '2026-10-26T14:00:00.000Z', reset: true });
  const lines = [];
  const log = console.log;
  console.log = (s) => lines.push(String(s));
  try { renderQuota(quotas, { now: NOW }, createFormatter({ color: false })); }
  finally { console.log = log; }
  const out = lines.join('\n');
  assert.match(out, /Client\s+Plan\s+Window\s+Used\s+Resets/);
  assert.match(out, /Codex CLI\s+self_serve_business_prolite\s+week\s+4%\s+\d{4}-\d\d-\d\d \d\d:\d\d \(in 6d 17h\)/);
  assert.match(out, /Codex CLI.*5h\s+reset\s+reset 1h ago/);
  assert.match(out, /Kimi Code\s+LEVEL_INTERMEDIATE\s+5h\s+69\.5% \(139\/200\)/);
  assert.match(out, /Kimi Code.*month\s+0\.6%/);
  assert.match(out, /Codex CLI: from local session logs, last seen .* \(43m ago\)/);

  lines.length = 0;
  console.log = (s) => lines.push(String(s));
  try { renderQuota(quotas, { json: true, now: NOW }, createFormatter({ color: false })); }
  finally { console.log = log; }
  const json = JSON.parse(lines.join('\n'));
  assert.equal(json.tool, 'toksight');
  assert.equal(json.generatedAt, '2026-10-26T15:00:00.000Z');
  assert.equal(json.quotas.length, 2);
});
