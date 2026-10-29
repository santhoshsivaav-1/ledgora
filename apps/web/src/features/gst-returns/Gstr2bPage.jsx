import { Download, Upload, CheckCircle } from 'lucide-react';
import { formatCurrency } from '../../utils';
import { toast } from '../../components/ui/Toast';
import { buildReconciliation, downloadCSV } from './gstHelpers';

// GSTR-2B reconciliation against your purchase bills. One page of GST returns (change 3.17).
export default function Gstr2bPage({
  activeTab, filteredPurchases, gstr2bData, gstr2bFilter, gstr2bInputRef, handleImport2B, purchases, setGstr2bData, setGstr2bFilter,
}) {
  return (
    <>
      {activeTab === 'gstr2b' && (() => {
        const reconRows = buildReconciliation(gstr2bData, purchases, filteredPurchases);
        const stats = reconRows.reduce((acc, r) => {
          acc.total += 1;
          acc[r.status] = (acc[r.status] || 0) + 1;
          return acc;
        }, { total: 0, matched: 0, amount_mismatch: 0, book_only: 0, twob_only: 0 });
        const visibleRows = gstr2bFilter === 'all' ? reconRows : reconRows.filter(r => r.status === gstr2bFilter);

        const exportReconCSV = () => {
          if (reconRows.length === 0) { toast('Nothing to export', 'warning'); return; }
          downloadCSV('GSTR2B_Reconciliation.csv',
            ['Status', 'Supplier GSTIN', 'Supplier Name', 'Invoice No.', 'Invoice Date', '2B Value', 'Books Value', 'Diff', '2B Taxable', 'Books Taxable', '2B IGST', '2B CGST', '2B SGST', 'ITC Available'],
            reconRows.map(r => [
              r.status, r.ctin, r.supplier, r.invoiceNumber, r.date,
              r.twoBVal.toFixed(2), r.bookVal.toFixed(2), (r.twoBVal - r.bookVal).toFixed(2),
              r.twoBTaxable.toFixed(2), r.bookTaxable.toFixed(2),
              r.twoBIgst.toFixed(2), r.twoBCgst.toFixed(2), r.twoBSgst.toFixed(2),
              r.itcAvailable ? 'Y' : 'N',
            ])
          );
          toast('Reconciliation CSV downloaded', 'success');
        };

        // Use the global .status-pill utility — color flows via the --pill-color CSS var,
        // background is auto-derived with a 14% mix so dark/light look identical.
        const STATUS_BADGES = {
          matched:         { label: '✓ Matched',         color: 'var(--success)' },
          amount_mismatch: { label: '⚠ Amount mismatch', color: '#d97706' },
          book_only:       { label: '⚠ Books only',      color: 'var(--danger)' },
          twob_only:       { label: '⚠ 2B only',         color: 'var(--purple)' },
        };

        return (
          <>
            {/* Help banner */}
            <div className="glass-panel" style={{ padding: '0.85rem 1rem', marginBottom: '0.75rem', borderLeft: '3px solid var(--primary)' }}>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                <strong>How to use:</strong> Download your GSTR-2B JSON from the GST portal
                (<a href="https://services.gst.gov.in/services/auth/dashboard" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>services.gst.gov.in</a>
                {' '}→ Returns → GSTR-2B → Download JSON), then click <strong>Import 2B JSON</strong> below.
                We match each 2B entry against your <em>Purchase Bills</em> by supplier GSTIN + invoice number, and flag mismatches so you can claim ITC accurately.
              </p>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input ref={gstr2bInputRef} type="file" accept=".json,application/json" onChange={handleImport2B} style={{ display: 'none' }} />
              <button className="btn btn-primary" onClick={() => gstr2bInputRef.current?.click()} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}>
                <Upload size={13} /> Import 2B JSON
              </button>
              {gstr2bData && (
                <>
                  <button className="btn btn-secondary" onClick={exportReconCSV} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}>
                    <Download size={13} /> Export reconciliation CSV
                  </button>
                  <button className="btn btn-secondary" onClick={() => { setGstr2bData(null); setGstr2bFilter('all'); }} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}>
                    Clear
                  </button>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    Imported for {gstr2bData.gstin || '?'} · period {gstr2bData.rtnprd || gstr2bData.fp || '?'}
                  </span>
                </>
              )}
            </div>

            {!gstr2bData && (
              <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <CheckCircle size={36} style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }} />
                <p style={{ margin: 0, fontSize: '0.9rem' }}>Import your GSTR-2B JSON to reconcile against your purchase records.</p>
                {purchases.length === 0 && (
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem', color: '#d97706' }}>
                    ⚠ You have no purchase bills recorded yet. Add some in the Purchases view first, otherwise everything will show as "2B only".
                  </p>
                )}
              </div>
            )}

            {gstr2bData && (
              <>
                {/* Summary stats */}
                <div className="glass-panel" style={{ padding: '0.85rem 1rem', marginBottom: '0.75rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
                    {[
                      { k: 'all', label: 'Total entries', count: stats.total, color: 'var(--text-primary)' },
                      { k: 'matched', label: '✓ Matched', count: stats.matched, color: '#059669' },
                      { k: 'amount_mismatch', label: '⚠ Amount mismatch', count: stats.amount_mismatch, color: '#d97706' },
                      { k: 'book_only', label: '⚠ Books only', count: stats.book_only, color: '#dc2626' },
                      { k: 'twob_only', label: '⚠ 2B only', count: stats.twob_only, color: '#7c3aed' },
                    ].map(s => (
                      <button key={s.k}
                        onClick={() => setGstr2bFilter(s.k)}
                        className={gstr2bFilter === s.k ? 'type-chip type-chip-active' : 'type-chip'}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.1rem', padding: '0.5rem 0.7rem', textAlign: 'left' }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{s.label}</span>
                        <strong style={{ fontSize: '1.05rem', color: s.color }}>{s.count}</strong>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Table */}
                <div className="glass-panel" style={{ padding: 0, overflowX: 'auto' }}>
                  <table className="data-table" style={{ width: '100%', minWidth: '900px' }}>
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Supplier</th>
                        <th>Invoice No.</th>
                        <th>Date</th>
                        <th style={{ textAlign: 'right' }}>2B Value</th>
                        <th style={{ textAlign: 'right' }}>Books Value</th>
                        <th style={{ textAlign: 'right' }}>Diff</th>
                        <th>ITC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.length === 0 ? (
                        <tr><td colSpan="8" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No entries match this filter.</td></tr>
                      ) : visibleRows.map((r, i) => {
                        const badge = STATUS_BADGES[r.status];
                        const diff = r.twoBVal - r.bookVal;
                        return (
                          // v1.10.6 — audit L13: use invoice + GSTIN combo (stable across filters).
                          <tr key={`${r.gstin || 'x'}-${r.invoice || i}`}>
                            <td><span className="status-pill" style={{ '--pill-color': badge.color }}>{badge.label}</span></td>
                            <td>
                              <div style={{ fontWeight: 500 }}>{r.supplier || '—'}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{r.ctin}</div>
                            </td>
                            <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{r.invoiceNumber}</td>
                            <td style={{ fontSize: '0.78rem' }}>{r.date || '—'}</td>
                            <td style={{ textAlign: 'right' }}>{r.twoBVal > 0 ? formatCurrency(r.twoBVal) : '—'}</td>
                            <td style={{ textAlign: 'right' }}>{r.bookVal > 0 ? formatCurrency(r.bookVal) : '—'}</td>
                            <td style={{ textAlign: 'right', color: Math.abs(diff) > 1 ? '#dc2626' : 'var(--text-muted)', fontWeight: Math.abs(diff) > 1 ? 600 : 400 }}>
                              {diff !== 0 ? (diff > 0 ? '+' : '') + formatCurrency(diff) : '—'}
                            </td>
                            <td style={{ fontSize: '0.78rem', color: r.itcAvailable ? '#059669' : '#94a3b8' }}>{r.itcAvailable ? '✓' : '✗'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        );
      })()}
    </>
  );
}
