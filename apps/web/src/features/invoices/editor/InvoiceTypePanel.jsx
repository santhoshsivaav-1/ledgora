import { Settings } from 'lucide-react';
import { getRegionMode } from '../../../lib/data';
import { INVOICE_TYPES, getCountriesForRegion, TDS_SECTIONS, TCS_SECTIONS, REMOVED_TCS_SECTIONS, getActiveAccounts, getAccountById, PAPER_SIZES, getPaperSize, invoiceOptionOn, DEFAULT_DECLARATION, localToday, toLocalIsoDate, parseLocalDate } from '../../../utils';
import InvoicePreview from '../../print/InvoicePreview';
import { ACCENT_PRESETS, DEFAULT_OPTIONS, PDF_STYLES } from './editorConstants';
import DocFlowTracker from '../../sales/DocFlowTracker';

// Which document this is (tax invoice, quotation, credit note, ...), and goods or services.
export default function InvoiceTypePanel({
  details, handleTypeChange, invoiceOptions, invoiceType, isIssuedInvoice, profile, setInvoiceOptions, showOptions, toggleOption, typeConfig, lockedType = false, sourceDoc = null,
}) {
  return (
          <div className="glass-panel p-6 mb-6">
            {/* v1.10.69 (#71 item 1) - Customize moved up to the sticky
                toolbar. Two buttons doing the same thing would only raise the
                question of whether they do. */}
            {lockedType ? (
              /* Opened from a sales page: the document type is already chosen, so there is no list of types to pick from. */
              <>
                <h3 className="section-title" style={{ margin: 0 }}>{typeConfig?.label || 'Document'}</h3>
                <p className="type-desc" style={{ marginBottom: '0.6rem' }}>{typeConfig?.description}</p>
                <DocFlowTracker type={invoiceType} sourceDoc={sourceDoc} />
              </>
            ) : (
              <>
            <div className="flex justify-between items-center">
                <h3 className="section-title" style={{ margin: 0 }}>Invoice Type</h3>
              </div>
              <div className="type-selector" style={{ marginTop: '0.75rem' }}>
                {Object.entries(INVOICE_TYPES).map(([key, val]) => (
                  <button key={key} type="button"
                    className={`type-chip ${invoiceType === key ? 'type-chip-active' : ''}`}
                    disabled={isIssuedInvoice && invoiceType !== key}
                    title={isIssuedInvoice ? 'The type cannot change once an invoice is saved. Duplicate it to make a different document.' : val.description}
                    onClick={() => handleTypeChange(key)}>{val.label}</button>
                ))}
              </div>
              {isIssuedInvoice && (
                <p className="type-desc" style={{ color: 'var(--text-muted)' }}>
                  Saved as a {typeConfig?.label || invoiceType}. The type stays fixed so the number series and tax treatment keep matching what the customer already has - use Duplicate to raise a different document.
                </p>
              )}
              <p className="type-desc">{typeConfig?.description}</p>
  
                </>
            )}

            {/* Goods / Services / Mixed selector — drives default line-item unit
                (Hrs vs Nos) and filters the unit dropdown. Stays out of the way
                for users who never touch services. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginRight: '0.25rem' }}>This invoice is for:</span>
              {[
                { id: 'goods',    label: '📦 Goods',    desc: 'Physical products — defaults to Nos / Kg / Pcs units' },
                { id: 'services', label: '⏱ Services', desc: 'Time / work-based — defaults to Hrs and surfaces Session / Visit / Month units' },
                { id: 'mixed',    label: '🔀 Mixed',   desc: 'Both — full unit list available, no filtering' },
              ].map(opt => (
                <button key={opt.id} type="button"
                  className={`type-chip ${(invoiceOptions.invoiceMode || 'goods') === opt.id ? 'type-chip-active' : ''}`}
                  onClick={() => setInvoiceOptions(prev => ({ ...prev, invoiceMode: opt.id }))}
                  title={opt.desc}
                  style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}>
                  {opt.label}
                </button>
              ))}
              {invoiceOptions.invoiceMode === 'services' && (
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  💡 Use a <strong>SAC code</strong> (services accounting code) in the HSN field
                </span>
              )}
            </div>

            {/* Customization Options */}
            {showOptions && (
              <div className="invoice-options">
                <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                  <label className="form-label">Invoice Title</label>
                  <input type="text" className="form-input" value={invoiceOptions.customTitle}
                    onChange={(e) => setInvoiceOptions(prev => ({ ...prev, customTitle: e.target.value }))}
                    placeholder={typeConfig?.title || 'TAX INVOICE'} />
                </div>
                <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                  <label className="form-label">Currency</label>
                  <select className="form-input" value={invoiceOptions.currency}
                    onChange={(e) => setInvoiceOptions(prev => ({ ...prev, currency: e.target.value }))}>
                    {/* Deduped currencies pulled from the region-filtered country list. */}
                    {Array.from(new Map(getCountriesForRegion(getRegionMode()).map(c => [c.currency, c])).values()).map(c => (
                      <option key={c.currency} value={c.currency}>{c.currency} ({c.currencySymbol === c.currency ? c.name : c.currencySymbol})</option>
                    ))}
                  </select>
                </div>
                {invoiceOptions.currency !== 'INR' && (
                  <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                    <label className="form-label">Exchange Rate (optional, snapshot)</label>
                    <input type="number" step="any" min="0" className="form-input"
                      value={invoiceOptions.exchangeRate}
                      onChange={(e) => setInvoiceOptions(prev => ({ ...prev, exchangeRate: e.target.value }))}
                      placeholder={`1 ${invoiceOptions.currency} = ? INR`} />
                    <small style={{ color: '#94a3b8', fontSize: '0.7rem' }}>Stored on this invoice — historical reports stay accurate even if rates change.</small>
                  </div>
                )}

                {/* Inline recurring — turn any invoice into a recurring template
                    without leaving the form. On save, this writes both the
                    invoice AND a recurring template the server auto-fires on
                    schedule. Edit/cancel the template later via the Recurring
                    Invoices view in the sidebar. */}
                {(() => {
                  const rec = invoiceOptions.recurring;
                  const isOn = !!rec?.enabled;
                  const toggle = () => {
                    if (isOn) {
                      setInvoiceOptions(prev => ({ ...prev, recurring: { ...prev.recurring, enabled: false } }));
                    } else {
                      // One month after the invoice date, kept inside the
                      // month (31 Jan -> 28 Feb, not 3 Mar) and as a local date.
                      const from = parseLocalDate(details.invoiceDate || localToday());
                      const next = new Date(from.getFullYear(), from.getMonth() + 1, 1);
                      next.setDate(Math.min(from.getDate(), new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
                      setInvoiceOptions(prev => ({
                        ...prev,
                        recurring: {
                          enabled: true,
                          frequency: 'monthly',
                          interval: 1,
                          nextDate: toLocalIsoDate(next),
                          endMode: 'never',
                          endDate: '',
                          maxOccurrences: '',
                        },
                      }));
                    }
                  };
                  const set = (key, val) => setInvoiceOptions(prev => ({
                    ...prev, recurring: { ...prev.recurring, [key]: val },
                  }));
                  return (
                    <div className={`form-group${isOn ? ' notice notice-info' : ''}`} style={{ marginBottom: '0.75rem', padding: '0.6rem', borderRadius: '6px', display: 'block' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', cursor: 'pointer' }}>
                        <input type="checkbox" checked={isOn} onChange={toggle}
                          style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
                        <strong>🔁 Make this a recurring invoice</strong>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          (auto-generate a new invoice on schedule, same items, new number)
                        </span>
                      </label>
                      {isOn && (
                        <div style={{ marginTop: '0.6rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Frequency</label>
                            <select className="form-input" value={rec.frequency}
                              onChange={e => set('frequency', e.target.value)}>
                              <option value="weekly">Weekly</option>
                              <option value="monthly">Monthly</option>
                              <option value="quarterly">Quarterly</option>
                              <option value="yearly">Yearly</option>
                            </select>
                          </div>
                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Every N (interval)</label>
                            <input type="number" min="1" max="12" className="form-input"
                              value={rec.interval || 1}
                              onChange={e => set('interval', parseInt(e.target.value) || 1)} />
                          </div>
                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Next invoice date</label>
                            <input type="date" className="form-input" value={rec.nextDate || ''}
                              onChange={e => set('nextDate', e.target.value)} />
                          </div>
                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">End condition</label>
                            <select className="form-input" value={rec.endMode || 'never'}
                              onChange={e => set('endMode', e.target.value)}>
                              <option value="never">Never (until I stop it)</option>
                              <option value="onDate">On a specific date</option>
                              <option value="afterN">After N invoices</option>
                            </select>
                          </div>
                          {rec.endMode === 'onDate' && (
                            <div className="form-group" style={{ margin: 0, gridColumn: 'span 2' }}>
                              <label className="form-label">Stop generating after this date</label>
                              <input type="date" className="form-input" value={rec.endDate || ''}
                                onChange={e => set('endDate', e.target.value)} />
                            </div>
                          )}
                          {rec.endMode === 'afterN' && (
                            <div className="form-group" style={{ margin: 0, gridColumn: 'span 2' }}>
                              <label className="form-label">Stop after this many invoices have been generated</label>
                              <input type="number" min="1" className="form-input"
                                value={rec.maxOccurrences || ''}
                                onChange={e => set('maxOccurrences', parseInt(e.target.value) || '')}
                                placeholder="e.g. 12 for a 1-year monthly contract" />
                            </div>
                          )}
                          <div style={{ gridColumn: 'span 2', fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                            Auto-generation fires every time you open the app (or daily if it stays running).
                            Future invoices get fresh sequential numbers, today's date as their invoice date,
                            and the same client + items + amounts as this one. Edit or pause the template any
                            time via <strong>Recurring</strong> in the sidebar.
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* TCS — collected by seller, ADDS to total (Section 206C, Income Tax Act) */}
                {(profile?.country || 'India') === 'India' && (
                  <div className={`form-group${invoiceOptions.showTCS ? ' notice notice-warn' : ''}`} style={{ marginBottom: '0.75rem', padding: '0.6rem', borderRadius: '6px', display: 'block' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!invoiceOptions.showTCS}
                        onChange={() => setInvoiceOptions(prev => {
                          // Turning TCS on for an invoice whose remembered section can no
                          // longer be chosen (206C(1H)) starts from the first current one.
                          const turningOn = !prev.showTCS;
                          const valid = TCS_SECTIONS.some(s => s.code === prev.tcsSection);
                          return turningOn && !valid
                            ? { ...prev, showTCS: true, tcsSection: TCS_SECTIONS[0].code, tcsRate: TCS_SECTIONS[0].rate }
                            : { ...prev, showTCS: turningOn };
                        })}
                        style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
                      <strong>TCS — Tax Collected at Source</strong>
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>(Adds to invoice total)</span>
                    </label>
                    {invoiceOptions.showTCS && (
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <select className="form-input" value={invoiceOptions.tcsSection || TCS_SECTIONS[0].code}
                          onChange={(e) => {
                            const code = e.target.value;
                            const section = TCS_SECTIONS.find(s => s.code === code);
                            setInvoiceOptions(prev => ({ ...prev, tcsSection: code, tcsRate: code === 'custom' ? prev.tcsRate : section?.rate ?? prev.tcsRate }));
                          }}>
                          {REMOVED_TCS_SECTIONS[invoiceOptions.tcsSection] && (
                            <option value={invoiceOptions.tcsSection} disabled>{REMOVED_TCS_SECTIONS[invoiceOptions.tcsSection]}</option>
                          )}
                          {TCS_SECTIONS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                        </select>
                        <input type="number" step="any" min="0" max="100" className="form-input"
                          value={invoiceOptions.tcsRate}
                          onChange={(e) => setInvoiceOptions(prev => ({ ...prev, tcsRate: e.target.value }))}
                          placeholder="Rate %" />
                      </div>
                    )}
                  </div>
                )}

                {/* TDS — deducted by buyer from payment, INFORMATIONAL on invoice */}
                {(profile?.country || 'India') === 'India' && (
                  <div className={`form-group${invoiceOptions.showTDS ? ' notice notice-info' : ''}`} style={{ marginBottom: '0.75rem', padding: '0.6rem', borderRadius: '6px', display: 'block' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!invoiceOptions.showTDS}
                        onChange={() => setInvoiceOptions(prev => ({ ...prev, showTDS: !prev.showTDS }))}
                        style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
                      <strong>TDS — Tax Deducted at Source</strong>
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>(Buyer deducts; informational)</span>
                    </label>
                    {invoiceOptions.showTDS && (
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <select className="form-input" value={invoiceOptions.tdsSection || '194Q'}
                          onChange={(e) => {
                            const code = e.target.value;
                            const section = TDS_SECTIONS.find(s => s.code === code);
                            setInvoiceOptions(prev => ({ ...prev, tdsSection: code, tdsRate: code === 'custom' ? prev.tdsRate : section?.rate ?? prev.tdsRate }));
                          }}>
                          {TDS_SECTIONS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                        </select>
                        <input type="number" step="any" min="0" max="100" className="form-input"
                          value={invoiceOptions.tdsRate}
                          onChange={(e) => setInvoiceOptions(prev => ({ ...prev, tdsRate: e.target.value }))}
                          placeholder="Rate %" />
                      </div>
                    )}
                  </div>
                )}
                {/* Payment account picker — lists the active business profile's active
                    accounts. Hidden when the profile has 0 accounts (preserves v1.4.3
                    "no bank block" behaviour). Stored as invoiceOptions.selectedAccountId
                    so re-opening the invoice produces the same PDF. */}
                {(() => {
                  const accounts = getActiveAccounts(profile);
                  if (accounts.length === 0) return null;
                  const resolved = getAccountById(profile, invoiceOptions.selectedAccountId);
                  return (
                    <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                      <label className="form-label">Payment account on this invoice</label>
                      <select className="form-input" value={resolved?.id || ''}
                        onChange={(e) => {
                          // v1.10.21 — reported: "working but on select it is not
                          // changing have to save and reopen it". Cause: the
                          // preview reads options.paymentAccountSnapshot first
                          // (bank frozen at the last save). Picking a new
                          // account from the dropdown only updated
                          // selectedAccountId, so the preview kept showing the
                          // old snapshot until save+reopen re-snapshotted. Fix:
                          // resnap immediately from the LIVE profile when the
                          // user picks a different account so the preview
                          // reflects the new bank without a round trip.
                          const newId = e.target.value || null;
                          const newSnap = newId ? getAccountById(profile, newId) : null;
                          setInvoiceOptions(prev => ({ ...prev, selectedAccountId: newId, paymentAccountSnapshot: newSnap }));
                        }}>
                        {accounts.map(a => (
                          <option key={a.id} value={a.id}>
                            {a.isDefault ? '⭐ ' : ''}{a.label || a.bankName || 'Untitled account'}
                            {a.bankName && a.label !== a.bankName ? ` — ${a.bankName}` : ''}
                          </option>
                        ))}
                      </select>
                      <small style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                        Bank details and UPI QR on the PDF come from the selected account.
                        Manage accounts in Settings → Payment Accounts.
                      </small>
                    </div>
                  );
                })()}
                <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                  <label className="form-label">PDF Style</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {PDF_STYLES.map(s => (
                      <button key={s.id} type="button"
                        className={`type-chip ${(invoiceOptions.pdfStyle || 'classic') === s.id ? 'type-chip-active' : ''}`}
                        onClick={() => setInvoiceOptions(prev => ({ ...prev, pdfStyle: s.id }))}
                        title={s.desc}>{s.label}</button>
                    ))}
                  </div>
                </div>
                <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                  <label className="form-label">Accent Color</label>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <button type="button" title="Auto (match invoice type)"
                      style={{ width: '28px', height: '28px', borderRadius: '50%', border: !invoiceOptions.accentColor ? '2.5px solid #334155' : '2px solid #cbd5e1', background: 'conic-gradient(#1e40af, #7c3aed, #0f766e, #be123c, #1e40af)', cursor: 'pointer', position: 'relative' }}
                      onClick={() => setInvoiceOptions(prev => ({ ...prev, accentColor: '' }))}>
                      {!invoiceOptions.accentColor && <span style={{ position: 'absolute', inset: '3px', borderRadius: '50%', border: '2px solid white' }} />}
                    </button>
                    {ACCENT_PRESETS.map(p => (
                      <button key={p.color} type="button" title={p.label}
                        style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: p.color, border: invoiceOptions.accentColor === p.color ? '2.5px solid #334155' : '2px solid #cbd5e1', cursor: 'pointer', position: 'relative' }}
                        onClick={() => setInvoiceOptions(prev => ({ ...prev, accentColor: p.color }))}>
                        {invoiceOptions.accentColor === p.color && <span style={{ position: 'absolute', inset: '3px', borderRadius: '50%', border: '2px solid white' }} />}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Field-level toggles, grouped. Lets the user hide any default field on the
                    PDF without losing the data on the invoice itself. */}
                {[
                  { group: 'Header & branding', items: [
                    ['showLogo', 'Logo'],
                    ['showBusinessName', 'Business name'],
                    ['showBusinessAddress', 'Business address'],
                    ['showBusinessPhone', 'Business phone'],
                    ['showBusinessEmail', 'Business email'],
                    ['showState', 'Business state'],
                    ['showGSTIN', 'Tax ID (GSTIN/VAT/etc.)'],
                  ]},
                  { group: 'Client / Bill-to', items: [
                    ['showClientAddress', 'Client address'],
                    ['showClientPhone', 'Client phone'],
                    ['showClientEmail', 'Client email'],
                    ['showPlaceOfSupply', 'Place of Supply'],
                  ]},
                  { group: 'Invoice meta', items: [
                    ['showInvoiceNumber', 'Invoice number'],
                    ['showInvoiceDate', 'Invoice date'],
                    ['showDueDate', 'Due date'],
                  ]},
                  { group: 'Items table', items: [
                    ['showHSN', 'HSN/SAC column'],
                    ['showItemQty', 'Qty column'],
                    // v1.10.33 — Renamed from "Unit column" to match
                    // reality: InvoicePreview renders the unit INSIDE the
                    // Qty cell ("5 Nos", not a separate column). Prior
                    // label misled users into unticking Qty and expecting
                    // Unit to survive as its own column — it just vanished
                    // instead. Label now describes what actually happens.
                    ['showItemUnit', 'Unit suffix (next to Qty)'],
                    ['showRateColumn', 'Rate column'],
                    ['showDiscount', 'Discount column'],
                    ['showGST', 'Tax % column (GST/VAT/etc.)'],
                    ['showCess', 'GST Cess % column (India — tobacco/auto/coal)'],
                  ]},
                  { group: 'Totals', items: [
                    ['showSubtotal', 'Subtotal row'],
                    ['showAmountWords', 'Amount in words'],
                    ['showRoundOff', 'Round-off line'],
                    ['showHsnSummary', 'HSN/SAC tax summary table'],
                    ['showTaxInWords', 'Tax amount in words'],
                  ]},
                  { group: 'Compliance flags (India)', items: [
                    ['reverseCharge', 'Reverse Charge applies (Section 9(3)/9(4)) — recipient pays GST'],
                  ]},
                  // Paper-size selector rendered outside the checkbox-grid pattern
                  // — see the block below the .map(). Adding a group marker here
                  // keeps the visual flow but the actual UI is a dropdown.
                  { group: '__PAPER_SIZE__', items: [] },
                  { group: 'Footer', items: [
                    ['showBankDetails', 'Bank details'],
                    ['showAccountLabel', 'Show "Pay via: <account>" label above bank block'],
                    // v1.10.74 - the QR needs a rupee invoice with a UPI ID, not an Indian business.
                    ['showUPI', 'UPI QR (rupee invoices)'],
                    ['showSignature', 'Signature block'],
                    ['showSignatoryText', 'Show "Authorized Signatory" caption'],
                    ['showTerms', 'Terms & Conditions'],
                    ['showNotes', 'Notes / Remarks'],
                    ['showSystemGeneratedNote', 'Note: system-generated invoice, no signature or stamp required'],
                    ['showDeclaration', 'Declaration'],
                    ['showCustomerSeal', "\"Customer's Seal and Signature\" box (Boxed grid / Tally style)"],
                  ]},
                ].map(section => {
                  if (section.group === '__PAPER_SIZE__') {
                    return (
                      <div key="paper-size" style={{ marginBottom: '0.6rem' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>Paper / print size</div>
                        <select className="form-input" style={{ fontSize: '0.85rem' }}
                          value={invoiceOptions.paperSize || 'a4'}
                          onChange={e => setInvoiceOptions(prev => ({ ...prev, paperSize: e.target.value }))}>
                          {Object.entries(PAPER_SIZES).map(([key, ps]) => (
                            <option key={key} value={key}>{ps.label}</option>
                          ))}
                        </select>
                        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.3rem 0 0' }}>
                          {getPaperSize(invoiceOptions.paperSize, invoiceOptions).hint}
                        </p>

                        {/* Custom size inputs — shown only when Custom preset picked */}
                        {invoiceOptions.paperSize === 'custom' && (
                          <div style={{ marginTop: '0.5rem', padding: '0.55rem 0.65rem', background: 'var(--bg-secondary)', borderRadius: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                            <div>
                              <label style={{ fontSize: '0.72rem', fontWeight: 600, display: 'block', marginBottom: 3 }}>Width (mm)</label>
                              <input type="number" min="30" max="500" step="1"
                                value={invoiceOptions.customPaperWidth || 80}
                                onChange={e => setInvoiceOptions(prev => ({ ...prev, customPaperWidth: parseInt(e.target.value, 10) || 80 }))}
                                className="form-input" style={{ fontSize: '0.8rem', padding: '0.35rem' }} />
                            </div>
                            <div>
                              <label style={{ fontSize: '0.72rem', fontWeight: 600, display: 'block', marginBottom: 3 }}>Height (mm)</label>
                              <input type="number" min="50" max="1200" step="1"
                                value={invoiceOptions.customPaperHeight || 297}
                                onChange={e => setInvoiceOptions(prev => ({ ...prev, customPaperHeight: parseInt(e.target.value, 10) || 297 }))}
                                className="form-input" style={{ fontSize: '0.8rem', padding: '0.35rem' }} />
                            </div>
                            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', gridColumn: 'span 2', margin: 0 }}>
                              Tip: enter your printer's <strong>printable</strong> width, not the roll width. Most 58mm thermals print at 48mm; 80mm print at 72mm. <strong>Below 100mm width auto-switches to thermal receipt layout</strong> — same rendering as the 58/80mm presets, just at your exact size.
                            </p>
                            {/* v1.10.30 — quick-pick chips for uncommon thermal rolls. */}
                            <div style={{ gridColumn: 'span 2', display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: 4 }}>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', alignSelf: 'center' }}>Quick-pick:</span>
                              {[
                                { label: '40mm', w: 32 },
                                { label: '76mm', w: 68 },
                                { label: '90mm', w: 80 },
                                { label: '110mm', w: 102 },
                              ].map(p => (
                                <button type="button" key={p.label}
                                  onClick={() => setInvoiceOptions(prev => ({ ...prev, customPaperWidth: p.w, customPaperHeight: 297 }))}
                                  className="btn btn-secondary"
                                  style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}
                                  title={`Set to ${p.label} roll (${p.w}mm printable × auto height)`}>
                                  {p.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Thermal-only extra settings — only shown when a
                            thermal paper size is picked. Each control maps
                            to an invoiceOptions field consumed by the
                            thermal render path in InvoicePreview. */}
                        {getPaperSize(invoiceOptions.paperSize, invoiceOptions).kind === 'thermal' && (
                          <div style={{ marginTop: '0.6rem', padding: '0.6rem', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
                              Thermal printer settings
                            </div>

                            <label style={{ display: 'block', fontSize: '0.78rem', marginBottom: '0.35rem' }}>
                              <span style={{ fontWeight: 600 }}>Font size</span>
                              <select className="form-input"
                                style={{ fontSize: '0.78rem', marginTop: 2 }}
                                value={invoiceOptions.thermalFontSize || 'medium'}
                                onChange={e => setInvoiceOptions(prev => ({ ...prev, thermalFontSize: e.target.value }))}>
                                <option value="small">Small (fits more per page)</option>
                                <option value="medium">Medium (recommended)</option>
                                <option value="large">Large (easier to read)</option>
                              </select>
                            </label>

                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', fontSize: '0.78rem', marginTop: '0.5rem', cursor: 'pointer' }}>
                              <input type="checkbox" checked={!!invoiceOptions.thermalCompact}
                                onChange={e => setInvoiceOptions(prev => ({ ...prev, thermalCompact: e.target.checked }))}
                                style={{ marginTop: 2, accentColor: 'var(--primary)' }} />
                              <span>
                                <strong>Compact mode</strong>
                                <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                  Tighter item rows, to save paper on long orders. Whether HSN and the quantity × rate line print is set in Print Settings.
                                </span>
                              </span>
                            </label>

                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', fontSize: '0.78rem', marginTop: '0.4rem', cursor: 'pointer' }}>
                              <input type="checkbox" checked={invoiceOptions.thermalCutMark !== false}
                                onChange={e => setInvoiceOptions(prev => ({ ...prev, thermalCutMark: e.target.checked }))}
                                style={{ marginTop: 2, accentColor: 'var(--primary)' }} />
                              <span>
                                <strong>Cut mark at bottom</strong>
                                <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                  Prints a CUT HERE line to tear against. Turn it off if your printer cuts the paper itself.
                                </span>
                              </span>
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div key={section.group} style={{ marginBottom: '0.6rem' }}>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>{section.group}</div>
                      <div className="options-grid">
                        {section.items.map(([key, label]) => {
                          // These default to OFF; everything else defaults to ON.
                          // v1.10.70 - showSystemGeneratedNote added: without it the box
                          // showed ticked while the invoice printed no note.
                          const checked = invoiceOptionOn(invoiceOptions, key);
                          return (
                            <label key={key} className="option-toggle">
                              <input type="checkbox" checked={checked} onChange={() => toggleOption(key)} />
                              <span>{label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {invoiceOptionOn(invoiceOptions, 'showDeclaration') && (
                  <div className="form-group" style={{ marginTop: '0.4rem' }}>
                    <label className="form-label" style={{ fontSize: '0.78rem' }}>Declaration text</label>
                    <textarea className="form-input" rows={2}
                      value={invoiceOptions.declarationText ?? DEFAULT_DECLARATION}
                      onChange={e => setInvoiceOptions(prev => ({ ...prev, declarationText: e.target.value }))} />
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
                  <button type="button" className="btn btn-secondary"
                    onClick={() => {
                      const allKeys = ['showLogo','showBusinessName','showBusinessAddress','showBusinessPhone','showBusinessEmail','showState','showGSTIN','showClientAddress','showClientPhone','showClientEmail','showPlaceOfSupply','showInvoiceNumber','showInvoiceDate','showDueDate','showHSN','showItemQty','showItemUnit','showRateColumn','showDiscount','showGST','showSubtotal','showAmountWords','showRoundOff','showBankDetails','showAccountLabel','showUPI','showSignature','showSignatoryText','showTerms','showNotes'];
                      setInvoiceOptions(prev => { const out = { ...prev }; allKeys.forEach(k => { out[k] = false; }); return out; });
                    }}
                    style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem' }}>
                    Hide all
                  </button>
                  <button type="button" className="btn btn-secondary"
                    onClick={() => setInvoiceOptions(prev => ({
                      ...DEFAULT_OPTIONS,
                      // v1.10.33 — Preserve per-bill data that lives inside
                      // invoiceOptions but is NOT a "display option" the
                      // reset button should touch. Prior code was a raw
                      // setInvoiceOptions(DEFAULT_OPTIONS) which nulled
                      // paymentAccountSnapshot (bank details frozen at save
                      // time, v1.10.20 invariant) and selectedAccountId
                      // (the account picked for THIS bill) — so an edit-
                      // then-reset silently repointed the bank block to the
                      // legacy profile bank.
                      paymentAccountSnapshot: prev.paymentAccountSnapshot,
                      selectedAccountId: prev.selectedAccountId,
                    }))}
                    style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem' }}>
                    Reset to default
                  </button>
                </div>
              </div>
            )}
          </div>
  );
}
