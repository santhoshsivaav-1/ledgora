import { Download, Upload, CheckCircle } from 'lucide-react';
import { formatCurrency, getStateCode } from '../../utils';
import { billIsInterstate, computeItemTaxSplit } from './gstHelpers';

// GSTR-3B: the monthly summary return. One page of GST returns (change 3.17).
export default function Gstr3bPage({
  activeTab, b2cBills, exportGSTR3B, exportGSTR3BJSON, exportTotals, nilExempt, grandTotals, hasCarry, itcCarry, itcFromExpenses, markFiled, netPayable, netTax, outputTax, periodFiling, setOff,
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
                  <tr><td className="font-medium">(a) Outward taxable supplies (other than zero-rated, nil-rated and exempted)</td><td style={{ textAlign: 'right' }}>{formatCurrency(grandTotals.taxable)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(grandTotals.igst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(grandTotals.cgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(grandTotals.sgst)}</td></tr>
                  <tr><td className="font-medium">(b) Zero-rated supplies</td><td style={{ textAlign: 'right' }}>{formatCurrency(exportTotals.taxable)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(exportTotals.igst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(0)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(0)}</td></tr>
                  <tr><td className="font-medium">(c) Other outward supplies (nil rated, exempted)</td><td style={{ textAlign: 'right' }}>{formatCurrency(nilExempt.total)}</td><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{nilExempt.total > 0 ? 'Bills of supply' : 'N/A'}</td></tr>
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

          {/* Table 4 — ITC */}
          <div className="glass-panel mb-4">
            <div className="table-header"><h3>Table 4 — Eligible ITC (from Expenses & Purchases)</h3></div>
            <div className="table-scroll">
              <table className="data-table" style={{ minWidth: '500px' }}>
                <thead><tr><th>Details</th><th style={{ textAlign: 'right' }}>IGST</th><th style={{ textAlign: 'right' }}>CGST</th><th style={{ textAlign: 'right' }}>SGST</th></tr></thead>
                <tbody>
                  <tr><td className="font-medium">(A) ITC Available — All other ITC</td><td style={{ textAlign: 'right' }}>{formatCurrency(itcFromExpenses.igst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(itcFromExpenses.cgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(itcFromExpenses.sgst)}</td></tr>
                  <tr className="font-bold"><td>Net ITC Available</td><td style={{ textAlign: 'right' }}>{formatCurrency(itcFromExpenses.igst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(itcFromExpenses.cgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(itcFromExpenses.sgst)}</td></tr>
                </tbody>
              </table>
            </div>
            <p className="field-hint" style={{ padding: '0.75rem 1.25rem' }}>
              ITC calculated from Expense Tracker and Purchase Bills entries with GST. Verify against GSTR-2B on the GST portal for actual eligible ITC.
            </p>
          </div>

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
