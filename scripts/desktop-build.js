import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktop, root, options, output, pkg, prepareRuntime, project, removeOutput, run, fail, powershell, tauriCli, target } from './desktop-common.js';

export async function validatePublish(directory) {
  for (const relative of ['toksight-desktop.exe', 'LICENSE', 'backend/node.exe', 'backend/NODE-LICENSE',
    'backend/desktop/service.mjs', 'backend/src/webserver.js', 'backend/package.json']) {
    await access(path.join(directory, relative)).catch(() => { throw new Error(`Incomplete Tauri publish: ${relative}. Run npm run desktop:build.`); });
  }
}

async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function directoryHashes(directory, prefix = '') {
  const result = {};
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix + entry.name, file = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await directoryHashes(file, name + '/'));
    else if (entry.isFile()) result[name] = await fileHash(file);
    else throw new Error(`Unexpected non-file in desktop package: ${file}`);
  }
  return result;
}

// Tauri bundles from target/ and staging/, while the ZIP comes from app/.
// Reject stale or cross-architecture inputs before producing mixed packages.
export async function validateBundleInputs(directory, arch) {
  await validatePublish(directory);
  const binary = 'toksight-desktop.exe';
  const [published, bundled, releaseHash, publishedHash, version] = await Promise.all([
    directoryHashes(path.join(directory, 'backend')),
    directoryHashes(path.join(desktop, 'staging', 'backend')),
    fileHash(path.join(project, 'target', target(arch), 'release', binary)),
    fileHash(path.join(directory, binary)),
    readFile(path.join(directory, 'backend', 'package.json'), 'utf8').then(JSON.parse),
  ]);
  const licenses = await Promise.all([
    path.join(root, 'LICENSE'), path.join(directory, 'LICENSE'), path.join(desktop, 'staging', 'LICENSE'),
  ].map(fileHash));
  if (JSON.stringify(published) !== JSON.stringify(bundled) || releaseHash !== publishedHash
    || version.version !== pkg.version || licenses.some(hash => hash !== licenses[0])) {
    throw new Error('Desktop bundle inputs differ from the portable app. Run npm run desktop:build for this architecture before packaging.');
  }
}

export async function prepareDesktop(opts) {
  await access(tauriCli).catch(() => { throw new Error('Desktop dependencies missing. Run npm run desktop:ci.'); });
  const conf = JSON.parse(await readFile(path.join(project, 'tauri.conf.json'), 'utf8'));
  const version = typeof conf.version === 'string' && conf.version.endsWith('.json')
    ? JSON.parse(await readFile(path.resolve(project, conf.version), 'utf8')).version : conf.version;
  if (version !== pkg.version) throw new Error('Desktop tauri.conf.json version must resolve to the root package.json version.');
  const node = await prepareRuntime(opts);
  // Only remove the known generated staging directory; never follow a supplied
  // path or merge a new backend into old files left by a previous build.
  const staging = path.resolve(desktop, 'staging');
  if (path.dirname(staging) !== path.resolve(desktop) || path.basename(staging) !== 'staging') {
    throw new Error('Refusing to clean outside desktop/staging.');
  }
  await rm(staging, { recursive: true, force: true });
  const backend = path.join(staging, 'backend');
  await mkdir(path.join(backend, 'desktop'), { recursive: true });
  await cp(path.join(root, 'src'), path.join(backend, 'src'), { recursive: true });
  await cp(path.join(root, 'package.json'), path.join(backend, 'package.json'));
  await cp(path.join(desktop, 'service.mjs'), path.join(backend, 'desktop', 'service.mjs'));
  await cp(path.join(node, 'node.exe'), path.join(backend, 'node.exe'));
  await cp(path.join(node, 'LICENSE'), path.join(backend, 'NODE-LICENSE'));
  await cp(path.join(root, 'LICENSE'), path.join(desktop, 'staging', 'LICENSE'));
  return backend;
}

export async function buildDesktop(opts) {
  const backend = await prepareDesktop(opts);
  const directory = path.join(output(opts.arch), 'tauri', 'app');
  await powershell(`
$active = Get-CimInstance Win32_Process -Filter "Name = 'toksight-desktop.exe'" |
  Where-Object { $_.ExecutablePath -and [IO.Path]::GetDirectoryName($_.ExecutablePath) -eq $env:TOKSIGHT_DESKTOP_PUBLISH_DIR }
if ($active) { throw 'Close the running toksight desktop window before rebuilding this publish directory.' }
`, { TOKSIGHT_DESKTOP_PUBLISH_DIR: directory });
  await run(process.execPath, [path.join(root, 'scripts', 'web-build.js')]);
  await run(process.execPath, [tauriCli, 'build', '--no-bundle', '--target', target(opts.arch), '--', '--locked'], { cwd: desktop });
  await removeOutput(directory);
  await mkdir(directory, { recursive: true });
  await cp(path.join(project, 'target', target(opts.arch), 'release', 'toksight-desktop.exe'), path.join(directory, 'toksight-desktop.exe'));
  await cp(backend, path.join(directory, 'backend'), { recursive: true });
  await cp(path.join(root, 'LICENSE'), path.join(directory, 'LICENSE'));
  await writeFile(path.join(directory, 'README.txt'), 'toksight desktop (Tauri)\r\nRun toksight-desktop.exe. Keep the backend directory beside it.\r\nRequires Microsoft Edge WebView2; use the setup.exe installer to install it automatically.\r\n');
  await validatePublish(directory);
  console.log(`Tauri desktop built: ${directory}\nRun: npm run desktop:run -- --arch ${opts.arch}`);
  return directory;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const opts = options();
    if (opts.help) console.log('Usage: npm run desktop:build -- [--arch x64|arm64] [--runtime <official-node.zip>]');
    else await buildDesktop(opts);
  } catch (error) { fail(error); }
}
