import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createUsageDatabase } from '../src/database.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/toksight.js', import.meta.url));

test('refresh command writes a reusable SQLite snapshot from isolated agent fixtures', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-refresh-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const claude = path.join(dir, 'claude');
  const session = path.join(claude, 'projects', 'fixture', 'session.jsonl');
  await mkdir(path.dirname(session), { recursive: true });
  await writeFile(session, JSON.stringify({
    type: 'assistant', sessionId: 'fixture', timestamp: '2026-08-29T10:00:00Z',
    message: { id: 'one', model: 'claude-sonnet-4-5', usage: { input_tokens: 100, output_tokens: 20 } },
  }) + '\n');
  const env = {
    ...process.env,
    CLAUDE_CONFIG_DIR: claude,
    CODEX_HOME: path.join(dir, 'codex'),
    ZCODE_HOME: path.join(dir, 'zcode'),
    OPENCODE_PATH: path.join(dir, 'opencode'),
    KIMI_CODE_HOME: path.join(dir, 'kimi'),
    TOKSIGHT_CONFIG_DIR: path.join(dir, 'config'),
  };
  const { stdout } = await run(process.execPath, [cli, 'refresh', '--offline', '--json'], { env });
  const result = JSON.parse(stdout);
  assert.equal(result.entries, 1);
  assert.equal(result.database, path.join(env.TOKSIGHT_CONFIG_DIR, 'usage.sqlite'));
  const db = createUsageDatabase({ file: result.database });
  try {
    assert.equal(db.read().entries[0].inputTokens, 100);
    assert.ok(db.read().refreshedAt);
  } finally { db.close(); }
});
