// Optional manual backup of the usage database to the user's own private
// GitHub repository, and restore by merging that backup back in. Zero
// dependencies: built-in fetch against the REST API. Nothing here runs on its
// own; every network call starts from an explicit web action.
//
// One fixed remote file (`toksight/usage.sqlite`) on the default branch.
// Snapshots up to 1 MiB use the Contents API; larger ones go through the Git
// Data API (blob → tree → commit → ref), whose final ref update is atomic, so
// an interrupted upload leaves the previous backup in place.

import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { configDir } from './pricing.js';
import { MAX_DATABASE_BYTES, readDatabaseBackup } from './dbtransfer.js';

export const REMOTE_PATH = 'toksight/usage.sqlite';
export const MAX_SNAPSHOT_BYTES = 90 * 1024 * 1024; // GitHub rejects files over 100 MiB.
export const CONTENTS_API_LIMIT = 1024 * 1024;
export const TOKEN_ENV = ['TOKSIGHT_GITHUB_TOKEN', 'GITHUB_TOKEN'];
const API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 30_000;
const TRANSFER_TIMEOUT_MS = 10 * 60_000;
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const TOKEN_RE = /^[\x21-\x7e]{1,512}$/;

export function syncError(code, message, status = 502, extra = {}) {
  return Object.assign(new Error(message), { code, status, ...extra });
}

export const backupConfigFile = (ctx) => path.join(configDir(ctx), 'github-backup.json');
export const safetyBackupFile = (ctx) => path.join(configDir(ctx), 'backups', 'before-github-restore.sqlite');

// Git's blob id, so a local snapshot can be compared with the remote file
// and a download can be verified without trusting its length alone.
export function gitBlobSha(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

export function validRepo(repo) {
  return typeof repo === 'string' && REPO_RE.test(repo) && !/\/\.{1,2}$/.test(repo);
}

function readConfig(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

// The token sits in toksight's own config directory. The file is replaced
// atomically and created owner-only (0600) where the OS supports modes; on
// Windows it inherits the user profile's private ACL.
function writePrivateFile(file, data) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, data, { mode: 0o600 });
  try { chmodSync(temp, 0o600); } catch { /* not supported on this filesystem */ }
  try { renameSync(temp, file); }
  catch (err) { rmSync(temp, { force: true }); throw err; }
}

export function resolveToken(env, config) {
  for (const name of TOKEN_ENV) {
    const value = env?.[name]?.trim();
    if (value) return { token: value, source: name };
  }
  return config.token ? { token: config.token, source: 'config' } : { token: null, source: null };
}

function rateLimitError(res) {
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  const retryAfter = Number(res.headers.get('retry-after'));
  const retryAt = Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString()
    : Number.isFinite(retryAfter) && retryAfter > 0 ? new Date(Date.now() + retryAfter * 1000).toISOString() : null;
  return syncError('SYNC_RATE_LIMIT', `GitHub rate limit reached${retryAt ? `; try again after ${retryAt}` : ''}. Local reports are unaffected.`, 502, { retryAt });
}

// A minimal REST client. Responses are mapped to specific, token-free errors;
// `allow` lists statuses the caller handles itself (returned, not thrown).
export function createGitHubClient({ token, repo, fetchImpl = globalThis.fetch, apiBase = API }) {
  const permission = `The token needs Contents: read and write (and Metadata: read) on ${repo}.`;
  async function call(method, route, { body, accept, raw = false, allow = [], scope = 'read', timeout = REQUEST_TIMEOUT_MS } = {}) {
    let res;
    try {
      res = await fetchImpl(apiBase + route, {
        method,
        headers: {
          accept: accept ?? 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'user-agent': 'toksight',
          'x-github-api-version': '2022-11-28',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw syncError('SYNC_OFFLINE', timedOut ? 'GitHub did not respond in time. Check your connection and try again; nothing was changed.'
        : 'Could not reach GitHub. Check your connection and try again; nothing was changed.');
    }
    if (res.ok) {
      if (raw) return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
      return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
    }
    if (allow.includes(res.status)) { await res.body?.cancel?.().catch?.(() => {}); return { status: res.status, body: null }; }
    const detail = await res.json().catch(() => ({}));
    const message = typeof detail?.message === 'string' ? detail.message : '';
    if (res.status === 429 || (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(message)))) throw rateLimitError(res);
    if (res.status === 401) throw syncError('SYNC_AUTH', 'GitHub rejected the token (401). It may be invalid, expired or revoked.');
    if (res.status === 403) throw syncError('SYNC_FORBIDDEN', `GitHub denied access (403). ${permission}`);
    if (res.status === 404) {
      throw scope === 'repo' ? syncError('SYNC_REPO_NOT_FOUND', `Repository ${repo} was not found, or the token cannot see it. ${permission}`)
        : syncError('SYNC_FORBIDDEN', `GitHub returned 404 for ${repo}. ${permission}`);
    }
    if (res.status === 409 || res.status === 422) throw syncError('SYNC_CONFLICT', 'The backup on GitHub changed during the operation. Try again; the previous backup is unchanged.', 409);
    throw syncError('SYNC_GITHUB_ERROR', `GitHub returned HTTP ${res.status}${message ? `: ${message}` : ''}. Try again later; nothing was changed.`);
  }
  return { call };
}

const encodeRef = (ref) => ref.split('/').map(encodeURIComponent).join('/');

async function openRepo(client, repo, { requirePrivate }) {
  const { body } = await client.call('GET', `/repos/${repo}`, { scope: 'repo' });
  if (!body || typeof body !== 'object') throw syncError('SYNC_GITHUB_ERROR', 'GitHub returned an unexpected repository response.');
  if (body.private !== true && requirePrivate) {
    throw syncError('SYNC_PUBLIC_REPO', `${repo} is public. Usage history includes session titles and directories, so toksight only backs up to a private repository.`, 400);
  }
  return { branch: body.default_branch || 'main', private: body.private === true };
}

async function remoteFile(client, repo, branch) {
  const { status, body } = await client.call('GET', `/repos/${repo}/contents/${REMOTE_PATH}?ref=${encodeURIComponent(branch)}`, { allow: [404] });
  if (status === 404) return null;
  if (!body || Array.isArray(body) || body.type !== 'file' || !/^[0-9a-f]{40,64}$/.test(body.sha ?? '')) {
    throw syncError('SYNC_GITHUB_ERROR', `${REMOTE_PATH} on GitHub is not a file.`);
  }
  return { sha: body.sha, size: Number(body.size) || 0 };
}

async function putContents(client, repo, branch, filePath, bytes, message, sha) {
  const { body } = await client.call('PUT', `/repos/${repo}/contents/${filePath}`, { scope: 'write', timeout: TRANSFER_TIMEOUT_MS,
    body: { message, content: bytes.toString('base64'), branch, ...(sha ? { sha } : {}) } });
  return { sha: body?.content?.sha ?? null, commit: body?.commit?.sha ?? null };
}

// Git Data API: every object is created first and only the last call (a
// non-forced ref update) makes the new commit visible.
async function putLarge(client, repo, branch, bytes, message) {
  const refRoute = `/repos/${repo}/git/ref/heads/${encodeRef(branch)}`;
  let ref = await client.call('GET', refRoute, { allow: [404, 409] });
  if (ref.status !== 200) {
    // An empty repository has no branch to build on; one tiny commit creates it.
    await putContents(client, repo, branch, 'toksight/README.md', Buffer.from('Backups written by toksight (https://github.com/Sanstoolow0513/toksight).\n'), 'Initialize toksight backup');
    ref = await client.call('GET', refRoute);
  }
  const parent = ref.body?.object?.sha;
  const { body: commit } = await client.call('GET', `/repos/${repo}/git/commits/${parent}`);
  const { body: blob } = await client.call('POST', `/repos/${repo}/git/blobs`, { scope: 'write', timeout: TRANSFER_TIMEOUT_MS,
    body: { content: bytes.toString('base64'), encoding: 'base64' } });
  const { body: tree } = await client.call('POST', `/repos/${repo}/git/trees`, { scope: 'write',
    body: { base_tree: commit?.tree?.sha, tree: [{ path: REMOTE_PATH, mode: '100644', type: 'blob', sha: blob?.sha }] } });
  const { body: created } = await client.call('POST', `/repos/${repo}/git/commits`, { scope: 'write',
    body: { message, tree: tree?.sha, parents: [parent] } });
  await client.call('PATCH', `/repos/${repo}/git/refs/heads/${encodeRef(branch)}`, { scope: 'write', body: { sha: created?.sha, force: false } });
  return { sha: blob?.sha ?? null, commit: created?.sha ?? null };
}

function integrityCheck(bytes) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'toksight-restore-'));
  try {
    const file = path.join(dir, 'usage.sqlite');
    writeFileSync(file, bytes);
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const rows = db.prepare('PRAGMA integrity_check').all();
      if (rows.length !== 1 || Object.values(rows[0])[0] !== 'ok') throw new Error('database integrity check failed');
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export function createGitHubBackup({ env = process.env, home = os.homedir(), database, fetchImpl = globalThis.fetch, apiBase = API, now = Date.now, offline = false } = {}) {
  const file = backupConfigFile({ env, home });
  let busy = null;

  function status() {
    const config = readConfig(file);
    const { token, source } = resolveToken(env, config);
    const repo = validRepo(config.repo) ? config.repo : null;
    const same = (record) => record && record.repo === repo ? record : null;
    return {
      configured: Boolean(repo && token), repo, tokenSource: source, tokenSaved: Boolean(config.token),
      remotePath: REMOTE_PATH, maxBytes: MAX_SNAPSHOT_BYTES, offline: Boolean(offline), busy, safetyBackup: safetyBackupFile({ env, home }),
      lastBackup: same(config.lastBackup), lastRestore: same(config.lastRestore),
    };
  }

  function configure(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['repo', 'token', 'clearToken'].includes(key))) {
      throw syncError('SYNC_BAD_CONFIG', 'invalid backup settings', 400);
    }
    if (busy) throw syncError('SYNC_BUSY', 'A GitHub backup or restore is already running', 409);
    const config = readConfig(file);
    if (Object.hasOwn(input, 'repo')) {
      const repo = typeof input.repo === 'string' ? input.repo.trim().replace(/^https:\/\/github\.com\//i, '').replace(/(\.git)?\/?$/, '') : input.repo;
      if (repo === '' || repo === null) delete config.repo;
      else if (!validRepo(repo)) throw syncError('SYNC_BAD_REPO', 'Repository must look like owner/name', 400);
      else config.repo = repo;
    }
    if (input.clearToken === true) delete config.token;
    else if (Object.hasOwn(input, 'clearToken') && input.clearToken !== false) throw syncError('SYNC_BAD_CONFIG', 'invalid backup settings', 400);
    if (typeof input.token === 'string' && input.token.trim()) {
      if (!TOKEN_RE.test(input.token.trim())) throw syncError('SYNC_BAD_TOKEN', 'The token contains unsupported characters', 400);
      config.token = input.token.trim();
    } else if (Object.hasOwn(input, 'token') && typeof input.token !== 'string') throw syncError('SYNC_BAD_CONFIG', 'invalid backup settings', 400);
    writePrivateFile(file, `${JSON.stringify(config, null, 2)}\n`);
    return status();
  }

  function prepare() {
    if (offline) throw syncError('SYNC_OFFLINE_MODE', 'GitHub backup needs network access; this web session was started with --offline.', 400);
    if (busy) throw syncError('SYNC_BUSY', 'A GitHub backup or restore is already running', 409);
    const config = readConfig(file);
    const { token } = resolveToken(env, config);
    if (!validRepo(config.repo) || !token) throw syncError('SYNC_NOT_CONFIGURED', 'Set a private repository and a GitHub token first', 400);
    return { config, repo: config.repo, client: createGitHubClient({ token, repo: config.repo, fetchImpl, apiBase }) };
  }

  async function exclusive(kind, fn) {
    busy = kind;
    try { return await fn(); }
    finally { busy = null; }
  }

  function remember(key, value) {
    const config = readConfig(file);
    config[key] = value;
    writePrivateFile(file, `${JSON.stringify(config, null, 2)}\n`);
  }

  async function upload() {
    const { repo, client } = prepare();
    return exclusive('upload', async () => {
      // The local database is only read (VACUUM INTO a temporary file).
      const bytes = database.exportDatabase();
      if (bytes.length > MAX_SNAPSHOT_BYTES) {
        throw syncError('SYNC_TOO_LARGE', `The snapshot is ${(bytes.length / 1048576).toFixed(1)} MiB; GitHub backups are limited to 90 MiB.`, 413, { size: bytes.length });
      }
      const { branch } = await openRepo(client, repo, { requirePrivate: true });
      const existing = await remoteFile(client, repo, branch);
      const sha = gitBlobSha(bytes);
      const at = new Date(now()).toISOString();
      let result;
      if (existing?.sha === sha) result = { sha, commit: null, unchanged: true };
      else {
        const message = `toksight backup ${at}`;
        const written = bytes.length <= CONTENTS_API_LIMIT
          ? await putContents(client, repo, branch, REMOTE_PATH, bytes, message, existing?.sha)
          : await putLarge(client, repo, branch, bytes, message);
        result = { ...written, sha: written.sha ?? sha, unchanged: false };
      }
      const record = { repo, branch, at, size: bytes.length, sha: result.sha, commit: result.commit };
      remember('lastBackup', record);
      return { ...status(), result: { ...record, unchanged: result.unchanged } };
    });
  }

  async function restore({ importDatabase = (bytes) => database.importDatabase(bytes) } = {}) {
    const { repo, client } = prepare();
    return exclusive('restore', async () => {
      const { branch } = await openRepo(client, repo, { requirePrivate: false });
      const remote = await remoteFile(client, repo, branch);
      if (!remote) throw syncError('SYNC_NO_BACKUP', `There is no backup at ${REMOTE_PATH} in ${repo} yet.`, 404);
      if (remote.size > MAX_DATABASE_BYTES) throw syncError('SYNC_TOO_LARGE', 'The remote backup is larger than 256 MB.', 413);
      const { body: bytes } = await client.call('GET', `/repos/${repo}/git/blobs/${remote.sha}`,
        { accept: 'application/vnd.github.raw+json', raw: true, timeout: TRANSFER_TIMEOUT_MS });
      // Validate a temporary copy completely before touching the live DB.
      try {
        if (gitBlobSha(bytes) !== remote.sha) throw new Error('the download is incomplete or corrupted');
        integrityCheck(bytes);
        readDatabaseBackup(bytes);
      } catch (err) {
        throw syncError('SYNC_BAD_BACKUP', `The backup on GitHub is not a valid toksight database (${err.message.replace(/^Invalid toksight database: /, '')}). Local data was not changed.`, 400);
      }
      // Keep the latest pre-restore state so a merge can be undone by hand.
      const safety = safetyBackupFile({ env, home });
      writePrivateFile(safety, database.exportDatabase());
      let merged;
      try { merged = await importDatabase(bytes); }
      catch (err) {
        // The merge is one SQLite transaction; a failure rolls it back.
        throw syncError('SYNC_MERGE_FAILED', `Merging the backup failed and was rolled back (${err.message}). A copy of the previous database is at ${safety}.`, 500);
      }
      const record = { repo, at: new Date(now()).toISOString(), sha: remote.sha, size: bytes.length, safetyBackup: safety };
      remember('lastRestore', record);
      return { ...status(), result: { ...merged, ...record } };
    });
  }

  return { status, configure, upload, restore, file };
}
