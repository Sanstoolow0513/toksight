import { ITEM_KEYS, formatBytes, formatDate } from '@/lib/config';

function FileState({ file, tx }) {
  if (file.error) return <span className="tag tag-error">{tx('cfgUnreadable')}</span>;
  if (!file.exists) return <span className="tag">{tx('cfgMissing')}</span>;
  return <span className="tag tag-ok">{tx('cfgFound')}</span>;
}

export default function FileCard({ file, locale, tx }) {
  const label = tx(ITEM_KEYS[file.id] || 'cfgItemFallback');
  return (
    <article className={`config-file${file.exists ? '' : ' config-file-missing'}`}>
      <div className="config-file-head">
        <b>{label}</b>
        <span className="config-file-name">{file.fileName} · {String(file.format).toUpperCase()}</span>
        <FileState file={file} tx={tx} />
      </div>
      <dl className="config-meta">
        <div><dt>{tx('cfgPath')}</dt><dd title={file.path}>{file.path}</dd></div>
        <div><dt>{tx('cfgSize')}</dt><dd>{formatBytes(file.size, locale)}</dd></div>
        <div><dt>{tx('cfgModified')}</dt><dd>{formatDate(file.modifiedAt, locale)}</dd></div>
      </dl>
      {file.exists && file.preview != null && (
        <div className="config-preview">
          <div className="config-preview-head">
            <span>{tx('cfgRedactedPreview')}</span>
            {file.truncated && <span>{tx('cfgPreviewTruncated')}</span>}
          </div>
          <pre>{file.preview}</pre>
        </div>
      )}
      {file.exists && file.preview == null && !file.error && file.kind === 'secret' && (
        <p className="config-file-note">{tx('cfgCredentialNote')}</p>
      )}
    </article>
  );
}

