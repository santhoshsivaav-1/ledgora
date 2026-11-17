import { useCallback, useEffect, useRef, useState } from 'react';

// Shared parts of the Godowns screen, in the style of CashBankPage's own dialog kit (change 3.23): one Dialog, one
// Field, one Save-button pair, and a paged-list hook for the "50 at a time + Load more" registers.

export function Dialog({ title, onClose, children, width = 560 }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: width }} role="dialog" aria-label={title}>
        <h3 className="section-title">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export const Field = ({ label, title, children }) => (
  <div className="form-group">
    <label className="form-label" title={title}>{label}</label>
    {children}
  </div>
);

/** Cancel / Save. Save runs once at a time, so a double click never records two transfers. */
export function Actions({ onCancel, onSave, disabled, label = 'Save' }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try { await onSave(); } finally { setBusy(false); }
  };
  return (
    <div className="flex gap-2 justify-end mt-4">
      <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      <button className="btn btn-primary" onClick={run} disabled={disabled || busy}>{busy ? 'Saving…' : label}</button>
    </div>
  );
}

/** The API's error as one line, with a 422's per-line details (every problem, not just the first) under it. */
export function FormErrors({ error }) {
  if (!error) return null;
  const details = Array.isArray(error?.body?.error?.details)
    ? error.body.error.details.map((d) => d?.message).filter(Boolean)
    : [];
  return (
    <div className="glass-panel p-4" role="alert" style={{ marginTop: 8, borderColor: '#dc2626' }}>
      <p style={{ margin: 0, color: '#b91c1c' }}>{error?.body?.error?.message || error?.message || 'Something went wrong'}</p>
      {details.length > 0 && (
        <ul style={{ margin: '6px 0 0', paddingLeft: '1.1rem', color: '#b91c1c', fontSize: '0.82rem' }}>
          {details.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}
    </div>
  );
}

/**
 * A register the API serves one page at a time (50 + Load more): `load(params)` answers `{ data, nextCursor }`.
 * When `deps` change the list restarts at page one; Load more appends until the API says there is none.
 */
export function usePagedList(load, deps) {
  const [rows, setRows] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState(null);
  const [bump, setBump] = useState(0);
  const refresh = useCallback(() => setBump((b) => b + 1), []);
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    setRows(null);
    setCursor(null);
    setError(null);
    load({})
      .then((r) => { if (seq.current === id) { setRows(r.data ?? []); setCursor(r.nextCursor || null); } })
      .catch((e) => { if (seq.current === id) setError(e); });
  }, [...deps, bump]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadMore = () => {
    if (!cursor) return;
    const id = seq.current;
    load({ cursor, limit: 50 })
      .then((r) => {
        if (seq.current !== id) return; // the list restarted while the page was coming in
        setRows((cur) => [...(cur ?? []), ...(r.data ?? [])]);
        setCursor(r.nextCursor || null);
      })
      .catch((e) => setError(e));
  };
  return { rows, hasMore: !!cursor, error, loadMore, refresh };
}
