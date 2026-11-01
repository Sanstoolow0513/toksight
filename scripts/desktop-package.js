import { cp, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildDesktop, validateBundleInputs } from './desktop-build.js';
import { desktop, fail, options, output, pkg, powershell, project, requireWindows, run, runtime, tauriCli, target } from './desktop-common.js';

async function main() {
  const opts = options();
  if (opts.help) {
    console.log('Usage: npm run desktop:package -- [--arch x64|arm64] [--no-build] [--store]\nCreates a portable ZIP and NSIS setup.exe. --store embeds the offline WebView2 installer; signing and Store submission are separate.');
    return;
  }
  requireWindows();
  const base = path.join(output(opts.arch), 'tauri'), app = path.join(base, 'app');
  if (!opts['no-build']) await buildDesktop(opts);
  await validateBundleInputs(app, opts.arch);
  const flags = opts.store ? ['--config', path.join(project, 'tauri.store.conf.json')] : [];
  const bundleDir = path.join(project, 'target', target(opts.arch), 'release', 'bundle', 'nsis');
  // Remove old installer files only, so a prior version cannot be selected as
  // this build's output. Names come directly from this generated directory.
  for (const file of await readdir(bundleDir).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
    if (file.endsWith('-setup.exe')) await rm(path.join(bundleDir, file));
  }
  await run(process.execPath, [tauriCli, 'bundle', '--bundles', 'nsis', '--target', target(opts.arch), '--no-binary-patching', '--no-sign', ...flags], { cwd: desktop });
  await validateBundleInputs(app, opts.arch);
  const installers = (await readdir(bundleDir)).filter(file => file.endsWith('-setup.exe'));
  if (installers.length !== 1) throw new Error('Expected exactly one NSIS installer in the target bundle directory.');
  const stem = `toksight-${pkg.version}-win-${opts.arch}${opts.store ? '-store' : ''}`;
  const installer = path.join(base, `${stem}-setup.exe`);
  await cp(path.join(bundleDir, installers[0]), installer);
  const zip = path.join(base, `${stem}.zip`);
  await rm(zip, { force: true });
  await powershell(`Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($env:TOKSIGHT_ZIP_SOURCE, $env:TOKSIGHT_ZIP_DESTINATION, [IO.Compression.CompressionLevel]::Optimal, $false)`,
  { TOKSIGHT_ZIP_SOURCE: app, TOKSIGHT_ZIP_DESTINATION: zip });
  await writeFile(path.join(base, 'package-info.json'), JSON.stringify({ version: pkg.version, framework: 'tauri2', arch: opts.arch,
    node: runtime.version, zip: path.basename(zip), installer: path.basename(installer),
    webviewInstallMode: opts.store ? 'offlineInstaller' : 'downloadBootstrapper', signed: false, storeSubmitted: false }, null, 2) + '\n');
  console.log(`Desktop packages:\n${zip}\n${installer}`);
}
main().catch(fail);
