import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const desktop = path.join(root, 'desktop');
export const project = path.join(desktop, 'Toksight.Desktop', 'Toksight.Desktop.csproj');
export const runtime = JSON.parse(await readFile(path.join(desktop, 'runtime.json'), 'utf8'));
export const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

export function options(argv = process.argv.slice(2), extra = []) {
  const result = { arch: 'x64' };
  const values = new Set(['arch', 'runtime', ...extra]);
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`);
    if (['help', 'offline', 'no-build'].includes(name)) result[name] = true;
    else if (values.has(name) && argv[i + 1] && !argv[i + 1].startsWith('--')) result[name] = argv[++i];
    else throw new Error(`Unknown or incomplete option: --${name}`);
  }
  if (!['x64', 'arm64'].includes(result.arch)) throw new Error('--arch must be x64 or arm64');
  return result;
}

export function requireWindows() {
  if (process.platform !== 'win32') throw new Error('WinUI desktop builds require Windows, .NET 10 SDK and the Windows SDK.');
}

export function output(arch) { return path.join(root, 'dist', 'desktop', `win-${arch}`); }
export async function exists(file) { return access(file).then(() => true, () => false); }

export function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: 'inherit', ...opts });
    child.once('error', (error) => reject(new Error(`Cannot run ${command}: ${error.message}`)));
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} failed (${signal || code})`)));
  });
}

export function powershell(code, env = {}) {
  // User-supplied paths travel as environment values, never as shell source.
  return run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(`$ErrorActionPreference = 'Stop'\n$ProgressPreference = 'SilentlyContinue'\n${code}`, 'utf16le').toString('base64')], { env: { ...process.env, ...env } });
}

export async function removeOutput(target) {
  const resolved = path.resolve(target);
  const boundary = path.resolve(root, 'dist', 'desktop');
  const relative = path.relative(boundary, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Refusing to remove outside desktop output');
  await rm(resolved, { recursive: true, force: true });
}

export async function prepareRuntime({ arch, runtime: supplied }) {
  requireWindows();
  const record = runtime.archives[arch];
  const cache = path.join(desktop, '.cache');
  await mkdir(cache, { recursive: true });
  const archive = supplied ? path.resolve(supplied) : path.join(cache, record.file);
  if (!(await exists(archive))) {
    if (supplied) throw new Error(`Node archive not found: ${archive}`);
    const url = new URL(record.file, runtime.source);
    console.log(`Downloading pinned Node ${runtime.version} (${arch}): ${url}`);
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body) throw new Error(`Node download failed: HTTP ${response.status}`);
    const temporary = `${archive}.${process.pid}.download`;
    try {
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }));
      await rename(temporary, archive);
    } finally { await rm(temporary, { force: true }); }
  }
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
  if (digest !== record.sha256) throw new Error(`Node archive SHA256 mismatch: ${archive}. Supply the exact ${record.file} from nodejs.org.`);
  const destination = path.join(desktop, 'runtime', `win-${arch}`);
  await mkdir(destination, { recursive: true });
  await powershell(`
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($env:TOKSIGHT_RUNTIME_ARCHIVE)
try {
  foreach ($file in @('node.exe', 'LICENSE')) {
    $entry = $archive.GetEntry($env:TOKSIGHT_RUNTIME_PREFIX + '/' + $file)
    if ($null -eq $entry) { throw "Missing Node archive entry: $file" }
    $inputStream = $entry.Open()
    $outputStream = [IO.File]::Create([IO.Path]::Combine($env:TOKSIGHT_RUNTIME_DESTINATION, $file))
    try { $inputStream.CopyTo($outputStream) } finally { $inputStream.Dispose(); $outputStream.Dispose() }
  }
} finally { $archive.Dispose() }
`, { TOKSIGHT_RUNTIME_ARCHIVE: archive, TOKSIGHT_RUNTIME_PREFIX: record.file.slice(0, -4), TOKSIGHT_RUNTIME_DESTINATION: destination });
  console.log(`Verified Node ${runtime.version}: ${destination}`);
  return destination;
}

export function fail(error) { console.error(`error: ${error.message}`); process.exitCode = 1; }
