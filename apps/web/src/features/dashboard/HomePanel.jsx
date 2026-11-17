// Extracted from Dashboard.jsx (audit Phase 3: no file over 800 lines).
// Everything the (home-mode) overview shows above the invoice list: the
// getting-started checklist, the overdue banner + Remind-all modal, the four
// headline stat cards and the low-stock ticker.

import { X, CheckCircle, AlertTriangle, Send, IndianRupee, TrendingUp, Clock, Receipt, MessageCircle } from 'lucide-react';
import { formatCurrency, amountDue } from '../../utils';
import LowStockTicker from './LowStockTicker';

export default function HomePanel({
  startedSteps, onDismissGuide,
  overdueBills, overdueStr, setStatusFilter,
  showRemindAll, setShowRemindAll,
  getClientPhone, sendReminder,
  stats, lowStockProducts, onOpenProducts, onOpenGuide,
}) {
  return (
    <>
      {/* v1.10.69 - a new user used to land here on "No invoices yet." and
          nothing else. The welcome wizard does end with a list of what to do,
          but it is shown once and then gone forever, which is no help on day
          two. This stays until the work is actually done, ticks itself off
          from real data rather than from "have you seen this screen", and
          removes itself for good once everything is set up. */}
      {startedSteps && (
        <div className="glass-panel p-6 mb-6">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.9rem' }}>
            <span style={{ fontSize: '1.15rem' }}>👋</span>
            <h3 className="section-title" style={{ margin: 0, flex: 1 }}>Getting started</h3>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {startedSteps.filter(s => s.done).length} of {startedSteps.length} done
            </span>
            <button type="button" className="btn-link" title="Hide this"
              onClick={onDismissGuide}
              style={{ background: 'none', border: 0, color: 'var(--text-muted)', cursor: 'pointer', padding: '0 0.25rem', lineHeight: 1 }}>
              <X size={16} />
            </button>
          </div>
          {startedSteps.map((s) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.55rem 0', borderTop: '1px solid var(--border-color)' }}>
              <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: s.done ? 'rgba(5, 150, 105, 0.16)' : 'transparent', border: s.done ? 'none' : '1.5px solid var(--border-color)' }}>
                {s.done && <CheckCircle size={15} style={{ color: '#059669' }} />}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: s.done ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: s.done ? 'line-through' : 'none' }}>{s.title}</div>
                {!s.done && <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>{s.hint}</div>}
              </div>
              {!s.done && (
                <button type="button" className="btn btn-secondary" onClick={s.go}
                  style={{ flexShrink: 0, padding: '0.35rem 0.8rem', fontSize: '0.8rem' }}>{s.cta}</button>
              )}
            </div>
          ))}
          <div style={{ marginTop: '0.9rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            New to this?{' '}
            <button type="button" onClick={onOpenGuide}
              style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'var(--primary)', textDecoration: 'underline', cursor: 'pointer' }}>
              Read the 5-minute guide
            </button>
          </div>
        </div>
      )}

      {overdueBills.length > 0 && (
        <div className="overdue-banner" onClick={() => { setStatusFilter('overdue'); }}
          style={{ background: 'var(--danger-light)', border: '1px solid var(--danger-light)', borderRadius: 10, padding: '0.85rem 1.25rem', marginBottom: '1.25rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <AlertTriangle size={20} style={{ color: '#dc2626', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 700, color: '#dc2626' }}>
              {overdueBills.length} overdue invoice{overdueBills.length > 1 ? 's' : ''}
            </span>
            <span style={{ color: '#991b1b', marginLeft: 8, fontSize: '0.85rem' }}>
              — {overdueStr} outstanding
            </span>
          </div>
          <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem', whiteSpace: 'nowrap' }}
            onClick={(e) => { e.stopPropagation(); setShowRemindAll(true); }}>
            <Send size={13} /> Remind All
          </button>
          <span style={{ fontSize: '0.78rem', color: '#dc2626', fontWeight: 500 }}>View all &rarr;</span>
        </div>
      )}

      {/* Remind All Modal */}
      {showRemindAll && (
        <div className="modal-overlay" onClick={() => setShowRemindAll(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '550px' }}>
            <h3 className="section-title">Send Payment Reminders</h3>
            <p className="text-muted" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>
              Click on a client below to send a WhatsApp payment reminder.
            </p>
            {overdueBills.length === 0 ? (
              <p className="text-muted">No overdue invoices.</p>
            ) : (
              <div style={{ maxHeight: '400px', overflow: 'auto' }}>
                {overdueBills.map(bill => {
                  const phone = getClientPhone(bill);
                  return (
                    <div key={bill.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0', borderBottom: '1px solid var(--border)' }}>
                      <div>
                        <span className="font-medium">{bill.clientName}</span>
                        <span className="text-muted" style={{ marginLeft: 8, fontSize: '0.8rem' }}>{bill.invoiceNumber}</span>
                        {(() => {
                          // v1.10.23 — signed outstanding label. Show
                          // "Overpaid ₹1" in blue on the reminder card
                          // instead of "-₹1" in red for overpayments.
                          const outCur = bill.currency || bill.data?.invoiceOptions?.currency;
                          const out = amountDue(bill) - (bill.paidAmount || 0);
                          if (out < -0.005) {
                            return <span style={{ marginLeft: 8, fontWeight: 600, color: '#0369a1', fontSize: '0.85rem' }}>
                              Overpaid {formatCurrency(Math.abs(out), outCur)}
                            </span>;
                          }
                          return <span style={{ marginLeft: 8, fontWeight: 600, color: '#dc2626', fontSize: '0.85rem' }}>
                            {formatCurrency(Math.max(0, out), outCur)}
                          </span>;
                        })()}
                        {phone && <span className="text-muted" style={{ marginLeft: 8, fontSize: '0.75rem' }}>{phone}</span>}
                      </div>
                      <button className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}
                        onClick={() => sendReminder({ ...bill, clientPhone: phone })}>
                        <MessageCircle size={13} /> Remind
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn btn-secondary" onClick={() => setShowRemindAll(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <div className="stats-grid stats-grid-4">
        <div className="stat-card">
          <div className="stat-icon stat-icon-blue"><IndianRupee size={22} /></div>
          <div style={{ flex: 1 }}>
            <p className="stat-label">Total Invoiced</p>
            {Object.entries(stats.byCurrency).map(([cur, v]) => (
              <div key={cur} className="stat-value" style={{ fontSize: Object.keys(stats.byCurrency).length > 1 ? '1.1rem' : undefined }}>
                {formatCurrency(v.total, cur)}
              </div>
            ))}
            {Object.keys(stats.byCurrency).length === 0 && <h2 className="stat-value">—</h2>}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon stat-icon-green"><TrendingUp size={22} /></div>
          <div style={{ flex: 1 }}>
            <p className="stat-label">Tax Collected</p>
            {Object.entries(stats.byCurrency).map(([cur, v]) => (
              <div key={cur} className="stat-value stat-value-green" style={{ fontSize: Object.keys(stats.byCurrency).length > 1 ? '1.1rem' : undefined }}>
                {formatCurrency(v.tax, cur)}
              </div>
            ))}
            {Object.keys(stats.byCurrency).length === 0 && <h2 className="stat-value stat-value-green">—</h2>}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon stat-icon-amber"><Clock size={22} /></div>
          <div style={{ flex: 1 }}>
            <p className="stat-label">Outstanding</p>
            {Object.entries(stats.byCurrency).map(([cur, v]) => (
              <div key={cur} className="stat-value stat-value-amber" style={{ fontSize: Object.keys(stats.byCurrency).length > 1 ? '1.1rem' : undefined }}>
                {formatCurrency(v.unpaid, cur)}
              </div>
            ))}
            {Object.keys(stats.byCurrency).length === 0 && <h2 className="stat-value stat-value-amber">—</h2>}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon stat-icon-purple"><Receipt size={22} /></div>
          <div><p className="stat-label">Invoices</p><h2 className="stat-value stat-value-purple">{stats.count}</h2></div>
        </div>
      </div>

      {/* Low stock: one line, moving only when it does not fit (LowStockTicker). */}
      {lowStockProducts.length > 0 && (
        <LowStockTicker products={lowStockProducts} onOpenProducts={onOpenProducts} />
      )}
    </>
  );
}
