import { useEffect, useMemo, useState } from 'react';
import { getAllPaymentsOut, getProfile } from '../../lib/data';
import { belongsToProfile, formatCurrency } from '../../utils';
import { toast } from '../../components/ui/Toast';
import { supplierStatementOf } from './purchaseExtras';

// Phase 3 acceptance 3: a supplier's statement, bills − payments − returns, with what is owed after each entry.
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export default function SupplierStatement({ bills, debitNotes, orders, onClose }) {
  const [vouchers, setVouchers] = useState([]);
  const suppliers = useMemo(() => [...new Set(bills.map((b) => (b.supplierName || '').trim()).filter(Boolean))].sort(), [bills]);
  const [supplier, setSupplier] = useState(suppliers[0] || '');
  useEffect(() => {
    Promise.all([getAllPaymentsOut(), getProfile()])
      .then(([v, p]) => setVouchers((v || []).filter((r) => belongsToProfile(r, p))))
      .catch(() => toast('Could not load payments', 'error'));
  }, []);
  const st = supplier ? supplierStatementOf({ supplierName: supplier, bills, vouchers, debitNotes, orders }) : null;

  const download = () => {
    const lines = [['Date', 'Entry', 'Reference', 'Amount', 'Balance payable'], ...st.rows.map((r) => [r.date, r.type, r.ref, r.payable.toFixed(2), r.balance.toFixed(2)]), ['', 'Closing balance', '', '', st.balance.toFixed(2)]];
    const blob = new Blob([lines.map((l) => l.map(csvCell).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Supplier-statement-${supplier.replace(/[^\w-]+/g, '_')}.csv`;
    a.click();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 820 }} role="dialog" aria-label="Supplier statement">
        <h3 className="section-title">Supplier statement</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: '0.75rem' }}>
          <select className="form-input" value={supplier} onChange={(e) => setSupplier(e.target.value)} aria-label="Supplier" style={{ flex: 1 }}>
            {suppliers.map((s) => <option key={s}>{s}</option>)}
          </select>
          <button type="button" className="btn btn-secondary" onClick={download} disabled={!st?.rows.length}>CSV</button>
        </div>
        {!st || !st.rows.length ? (
          <p className="field-hint">No purchases from this supplier yet.</p>
        ) : (
          <>
            <div className="table-scroll" style={{ maxHeight: 420 }}>
              <table className="data-table">
                <thead><tr><th>Date</th><th>Entry</th><th>Reference</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Balance payable</th></tr></thead>
                <tbody>
                  {st.rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.date}</td><td>{r.type}</td><td>{r.ref}</td>
                      <td style={{ textAlign: 'right', color: r.payable < 0 ? '#059669' : undefined }}>{formatCurrency(r.payable)}</td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ textAlign: 'right', marginTop: '0.5rem' }}>
              Bills {formatCurrency(st.documents)} − paid {formatCurrency(st.settled)} − returns {formatCurrency(st.returns)} ={' '}
              <strong>{st.balance >= 0 ? `${formatCurrency(st.balance)} to pay` : `${formatCurrency(-st.balance)} advance with supplier`}</strong>
            </p>
          </>
        )}
        <div className="flex justify-end mt-4"><button className="btn btn-secondary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
