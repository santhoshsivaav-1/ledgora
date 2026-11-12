import { useState } from 'react';
import { Upload } from 'lucide-react';
import { compare26AS, parse26AS } from '@ledgora/tax-engine';
import { formatCurrency } from '../../utils';
import { toast } from '../../components/ui/Toast';
import { tdsBookByCustomer } from './gstReturnTables';

// P10-S5: TDS customers deducted from what they paid us (invoices and receipts of the period) against Form 26AS. The
// file is read in the browser and never sent anywhere. Pick the financial year above so both sides cover the same span.
const STATUS = {
  matched: ['Matched', '#059669'],
  mismatch: ['Amount differs', '#d97706'],
  missing_in_26as: ['Not in 26AS', '#dc2626'],
  missing_in_books: ['Not in books', '#2563eb'],
};

export default function Tds26ASPanel({ bills, receipts }) {
  const [statement, setStatement] = useState(null);
  const book = tdsBookByCustomer(bills, receipts);
  const result = statement ? compare26AS(book, statement) : null;
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5_000_000) return toast('That file is too large for a 26AS statement', 'error');
    const rows = parse26AS(await file.text());
    if (!rows.length) return toast('No deductor rows found. Use the TRACES text download or a CSV with "Name of Deductor", "TAN of Deductor" and "Total Tax Deducted" columns.', 'error');
    setStatement(rows);
    toast(`${rows.length} deductor${rows.length === 1 ? '' : 's'} read from 26AS`, 'success');
  };
  return (
    <div className="glass-panel" style={{ padding: '1rem', marginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: '0.95rem' }}>TDS receivable vs Form 26AS</h3>
        <label className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', cursor: 'pointer' }}>
          <Upload size={13} /> Import 26AS
          <input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={onFile} style={{ display: 'none' }} />
        </label>
      </div>
      <p className="field-hint" style={{ margin: '0.4rem 0 0.75rem' }}>
        Books: TDS on this period's invoices and TDS customers kept from receipts. 26AS: download the text file from TRACES
        (View Tax Credit). Credit only counts in your return when it is in 26AS.
      </p>
      {!result && (book.length ? (
        <p style={{ fontSize: '0.8rem', margin: 0 }}>{book.length} customer{book.length === 1 ? '' : 's'} deducted {formatCurrency(book.reduce((t, r) => t + r.tds, 0))} in this period. Import 26AS to compare.</p>
      ) : <p style={{ fontSize: '0.8rem', margin: 0, color: 'var(--text-muted)' }}>No TDS deducted by customers in this period.</p>)}
      {result && (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%', fontSize: '0.78rem' }}>
            <thead><tr><th>Deductor</th><th>TAN</th><th style={{ textAlign: 'right' }}>Books</th><th style={{ textAlign: 'right' }}>26AS</th><th style={{ textAlign: 'right' }}>Difference</th><th>Status</th></tr></thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={`${r.deductor}|${r.tan}`}>
                  <td>{r.deductor}</td><td style={{ fontFamily: 'monospace' }}>{r.tan || '-'}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(r.book)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(r.statement)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(r.diff)}</td>
                  <td style={{ color: STATUS[r.status][1], fontWeight: 600 }}>{STATUS[r.status][0]}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr style={{ fontWeight: 700 }}><td colSpan={2}>Total</td><td style={{ textAlign: 'right' }}>{formatCurrency(result.totals.book)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(result.totals.statement)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(result.totals.diff)}</td><td /></tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
