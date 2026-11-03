// Exercise the packaged Tauri executable's actual WebView2 using an isolated
// fixture and loopback CDP. Normal launches never enable remote debugging.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../src/args.js';
import { createWebDataService } from '../src/webservice.js';
import { chromium } from '../desktop/node_modules/playwright-core/index.mjs';

if (process.platform !== 'win32') throw new Error('Tauri desktop smoke tests require Windows.');
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const fresh = args.includes('--fresh');
if (args.some(arg => arg.startsWith('--') && arg !== '--fresh')) throw new Error('Usage: npm run desktop:check -- [--fresh] [path/to/toksight-desktop.exe]');
const results = path.join(root, 'dist', 'desktop', 'checks');
await mkdir(results, { recursive: true });
const profile = await mkdtemp(path.join(results, 'tauri-'));
const home = path.join(profile, 'home'), config = path.join(profile, 'config'), state = path.join(profile, 'state');
const sessions = path.join(home, '.claude', 'projects', 'demo-workspace');
await Promise.all([mkdir(sessions, { recursive: true }), mkdir(config, { recursive: true }), mkdir(state, { recursive: true })]);
const rows = [];
for (let day = 0; day < 62; day++) {
  const date = new Date(); date.setUTCDate(date.getUTCDate() - day);
  for (let hour = 0; hour < 24; hour += 2) {
    date.setUTCHours(hour, 20, 0, 0);
    const factor = ((day * 7 + hour * 11) % 17) + 1;
    rows.push(JSON.stringify({ type: 'assistant', sessionId: `demo-${day}-${hour % 3}`, timestamp: date.toISOString(),
      message: { id: `demo-${day}-${hour}`, model: hour % 4 ? 'claude-sonnet-4-5' : 'claude-opus-4-5',
        usage: { input_tokens: factor * 1220, output_tokens: factor * 360, cache_read_input_tokens: factor * 2750, cache_creation_input_tokens: factor * 120 } } }));
  }
}
const log = fresh ? '' : rows.join('\n') + '\n';
await writeFile(path.join(sessions, 'demo.jsonl'), log);
await writeFile(path.join(config, 'pricing.json'), JSON.stringify({
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: .3, cacheWrite: 3.75 },
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: .5, cacheWrite: 6.25 },
}));
const service = createWebDataService(parseArgs(['web', '--offline']), { env: { TOKSIGHT_CONFIG_DIR: config }, home });
try { await service.initialize(); if (!fresh) await service.setup({ offline: true, autoUpdate: false }); }
finally { service.close(); }
const listener = net.createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ['systemroot', 'windir', 'temp', 'tmp', 'programfiles', 'programfiles(x86)', 'programdata', 'localappdata', 'userprofile'].includes(key.toLowerCase())));
Object.assign(env, { Path: path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32'), GH_CONFIG_DIR: path.join(home, '.config', 'gh'),
  TOKSIGHT_CONFIG_DIR: config, TOKSIGHT_DESKTOP_HOME: home, TOKSIGHT_DESKTOP_STATE_DIR: state,
  TOKSIGHT_DESKTOP_SMOKE: '1', TOKSIGHT_DESKTOP_DEBUG_PORT: String(port) });
const executable = args.find(arg => !arg.startsWith('--'));
const exe = executable ? path.resolve(executable) : path.join(root, 'dist', 'desktop', 'win-x64', 'tauri', 'app', 'toksight-desktop.exe');
console.log(`Tauri smoke profile: ${profile}`);
const child = spawn(exe, ['--offline'], { env, cwd: path.dirname(exe), windowsHide: true, stdio: 'ignore' });
const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
closed.catch(() => {});
const deadline = Date.now() + 120_000;
let browser, page, sidecarPid;
const errors = [];
async function waitFor(check, label) {
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    if (child.exitCode !== null) {
      const diagnostic = await readFile(path.join(state, 'last-error.txt'), 'utf8').catch(() => '');
      throw new Error(`App exited ${child.exitCode} while waiting for ${label}. ${diagnostic}`);
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
const ps = async code => (await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], { windowsHide: true })).stdout.trim();
try {
  const endpoint = await waitFor(async () => {
    try { return (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; }
    catch { return null; }
  }, 'WebView2 debugger');
  browser = await chromium.connectOverCDP(endpoint);
  page = await waitFor(() => browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes('tauri.localhost')), 'embedded app page');
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.setDefaultTimeout(15000);
  await page.waitForFunction(() => typeof window.__TAURI__?.core?.invoke === 'function');
  const pidText = await ps(`Get-CimInstance Win32_Process -Filter "ParentProcessId = ${child.pid} AND Name = 'node.exe'" | Select-Object -ExpandProperty ProcessId`);
  sidecarPid = Number(pidText);
  assert.ok(sidecarPid > 0, 'host owns a bundled Node child');
  const request = (path, method = 'GET', bodyBase64, contentType) => page.evaluate(args => window.__TAURI__.core.invoke('desktop_request', args), { path, method, bodyBase64, contentType });
  if (fresh) {
    await page.locator('.price-setup').waitFor();
    await page.screenshot({ path: path.join(profile, 'first-run.png') });
    await page.locator('.setup-actions button').last().click();
    await page.locator('.price-setup').waitFor({ state: 'detached' });
  }
  const selectors = { today: '.today-report', calendar: '.calendar-report', prices: '.prices-content', settings: '.settings-content' };
  for (const variant of [{ name: '', theme: 'light', locale: 'zh-CN', width: 1440 }, { name: 'dark-', theme: 'dark', locale: 'en', width: 1000 }]) {
    await page.evaluate(async variant => {
      localStorage.setItem('toksight-theme', variant.theme);
      localStorage.setItem('toksight-locale', variant.locale);
      localStorage.setItem('toksight-timezone', 'UTC');
      await window.__TAURI__.window.getCurrentWindow().setSize(new window.__TAURI__.dpi.LogicalSize(variant.width, 940));
    }, variant);
    await page.reload();
    await page.locator('.today-report').waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('html').getAttribute('data-theme'), variant.theme);
    for (const [view, selector] of Object.entries(selectors)) {
      await page.locator(`[data-nav="${view}"]`).click();
      await page.locator(selector).waitFor();
      await page.waitForFunction(() => !document.querySelector('.loading-workspace, .report.is-loading, .filter-status'));
      assert.equal(await page.locator('.state-card[role="alert"]').count(), 0);
      await page.screenshot({ path: path.join(profile, `${variant.name}${view}.png`) });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${view} fits window`);
    }
  }
  if (!fresh) {
    // Exercise real DOM-to-PNG rendering inside WebView2. Intercept only the
    // final save request so automated checks don't drive the system dialog.
    await page.locator('[data-nav="today"]').click();
    await page.locator('.today-report').waitFor();
    await page.waitForFunction(() => !document.querySelector('.report.is-loading'));
    await page.evaluate(() => {
      const original = window.__TAURI__.core;
      window.__restoreSmokeInvoke = () => { window.__TAURI__.core = original; };
      window.__TAURI__.core = { ...original, invoke: (command, args, ...rest) => {
        if (command === 'desktop_save') { window.__smokePng = args; return Promise.resolve(false); }
        return original.invoke(command, args, ...rest);
      } };
    });
    await page.locator('.header-actions button').first().click();
    await page.waitForFunction(() => Boolean(window.__smokePng), null, { timeout: 30000 });
    const png = await page.evaluate(() => { window.__restoreSmokeInvoke(); return window.__smokePng; });
    const bytes = Buffer.from(png.bodyBase64, 'base64');
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.ok(bytes.length > 10000, 'report PNG includes actual content');
    await writeFile(path.join(profile, 'exported-report.png'), bytes);
  }
  const data = JSON.parse(Buffer.from((await request('/api/data')).bodyBase64, 'base64'));
  assert.equal(data.totals.requests, fresh ? 0 : rows.length);
  assert.equal((await request('/api/refresh', 'POST')).status, 200);
  const backup = await request('/api/export/db');
  assert.equal(backup.status, 200);
  assert.equal(Buffer.from(backup.bodyBase64, 'base64').subarray(0, 15).toString(), 'SQLite format 3');
  assert.equal((await request('/api/import/db', 'POST', backup.bodyBase64, 'application/vnd.sqlite3')).status, 200);
  assert.equal((await request('/api/quota')).status, 200);
  assert.equal((await request('/api/sync/status')).status, 200);
  assert.equal((await request('/api/prices/status')).status, 200);
  await assert.rejects(request('https://example.invalid/api/data'), /path|route|request/i);
  assert.deepEqual(errors, [], 'WebView should have no runtime or CSP errors');
  assert.equal(await readFile(path.join(sessions, 'demo.jsonl'), 'utf8'), log, 'Agent fixture unchanged');
  await page.evaluate(() => { void window.__TAURI__.window.getCurrentWindow().close(); });
  assert.equal(await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('App did not close')), 10000).unref())]), 0);
  const running = await ps(`Get-CimInstance Win32_Process -Filter "ProcessId = ${sidecarPid}" | Select-Object -ExpandProperty ProcessId`);
  assert.equal(running, '', 'owned Node sidecar exits with app');
  await writeFile(path.join(profile, 'result.json'), JSON.stringify({ ok: true, framework: 'tauri', fresh, pages: Object.keys(selectors), variants: ['light-wide-zh', 'dark-narrow-en'], api: ['data', 'refresh', 'import', 'export', 'quota', 'sync'], childExited: true }, null, 2));
  console.log(`Tauri smoke passed: actual WebView2, four views, light/dark, wide/narrow, IPC refresh/import/export, clean child exit. Screenshots: ${profile}`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(profile, 'failure.png') }).catch(() => {});
    await writeFile(path.join(profile, 'failure.txt'), `${error.stack}\n\n${errors.join('\n')}\n\n${await page.locator('body').innerText().catch(() => '')}`);
  }
  throw error;
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
}
