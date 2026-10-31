import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { options, output, pkg, prepareRuntime, project, removeOutput, run, fail, powershell } from './desktop-common.js';

export async function validatePublish(directory) {
  for (const relative of ['Toksight.Desktop.exe', 'LICENSE', 'backend/node.exe', 'backend/NODE-LICENSE',
    'backend/desktop/service.mjs', 'backend/src/webserver.js', 'backend/package.json',
    'Assets/Fonts/Geist-Variable.ttf', 'Assets/Fonts/GeistMono-Variable.ttf', 'Assets/Fonts/LICENSE.txt',
    'Assets/Icons/lucide.json', 'Assets/Icons/LICENSE.txt', 'Assets/Logos/LICENSE.txt']) {
    await access(path.join(directory, relative)).catch(() => { throw new Error(`Incomplete desktop publish: ${relative}. Run npm run desktop:build.`); });
  }
}

export async function buildDesktop(opts) {
  await prepareRuntime(opts);
  const directory = path.join(output(opts.arch), 'app');
  // Replacing XBF/PRI resources while its old DLL is loaded can leave a mixed
  // application. Refuse before touching any files in an active publish folder.
  await powershell(`
$active = Get-CimInstance Win32_Process -Filter "Name = 'Toksight.Desktop.exe'" |
  Where-Object { $_.ExecutablePath -and [IO.Path]::GetDirectoryName($_.ExecutablePath) -eq $env:TOKSIGHT_DESKTOP_PUBLISH_DIR }
if ($active) { throw 'Close the running toksight desktop window before rebuilding this publish directory.' }
`, { TOKSIGHT_DESKTOP_PUBLISH_DIR: directory });
  await removeOutput(directory);
  await mkdir(directory, { recursive: true });
  await run('dotnet', ['publish', project, '-c', 'Release', `-p:Platform=${opts.arch === 'arm64' ? 'ARM64' : 'x64'}`,
    '-r', `win-${opts.arch}`, '--self-contained', 'true', '-p:WindowsAppSDKSelfContained=true',
    '-p:RestoreLockedMode=true', `-p:Version=${pkg.version}`, '-o', directory]);
  await validatePublish(directory);
  console.log(`Desktop built: ${directory}\nRun: npm run desktop:run -- --arch ${opts.arch}`);
  return directory;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const opts = options();
    if (opts.help) console.log('Usage: npm run desktop:build -- [--arch x64|arm64] [--runtime <official-node.zip>]');
    else await buildDesktop(opts);
  } catch (error) { fail(error); }
}
