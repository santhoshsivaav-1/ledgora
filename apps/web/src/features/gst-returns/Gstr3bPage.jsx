import { Download, Upload, CheckCircle } from 'lucide-react';
import { formatCurrency, getStateCode } from '../../utils';
import { billIsInterstate, computeItemTaxSplit } from './gstHelpers';

// GSTR-3B: the monthly summary return. One page of GST returns (change 3.17).
export default function Gstr3bPage({
  activeTab, b2cBills, exportGSTR3B, exportGSTR3BJSON, exportTotals, nilExempt, grandTotals, hasCarry, itcCarry, itcFromExpenses, markFiled, netPayable, netTax, outputTax, periodFiling, setOff, table4, itc180, rcm = null, onRecordRcm, unreg32 = [], inward5 = null, supplies31a = grandTotals, exempt31c = nilExempt.total,
}) {
  return (
    <>
      {activeTab === 'gstr3b' && (
        <>
          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem', alignItems: 'center' }}>
            <button className="btn btn-secondary" onClick={exportGSTR3B} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}><Download size={13} /> 3B CSV</button>
            <button className="btn btn-primary" onClick={exportGSTR3BJSON} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}><Upload size={13} /> 3B JSON</button>
            {!periodFiling.gstr3b && (
              <button className="btn btn-secondary" onClick={() => markFiled('gstr3b')} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', marginLeft: 'auto', color: '#059669', borderColor: '#bbf7d0' }}>
                <CheckCircle size={13} /> Mark Filed
              </button>
            )}
          </div>

          {/* Table 3.1 — Output Tax */}
          <div className="glass-panel mb-4">
            <div className="table-header"><h3>Table 3.1 — Outward Supplies & Tax</h3></div>
            <div className="table-scroll">
              <table className="data-table" style={{ minWidth: '600px' }}>
                <thead><tr><th>Nature of Supplies</th><th style={{ textAlign: 'right' }}>Taxable Value</th><th style={{ textAlign: 'right' }}>IGST</th><th style={{ textAlign: 'right' }}>CGST</th><th style={{ textAlign: 'right' }}>SGST</th></tr></thead>
                <tbody>
                  <tr><td className="font-medium">(a) Outward taxable supplies (other than zero-rated, nil-rated and exempted)</td><td style={{ textAlign: 'right' }}>{formatCurrency(supplies31a.taxable)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(supplies31a.igst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(supplies31a.cgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(supplies31a.sgst)}</td></tr>
                  <tr><td className="font-medium">(b) Zero-rated supplies (exports, SEZ)</td><td style={{ textAlign: 'right' }}>{formatCurrency(exportTotals.taxable)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(exportTotals.igst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(0)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(0)}</td></tr>
                  <tr><td className="font-medium">(c) Other outward supplies (nil rated, exempted)</td><td style={{ textAlign: 'right' }}>{formatCurrency(exempt31c)}</td><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{exempt31c > nilExempt.total ? 'Bills of supply and exempt other income' : nilExempt.total > 0 ? 'Bills of supply' : 'N/A'}</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Table 3.2 — Inter-state Supplies */}
          {(() => {
            const interStateB2C = {};
            b2cBills.forEach(bill => {
              const { client, items, details } = bill.data;
              const isInter = billIsInterstate(bill);
              if (!isInter) return;
              const pos = getStateCode(details?.placeOfSupply || client?.state || '');
              const posName = client?.state || pos;
              (items || []).forEach(item => {
                if (!interStateB2C[posName]) interStateB2C[posName] = { pos: posName, taxable: 0, igst: 0 };
                // v1.10.74 - pass the tax-inclusive flag like every other call,
                // or a tax-inclusive bill's taxable value and IGST come out too high.
                const split = computeItemTaxSplit(item, true, !!bill.data?.taxInclusive);
                interStateB2C[posName].taxable += split.taxable;
                interStateB2C[posName].igst += split.igst;
              });
            });
            const rows = Object.values(interStateB2C);
            if (rows.length === 0) return null;
            return (
              <div className="glass-panel mb-4">
                <div className="table-header"><h3>Table 3.2 — Inter-state Supplies to Unregistered Persons</h3></div>
                <div className="table-scroll">
                  <table className="data-table" style={{ minWidth: '400px' }}>
                    <thead><tr><th>Place of Supply</th><th style={{ textAlign: 'right' }}>Taxable Value</th><th style={{ textAlign: 'right' }}>IGST</th></tr></thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}><td className="font-medium">{r.pos}</td><td style={{ textAlign: 'right' }}>{formatCurrency(r.taxable)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(r.igst)}</td></tr>
                      ))}
                    </tbody>
                    <tfoot><tr style={{ fontWeight: 'bold', borderTop: '2px solid var(--border)' }}>
                      <td>Total</td><td style={{ textAlign: 'right' }}>{formatCurrency(rows.reduce((s, r) => s + r.taxable, 0))}</td><td style={{ textAlign: 'right' }}>{formatCurrency(rows.reduce((s, r) => s + r.igst, 0))}</td>
                    </tr></tfoot>
                  </table>
                </div>
              </div>
            );
          })()}

          {/* Table 4 — ITC. Phase 3: reverse-charge credit in (A)(3), credit flagged ineligible reversed in (B)(1), debit
              notes in (B)(2). The extra rows appear only when they hold something. */}
          {(() => {
            const row = (label, h, opts = {}) => (
              <tr className={opts.bold ? 'font-bold' : undefined}>
                <td className={opts.bold ? undefined : 'font-medium'}>{label}</td>
                {['igst', 'cgst', 'sgst'].map(k => (
                  <td key={k} style={{ textAlign: 'right' }}>{opts.minus && h[k] > 0 ? '-' : ''}{formatCurrency(h[k])}</td>
                ))}
              </tr>
            );
            const some = (h) => h && h.igst + h.cgst + h.sgst > 0;
            const isrc = table4?.avl.isrc;
            const oth = table4?.avl.oth || itcFromExpenses;
            return (
              <div className="glass-panel mb-4">
                <div className="table-header"><h3>Table 4 — Eligible ITC (from Expenses & Purchases)</h3></div>
                <div className="table-scroll">
                  <table className="data-table" style={{ minWidth: '500px' }}>
                    <thead><tr><th>Details</th><th style={{ textAlign: 'right' }}>IGST</th><th style={{ textAlign: 'right' }}>CGST</th><th style={{ textAlign: 'right' }}>SGST</th></tr></thead>
                    <tbody>
                      {some(isrc) && row('(A)(3) Inward supplies liable to reverse charge', isrc)}
                      {row('(A) ITC Available — All other ITC', oth)}
                      {some(table4?.avl.reclaim) && row('(A)(5) Re-claimed ITC — supplier paid after 180 days', table4.avl.reclaim)}
                      {some(table4?.rev.rul) && row('(B)(1) Reversed — §17(5), blocked, exempt use', table4.rev.rul, { minus: true })}
                      {some(table4?.rev.oth) && row('(B)(2) Reversed — debit notes and the 180-day rule', table4.rev.oth, { minus: true })}
                      {row('Net ITC Available', itcFromExpenses, { bold: true })}
                    </tbody>
                  </table>
                </div>
                {itc180?.reversals?.length > 0 && (
                  <div style={{ padding: '0.5rem 1.25rem' }}>
                    <strong style={{ fontSize: '0.8rem' }}>Review — supplier not paid within 180 days (reversed above)</strong>
                    <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.1rem', fontSize: '0.8rem' }}>
                      {itc180.reversals.map((r) => <li key={r.billId}>{r.supplier} · bill {r.number} · unpaid {formatCurrency(r.unpaid)} · credit {formatCurrency(r.itc)}. Pay it and the credit returns as Re-claimed ITC.</li>)}
                    </ul>
                  </div>
                )}
                <p className="field-hint" style={{ padding: '0.75rem 1.25rem' }}>
                  ITC calculated from Expense Tracker and Purchase Bills entries with GST. Credit marked ineligible on a bill line or an expense is shown in 4(A) and reversed in 4(B)(1) (CBIC Circular 170/02/2022). Verify against GSTR-2B on the GST portal for actual eligible ITC.
                </p>
              </div>
            );
          })()}

          {/* P10-S3: 3.2 and 5 */}
          {(unreg32.length > 0 || (inward5 && inward5.gst.inter + inward5.gst.intra + inward5.nongst.inter + inward5.nongst.intra > 0)) && (
            <div className="glass-panel mb-4">
              {unreg32.length > 0 && (
                <>
                  <div className="table-header"><h3>Table 3.2 — Inter-state supplies to unregistered persons</h3></div>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead><tr><th>Place of supply</th><th style={{ textAlign: 'right' }}>Taxable value</th><th style={{ textAlign: 'right' }}>IGST</th></tr></thead>
                      <tbody>{unreg32.map((r) => <tr key={r.pos}><td>{r.pos}</td><td style={{ textAlign: 'right' }}>{formatCurrency(r.txval)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(r.iamt)}</td></tr>)}</tbody>
                    </table>
                  </div>
                  <p className="field-hint" style={{ padding: '0.5rem 1.25rem' }}>Already inside 3.1(a); the portal asks for this split by state. Composition and UIN holders are not tracked, so those rows stay empty.</p>
                </>
              )}
              {inward5 && inward5.gst.inter + inward5.gst.intra + inward5.nongst.inter + inward5.nongst.intra > 0 && (
                <>
                  <div className="table-header"><h3>Table 5 — Exempt, nil-rated and non-GST inward supplies</h3></div>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead><tr><th>Nature</th><th style={{ textAlign: 'right' }}>Inter-state</th><th style={{ textAlign: 'right' }}>Intra-state</th></tr></thead>
                      <tbody>
                        <tr><td>Composition, exempt and nil-rated (0% purchase lines)</td><td style={{ textAlign: 'right' }}>{formatCurrency(inward5.gst.inter)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(inward5.gst.intra)}</td></tr>
                        <tr><td>Non-GST supply</td><td style={{ textAlign: 'right' }}>{formatCurrency(inward5.nongst.inter)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(inward5.nongst.intra)}</td></tr>
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* P10-S2: reverse charge. Tax on RCM bills is paid in cash (not from credit); its credit is claimed in 4(A)(3) of the month it is paid. */}
          {rcm && rcm.unpaid.length > 0 && (
            <div className="glass-panel mb-4">
              <div className="table-header"><h3>Reverse charge (RCM) — tax not paid yet</h3></div>
              <div className="table-scroll">
                <table className="data-table" style={{ minWidth: '600px' }}>
                  <thead><tr><th>Bill</th><th>Supplier</th><th>Date</th><th style={{ textAlign: 'right' }}>Taxable</th><th style={{ textAlign: 'right' }}>IGST / CGST / SGST</th><th>Status</th></tr></thead>
                  <tbody>
                    {rcm.unpaid.map((b) => (
                      <tr key={b.id}>
                        <td>{b.number || '-'}</td><td>{b.supplier || '-'}</td><td>{b.date}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(b.taxable)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(b.heads.igst)} / {formatCurrency(b.heads.cgst)} / {formatCurrency(b.heads.sgst)}</td>
                        <td>Unpaid {onRecordRcm && <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', marginLeft: 6 }} onClick={() => onRecordRcm(b)}>Record payment</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="field-hint" style={{ padding: '0.75rem 1.25rem' }}>
                The tax is in 3.1(d) of the bill's month. Pay it through the cash ledger, record the payment here, and the credit appears in 4(A)(3) of that payment's month. The supplier is owed the bill without this tax.
              </p>
            </div>
          )}

          {/* Table 6 — Tax Payment */}
          <div className="glass-panel mb-4">
            <div className="table-header"><h3>Table 6 — Tax Payment Summary</h3></div>
            <div className="table-scroll">
              <table className="data-table" style={{ minWidth: '600px' }}>
                <thead><tr><th>Description</th><th style={{ textAlign: 'right' }}>IGST</th><th style={{ textAlign: 'right' }}>CGST</th><th style={{ textAlign: 'right' }}>SGST</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                <tbody>
                  <tr><td className="font-medium">Output Tax Liability</td><td style={{ textAlign: 'right' }}>{formatCurrency(outputTax.igst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(outputTax.cgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(outputTax.sgst)}</td><td style={{ textAlign: 'right' }} className="font-bold">{formatCurrency(outputTax.igst + outputTax.cgst + outputTax.sgst)}</td></tr>
                  <tr><td className="font-medium" style={{ color: '#059669' }}>Less: ITC utilised</td><td style={{ textAlign: 'right', color: '#059669' }}>-{formatCurrency(setOff.used.igst)}</td><td style={{ textAlign: 'right', color: '#059669' }}>-{formatCurrency(setOff.used.cgst)}</td><td style={{ textAlign: 'right', color: '#059669' }}>-{formatCurrency(setOff.used.sgst)}</td><td style={{ textAlign: 'right', color: '#059669' }}>-{formatCurrency(setOff.used.igst + setOff.used.cgst + setOff.used.sgst)}</td></tr>
                </tbody>
                <tfoot><tr style={{ fontWeight: 'bold', borderTop: '2px solid var(--border)' }}>
                  <td>Net Tax Payable</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(netTax.igst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(netTax.cgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(netTax.sgst)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--primary)', fontSize: '1.1rem' }}>{formatCurrency(netTax.igst + netTax.cgst + netTax.sgst)}</td>
                </tr>
                {hasCarry && (
                  <tr style={{ color: 'var(--text-muted)' }}>
                    <td>ITC carried forward</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(itcCarry.igst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(itcCarry.cgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(itcCarry.sgst)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(itcCarry.igst + itcCarry.cgst + itcCarry.sgst)}</td>
                  </tr>
                )}</tfoot>
              </table>
            </div>
            <p className="field-hint" style={{ padding: '0.75rem 1.25rem' }}>
              Credit is set off in the order the law requires: IGST credit first (against IGST, then CGST, then SGST); CGST credit against CGST, then IGST; SGST credit against SGST, then IGST. CGST credit never pays SGST, and SGST credit never pays CGST.
            </p>
          </div>

          {/* Net Payable */}
          <div className="glass-panel" style={{ padding: '1rem 1.25rem', textAlign: 'center' }}>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 0.25rem' }}>Net GST Payable</p>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--primary)', margin: 0 }}>
              {formatCurrency(netPayable)}
            </h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
              {netPayable === 0 ? 'ITC covers your liability' : 'Pay via Electronic Cash Ledger'}
            </p>
          </div>
        </>
      )}
    </>
  );
}
