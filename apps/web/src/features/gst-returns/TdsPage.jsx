import { Download } from 'lucide-react';
import { formatCurrency } from '../../utils';
import { toast } from '../../components/ui/Toast';
import { downloadCSV } from './gstHelpers';

// TDS and TCS reports (Form 26Q and 27EQ). One page of GST returns (change 3.17).
export default function TdsPage({
  activeTab, filteredBills,
}) {
  return (
    <>
      {activeTab === 'tds' && (() => {
        // Aggregate TDS (deducted by buyers) and TCS (collected by us) across all bills
        // in the filtered period, grouped by client + section + quarter. The data feeds
        // Form 26Q (TDS quarterly return) and Form 27EQ (TCS quarterly return) inputs.
        const tdsRows = []; // each row: { client, gstin, section, quarter, taxable, tds }
        const tcsRows = [];
        filteredBills.forEach(bill => {
          const t = bill.data?.totals || {};
          const opt = bill.data?.invoiceOptions || {};
          const client = bill.data?.client || {};
          const date = new Date(bill.invoiceDate);
          if (isNaN(date.getTime())) return;
          const m = date.getMonth(); // 0=Jan
          const fyQuarter = m >= 3 && m <= 5 ? 'Q1' : m >= 6 && m <= 8 ? 'Q2' : m >= 9 && m <= 11 ? 'Q3' : 'Q4';
          const taxable = t.taxableAmount ?? ((t.subtotal || 0) - (t.totalDiscount || 0));
          if (t.tdsAmount > 0) {
            tdsRows.push({
              clientName: client.name || bill.clientName || '—',
              clientGstin: client.gstin || '',
              clientPan: client.pan || '',
              section: opt.tdsSection || '194Q',
              rate: opt.tdsRate || 0,
              quarter: fyQuarter,
              invoiceNumber: bill.invoiceNumber,
              date: bill.invoiceDate,
              taxable,
              tds: t.tdsAmount,
            });
          }
          if (t.tcsAmount > 0) {
            tcsRows.push({
              clientName: client.name || bill.clientName || '—',
              clientGstin: client.gstin || '',
              clientPan: client.pan || '',
              section: opt.tcsSection || '206C(1H)',
              rate: opt.tcsRate || 0,
              quarter: fyQuarter,
              invoiceNumber: bill.invoiceNumber,
              date: bill.invoiceDate,
              taxable,
              tcs: t.tcsAmount,
            });
          }
        });

        const tdsTotal = tdsRows.reduce((acc, r) => ({ taxable: acc.taxable + r.taxable, tds: acc.tds + r.tds }), { taxable: 0, tds: 0 });
        const tcsTotal = tcsRows.reduce((acc, r) => ({ taxable: acc.taxable + r.taxable, tcs: acc.tcs + r.tcs }), { taxable: 0, tcs: 0 });

        // Section-wise summary for TDS: groups by section + quarter
        const tdsBySection = {};
        tdsRows.forEach(r => {
          const k = `${r.section}_${r.quarter}`;
          if (!tdsBySection[k]) tdsBySection[k] = { section: r.section, quarter: r.quarter, count: 0, taxable: 0, tds: 0 };
          tdsBySection[k].count += 1; tdsBySection[k].taxable += r.taxable; tdsBySection[k].tds += r.tds;
        });
        const tcsBySection = {};
        tcsRows.forEach(r => {
          const k = `${r.section}_${r.quarter}`;
          if (!tcsBySection[k]) tcsBySection[k] = { section: r.section, quarter: r.quarter, count: 0, taxable: 0, tcs: 0 };
          tcsBySection[k].count += 1; tcsBySection[k].taxable += r.taxable; tcsBySection[k].tcs += r.tcs;
        });

        const exportTDSCSV = () => {
          if (tdsRows.length === 0) { toast('No TDS entries in this period', 'warning'); return; }
          downloadCSV('TDS_Receivable_Report.csv',
            ['Quarter', 'Section', 'Rate %', 'Invoice No.', 'Date', 'Client', 'Client GSTIN', 'Client PAN', 'Taxable Value', 'TDS Amount'],
            tdsRows.map(r => [r.quarter, r.section, r.rate, r.invoiceNumber, r.date, r.clientName, r.clientGstin, r.clientPan, r.taxable.toFixed(2), r.tds.toFixed(2)])
          );
          toast('TDS report exported', 'success');
        };
        const exportTCSCSV = () => {
          if (tcsRows.length === 0) { toast('No TCS entries in this period', 'warning'); return; }
          downloadCSV('TCS_Collected_Report.csv',
            ['Quarter', 'Section', 'Rate %', 'Invoice No.', 'Date', 'Client', 'Client GSTIN', 'Client PAN', 'Taxable Value', 'TCS Amount'],
            tcsRows.map(r => [r.quarter, r.section, r.rate, r.invoiceNumber, r.date, r.clientName, r.clientGstin, r.clientPan, r.taxable.toFixed(2), r.tcs.toFixed(2)])
          );
          toast('TCS report exported', 'success');
        };

        return (
          <>
            <div className="glass-panel" style={{ padding: '0.85rem 1rem', marginBottom: '0.75rem', borderLeft: '3px solid var(--primary)' }}>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                <strong>What this is:</strong> Aggregates TDS (tax deducted by your clients on payments to you — Section 194C/194J/194Q etc.)
                and TCS (tax collected by you from clients — CGST section 52, 206C(1), or 206C(1H) on invoices before April 2025) across the selected period.
                Use the CSV exports as input for <strong>Form 26Q</strong> (TDS) and <strong>Form 27EQ</strong> (TCS) quarterly returns,
                or hand the file to your CA. Filed at <a href="https://www.tin-nsdl.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>tin-nsdl.com</a>.
              </p>
            </div>

            {/* TDS section */}
            <div className="glass-panel" style={{ padding: '0.85rem 1rem', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>TDS Receivable (deducted by clients)</h3>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Total TDS your clients should have deducted. You can claim this as credit against your own income tax.
                  </p>
                </div>
                <button className="btn btn-secondary" onClick={exportTDSCSV} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }} disabled={tdsRows.length === 0}>
                  <Download size={13} /> Export TDS CSV
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.5rem', marginBottom: '0.6rem' }}>
                <div className="glass-panel" style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-secondary)' }}>
                  <p className="stat-label" style={{ margin: 0, fontSize: '0.7rem' }}>Invoices with TDS</p>
                  <strong style={{ fontSize: '1rem' }}>{tdsRows.length}</strong>
                </div>
                <div className="glass-panel" style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-secondary)' }}>
                  <p className="stat-label" style={{ margin: 0, fontSize: '0.7rem' }}>Taxable value</p>
                  <strong style={{ fontSize: '1rem' }}>{formatCurrency(tdsTotal.taxable)}</strong>
                </div>
                <div className="glass-panel" style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-secondary)' }}>
                  <p className="stat-label" style={{ margin: 0, fontSize: '0.7rem' }}>Total TDS receivable</p>
                  <strong style={{ fontSize: '1rem', color: '#0f766e' }}>{formatCurrency(tdsTotal.tds)}</strong>
                </div>
              </div>
              {Object.values(tdsBySection).length > 0 ? (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ width: '100%', fontSize: '0.78rem' }}>
                    <thead>
                      <tr><th>Quarter</th><th>Section</th><th>Invoices</th><th style={{ textAlign: 'right' }}>Taxable</th><th style={{ textAlign: 'right' }}>TDS</th></tr>
                    </thead>
                    <tbody>
                      {Object.values(tdsBySection).sort((a, b) => a.quarter.localeCompare(b.quarter) || a.section.localeCompare(b.section)).map((r, i) => (
                        <tr key={`tds-${i}`}>
                          <td>{r.quarter}</td>
                          <td style={{ fontFamily: 'monospace' }}>{r.section}</td>
                          <td>{r.count}</td>
                          <td style={{ textAlign: 'right' }}>{formatCurrency(r.taxable)}</td>
                          <td style={{ textAlign: 'right', color: '#0f766e', fontWeight: 600 }}>{formatCurrency(r.tds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, textAlign: 'center', padding: '0.75rem' }}>
                  No invoices with TDS in this period. Enable TDS on an invoice via <em>Customize → TDS</em>.
                </p>
              )}
            </div>

            {/* TCS section */}
            <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>TCS Collected (from clients)</h3>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    TCS you collected from buyers. Must be deposited to the Income Tax Department and reported in Form 27EQ quarterly.
                  </p>
                </div>
                <button className="btn btn-secondary" onClick={exportTCSCSV} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }} disabled={tcsRows.length === 0}>
                  <Download size={13} /> Export TCS CSV
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.5rem', marginBottom: '0.6rem' }}>
                <div className="glass-panel" style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-secondary)' }}>
                  <p className="stat-label" style={{ margin: 0, fontSize: '0.7rem' }}>Invoices with TCS</p>
                  <strong style={{ fontSize: '1rem' }}>{tcsRows.length}</strong>
                </div>
                <div className="glass-panel" style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-secondary)' }}>
                  <p className="stat-label" style={{ margin: 0, fontSize: '0.7rem' }}>Taxable value</p>
                  <strong style={{ fontSize: '1rem' }}>{formatCurrency(tcsTotal.taxable)}</strong>
                </div>
                <div className="glass-panel" style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-secondary)' }}>
                  <p className="stat-label" style={{ margin: 0, fontSize: '0.7rem' }}>Total TCS collected</p>
                  <strong style={{ fontSize: '1rem', color: '#d97706' }}>{formatCurrency(tcsTotal.tcs)}</strong>
                </div>
              </div>
              {Object.values(tcsBySection).length > 0 ? (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ width: '100%', fontSize: '0.78rem' }}>
                    <thead>
                      <tr><th>Quarter</th><th>Section</th><th>Invoices</th><th style={{ textAlign: 'right' }}>Taxable</th><th style={{ textAlign: 'right' }}>TCS</th></tr>
                    </thead>
                    <tbody>
                      {Object.values(tcsBySection).sort((a, b) => a.quarter.localeCompare(b.quarter) || a.section.localeCompare(b.section)).map((r, i) => (
                        <tr key={`tcs-${i}`}>
                          <td>{r.quarter}</td>
                          <td style={{ fontFamily: 'monospace' }}>{r.section}</td>
                          <td>{r.count}</td>
                          <td style={{ textAlign: 'right' }}>{formatCurrency(r.taxable)}</td>
                          <td style={{ textAlign: 'right', color: '#d97706', fontWeight: 600 }}>{formatCurrency(r.tcs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, textAlign: 'center', padding: '0.75rem' }}>
                  No invoices with TCS in this period. Enable TCS on an invoice via <em>Customize → TCS</em>.
                </p>
              )}
            </div>
          </>
        );
      })()}
    </>
  );
}
