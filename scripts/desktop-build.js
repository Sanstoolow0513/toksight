import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { options, output, pkg, prepareRuntime, project, removeOutput, run, fail } from './desktop-common.js';

export async function validatePublish(directory) {
  for (const relative of ['Toksight.Desktop.exe', 'LICENSE', 'backend/node.exe', 'backend/NODE-LICENSE',
    'backend/desktop/service.mjs', 'backend/src/webserver.js', 'backend/package.json']) {
    await access(path.join(directory, relative)).catch(() => { throw new Error(`Incomplete desktop publish: ${relative}. Run npm run desktop:build.`); });
  }
}

export async function buildDesktop(opts) {
  await prepareRuntime(opts);
  const directory = path.join(output(opts.arch), 'app');
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
