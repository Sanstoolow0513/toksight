'use client';

// Full-page state cards (error / empty) share one white card with a status
// icon. `coded()` renders the backtick-quoted command fragments inside i18n
// strings as <code> so hints like `toksight env` stay monospaced.

import { Inbox, RefreshCw, TriangleAlert } from 'lucide-react';

export function coded(text) {
  const parts = String(text).split(/`([^`]+)`/);
  return parts.map((p, i) => (i % 2 ? <code key={i}>{p}</code> : p));
}

export function ErrorCard({ error, tx, onRetry }) {
  return (
    <div className="state-card" role="alert">
      <h1>
        <TriangleAlert size={18} strokeWidth={1.5} aria-hidden="true" />
        {tx('errorTitle')}
      </h1>
      <p>{coded(tx('errorFail', { error }))}</p>
      <p>{coded(tx('errorHint'))}</p>
      <button className="btn" type="button" onClick={onRetry}>
        <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />
        {tx('retry')}
      </button>
    </div>
  );
}

export function EmptyCard({ tx, filtered }) {
  return (
    <div className="state-card">
      <h1>
        <Inbox size={18} strokeWidth={1.5} aria-hidden="true" />
        {tx('emptyTitle')}
      </h1>
      <p>{coded(tx(filtered ? 'filterEmpty' : 'emptyBody'))}</p>
    </div>
  );
}
