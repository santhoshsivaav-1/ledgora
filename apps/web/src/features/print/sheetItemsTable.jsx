import { formatQty } from '../../utils';
import ItemSubLines from './ItemSubLines';

// Sheet-layout items table (moved out of InvoicePreview.jsx with explicit
// props — markup unchanged, including the IGST / CGST+SGST / foreign
// single-tax column variants and the no-GST plain table).
//
// Props:
//   items / totals                          — invoice data
//   showGST / isIndia / isInterstate        — tax context
//   showHSN / showItemQty / showItemUnit /
//   showRateColumn                          — column toggles
//   hasAnyDiscount                          — whether any line carries a discount
//   taxLabel                                — seller country's tax label (VAT etc.)
//   lineCalc(item)                          — shared per-line tax math (see invoiceLines.js)
//   fmt(amount)                             — currency formatter
//   rateText(rate)                          — rate cell text (exempt label aware)
//   pdfStyle                                — template style (drives table margins)
export default function ItemsTable({
  items, totals, showGST, isIndia, isInterstate,
  showHSN, showItemQty, showItemUnit, showRateColumn,
  hasAnyDiscount, taxLabel, lineCalc, fmt, rateText, pdfStyle,
}) {
  return (
    <table className="inv-table" style={{ tableLayout: 'auto', ...(pdfStyle === 'modern' ? { margin: '0 2rem', width: 'calc(100% - 4rem)' } : pdfStyle === 'minimal' ? { margin: '0 2rem', width: 'calc(100% - 4rem)', borderTop: 'none' } : {}) }}>
      <thead>
        {showGST ? (
          isIndia && isInterstate ? (
            <>
              <tr>
                <th className="inv-th" rowSpan="2">#</th>
                <th className="inv-th" rowSpan="2">Description</th>
                {showHSN && <th className="inv-th inv-th-center" rowSpan="2">HSN/SAC</th>}
                {showItemQty && <th className="inv-th inv-th-center" rowSpan="2">Qty</th>}
                {showRateColumn && <th className="inv-th inv-th-right" rowSpan="2">Rate</th>}
                {hasAnyDiscount && <th className="inv-th inv-th-right" rowSpan="2">Disc.</th>}
                <th className="inv-th inv-th-center" colSpan="2" style={{ borderBottom: '1px solid #cbd5e1' }}>IGST</th>
                <th className="inv-th inv-th-right" rowSpan="2">Amount</th>
              </tr>
              <tr>
                <th className="inv-th inv-th-center">%</th>
                <th className="inv-th inv-th-right">Amt</th>
              </tr>
            </>
          ) : isIndia ? (
            <>
              <tr>
                <th className="inv-th" rowSpan="2">#</th>
                <th className="inv-th" rowSpan="2">Description</th>
                {showHSN && <th className="inv-th inv-th-center" rowSpan="2">HSN/SAC</th>}
                {showItemQty && <th className="inv-th inv-th-center" rowSpan="2">Qty</th>}
                {showRateColumn && <th className="inv-th inv-th-right" rowSpan="2">Rate</th>}
                {hasAnyDiscount && <th className="inv-th inv-th-right" rowSpan="2">Disc.</th>}
                <th className="inv-th inv-th-center" colSpan="2" style={{ borderBottom: '1px solid #cbd5e1' }}>CGST</th>
                <th className="inv-th inv-th-center" colSpan="2" style={{ borderBottom: '1px solid #cbd5e1' }}>{totals.isIntraUT ? 'UTGST' : 'SGST'}</th>
                <th className="inv-th inv-th-right" rowSpan="2">Amount</th>
              </tr>
              <tr>
                <th className="inv-th inv-th-center">%</th>
                <th className="inv-th inv-th-right">Amt</th>
                <th className="inv-th inv-th-center">%</th>
                <th className="inv-th inv-th-right">Amt</th>
              </tr>
            </>
          ) : (
            // Foreign: single tax column (VAT/SST/etc.) — no CGST/SGST/IGST split
            <>
              <tr>
                <th className="inv-th" rowSpan="2">#</th>
                <th className="inv-th" rowSpan="2">Description</th>
                {showHSN && <th className="inv-th inv-th-center" rowSpan="2">HSN/SAC</th>}
                {showItemQty && <th className="inv-th inv-th-center" rowSpan="2">Qty</th>}
                {showRateColumn && <th className="inv-th inv-th-right" rowSpan="2">Rate</th>}
                {hasAnyDiscount && <th className="inv-th inv-th-right" rowSpan="2">Disc.</th>}
                <th className="inv-th inv-th-center" colSpan="2" style={{ borderBottom: '1px solid #cbd5e1' }}>{taxLabel}</th>
                <th className="inv-th inv-th-right" rowSpan="2">Amount</th>
              </tr>
              <tr>
                <th className="inv-th inv-th-center">%</th>
                <th className="inv-th inv-th-right">Amt</th>
              </tr>
            </>
          )
        ) : (
          <tr>
            <th className="inv-th">#</th>
            <th className="inv-th">Description</th>
            {showHSN && <th className="inv-th inv-th-center">HSN/SAC</th>}
            {showItemQty && <th className="inv-th inv-th-center">Qty</th>}
            {showRateColumn && <th className="inv-th inv-th-right">Rate</th>}
            {hasAnyDiscount && <th className="inv-th inv-th-right">Disc.</th>}
            <th className="inv-th inv-th-right">Amount</th>
          </tr>
        )}
      </thead>
      <tbody>
        {items.map((item, index) => {
          // Shared with the grid designs and the HSN summary (lineCalc).
          const { discount, taxable: afterDiscount, tax: taxAmount, rate: taxRate } = lineCalc(item);
          const halfRate = taxRate / 2;
          const halfTax = taxAmount / 2;
          return (
            <tr key={item.id ?? index} className={index % 2 === 0 ? 'inv-tr-even' : ''}>
              <td className="inv-td inv-td-muted">{index + 1}</td>
              <td className="inv-td inv-td-name">
                {item.name || '-'}
                {/* v1.10.22 — optional per-line description shown under the
                    name in a smaller, muted font. Renders only when set so
                    pre-existing invoices without a description look
                    identical. */}
                <ItemSubLines item={item} fmt={fmt} style={{ fontSize: '0.78em', color: '#475569', marginTop: 2 }} />
              </td>
              {showHSN && <td className="inv-td inv-td-center inv-td-muted">{item.hsn || '-'}</td>}
              {showItemQty && <td className="inv-td inv-td-center">{formatQty(item.quantity)}{showItemUnit && item.unit ? ` ${item.unit}` : ''}</td>}
              {showRateColumn && <td className="inv-td inv-td-right">{fmt(item.rate)}</td>}
              {hasAnyDiscount && <td className="inv-td inv-td-right">{discount > 0 ? fmt(discount) : '-'}</td>}
              {showGST && (
                isIndia && isInterstate ? (
                  <>
                    <td className="inv-td inv-td-center">{rateText(taxRate)}</td>
                    <td className="inv-td inv-td-right">{fmt(taxAmount)}</td>
                  </>
                ) : isIndia ? (
                  <>
                    <td className="inv-td inv-td-center">{rateText(halfRate)}</td>
                    <td className="inv-td inv-td-right">{fmt(halfTax)}</td>
                    <td className="inv-td inv-td-center">{rateText(halfRate)}</td>
                    <td className="inv-td inv-td-right">{fmt(halfTax)}</td>
                  </>
                ) : (
                  <>
                    <td className="inv-td inv-td-center">{rateText(taxRate)}</td>
                    <td className="inv-td inv-td-right">{fmt(taxAmount)}</td>
                  </>
                )
              )}
              <td className="inv-td inv-td-right inv-td-amount">{fmt(afterDiscount)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
