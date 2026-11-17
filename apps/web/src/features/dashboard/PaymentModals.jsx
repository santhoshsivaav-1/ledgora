// Extracted from Dashboard.jsx (audit Phase 3: no file over 800 lines).
// The three payment dialogs: Record Payment (with the payment history and
// its per-row receipt / edit / delete actions), the v1.10.13 Edit Payment
// modal, and the printable receipt. All state and handlers live in the
// Dashboard (usePaymentActions) — this is presentation only.

import { Trash2, Edit3, Receipt, X } from 'lucide-react';
import { formatCurrency, amountDue } from '../../utils';
import ReceiptModal from './ReceiptModal';

// v1.10.74 - one list for the Record Payment mode select and its Payment
// History, so history shows "Bank Transfer" instead of "bank-transfer".
export const PAYMENT_MODES = [
  ['bank-transfer', 'Bank Transfer'], ['upi', 'UPI'], ['cash', 'Cash'],
  ['cheque', 'Cheque'], ['card', 'Card'], ['other', 'Other'],
];
export const paymentModeName = (mode) => (PAYMENT_MODES.find(([v]) => v === mode) || [])[1] || mode;

export default function PaymentModals({
  paymentModal, setPaymentModal,
  paymentInput, setPaymentInput,
  recordPayment, openReceiptFor, editPaymentAt, deletePaymentAt,
  editPaymentModal, setEditPaymentModal, saveEditedPayment,
  receiptTarget, setReceiptTarget,
}) {
  return (
    <>
      {/* Payment Modal */}
      {paymentModal && (
        <div className="modal-overlay" onClick={() => setPaymentModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="section-title">Record Payment</h3>
            <p className="text-muted" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>
              Invoice: <strong>{paymentModal.invoiceNumber}</strong> | Total: <strong>{formatCurrency(paymentModal.totalAmount, paymentModal.currency)}</strong>
              {(paymentModal.paidAmount || 0) > 0 && <> | Paid: <strong>{formatCurrency(paymentModal.paidAmount, paymentModal.currency)}</strong></>}
              {' '}| {(() => {
                // v1.10.23 — signed remaining so overpayments surface here too.
                const rem = amountDue(paymentModal) - (paymentModal.paidAmount || 0);
                if (rem < -0.005) {
                  return <>Overpaid: <strong style={{ color: '#0369a1' }}>{formatCurrency(Math.abs(rem), paymentModal.currency)}</strong></>;
                }
                return <>Balance: <strong style={{ color: rem > 0.005 ? '#dc2626' : '#059669' }}>{formatCurrency(Math.max(0, rem), paymentModal.currency)}</strong></>;
              })()}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group">
                <label className="form-label">Amount Received</label>
                <input type="number" className="form-input" value={paymentInput.amount}
                  onChange={e => setPaymentInput(prev => ({ ...prev, amount: e.target.value }))}
                  placeholder={String(Math.max(0, Math.round((amountDue(paymentModal) - (paymentModal.paidAmount || 0)) * 100) / 100))} min="0" />
              </div>
              <div className="form-group">
                <label className="form-label">Payment Date</label>
                <input type="date" className="form-input" value={paymentInput.date}
                  onChange={e => setPaymentInput(prev => ({ ...prev, date: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Payment Mode</label>
                <select className="form-input" value={paymentInput.mode}
                  onChange={e => setPaymentInput(prev => ({ ...prev, mode: e.target.value }))}>
                  {PAYMENT_MODES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Note (optional)</label>
                <input type="text" className="form-input" value={paymentInput.note}
                  onChange={e => setPaymentInput(prev => ({ ...prev, note: e.target.value }))}
                  placeholder="Transaction ID, ref..." />
              </div>
            </div>
            {paymentModal.payments?.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <label className="form-label">Payment History</label>
                <div className="payment-history">
                  {/* v1.10.9 — each row now has View Receipt / Edit Note /
                      Delete actions. Prior code showed values only with no
                      way to reprint or fix a typo. */}
                  {paymentModal.payments.map((p, i) => (
                    <div key={p.id || i} className="payment-row" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ minWidth: 90 }}>{p.date ? new Date(p.date).toLocaleDateString('en-IN') : '—'}</span>
                      <span className="font-bold" style={{ minWidth: 100 }}>{formatCurrency(p.amount, paymentModal.currency)}</span>
                      <span className="text-muted" style={{ minWidth: 90 }}>{paymentModeName(p.mode)}</span>
                      {p.note && <span className="text-muted" style={{ flex: 1 }}>· {p.note}</span>}
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
                        <button className="btn btn-secondary" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
                          onClick={() => openReceiptFor(paymentModal, p)}
                          title="View / Print receipt for this payment"><Receipt size={12} /> Receipt</button>
                        <button className="btn btn-secondary" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
                          onClick={() => editPaymentAt(paymentModal, i)}
                          title="Edit amount / date / mode / note"><Edit3 size={12} /></button>
                        <button className="btn btn-secondary" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', color: 'var(--danger)', borderColor: 'var(--danger)' }}
                          onClick={() => deletePaymentAt(paymentModal, i)}
                          title="Delete this payment"><Trash2 size={12} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn btn-secondary" onClick={() => setPaymentModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={recordPayment}>Record Payment</button>
            </div>
          </div>
        </div>
      )}

      {/* v1.10.13 — Payment Edit modal. Lets the user fix a wrong amount
           without having to delete + re-record. Recomputes bill status
           on save; keeps the Receipts store in sync. */}
      {editPaymentModal && (
        <div className="modal-overlay" onClick={() => setEditPaymentModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 className="section-title" style={{ margin: 0 }}>Edit Payment</h3>
              <button className="icon-btn" onClick={() => setEditPaymentModal(null)} title="Close"><X size={18} /></button>
            </div>
            <p className="text-muted" style={{ fontSize: '0.82rem', marginBottom: '0.75rem' }}>
              Invoice: <strong>{editPaymentModal.bill.invoiceNumber}</strong>
              {' '}| Total: <strong>{formatCurrency(editPaymentModal.bill.totalAmount, editPaymentModal.bill.currency)}</strong>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="form-group">
                <label className="form-label">Amount</label>
                <input type="number" className="form-input" value={editPaymentModal.form.amount}
                  onChange={e => setEditPaymentModal(prev => ({ ...prev, form: { ...prev.form, amount: e.target.value } }))}
                  min="0" step="0.01" />
              </div>
              <div className="form-group">
                <label className="form-label">Date</label>
                <input type="date" className="form-input" value={editPaymentModal.form.date}
                  onChange={e => setEditPaymentModal(prev => ({ ...prev, form: { ...prev.form, date: e.target.value } }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Mode</label>
                <select className="form-input" value={editPaymentModal.form.mode}
                  onChange={e => setEditPaymentModal(prev => ({ ...prev, form: { ...prev.form, mode: e.target.value } }))}>
                  <option value="bank-transfer">Bank Transfer</option>
                  <option value="upi">UPI</option>
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                  <option value="card">Card</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Note / reference</label>
                <input type="text" className="form-input" value={editPaymentModal.form.note}
                  onChange={e => setEditPaymentModal(prev => ({ ...prev, form: { ...prev.form, note: e.target.value } }))}
                  placeholder="Transaction ID, ref..." />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn btn-secondary" onClick={() => setEditPaymentModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEditedPayment}>Save changes</button>
            </div>
          </div>
        </div>
      )}

      {/* v1.10.9 — Payment Receipt modal. */}
      {receiptTarget && (
        <ReceiptModal target={receiptTarget} onClose={() => setReceiptTarget(null)} />
      )}
    </>
  );
}
