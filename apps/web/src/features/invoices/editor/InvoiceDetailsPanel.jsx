import { Check } from 'lucide-react';
import { getStatesForCountry, ORDER_DETAIL_FIELDS } from '../../../utils';

// The number, date, due date and place of supply.
export default function InvoiceDetailsPanel({
  details, invoiceOptions, invoiceType, profile, setDetails,
}) {
  return (
          <div className="glass-panel p-6 mb-6">
            <h3 className="section-title">Invoice Details</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group">
                <label className="form-label">Invoice Number</label>
                <input type="text" className="form-input" value={details.invoiceNumber}
                  onChange={(e) => setDetails({ ...details, invoiceNumber: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Invoice Date</label>
                <input type="date" className="form-input" value={details.invoiceDate}
                  onChange={(e) => setDetails({ ...details, invoiceDate: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Due Date</label>
                <input type="date" className="form-input" value={details.dueDate}
                  onChange={(e) => setDetails({ ...details, dueDate: e.target.value })} />
              </div>
              {invoiceOptions.showPlaceOfSupply && (() => {
                const posOpts = getStatesForCountry(profile?.country);
                return (
                  <div className="form-group">
                    <label className="form-label">Place of Supply</label>
                    {posOpts.length > 0 ? (
                      <select className="form-input" value={details.placeOfSupply}
                        onChange={(e) => setDetails({ ...details, placeOfSupply: e.target.value })}>
                        <option value="">Defaults to Client State</option>
                        {posOpts.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <input type="text" className="form-input" value={details.placeOfSupply}
                        onChange={(e) => setDetails({ ...details, placeOfSupply: e.target.value })} placeholder="State / Region" />
                    )}
                  </div>
                );
              })()}
              {invoiceType === 'credit-note' && (
                <div className="form-group full-width">
                  <label className="form-label">Original Invoice Reference</label>
                  <input type="text" className="form-input" value={details.originalInvoiceRef}
                    onChange={(e) => setDetails({ ...details, originalInvoiceRef: e.target.value })} placeholder="e.g. INV/2025-26/0001" />
                </div>
              )}

              {/* v1.10.11 — Ship-to = Bill-to checkbox. When unchecked,
                   4 shipping fields appear. Rendered next to the billing
                   block in the PDF preview. */}
              <div className="form-group full-width" style={{ marginTop: '0.5rem', padding: '0.6rem 0.85rem', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', userSelect: 'none', fontSize: '0.88rem' }}>
                  <input type="checkbox" checked={details.shipToSameAsBilling !== false}
                    onChange={e => setDetails({ ...details, shipToSameAsBilling: e.target.checked })}
                    style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
                  <span><strong>Ship to</strong> same as bill-to address</span>
                </label>
                {details.shipToSameAsBilling === false && (
                  <div className="grid grid-cols-2 gap-3" style={{ marginTop: '0.6rem' }}>
                    <div className="form-group full-width">
                      <label className="form-label" style={{ fontSize: '0.78rem' }}>Shipping Address</label>
                      <textarea className="form-input" rows={2} value={details.shippingAddress || ''}
                        onChange={e => setDetails({ ...details, shippingAddress: e.target.value })}
                        placeholder="Delivery address / warehouse / consignee location" />
                    </div>
                    <div className="form-group">
                      <label className="form-label" style={{ fontSize: '0.78rem' }}>Shipping City</label>
                      <input type="text" className="form-input" value={details.shippingCity || ''}
                        onChange={e => setDetails({ ...details, shippingCity: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label className="form-label" style={{ fontSize: '0.78rem' }}>Shipping PIN</label>
                      <input type="text" className="form-input" value={details.shippingPin || ''}
                        onChange={e => setDetails({ ...details, shippingPin: e.target.value })}
                        placeholder="6-digit PIN" maxLength={6} />
                    </div>
                    <div className="form-group full-width">
                      <label className="form-label" style={{ fontSize: '0.78rem' }}>Shipping State</label>
                      {(() => {
                        const posOpts = getStatesForCountry(profile?.country);
                        return posOpts.length > 0 ? (
                          <select className="form-input" value={details.shippingState || ''}
                            onChange={e => setDetails({ ...details, shippingState: e.target.value })}>
                            <option value="">Same as billing state</option>
                            {posOpts.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        ) : (
                          <input type="text" className="form-input" value={details.shippingState || ''}
                            onChange={e => setDetails({ ...details, shippingState: e.target.value })}
                            placeholder="Delivery state / region" />
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>

              {/* v1.10.73 - order, dispatch and reference details: the boxes on a
                  Tally-style invoice. Optional; closed unless one is filled. */}
              {(() => {
                const filled = ORDER_DETAIL_FIELDS.filter(f => String(details[f.key] || '').trim()).length;
                const periodBackwards = details.periodFrom && details.periodTo && details.periodTo < details.periodFrom;
                return (
                  <details className="form-group full-width" open={filled > 0 || undefined}
                    style={{ padding: '0.6rem 0.85rem', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                    <summary style={{ cursor: 'pointer', fontSize: '0.88rem', userSelect: 'none' }}>
                      <strong>Order, dispatch &amp; reference details</strong>
                      <span style={{ color: 'var(--text-muted)' }}> (optional{filled ? `, ${filled} filled` : ''}) - buyer's order no, vehicle no, service period, work details</span>
                    </summary>
                    <div className="grid grid-cols-2 gap-3" style={{ marginTop: '0.6rem' }}>
                      {ORDER_DETAIL_FIELDS.map(f => (
                        <div key={f.key} className={`form-group${f.wide ? ' full-width' : ''}`}>
                          <label className="form-label" style={{ fontSize: '0.78rem' }}>{f.label}</label>
                          <input type={f.type || 'text'} className="form-input" value={details[f.key] || ''}
                            placeholder={f.placeholder || ''}
                            onChange={e => setDetails({ ...details, [f.key]: e.target.value })} />
                        </div>
                      ))}
                    </div>
                    {periodBackwards && (
                      <p style={{ margin: '0.4rem 0 0', fontSize: '0.78rem', color: 'var(--warn-text, #b45309)' }}>
                        ⚠ The service period ends before it starts. Check the two dates.
                      </p>
                    )}
                  </details>
                );
              })()}
            </div>
          </div>
  );
}
