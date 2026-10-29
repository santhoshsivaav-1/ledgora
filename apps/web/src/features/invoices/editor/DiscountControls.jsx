import { currencySymbolFor } from './editorConstants';

// The whole-bill discount (a fixed amount or a percent of the total, applied after tax) under the line items (change 3.9).
export default function DiscountControls({ invoiceOptions, setInvoiceOptions, clampNonNeg }) {
  return (
    <>
            {/* v1.10.22 — invoice-level (whole-bill) discount. Sits below
                the line items so it reads as "…and then take X off the
                whole bill". Zero value = no line renders in the preview. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: '0.75rem', flexWrap: 'wrap' }}>
              <label style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Discount on total (whole bill)</label>
              <input type="number" min="0" step="any" className="form-input"
                value={invoiceOptions.invoiceDiscountValue || ''}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setInvoiceOptions(prev => ({ ...prev, invoiceDiscountValue: clampNonNeg(e.target.value) }))}
                style={{ width: 100 }} placeholder="0" />
              <select className="form-input"
                value={invoiceOptions.invoiceDiscountType === 'percent' ? 'percent' : 'fixed'}
                onChange={(e) => setInvoiceOptions(prev => ({ ...prev, invoiceDiscountType: e.target.value }))}
                style={{ width: 128 }}>
                <option value="fixed">{currencySymbolFor(invoiceOptions.currency)} (fixed)</option>
                <option value="percent">% of total</option>
              </select>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Applied after tax. For GST-compliant pre-tax discount, use per-line discount instead.
              </span>
            </div>
    </>
  );
}
