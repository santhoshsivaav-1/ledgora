import { AlertTriangle, Inbox } from 'lucide-react';

// The three states every screen has besides "the data" (change 3.24): still loading, nothing here yet, and something
// went wrong. One look and one set of words, so a screen never shows a blank page or a raw error.

export function LoadingState({ label = 'Loading…' }) {
  return (
    <div role="status" aria-live="polite" style={{ padding: '3rem', display: 'flex', justifyContent: 'center' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
        <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid var(--border)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        {label}
      </div>
    </div>
  );
}

export function EmptyState({ title, hint, action }) {
  return (
    <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
      <Inbox size={28} style={{ opacity: 0.5 }} aria-hidden="true" />
      <div style={{ fontWeight: 600, marginTop: '0.5rem', color: 'var(--text)' }}>{title}</div>
      {hint && <p style={{ margin: '0.25rem 0 0.75rem', fontSize: '0.85rem' }}>{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }) {
  return (
    <div role="alert" style={{ padding: '2.5rem 1rem', textAlign: 'center' }}>
      <AlertTriangle size={28} style={{ color: 'var(--danger)' }} aria-hidden="true" />
      <div style={{ fontWeight: 600, marginTop: '0.5rem' }}>{title}</div>
      {message && <p style={{ margin: '0.25rem 0 0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{message}</p>}
      {onRetry && <button type="button" className="btn btn-secondary" onClick={onRetry}>Try again</button>}
    </div>
  );
}
