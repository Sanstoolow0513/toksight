// Native Windows integration test. All collectors, credentials and preferences
// are redirected to a synthetic profile; no real Agent data is read.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../src/args.js';
import { createWebDataService } from '../src/webservice.js';

if (process.platform !== 'win32') throw new Error('Native desktop smoke tests require Windows.');
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const fresh = args.includes('--fresh');
const results = path.join(root, 'dist', 'desktop', 'checks');
await mkdir(results, { recursive: true });
const profile = await mkdtemp(path.join(results, 'native-'));
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
await writeFile(path.join(state, 'preferences.json'), JSON.stringify(fresh
  ? { Language: 'invalid', Theme: null, TimeZonePreference: null }
  : { Language: 'zh-CN', Theme: 'light', TimeZonePreference: 'UTC' }));
const service = createWebDataService(parseArgs(['web', '--offline']), { env: { TOKSIGHT_CONFIG_DIR: config }, home });
try { await service.initialize(); if (!fresh) await service.setup({ offline: true, autoUpdate: false }); }
finally { service.close(); }
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ['systemroot', 'windir', 'temp', 'tmp', 'programfiles', 'programfiles(x86)', 'programdata', 'localappdata', 'userprofile'].includes(key.toLowerCase())));
Object.assign(env, { Path: path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32'), GH_CONFIG_DIR: path.join(home, '.config', 'gh'),
  TOKSIGHT_CONFIG_DIR: config, TOKSIGHT_DESKTOP_HOME: home, TOKSIGHT_DESKTOP_STATE_DIR: state });
const executable = args.find(arg => !arg.startsWith('--'));
const exe = executable ? path.resolve(executable) : path.join(root, 'dist', 'desktop', 'win-x64', 'app', 'Toksight.Desktop.exe');
const result = path.join(profile, 'result.json');
console.log(`Native smoke profile: ${profile}`);
const child = spawn(exe, ['--offline', '--smoke-test', result], { env, windowsHide: true, stdio: 'ignore' });
const timer = setTimeout(() => { child.kill(); }, 120_000);
let code;
try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); }
finally { clearTimeout(timer); }
let report;
try { report = JSON.parse(await readFile(result, 'utf8')); }
catch {
  const error = await readFile(path.join(state, 'last-error.txt'), 'utf8').catch(() => 'No managed crash log. Check Windows Event Viewer for native loader failures.');
  throw new Error(`Native app exited ${code} without a result. ${error}`);
}
assert.equal(report.ok, true, report.error);
assert.deepEqual(report.pages, ['today', 'calendar', 'prices', 'settings']);
assert.deepEqual(report.variants, ['light-wide-zh', 'dark-narrow-en']);
assert.equal(report.initialPage, fresh ? 'prices' : 'today');
assert.equal(code, 0, `Native app exit code ${code}`);
for (const page of report.pages.flatMap(page => [page, `dark-${page}`])) {
  const bytes = await readFile(path.join(profile, `${page}.png`));
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.ok(bytes.length > 1000, `${page} should render real content`);
}
assert.equal(await readFile(path.join(sessions, 'demo.jsonl'), 'utf8'), log, 'Agent data must not change');
console.log(`Native smoke passed: four XAML pages, light/dark, wide/narrow, Chinese/English, ${fresh ? 'first-run empty state' : 'priced fixture'}, clean exit. Screenshots: ${profile}`);
