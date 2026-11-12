import { currencySymbolFor } from './editorConstants';
import { useAppSettings } from '../../../lib/appSettings';
import { discountRules } from './settingsDefaults';
import { useState } from 'react';
import { offerFor } from './offers';
import { toast } from '../../../components/ui/Toast';

// The whole-bill discount (a fixed amount or a percent of the total, applied after tax) under the line items (change 3.9).
export default function DiscountControls({ invoiceOptions, setInvoiceOptions, clampNonNeg, billTotal = 0, billDate = '' }) {
  const appSettings = useAppSettings();
  const rules = discountRules(appSettings); // Settings > Transaction > Discount mode and unit
  const [code, setCode] = useState(invoiceOptions.offerCode || '');
  const coupons = appSettings['offer.coupons'] || [];
  if (!rules.bill) return null;
  // Settings > Party > Offer codes: the code's discount becomes the whole-bill discount, and the code is kept on the bill.
  const applyOffer = () => {
    const before = Number(billTotal) || 0;
    const r = offerFor(code, coupons, { date: billDate, total: before });
    if (!r.ok) { toast(r.message, 'warning'); return; }
    setInvoiceOptions((prev) => ({ ...prev, offerCode: r.code, invoiceDiscountType: r.type, invoiceDiscountValue: r.value }));
    toast(`Offer ${r.code} applied`, 'success');
  };
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
                {rules.amount && <option value="fixed">{currencySymbolFor(invoiceOptions.currency)} (fixed)</option>}
                {rules.percent && <option value="percent">% of total</option>}
              </select>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Applied after tax. For GST-compliant pre-tax discount, use per-line discount instead.
              </span>
            </div>
            {coupons.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: '0.5rem', flexWrap: 'wrap' }}>
                <label htmlFor="offer-code" style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Offer code</label>
                <input id="offer-code" className="form-input" style={{ width: 140, textTransform: 'uppercase' }} value={code}
                  onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyOffer(); } }} />
                <button type="button" className="btn btn-secondary" onClick={applyOffer}>Apply</button>
                {invoiceOptions.offerCode && (
                  <button type="button" className="btn btn-secondary" onClick={() => { setCode(''); setInvoiceOptions((prev) => ({ ...prev, offerCode: undefined, invoiceDiscountValue: 0 })); }}>
                    Remove {invoiceOptions.offerCode}
                  </button>
                )}
              </div>
            )}
    </>
  );
}
