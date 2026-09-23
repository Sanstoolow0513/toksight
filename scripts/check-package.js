// Exercise the shipped artifact, not source files or a mocked web/out directory.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { runNpm, startNode, stopChild } from './lib/process.js';

const root = fileURLToPath(new URL('../', import.meta.url));

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((err) => err ? reject(err) : resolve()));
  return port;
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode != null || child.signalCode != null) throw new Error('Installed CLI exited before serving the dashboard');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch { /* startup may not have bound the port yet */ }
    await delay(100);
  }
  throw new Error('Timed out waiting for the installed CLI');
}

async function filesUnder(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(full));
    else files.push(full);
  }
  return files;
}

async function main() {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'toksight-package-'));
  let child;
  let output = '';
  try {
    const sourcePkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const webPkg = JSON.parse(await readFile(path.join(root, 'web', 'package.json'), 'utf8'));
    assert.equal(webPkg.version, sourcePkg.version, 'Root and dashboard versions must match');
    console.log('Building and packing toksight (prepack installs locked web dependencies)…');
    await runNpm(['pack', '--loglevel=error', '--pack-destination', temp], { cwd: root });
    const archives = (await readdir(temp)).filter((name) => name.endsWith('.tgz'));
    assert.equal(archives.length, 1, 'Expected one npm package');
    const installDir = path.join(temp, 'installed');
    await mkdir(installDir);
    await runNpm([
      'install', '--prefix', installDir, '--ignore-scripts', '--offline',
      '--no-audit', '--no-fund', '--package-lock=false', path.join(temp, archives[0]),
    ], { cwd: temp });

    const installed = path.join(installDir, 'node_modules', 'toksight');
    const pkg = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
    assert.equal(Object.keys(pkg.dependencies || {}).length, 0, 'CLI must have zero runtime dependencies');
    const installedNames = (await readdir(path.join(installDir, 'node_modules'))).filter((name) => !name.startsWith('.'));
    assert.deepEqual(installedNames, ['toksight'], 'Dashboard dependencies must not be installed at runtime');

    // All agent roots and pricing overrides are isolated. A real fixture makes
    // the API check prove collection works from the package.
    const fixture = path.join(temp, 'fixtures');
    const claude = path.join(fixture, 'claude');
    await mkdir(path.join(claude, 'projects', 'smoke'), { recursive: true });
    await writeFile(path.join(claude, 'projects', 'smoke', 'session.jsonl'), JSON.stringify({
      type: 'assistant', sessionId: 'package-smoke', timestamp: '2026-08-29T10:00:00Z',
      message: { id: 'package-smoke', model: 'claude-sonnet-4-5', usage: { input_tokens: 100, output_tokens: 20 } },
    }) + '\n');
    const env = {
      ...process.env,
      CLAUDE_CONFIG_DIR: claude,
      CODEX_HOME: path.join(fixture, 'codex'),
      ZCODE_HOME: path.join(fixture, 'zcode'),
      KIMI_CODE_HOME: path.join(fixture, 'kimi'),
      OPENCODE_PATH: path.join(fixture, 'opencode-data'),
      XDG_CONFIG_HOME: path.join(fixture, 'xdg-config'),
      XDG_DATA_HOME: path.join(fixture, 'xdg-data'),
      XDG_STATE_HOME: path.join(fixture, 'xdg-state'),
      TOKSIGHT_CONFIG_DIR: path.join(fixture, 'pricing'),
    };
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    child = startNode([path.join(installed, 'bin', 'toksight.js'), 'web', '--offline', '--no-open', '--port', String(port)], {
      cwd: installDir, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    await waitForServer(url, child);

    const assetPaths = new Set();
    for (const [route, file] of [['/', 'index.html']]) {
      const expected = await readFile(path.join(installed, 'web', 'out', file), 'utf8');
      const response = await fetch(url + route);
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get('content-type'), /text\/html/);
      const html = await response.text();
      assert.equal(html, expected, `${route} must serve the packaged page`);
      const references = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?#]+)(?:[^" ]*)"/g)];
      assert.ok(references.some((match) => match[1].endsWith('.js')), `${route} must reference JavaScript`);
      assert.ok(references.some((match) => match[1].endsWith('.css')), `${route} must reference CSS`);
      for (const [, ref] of references) assetPaths.add(ref);
      console.log(`OK ${route}: packaged HTML`);
    }
    // Also check fonts and assets referenced indirectly from stylesheets.
    const out = path.join(installed, 'web', 'out');
    for (const file of await filesUnder(path.join(out, '_next', 'static'))) {
      assetPaths.add('/' + path.relative(out, file).split(path.sep).join('/'));
    }
    for (const asset of assetPaths) {
      const response = await fetch(url + asset);
      assert.equal(response.status, 200, asset);
      assert.match(response.headers.get('cache-control'), /immutable/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(path.join(out, asset.slice(1))), asset);
    }
    console.log(`OK ${assetPaths.size} static resources (scripts, styles and fonts)`);
    const dataResponse = await fetch(url + '/api/data');
    assert.equal(dataResponse.status, 200);
    const data = await dataResponse.json();
    assert.equal(data.version, pkg.version);
    assert.equal(data.totals.totalTokens, 120);
    assert.equal(data.pricing.sources.litellm, 'skipped (offline)');
    const filteredResponse = await fetch(url + '/api/data?client=claude&since=2026-08-29&until=2026-08-29');
    assert.equal(filteredResponse.status, 200);
    const filteredData = await filteredResponse.json();
    assert.equal(filteredData.totals.totalTokens, 120);
    assert.equal(filteredData.selection.rows.length, 1);
    assert.equal(filteredData.selection.rows[0].date, '2026-08-29');
    assert.equal(filteredData.comparison.days, 1);
    assert.equal(filteredData.costCoverage.sources.builtin.requests, 1);
    const emptyFilter = await fetch(url + '/api/data?client=codex');
    assert.equal((await emptyFilter.json()).totals.requests, 0);
    assert.equal((await fetch(url + '/api/data?since=2026-02-30')).status, 400);
    console.log('OK dashboard filters, selected charts, comparison and cost coverage');
    const monthResponse = await fetch(url + '/api/data?period=custom&since=2026-08-01&until=2026-08-31');
    assert.equal(monthResponse.status, 200);
    const month = await monthResponse.json();
    assert.equal(month.daily.length, 1);
    assert.equal(month.scopeRange.firstAt, Date.parse('2026-08-29T10:00:00Z'));
    const emptyMonth = await (await fetch(url + '/api/data?period=custom&since=2026-07-01&until=2026-07-31')).json();
    assert.equal(emptyMonth.totals.requests, 0);
    assert.equal(emptyMonth.scopeRange.firstAt, month.scopeRange.firstAt);
    assert.equal((await fetch(url + '/api/config')).status, 404);
    console.log('OK report periods and scope range: isolated fixtures');
    console.log(`Package check passed: toksight ${pkg.version}`);
  } catch (err) {
    if (output) console.error(output);
    throw err;
  } finally {
    await stopChild(child);
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`Package check failed: ${err.message}`);
  process.exitCode = 1;
});
