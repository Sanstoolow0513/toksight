import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const files = ['package.json', 'package-lock.json', 'web/package.json', 'web/package-lock.json'];

export function parseStableVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) throw new Error(`Expected a stable X.Y.Z version, got ${version}`);
  const parts = match.slice(1).map(Number);
  if (!parts.every(Number.isSafeInteger)) {
    throw new Error(`Version exceeds JavaScript's safe integer range: ${version}`);
  }
  return parts;
}

export function compareVersions(left, right) {
  const a = parseStableVersion(left);
  const b = parseStableVersion(right);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  }
  return 0;
}

function nextVersion(version, bump) {
  const [major, minor, patch] = parseStableVersion(version);
  if (!['patch', 'minor', 'major'].includes(bump)) {
    if (compareVersions(bump, version) <= 0) {
      throw new Error(`Release version ${bump} must be newer than ${version}`);
    }
    return bump;
  }
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

async function readReleaseDocuments(root) {
  const documents = await Promise.all(files.map(async (name) => {
    const source = await readFile(join(root, name), 'utf8');
    return { name, source, data: JSON.parse(source) };
  }));
  const version = documents[0].data.version;
  parseStableVersion(version);
  for (const { name, data } of documents) {
    if (data.version !== version || (name.endsWith('package-lock.json') && data.packages?.['']?.version !== version)) {
      throw new Error(`${name} version does not match package.json (${version})`);
    }
  }
  return { documents, version };
}

export async function readReleaseVersion(root) {
  return (await readReleaseDocuments(root)).version;
}

export async function bumpReleaseVersion(root, bump) {
  const { documents, version } = await readReleaseDocuments(root);
  const next = nextVersion(version, bump);
  parseStableVersion(next);
  for (const { name, source, data } of documents) {
    data.version = next;
    if (name.endsWith('package-lock.json')) data.packages[''].version = next;
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const text = JSON.stringify(data, null, 2).replace(/\n/g, newline) + newline;
    await writeFile(join(root, name), text);
  }
  return next;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  bumpReleaseVersion(root, process.argv[2]).then(
    (version) => console.log(version),
    (error) => { console.error(error.message); process.exitCode = 1; },
  );
}
