import { X, Bell } from 'lucide-react';

// The bell's popover (change 3.5): what needs attention (overdue and due-soon invoices, GST filing deadlines, low stock,
// recurring invoices made today), grouped, with one button per group that opens the page that fixes it. It only draws;
// the shell works out the numbers.
export default function NotificationPopover({
  notifications,
  isLive,
  notifTotal,
  dismissableCount,
  onMarkAll,
  onClose,
  go,
}) {
  return (
    <div className="modal-overlay" onClick={() => onClose()}>
      <div
        className="modal-content"
        style={{ maxWidth: '480px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.5rem',
          }}
        >
          <h3 className="section-title" style={{ margin: 0 }}>
            Notifications
          </h3>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {/* v1.10.62 (#53) — clears everything currently shown. Each
                      section remembers exactly WHAT was cleared, so a genuinely
                      new overdue invoice or a different product running low
                      brings the alert back by itself. */}
            {dismissableCount > 0 && (
              <button
                type="button"
                className="btn"
                onClick={onMarkAll}
                style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}
                title="Clear these notifications. They return if something new happens."
              >
                Mark all as read
              </button>
            )}
            <button className="icon-btn" onClick={() => onClose()} title="Close">
              <X size={18} />
            </button>
          </span>
        </div>
        {notifTotal === 0 ? (
          <p
            style={{
              textAlign: 'center',
              color: 'var(--text-muted)',
              padding: '1.5rem 0',
              margin: 0,
            }}
          >
            All clear ✨ — nothing needs your attention right now.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {isLive('autoFire') && (
              <button
                type="button"
                className="notice notice-info"
                onClick={() => {
                  onClose();
                  go('dashboard');
                }}
                style={{ cursor: 'pointer', border: 'none', textAlign: 'left' }}
              >
                <span className="notice-icon">🔁</span>
                <div style={{ flex: 1 }}>
                  <strong>
                    {notifications.autoFire.count} recurring invoice
                    {notifications.autoFire.count !== 1 ? 's' : ''} auto-generated today
                  </strong>
                  <div style={{ fontSize: '0.72rem', opacity: 0.85, marginTop: '0.2rem' }}>
                    Check the Dashboard for the new bills · review and download PDFs as needed
                  </div>
                </div>
              </button>
            )}
            {isLive('overdue') && (
              <button
                type="button"
                className="notice notice-danger"
                onClick={() => {
                  onClose();
                  go('dashboard');
                }}
                style={{ cursor: 'pointer', border: 'none', textAlign: 'left' }}
              >
                <span className="notice-icon">⚠</span>
                <div style={{ flex: 1 }}>
                  <strong>
                    {notifications.overdue.length} overdue invoice
                    {notifications.overdue.length !== 1 ? 's' : ''}
                  </strong>
                  <div style={{ fontSize: '0.72rem', opacity: 0.85, marginTop: '0.2rem' }}>
                    {notifications.overdue
                      .slice(0, 3)
                      .map((b) => b.invoiceNumber)
                      .join(' · ')}
                    {notifications.overdue.length > 3
                      ? ` · +${notifications.overdue.length - 3} more`
                      : ''}
                  </div>
                </div>
              </button>
            )}
            {isLive('dueSoon') && (
              <button
                type="button"
                className="notice notice-warn"
                onClick={() => {
                  onClose();
                  go('dashboard');
                }}
                style={{ cursor: 'pointer', border: 'none', textAlign: 'left' }}
              >
                <span className="notice-icon">⏰</span>
                <div style={{ flex: 1 }}>
                  <strong>
                    {notifications.dueSoon.length} invoice
                    {notifications.dueSoon.length !== 1 ? 's' : ''} due in next 3 days
                  </strong>
                  <div style={{ fontSize: '0.72rem', opacity: 0.85, marginTop: '0.2rem' }}>
                    {notifications.dueSoon
                      .slice(0, 3)
                      .map((b) => `${b.invoiceNumber} (${b.clientName})`)
                      .join(' · ')}
                  </div>
                </div>
              </button>
            )}
            {isLive('filings') && (
              <button
                type="button"
                className="notice notice-info"
                onClick={() => {
                  onClose();
                  go('filing');
                }}
                style={{ cursor: 'pointer', border: 'none', textAlign: 'left' }}
              >
                <span className="notice-icon">📋</span>
                <div style={{ flex: 1 }}>
                  <strong>
                    {notifications.filings.length} GST filing
                    {notifications.filings.length !== 1 ? 's' : ''} due in next 10 days
                  </strong>
                  <div style={{ fontSize: '0.72rem', opacity: 0.85, marginTop: '0.2rem' }}>
                    {notifications.filings
                      .slice(0, 3)
                      .map((f) => `${f.label} (${f.daysAway === 0 ? 'today' : f.daysAway + 'd'})`)
                      .join(' · ')}
                  </div>
                </div>
              </button>
            )}
            {isLive('lowStock') && (
              <button
                type="button"
                className="notice notice-note"
                onClick={() => {
                  onClose();
                  go('inventory');
                }}
                style={{ cursor: 'pointer', border: 'none', textAlign: 'left' }}
              >
                <span className="notice-icon">📦</span>
                <div style={{ flex: 1 }}>
                  <strong>
                    {notifications.lowStock.length} product
                    {notifications.lowStock.length !== 1 ? 's' : ''} low on stock
                  </strong>
                  <div style={{ fontSize: '0.72rem', opacity: 0.85, marginTop: '0.2rem' }}>
                    {notifications.lowStock
                      .slice(0, 3)
                      .map((p) => `${p.name} (${p.stock} left)`)
                      .join(' · ')}
                  </div>
                </div>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// The sidebar button, with its unread count.
export function NotificationButton({ total, onClick }) {
  return (
    <button
      className="nav-btn"
      onClick={onClick}
      title="Notifications"
      style={{ position: 'relative' }}
    >
      <Bell size={18} />
      Notifications
      {total > 0 && (
        <span
          className="nav-badge"
          style={{
            position: 'absolute',
            top: '8px',
            right: '12px',
            minWidth: 18,
            height: 18,
            padding: '0 5px',
            borderRadius: '9px',
            background: 'var(--danger)',
            color: '#fff',
            fontSize: '0.65rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {total > 99 ? '99+' : total}
        </span>
      )}
    </button>
  );
}
