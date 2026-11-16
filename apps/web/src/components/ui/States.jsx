import { AlertTriangle, Inbox } from 'lucide-react';

// The three states every screen has besides "the data" (change 3.24): still loading, nothing here yet, and something
// went wrong. One look and one set of words, so a screen never shows a blank page or a raw error.

export function LoadingState({ label = 'Loading…' }) {
  // A skeleton in the shape of a page (a heading, then a card of rows) instead of a spinner: the layout does not jump when the
  // data arrives, and the screen reads as already there while the server answers. The label is for screen readers.
  const bar = (w, h = 12, mb = 12) => <span className="ui-skel" aria-hidden="true" style={{ width: w, height: h, marginBottom: mb }} />;
  return (
    <div role="status" aria-live="polite" aria-busy="true" style={{ padding: '1rem 0' }}>
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{label}</span>
      {bar('220px', 22, 18)}
      <div className="glass-panel" style={{ padding: '1.25rem' }} aria-hidden="true">
        {bar('40%', 14, 18)}
        {[100, 92, 96, 85, 90].map((w, i) => (
          <span key={i}>{bar(`${w}%`, 12, 14)}</span>
        ))}
      </div>
    </div>
  );
}

// `illustration` replaces the inbox icon and `secondary` sits beside the main action ("Import from Excel" next to
// "+ Add Party"), as every list's empty state has in the new layout (Vyapar parity P0-S3.5).
export function EmptyState({ title, hint, action, secondary, illustration }) {
  return (
    <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
      {illustration ? <div className="ui-empty-art" style={{ margin: '0 auto' }} aria-hidden="true">{illustration}</div> : <Inbox size={28} style={{ opacity: 0.5 }} aria-hidden="true" />}
      <div style={{ fontWeight: 600, marginTop: '0.5rem', color: 'var(--text)' }}>{title}</div>
      {hint && <p style={{ margin: '0.25rem 0 0.75rem', fontSize: '0.85rem' }}>{hint}</p>}
      {secondary ? <div className="ui-empty-actions" style={{ justifyContent: 'center' }}>{action}{secondary}</div> : action}
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
