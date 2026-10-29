import { useEffect } from 'react';
import { Search, Command } from 'lucide-react';

// Ctrl/Cmd+K (change 3.5). Spotlight-style: type to filter actions, arrows to move, Enter to run, Esc to close.
export default function CommandPalette({
  open,
  query,
  onQuery,
  actions,
  index,
  onIndex,
  onClose,
  onShowShortcuts,
}) {
  // Arrow, Enter and Esc work from anywhere while it is open.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        onIndex(Math.min(index + 1, actions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        onIndex(Math.max(index - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const action = actions[index];
        if (action) {
          action.run();
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, index, actions, onIndex, onClose]);

  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={() => onClose()}>
      <div
        className="modal-content"
        style={{ maxWidth: '520px', padding: 0, overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.75rem 1rem',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <Search size={16} style={{ color: 'var(--text-muted)' }} />
          <input
            autoFocus
            type="text"
            placeholder="Type a command or page name…"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            className="form-input"
            style={{ border: 0, background: 'transparent', flex: 1, fontSize: '0.95rem' }}
          />
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Esc</span>
        </div>
        <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
          {actions.length === 0 && (
            <p
              style={{
                textAlign: 'center',
                color: 'var(--text-muted)',
                padding: '1.25rem',
                margin: 0,
                fontSize: '0.85rem',
              }}
            >
              Nothing matches "{query}".
            </p>
          )}
          {actions.map((a, i) => (
            <button
              key={a.label}
              type="button"
              onClick={() => {
                a.run();
                onClose();
              }}
              onMouseEnter={() => onIndex(i)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '0.6rem 1rem',
                border: 0,
                cursor: 'pointer',
                background: i === index ? 'var(--bg-tertiary)' : 'transparent',
                color: 'var(--text-primary)',
                textAlign: 'left',
                fontSize: '0.88rem',
              }}
            >
              <span>{a.label}</span>
              {a.hint && (
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{a.hint}</span>
              )}
            </button>
          ))}
        </div>
        <div
          style={{
            padding: '0.4rem 1rem',
            borderTop: '1px solid var(--border-color)',
            fontSize: '0.7rem',
            color: 'var(--text-muted)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>
            <Command size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Ctrl+K to toggle · ↑↓ navigate · Enter run
          </span>
          <button
            type="button"
            onClick={() => {
              onShowShortcuts();
            }}
            style={{
              background: 'none',
              border: 0,
              color: 'var(--primary)',
              cursor: 'pointer',
              fontSize: '0.7rem',
            }}
          >
            All shortcuts (Ctrl+/)
          </button>
        </div>
      </div>
    </div>
  );
}
