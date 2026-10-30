import { useEffect, useId, useRef, useState } from 'react';
import { CloudDownload, CloudUpload, TriangleAlert, X } from 'lucide-react';
import { Badge, Button, Field, IconButton, Panel } from './ui';
import { fmtBytes, fmtDateTime } from '@/lib/format';

const ERROR_KEYS = {
  SYNC_AUTH: 'backupErrAuth', SYNC_FORBIDDEN: 'backupErrForbidden', SYNC_REPO_NOT_FOUND: 'backupErrNotFound',
  SYNC_PUBLIC_REPO: 'backupErrPublic', SYNC_TOO_LARGE: 'backupErrTooLarge', SYNC_OFFLINE: 'backupErrOffline',
  SYNC_OFFLINE_MODE: 'backupOfflineNote', SYNC_NO_BACKUP: 'backupErrNoBackup', SYNC_BAD_BACKUP: 'backupErrBadBackup',
  SYNC_CONFLICT: 'backupErrConflict', SYNC_BAD_REPO: 'backupErrRepo', SYNC_BAD_TOKEN: 'backupErrToken',
  SYNC_NOT_CONFIGURED: 'backupErrNotConfigured', SYNC_BUSY: 'backupErrBusy', SYNC_LOCAL_ONLY: 'backupErrLocalOnly',
};

// Server codes become localized, actionable messages; anything unknown keeps
// the server's own (token-free) text.
export function backupErrorText(error, { tx, repo, remotePath, timezone }) {
  if (error.code === 'SYNC_RATE_LIMIT') return error.retryAt ? tx('backupErrRateLimitAt', { time: fmtDateTime(error.retryAt, timezone) }) : tx('backupErrRateLimit');
  if (error.code === 'SYNC_MERGE_FAILED') return tx('backupErrMerge', { error: error.message });
  const key = ERROR_KEYS[error.code];
  return key ? tx(key, { repo: repo ?? '—', path: remotePath ?? 'toksight/usage.sqlite' }) : tx('backupErrGeneric', { error: error.message });
}

function BackupError({ text, tx }) {
  return <div className="notice backup-error" role="alert"><TriangleAlert size={16} aria-hidden="true" />
    <div><strong>{tx('backupFailedTitle')}</strong><p>{text}</p></div></div>;
}

export function GitHubRestore({ status, busy, error, onRestore, onClose, tx, timezone }) {
  const ref = useRef(null);
  const title = useId();
  const description = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="dialog plate" aria-labelledby={title} aria-describedby={description}
    aria-busy={busy} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-head">
      <CloudDownload size={20} aria-hidden="true" />
      <h2 id={title}>{tx('backupRestore')}</h2>
      <IconButton label={tx('databaseCancel')} disabled={busy} onClick={onClose}><X size={18} /></IconButton>
    </div>
    <div className="database-file leader"><strong className="is-mono">{status.repo}</strong><span className="is-mono">{status.remotePath}</span></div>
    <p id={description}>{tx('backupRestoreDescription', { repo: status.repo })}</p>
    <p className="dialog-note">{tx('backupRestoreSafety')} <code>{status.safetyBackup}</code></p>
    {error ? <BackupError tx={tx} text={backupErrorText(error, { tx, repo: status.repo, remotePath: status.remotePath, timezone })} /> : null}
    <div className="dialog-actions">
      <Button disabled={busy} onClick={onClose}>{tx('databaseCancel')}</Button>
      <Button variant="primary" loading={busy} onClick={onRestore}>{tx(busy ? 'backupRestoring' : 'backupRestoreConfirm')}</Button>
    </div>
  </dialog>;
}

// GitHub CLI state: not installed / logged out (hint) / logged in, with an
// "in use" badge when it supplies the token, and a local re-check.
function GhStatus({ gh, active, detecting, disabled, onDetect, tx }) {
  const text = !gh?.installed ? tx('backupGhMissing') : !gh.loggedIn ? tx('backupGhLoggedOut')
    : gh.user ? tx('backupGhLoggedIn', { user: gh.user }) : tx('backupGhLoggedInAnon');
  return <div className="backup-gh">
    <span className="field-label">GitHub CLI</span>
    <span className="backup-gh-state">{gh?.installed && gh.loggedIn ? <Badge tone={active ? 'signal' : 'neutral'}>{tx(active ? 'backupGhInUse' : 'backupGhAvailable')}</Badge> : null}
      <span>{text}</span>
      <Button variant="text" loading={detecting} disabled={disabled} onClick={onDetect}>{tx(detecting ? 'backupGhChecking' : 'backupGhRecheck')}</Button></span>
  </div>;
}

export default function GitHubBackup({ backup, loading, timezone, tx, onSave, onUpload, onConfirmRestore, onDetect }) {
  const { status, busy, error, confirming } = backup;
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const savedRepo = status?.repo ?? '';
  useEffect(() => { setRepo(savedRepo); }, [savedRepo]);
  const ghToken = status?.tokenSource === 'gh';
  const envToken = status?.tokenSource && !['config', 'gh'].includes(status.tokenSource) ? status.tokenSource : null;
  const external = Boolean(envToken) || ghToken;
  const working = Boolean(busy);
  const blocked = !status || loading || working || status.offline;
  const ready = Boolean(status?.configured) && savedRepo === repo.trim();
  const last = status?.lastBackup;
  const save = async (event) => {
    event.preventDefault();
    const ok = await onSave({ repo: repo.trim(), ...(token.trim() ? { token: token.trim() } : {}) });
    if (ok) setToken('');
  };
  const actionHint = status?.offline ? tx('backupOfflineNote') : !status?.configured ? tx('backupNotConfigured') : tx('backupActionsHint');
  return <Panel className="settings-section backup-settings" level={2} icon={<CloudUpload size={18} aria-hidden="true" />} title={tx('backupTitle')} note={tx('backupDescription')}>
    <form className="settings-body backup-form" onSubmit={save}>
      <div className="backup-fields">
        <Field label={tx('backupRepo')} className="backup-field">
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder={tx('backupRepoPlaceholder')} spellCheck={false} autoComplete="off" disabled={!status || working} />
        </Field>
        <Field label={tx('backupToken')} className="backup-field">
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} disabled={!status || working || external}
            placeholder={envToken ? tx('backupTokenEnv', { name: envToken }) : ghToken ? tx('backupTokenGh') : status?.tokenSaved ? tx('backupTokenSaved') : tx('backupTokenPlaceholder')} />
        </Field>
        <Button type="submit" loading={busy === 'save'} disabled={!status || working || (repo.trim() === savedRepo && !token.trim())}>{tx(busy === 'save' ? 'backupSaving' : 'backupSave')}</Button>
      </div>
      <GhStatus gh={status?.gh} active={ghToken} detecting={busy === 'detect'} disabled={!status || working} onDetect={onDetect} tx={tx} />
      <p className="muted-note">{envToken ? `${tx('backupTokenEnv', { name: envToken })} · ` : ''}{ghToken ? tx('backupGhScope') : tx('backupTokenHint')}
        {status?.tokenSaved && !envToken ? <> <Button variant="text" disabled={working} onClick={() => void onSave({ clearToken: true })}>{tx('backupClearToken')}</Button></> : null}</p>
    </form>
    <div className="settings-row">
      <div><h3>{tx('backupLast')}</h3><p>{tx('backupRemote')} <code>{savedRepo ? `${savedRepo} · ${status.remotePath}` : status?.remotePath ?? '—'}</code></p></div>
      <span className="backup-last">{last ? tx('backupLastValue', { time: fmtDateTime(last.at, timezone), size: fmtBytes(last.size) }) : tx('backupNever')}</span>
    </div>
    <div className="settings-row">
      <div><h3>{tx('backupActionsTitle')}</h3><p>{actionHint}</p></div>
      <div className="backup-actions">
        <Button loading={busy === 'upload'} disabled={blocked || !ready} icon={<CloudUpload size={15} />} onClick={onUpload}>{tx(busy === 'upload' ? 'backupUploading' : 'backupUpload')}</Button>
        <Button loading={busy === 'restore' && !confirming} disabled={blocked || !ready} icon={<CloudDownload size={15} />} onClick={onConfirmRestore}>{tx(busy === 'restore' ? 'backupRestoring' : 'backupRestore')}</Button>
      </div>
    </div>
    {error && !confirming ? <div className="settings-body backup-error-row"><BackupError tx={tx} text={backupErrorText(error, { tx, repo: savedRepo || repo.trim(), remotePath: status?.remotePath, timezone })} /></div> : null}
  </Panel>;
}
