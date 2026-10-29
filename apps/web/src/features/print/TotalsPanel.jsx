import { printedSubtotal } from '../../utils';
import { getLabel } from './printSettingsStore';
import TaxSummary from './TaxSummary';

// The totals box at the foot of the invoice: subtotal, discount, tax, round-off and the amount due (change 3.9).
export default function TotalsPanel({
  _ps_labels, accent, fmt, invoiceType, isIndia, isInterstate, options, pdfStyle, showGST, showSubtotal, taxLabel, totalDueLabel, totals,
}) {
  return (
        <div className="inv-totals">
          {showSubtotal && (
            <div className="inv-total-row">
              {/* v1.10.74 - Subtotal / Total Due / Authorized Signatory now follow the label language. */}
              <span>{getLabel(_ps_labels, 'subtotal')}</span>
              <span>{fmt(printedSubtotal(totals))}</span>
            </div>
          )}
          {totals.totalDiscount > 0 && (
            <div className="inv-total-row" style={{ color: '#dc2626' }}>
              <span>Discount</span>
              <span>- {fmt(totals.totalDiscount)}</span>
            </div>
          )}
          <TaxSummary
            fmt={fmt}
            isIndia={isIndia}
            isInterstate={isInterstate}
            showGST={showGST}
            taxLabel={taxLabel}
            totals={totals}
          />
          {totals.cess > 0 && (
            <div className="inv-total-row">
              <span>GST Cess</span>
              <span>{fmt(totals.cess)}</span>
            </div>
          )}
          {totals.tcsAmount > 0 && (
            <div className="inv-total-row">
              <span>TCS{options.tcsSection ? ` (${options.tcsSection} @ ${options.tcsRate}%)` : ''}</span>
              <span>{fmt(totals.tcsAmount)}</span>
            </div>
          )}
          {/* v1.10.22 — invoice-level (post-tax) discount, if any. */}
          {totals.invoiceDiscountAmount > 0 && (
            <div className="inv-total-row" style={{ color: '#dc2626' }}>
              <span>
                Discount on total
                {totals.invoiceDiscountType === 'percent' && totals.invoiceDiscountValue > 0
                  ? ` (${totals.invoiceDiscountValue}%)`
                  : ''}
              </span>
              <span>−{fmt(totals.invoiceDiscountAmount)}</span>
            </div>
          )}
          {totals.roundOff !== undefined && totals.roundOff !== 0 && (
            <div className="inv-total-row" style={{ color: '#64748b', fontStyle: 'italic' }}>
              <span>Round-off</span>
              <span>{totals.roundOff > 0 ? '+' : ''}{fmt(totals.roundOff)}</span>
            </div>
          )}
          {pdfStyle === 'modern' ? (
            <div className="inv-total-row inv-total-final inv-total-modern" style={{ background: accent, color: '#fff', borderRadius: '6px', padding: '0.6rem 0.75rem', marginTop: '0.25rem' }}>
              <span style={{ color: '#fff' }}>{invoiceType === 'credit-note' ? 'Credit Amount' : totalDueLabel}</span>
              <span style={{ color: '#fff' }}>{fmt(totals.total)}</span>
            </div>
          ) : (
            <div className="inv-total-row inv-total-final">
              <span>{invoiceType === 'credit-note' ? 'Credit Amount' : totalDueLabel}</span>
              <span style={{ color: accent }}>{fmt(totals.total)}</span>
            </div>
          )}
          {totals.tdsAmount > 0 && (
            <>
              <div className="inv-total-row" style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '0.25rem', borderTop: '1px dashed #e2e8f0', paddingTop: '0.4rem' }}>
                <span>Less: TDS{options.tdsSection ? ` (${options.tdsSection} @ ${options.tdsRate}%)` : ''}</span>
                <span>− {fmt(totals.tdsAmount)}</span>
              </div>
              <div className="inv-total-row" style={{ fontWeight: 600, color: '#0f766e', fontSize: '0.78rem' }}>
                <span>Net Receivable</span>
                <span>{fmt(totals.netReceivable)}</span>
              </div>
            </>
          )}
        </div>
  );
}
