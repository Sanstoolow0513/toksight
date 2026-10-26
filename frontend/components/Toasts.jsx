'use client';

// Transient notices for operation results, request failures and collection
// warnings. They stack at the bottom centre of the viewport, outside
// `.report` (so never exported), and dismiss themselves; hovering, focusing
// or expanding a toast holds it open.

import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleCheck, TriangleAlert, X } from 'lucide-react';
import { coded } from '@/components/Coded';

const DURATION = { success: 4000, warn: 8000, error: 8000 };
const LEAVE_MS = 200;
const MAX_TOASTS = 4;

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)));
    setTimeout(() => setToasts((list) => list.filter((toast) => toast.id !== id)), LEAVE_MS);
  }, []);

  // A toast with a `key` replaces the live one with the same key.
  const push = useCallback((toast) => {
    seq.current += 1;
    const next = { ...toast, id: seq.current };
    setToasts((list) => [...list.filter((item) => !toast.key || item.key !== toast.key), next].slice(-MAX_TOASTS));
  }, []);

  return { toasts, push, dismiss };
}

function ToastItem({ toast, onDismiss, tx }) {
  const [held, setHeld] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { id, tone, message, details, leaving } = toast;
  const closeLabel = tx('toastClose');

  useEffect(() => {
    if (held || expanded || leaving) return undefined;
    const timer = setTimeout(() => onDismiss(id), toast.duration ?? DURATION[tone]);
    return () => clearTimeout(timer);
  }, [held, expanded, leaving, id, tone, toast.duration, onDismiss]);

  const Icon = tone === 'success' ? CircleCheck : TriangleAlert;
  return (
    <div
      className={`toast is-${tone}${leaving ? ' is-leaving' : ''}`}
      role={tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setHeld(false);
      }}
    >
      <Icon size={15} strokeWidth={2} aria-hidden="true" />
      <div className="toast-body">
        <p>{coded(tx(...message))}</p>
        {details?.items?.length ? (
          <details onToggle={(e) => setExpanded(e.currentTarget.open)}>
            <summary>{tx(...(details.summary ?? ['toastDetails']))}</summary>
            <ul>
              {details.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <button type="button" className="toast-close" onClick={() => onDismiss(id)} aria-label={closeLabel} title={closeLabel}>
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}

// `message` and `details.summary` are [i18n key, vars] pairs, translated on
// render so a locale switch relabels toasts that are still on screen.
export default function Toasts({ toasts, onDismiss, tx }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} tx={tx} />
      ))}
    </div>
  );
}
