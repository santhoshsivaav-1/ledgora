import { Download, Upload, CheckCircle } from 'lucide-react';
import { formatCurrency, placeOfSupplyLabel } from '../../utils';
import { getTaxableAmount } from './gstHelpers';

// GSTR-1: outward supplies, with the JSON for the portal. One page of GST returns (change 3.17).
export default function Gstr1Page({
  activeTab, b2bRows, b2bTotals, b2cBills, b2cLarge, b2cPos, b2cRates, b2cTable7, b2cTotals, creditNotes, docSummary, exportB2B, exportB2C, exportCDNR, exportDocSummary, exportGSTR1JSON, exportHSN, grandTotals, hsnRows, nilExempt, exportBills, markFiled, periodFiling,
}) {
  return (
    <>
      {activeTab === 'gstr1' && (
        <>
          {/* Actions bar */}
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={exportGSTR1JSON} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}><Upload size={13} /> JSON Export</button>
            <button className="btn btn-secondary" onClick={exportB2B} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}><Download size={13} /> B2B</button>
            <button className="btn btn-secondary" onClick={exportB2C} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}><Download size={13} /> B2C</button>
            <button className="btn btn-secondary" onClick={exportHSN} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}><Download size={13} /> HSN</button>
            <button className="btn btn-secondary" onClick={exportCDNR} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}><Download size={13} /> CDNR</button>
            <button className="btn btn-secondary" onClick={exportDocSummary} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}><Download size={13} /> Docs</button>
            {!periodFiling.gstr1 && (
              <button className="btn btn-secondary" onClick={() => markFiled('gstr1')} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', marginLeft: 'auto', color: '#059669', borderColor: '#bbf7d0' }}>
                <CheckCircle size={13} /> Mark Filed
              </button>
            )}
          </div>

          {/* B2B — Table 4A */}
          <div className="glass-panel mb-4">
            <div className="table-header">
              <h3>B2B Sales — Table 4A</h3>
              <span className="text-muted" style={{ fontSize: '0.82rem' }}>{b2bRows.length} invoice{b2bRows.length !== 1 ? 's' : ''}</span>
            </div>
            {b2bRows.length === 0 ? (
              <p style={{ padding: '1rem 1.25rem', margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>No B2B invoices for this period.</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr>
                    <th>GSTIN</th><th>Client</th><th>Invoice No</th><th>Date</th><th>POS</th><th>Type</th>
                    <th style={{ textAlign: 'right' }}>Taxable</th><th style={{ textAlign: 'right' }}>CGST</th>
                    <th style={{ textAlign: 'right' }}>SGST</th><th style={{ textAlign: 'right' }}>IGST</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr></thead>
                  <tbody>
                    {/* v1.10.6 — audit L13: was key={i}; use invoiceNo which is
                        stable across sorts. */}
                    {b2bRows.map((r, i) => (
                      <tr key={r.invoiceNo || `b2b-${i}`}>
                        <td><span className="invoice-badge">{r.gstin}</span></td>
                        <td className="font-medium">{r.clientName}</td>
                        <td>{r.invoiceNo}</td>
                        <td className="text-muted">{r.date ? new Date(r.date).toLocaleDateString('en-IN') : ''}</td>
                        <td className="text-muted">{r.pos}</td>
                        <td><span className="type-badge">{r.supplyType}</span></td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(r.taxable)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(r.cgst)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(r.sgst)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(r.igst)}</td>
                        <td style={{ textAlign: 'right' }} className="font-bold">{formatCurrency(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr style={{ fontWeight: 'bold', borderTop: '2px solid var(--border)' }}>
                    <td colSpan={6}>B2B Total</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b2bTotals.taxable)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b2bTotals.cgst)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b2bTotals.sgst)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b2bTotals.igst)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b2bTotals.total)}</td>
                  </tr></tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Credit/Debit Notes — Table 9B */}
          {creditNotes.length > 0 && (
            <div className="glass-panel mb-4">
              <div className="table-header">
                <h3>Credit/Debit Notes — Table 9B</h3>
                <span className="text-muted" style={{ fontSize: '0.85rem' }}>{creditNotes.length} note{creditNotes.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>GSTIN</th><th>Client</th><th>Note No</th><th>Date</th><th style={{ textAlign: 'right' }}>Taxable</th><th style={{ textAlign: 'right' }}>Tax</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                  <tbody>
                    {/* v1.10.6 — audit L13: was key={i}; use bill.id which is stable. */}
                    {creditNotes.map((bill, i) => {
                      const { client, totals } = bill.data;
                      return (
                        <tr key={bill.id || `cn-${i}`}>
                          <td><span className="invoice-badge">{client?.gstin || 'Unregistered'}</span></td>
                          <td className="font-medium">{client?.name || bill.clientName}</td>
                          <td>{bill.invoiceNumber}</td>
                          <td className="text-muted">{bill.invoiceDate ? new Date(bill.invoiceDate).toLocaleDateString('en-IN') : ''}</td>
                          <td style={{ textAlign: 'right' }}>{formatCurrency(getTaxableAmount(totals))}</td>
                          <td style={{ textAlign: 'right' }}>{formatCurrency((totals?.cgst || 0) + (totals?.sgst || 0) + (totals?.igst || 0))}</td>
                          <td style={{ textAlign: 'right' }} className="font-bold">{formatCurrency(totals?.total || 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* B2C — Table 7 (only show if data exists) */}
          <div className="glass-panel mb-4">
            <div className="table-header">
              <h3>B2C Sales — Table 7</h3>
              <span className="text-muted" style={{ fontSize: '0.82rem' }}>
                {b2cBills.length} invoice{b2cBills.length !== 1 ? 's' : ''}
                {b2cLarge.length > 0 && <> ({b2cLarge.length} B2C Large)</>}
              </span>
            </div>
            {b2cRates.length === 0 ? (
              <p style={{ padding: '1rem 1.25rem', margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>No B2C invoices for this period.</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Type</th><th>Place of supply</th><th>Rate %</th><th style={{ textAlign: 'right' }}>Taxable</th><th style={{ textAlign: 'right' }}>CGST</th><th style={{ textAlign: 'right' }}>SGST</th><th style={{ textAlign: 'right' }}>IGST</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                  <tbody>
                    {b2cTable7.map(d => (
                      <tr key={`${d.inter}-${d.pos}-${d.rate}`}>
                        <td>{d.inter ? 'Inter-state' : 'Intra-state'}</td>
                        <td>{placeOfSupplyLabel(d.pos) || '-'}</td>
                        <td><span className="type-badge">{d.rate}%</span></td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(d.taxable)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(d.cgst)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(d.sgst)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(d.igst)}</td>
                        <td style={{ textAlign: 'right' }} className="font-bold">{formatCurrency(d.taxable + d.cgst + d.sgst + d.igst + d.cess)}</td>
                      </tr>
                    ))}
                    {b2cLarge.map(bill => {
                      const t = bill.data?.totals || {};
                      const taxable = getTaxableAmount(t);
                      return (
                        <tr key={bill.id} title="B2C Large (Table 5): an inter-state sale to an unregistered buyer above the limit is reported invoice by invoice">
                          <td>Inter-state, large</td>
                          <td>{placeOfSupplyLabel(b2cPos(bill)) || '-'}</td>
                          <td className="text-muted" style={{ fontSize: '0.78rem' }}>{bill.invoiceNumber}</td>
                          <td style={{ textAlign: 'right' }}>{formatCurrency(taxable)}</td>
                          <td style={{ textAlign: 'right' }}>{formatCurrency(0)}</td>
                          <td style={{ textAlign: 'right' }}>{formatCurrency(0)}</td>
                          <td style={{ textAlign: 'right' }}>{formatCurrency(t.igst || 0)}</td>
                          <td style={{ textAlign: 'right' }} className="font-bold">{formatCurrency(taxable + (t.igst || 0) + (t.cess || 0))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr style={{ fontWeight: 'bold', borderTop: '2px solid var(--border)' }}>
                    <td colSpan={3}>B2C Total</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b2cTotals.taxable)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b2cTotals.cgst)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b2cTotals.sgst)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b2cTotals.igst)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b2cTotals.total)}</td>
                  </tr></tfoot>
                </table>
              </div>
            )}
          </div>

          {/* HSN Summary — Table 12 */}
          <div className="glass-panel mb-4">
            <div className="table-header">
              <h3>HSN Summary — Table 12</h3>
              <span className="text-muted" style={{ fontSize: '0.82rem' }}>{hsnRows.length} code{hsnRows.length !== 1 ? 's' : ''}</span>
            </div>
            {hsnRows.length === 0 ? (
              <p style={{ padding: '1rem 1.25rem', margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>No items found.</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>HSN</th><th>Description</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Taxable</th><th style={{ textAlign: 'right' }}>CGST</th><th style={{ textAlign: 'right' }}>SGST</th><th style={{ textAlign: 'right' }}>IGST</th><th style={{ textAlign: 'right' }}>Total Tax</th></tr></thead>
                  <tbody>
                    {/* v1.10.6 — audit L13: HSN code is unique per row. */}
                    {hsnRows.map((r, i) => (
                      <tr key={r.hsn || `hsn-${i}`}>
                        <td><span className="invoice-badge">{r.hsn}</span></td>
                        <td className="font-medium">{r.description}</td>
                        <td style={{ textAlign: 'right' }}>{r.quantity}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(r.taxable)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(r.cgst)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(r.sgst)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(r.igst)}</td>
                        <td style={{ textAlign: 'right' }} className="font-bold">{formatCurrency(r.totalTax)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr style={{ fontWeight: 'bold', borderTop: '2px solid var(--border)' }}>
                    <td colSpan={2}>Total</td>
                    <td style={{ textAlign: 'right' }}>{hsnRows.reduce((s, r) => s + r.quantity, 0)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(hsnRows.reduce((s, r) => s + r.taxable, 0))}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(hsnRows.reduce((s, r) => s + r.cgst, 0))}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(hsnRows.reduce((s, r) => s + r.sgst, 0))}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(hsnRows.reduce((s, r) => s + r.igst, 0))}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(hsnRows.reduce((s, r) => s + r.totalTax, 0))}</td>
                  </tr></tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Table 8 - bills of supply are exempt supplies; they go to the portal as one total per kind of buyer. */}
          {nilExempt.inv.length > 0 && (
            <div className="glass-panel mb-4">
              <div className="table-header"><h3>Nil-rated, Exempt &amp; Non-GST Supplies — Table 8</h3></div>
              <div className="table-scroll">
                <table className="data-table" style={{ minWidth: '400px' }}>
                  <thead><tr><th>Supplies to</th><th style={{ textAlign: 'right' }}>Exempted</th></tr></thead>
                  <tbody>
                    {nilExempt.inv.map((r) => (
                      <tr key={r.sply_ty}>
                        <td className="font-medium">{{ INTRB2B: 'Registered, inter-state', INTRAB2B: 'Registered, intra-state', INTRB2C: 'Unregistered, inter-state', INTRAB2C: 'Unregistered, intra-state' }[r.sply_ty]}</td>
                        <td style={{ textAlign: 'right' }} className="font-bold">{formatCurrency(r.expt_amt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ padding: '0.5rem 1.25rem 0.75rem', margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                From your bills of supply. Included in the JSON, and in GSTR-3B 3.1(c).
              </p>
            </div>
          )}

          {/* Exports - Table 6A */}
          {exportBills.length > 0 && (
            <div className="glass-panel mb-4">
              <div className="table-header"><h3>Exports — Table 6A</h3></div>
              <p style={{ padding: '0.5rem 1.25rem 0.75rem', margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                {exportBills.length} export invoice{exportBills.length === 1 ? '' : 's'} ({exportBills.map((b) => b.invoiceNumber).join(', ')}) are in the JSON.
                Shipping bill number, date and port are filed with customs, not kept on the invoice: add them on the portal after uploading.
              </p>
            </div>
          )}

          {/* Document Summary — Table 13 */}
          <div className="glass-panel mb-4">
            <div className="table-header"><h3>Document Summary — Table 13</h3></div>
            {Object.keys(docSummary).length === 0 ? (
              <p style={{ padding: '1rem 1.25rem', margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>No documents issued.</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table" style={{ minWidth: '400px' }}>
                  <thead><tr><th>Document Type</th><th>From</th><th>To</th><th style={{ textAlign: 'right' }}>Total Issued</th><th style={{ textAlign: 'right' }}>Cancelled</th></tr></thead>
                  <tbody>
                    {Object.entries(docSummary).map(([prefix, d]) => (
                      <tr key={prefix}>
                        <td className="font-medium">{d.type}</td>
                        <td className="text-muted">{d.from}</td>
                        <td className="text-muted">{d.to}</td>
                        <td style={{ textAlign: 'right' }} className="font-bold">{d.total}</td>
                        <td style={{ textAlign: 'right' }}>{d.cancelled}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Grand Summary */}
          <div className="glass-panel">
            <div className="table-header"><h3>GSTR-1 Summary Totals</h3></div>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Category</th><th style={{ textAlign: 'right' }}>Taxable</th><th style={{ textAlign: 'right' }}>CGST</th><th style={{ textAlign: 'right' }}>SGST</th><th style={{ textAlign: 'right' }}>IGST</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                <tbody>
                  <tr><td className="font-medium">B2B Sales</td><td style={{ textAlign: 'right' }}>{formatCurrency(b2bTotals.taxable)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(b2bTotals.cgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(b2bTotals.sgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(b2bTotals.igst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(b2bTotals.total)}</td></tr>
                  <tr><td className="font-medium">B2C Sales</td><td style={{ textAlign: 'right' }}>{formatCurrency(b2cTotals.taxable)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(b2cTotals.cgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(b2cTotals.sgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(b2cTotals.igst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(b2cTotals.total)}</td></tr>
                </tbody>
                <tfoot><tr style={{ fontWeight: 'bold', borderTop: '2px solid var(--border)' }}>
                  <td>Grand Total</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(grandTotals.taxable)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(grandTotals.cgst)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(grandTotals.sgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(grandTotals.igst)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(grandTotals.total)}</td>
                </tr></tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
