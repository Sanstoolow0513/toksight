import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { buildDesktop, validatePublish } from './desktop-build.js';
import { desktop, exists, fail, options, output, pkg, powershell, removeOutput, requireWindows, run, runtime } from './desktop-common.js';

const xml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

async function findTool(name, candidates) {
  for (const base of [...(process.env.PATH || '').split(path.delimiter), ...candidates]) {
    const file = path.join(base, name);
    if (await exists(file)) return file;
  }
  return null;
}

async function sdkTool() {
  const base = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
  const versions = (await readdir(base).catch(() => [])).filter((name) => /^\d+\.\d+\.\d+\.\d+$/.test(name))
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  return findTool('MakeAppx.exe', versions.map((version) => path.join(base, version, 'x64')));
}

// The existing 3x3 heat-map brand mark, rendered directly into PNG for package
// metadata. This uses only Node built-ins and adds no raster/image dependency.
function logo(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const alphas = [0.35, 0.55, 1, 0.2, 0.75, 0.55, 0.35, 0.2, 0.75];
  const pad = Math.round(size * 0.16), gap = Math.max(1, Math.round(size * 0.055));
  const cell = Math.floor((size - pad * 2 - gap * 2) / 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const col = Math.floor((x - pad) / (cell + gap)), row = Math.floor((y - pad) / (cell + gap));
      const inside = col >= 0 && col < 3 && row >= 0 && row < 3
        && (x - pad) % (cell + gap) < cell && (y - pad) % (cell + gap) < cell;
      const alpha = inside ? alphas[row * 3 + col] : 0;
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      [243, 243, 241].forEach((base, channel) => { raw[offset + channel] = Math.round(base * (1 - alpha) + [232, 89, 12][channel] * alpha); });
      raw[offset + 3] = 255;
    }
  }
  const chunk = (type, data) => {
    const contents = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of contents) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, contents, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function main() {
  const opts = options(process.argv.slice(2), ['identity', 'publisher', 'publisher-name', 'makeappx', 'inno']);
  if (opts.help) {
    console.log('Usage: npm run desktop:package -- [--arch x64|arm64] [--runtime <official-node.zip>] [--no-build]\n'
      + '  [--identity <package-name>] [--publisher <certificate-subject>] [--publisher-name <name>]\n'
      + '  [--makeappx <MakeAppx.exe>] [--inno <ISCC.exe>]\nCreates ZIP + unsigned MSIX; creates an unsigned setup.exe only when Inno Setup 6.3+ is available.');
    return;
  }
  requireWindows();
  const base = output(opts.arch), app = path.join(base, 'app');
  if (!opts['no-build']) await buildDesktop(opts);
  await validatePublish(app);
  const stem = `toksight-${pkg.version}-win-${opts.arch}`;
  const zip = path.join(base, `${stem}.zip`);
  await rm(zip, { force: true });
  await powershell(`Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($env:TOKSIGHT_PACKAGE_APP, $env:TOKSIGHT_PACKAGE_ZIP)`,
  { TOKSIGHT_PACKAGE_APP: app, TOKSIGHT_PACKAGE_ZIP: zip });
  console.log(`Unpacked ZIP: ${zip}`);

  const staging = path.join(base, 'msix');
  await removeOutput(staging);
  await cp(app, staging, { recursive: true });
  await mkdir(path.join(staging, 'PackageAssets'), { recursive: true });
  for (const [name, size] of [['Square44x44Logo', 44], ['Square150x150Logo', 150], ['StoreLogo', 50]]) {
    await writeFile(path.join(staging, 'PackageAssets', `${name}.png`), logo(size));
  }
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('MSIX packaging requires a stable three-part package.json version');
  const identity = opts.identity || runtime.package.identity;
  if (!/^[A-Za-z0-9.-]{3,50}$/.test(identity)) throw new Error('MSIX identity must be 3–50 letters, digits, periods or hyphens');
  const publisher = opts.publisher || runtime.package.publisher;
  const publisherName = opts['publisher-name'] || runtime.package.publisherDisplayName;
  const manifest = `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">
  <Identity Name="${xml(identity)}" Publisher="${xml(publisher)}" Version="${pkg.version}.0" ProcessorArchitecture="${opts.arch}" />
  <Properties><DisplayName>toksight</DisplayName><PublisherDisplayName>${xml(publisherName)}</PublisherDisplayName><Logo>PackageAssets\\StoreLogo.png</Logo></Properties>
  <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="${runtime.package.minimumWindowsVersion}" MaxVersionTested="10.0.26100.0" /></Dependencies>
  <Resources><Resource Language="en-us" /><Resource Language="zh-cn" /></Resources>
  <Applications><Application Id="Toksight" Executable="Toksight.Desktop.exe" EntryPoint="Windows.FullTrustApplication">
    <uap:VisualElements DisplayName="toksight" Description="Local AI coding agent usage, cost and cache reports" BackgroundColor="#f3f3f1"
      Square150x150Logo="PackageAssets\\Square150x150Logo.png" Square44x44Logo="PackageAssets\\Square44x44Logo.png" />
  </Application></Applications>
  <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>
</Package>
`;
  await writeFile(path.join(staging, 'AppxManifest.xml'), manifest);
  const makeappx = opts.makeappx ? path.resolve(opts.makeappx) : await sdkTool();
  if (!makeappx) throw new Error('ZIP is ready, but MakeAppx.exe is missing. Install Windows SDK or pass --makeappx <path>.');
  const msix = path.join(base, `${stem}.msix`);
  await run(makeappx, ['pack', '/d', staging, '/p', msix, '/o']);
  console.log(`Unsigned MSIX: ${msix}`);

  const inno = opts.inno ? path.resolve(opts.inno) : await findTool('ISCC.exe', [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Inno Setup 6'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Inno Setup 6'),
  ]);
  if (inno) {
    await run(inno, [`/DSourceDir=${app}`, `/DOutputDir=${base}`, `/DAppVersion=${pkg.version}`, `/DAppArch=${opts.arch}`,
      `/DOutputBaseFilename=${stem}-setup`, path.join(desktop, 'installer.iss')]);
  } else {
    console.log('Inno Setup not found. ZIP and MSIX are ready; installer.iss can generate setup.exe when Inno Setup 6.3+ is available.');
  }
  await writeFile(path.join(base, 'package-info.json'), JSON.stringify({ version: pkg.version, arch: opts.arch,
    node: runtime.version, identity, publisher, signed: false, zip: path.basename(zip), msix: path.basename(msix),
    installer: inno ? `${stem}-setup.exe` : null }, null, 2) + '\n');
}

await main().catch(fail);
