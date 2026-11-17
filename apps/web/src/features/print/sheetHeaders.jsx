import { getCountryConfig } from '../../utils';
import { getLabel } from './printSettingsStore';

// Header renderers per style (moved out of InvoicePreview.jsx with
// explicit props — markup unchanged). Shared props across all three:
//
//   accent          — resolved accent colour (options → user colours → type map)
//   profile         — business profile
//   customTitle     — invoice title (per-invoice override or type default)
//   invoiceType     — 'tax-invoice' | 'proforma' | 'credit-note' | ...
//   details         — invoice details (numbers/dates/original ref)
//   fmtDate         — date formatter built from print settings
//   showLogo / showBusinessName / showBusinessAddress / showState /
//   showGSTIN / showBusinessEmail / showBusinessPhone /
//   showInvoiceNumber / showInvoiceDate / showDueDate /
//   showReverseChargeLine / reverseChargeText — content toggles

export function ModernHeader({
  accent, profile, customTitle, invoiceType, details, fmtDate,
  showLogo, showBusinessName, showBusinessAddress, showState, showGSTIN,
  showBusinessEmail, showBusinessPhone, showInvoiceNumber, showInvoiceDate,
  showDueDate, showReverseChargeLine, reverseChargeText,
}) {
  return (
    <>
      <div style={{ background: accent, padding: '1.5rem 2rem', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          {showLogo && profile?.logo && (
            <img src={profile.logo} alt="Logo" style={{ maxHeight: `${profile.logoHeight || 48}px`, maxWidth: '180px', objectFit: 'contain', marginBottom: '0.5rem', display: 'block', filter: 'brightness(0) invert(1)' }} />
          )}
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, letterSpacing: '0.08em' }}>{customTitle}</h1>
          {invoiceType === 'proforma' && (
            <p style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)', fontStyle: 'italic', margin: '0.25rem 0 0' }}>For estimation purposes only</p>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          {showBusinessName && <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.25rem' }}>{profile?.businessName || 'Your Business'}</h2>}
          <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.85)', lineHeight: 1.6 }}>
            {showBusinessAddress && profile?.address && <p style={{ margin: 0 }}>{profile.address}</p>}
            {showBusinessAddress && (profile?.city || profile?.pin) && <p style={{ margin: 0 }}>{[profile.city, profile.pin].filter(Boolean).join(' - ')}</p>}
            {showState && profile?.state && <p style={{ margin: 0 }}>{profile.state}</p>}
            {showGSTIN && profile?.gstin && <p style={{ margin: 0 }}>{getCountryConfig(profile?.country).taxIdLabel}: {profile.gstin}</p>}
            {showBusinessEmail && profile?.email && <p style={{ margin: 0 }}>{profile.email}</p>}
            {showBusinessPhone && profile?.phone && <p style={{ margin: 0 }}>Ph: {profile.phone}</p>}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 2rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.78rem' }}>
          {showInvoiceNumber && <span><strong style={{ color: '#64748b' }}>No.</strong> {details?.invoiceNumber}</span>}
          {showInvoiceDate && <span><strong style={{ color: '#64748b' }}>Date</strong> {details?.invoiceDate ? fmtDate(details.invoiceDate) : ''}</span>}
          {showDueDate && details?.dueDate && <span><strong style={{ color: '#64748b' }}>Due</strong> {fmtDate(details.dueDate)}</span>}
          {showReverseChargeLine && <span><strong style={{ color: '#64748b' }}>Reverse Charge</strong> {reverseChargeText}</span>}
        </div>
        {invoiceType === 'credit-note' && details?.originalInvoiceRef && (
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Against: <strong style={{ color: '#334155' }}>{details.originalInvoiceRef}</strong></span>
        )}
      </div>
    </>
  );
}

export function MinimalHeader({
  accent, profile, customTitle, invoiceType, details, fmtDate,
  showLogo, showBusinessName, showBusinessAddress, showState, showGSTIN,
  showBusinessEmail, showBusinessPhone, showInvoiceNumber, showInvoiceDate,
  showDueDate, showReverseChargeLine, reverseChargeText,
}) {
  return (
    <div style={{ padding: '2rem 2rem 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          {showLogo && profile?.logo && (
            <img src={profile.logo} alt="Logo" style={{ maxHeight: `${profile.logoHeight || 48}px`, maxWidth: '180px', objectFit: 'contain', marginBottom: '0.5rem', display: 'block' }} />
          )}
          {showBusinessName && <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>{profile?.businessName || 'Your Business'}</h2>}
          <div style={{ fontSize: '0.7rem', color: '#475569', lineHeight: 1.6, marginTop: '0.25rem' }}>
            {showBusinessAddress && profile?.address && <p style={{ margin: 0 }}>{profile.address}</p>}
            {showBusinessAddress && (profile?.city || profile?.pin) && <p style={{ margin: 0 }}>{[profile.city, profile.pin].filter(Boolean).join(' - ')}</p>}
            {showState && profile?.state && <p style={{ margin: 0 }}>{profile.state}</p>}
            {showGSTIN && profile?.gstin && <p style={{ margin: 0 }}>{getCountryConfig(profile?.country).taxIdLabel}: {profile.gstin}</p>}
            {showBusinessEmail && profile?.email && <p style={{ margin: 0 }}>{profile.email}</p>}
            {showBusinessPhone && profile?.phone && <p style={{ margin: 0 }}>Ph: {profile.phone}</p>}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <h1 style={{ fontSize: '1.1rem', fontWeight: 700, color: accent, margin: '0 0 0.5rem', letterSpacing: '0.05em' }}>{customTitle}</h1>
          <div style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.8 }}>
            {showInvoiceNumber && <p style={{ margin: 0 }}>{details?.invoiceNumber}</p>}
            {showInvoiceDate && <p style={{ margin: 0 }}>{details?.invoiceDate ? fmtDate(details.invoiceDate) : ''}</p>}
            {showDueDate && details?.dueDate && <p style={{ margin: 0 }}>Due: {fmtDate(details.dueDate)}</p>}
            {showReverseChargeLine && <p style={{ margin: 0 }}>Reverse Charge: {reverseChargeText}</p>}
            {/* v1.10.74 - Classic and Modern print the credit note's original invoice; Minimal dropped it. */}
            {invoiceType === 'credit-note' && details?.originalInvoiceRef && <p style={{ margin: 0 }}>Against Invoice: {details.originalInvoiceRef}</p>}
          </div>
        </div>
      </div>
      {invoiceType === 'proforma' && (
        <p style={{ fontSize: '0.7rem', color: '#475569', fontStyle: 'italic', margin: '0 0 0.5rem' }}>This is not a tax invoice. For estimation purposes only.</p>
      )}
      <div style={{ borderBottom: `1.5px solid ${accent}`, marginBottom: '0' }} />
    </div>
  );
}

export function ClassicHeader({
  accent, profile, customTitle, invoiceType, details, fmtDate,
  showLogo, showBusinessName, showBusinessAddress, showState, showGSTIN,
  showBusinessEmail, showBusinessPhone, showInvoiceNumber, showInvoiceDate,
  showDueDate, showReverseChargeLine, reverseChargeText,
}) {
  return (
    <>
      <div style={{ height: '6px', background: `linear-gradient(90deg, ${accent}, ${accent}cc, ${accent}88)` }} />
      <div className="inv-header">
        <div className="inv-header-left">
          {showLogo && profile?.logo && (
            <img src={profile.logo} alt="Logo" style={{ maxHeight: `${profile.logoHeight || 48}px`, maxWidth: '180px', objectFit: 'contain', marginBottom: '0.75rem', display: 'block' }} />
          )}
          <h1 className="inv-title" style={{ color: accent }}>{customTitle}</h1>
          {invoiceType === 'proforma' && (
            <p style={{ fontSize: '0.7rem', color: '#475569', fontStyle: 'italic', marginBottom: '0.75rem' }}>This is not a tax invoice. For estimation purposes only.</p>
          )}
          {invoiceType === 'credit-note' && details?.originalInvoiceRef && (
            <p style={{ fontSize: '0.75rem', color: '#475569', marginBottom: '0.75rem' }}>Against Invoice: <strong style={{ color: '#334155' }}>{details.originalInvoiceRef}</strong></p>
          )}
          <div className="inv-meta">
            {showInvoiceNumber && <div className="inv-meta-row"><span className="inv-meta-label">No.</span><span className="inv-meta-value">{details?.invoiceNumber}</span></div>}
            {showInvoiceDate && <div className="inv-meta-row"><span className="inv-meta-label">Date</span><span className="inv-meta-value">{details?.invoiceDate ? fmtDate(details.invoiceDate) : ''}</span></div>}
            {showDueDate && details?.dueDate && (
              <div className="inv-meta-row"><span className="inv-meta-label">Due Date</span><span className="inv-meta-value">{fmtDate(details.dueDate)}</span></div>
            )}
            {showReverseChargeLine && (
              <div className="inv-meta-row"><span className="inv-meta-label">Reverse Charge</span><span className="inv-meta-value">{reverseChargeText}</span></div>
            )}
          </div>
        </div>
        <div className="inv-header-right">
          {showBusinessName && <h2 className="inv-business-name">{profile?.businessName || 'Your Business'}</h2>}
          <div className="inv-business-details">
            {showBusinessAddress && profile?.address && <p>{profile.address}</p>}
            {showBusinessAddress && (profile?.city || profile?.pin) && <p>{[profile.city, profile.pin].filter(Boolean).join(' - ')}</p>}
            {showState && profile?.state && <p>{profile.state}</p>}
            {showGSTIN && profile?.gstin && <p>{getCountryConfig(profile?.country).taxIdLabel}: <strong>{profile.gstin}</strong></p>}
            {showBusinessEmail && profile?.email && <p>{profile.email}</p>}
            {showBusinessPhone && profile?.phone && <p>Ph: {profile.phone}</p>}
          </div>
        </div>
      </div>
    </>
  );
}

// Billing parties section (shared but styled per variant).
//
// Extra props beyond the header set:
//   pdfStyle      — resolved template style ('modern' | 'minimal' | 'classic' | ...)
//   client        — client record (bill-to)
//   labels        — the print-settings object getLabel reads (`_ps_labels`)
//   showClientAddress / showClientEmail / showClientPhone /
//   showPlaceOfSupply / showGST — content toggles
//   isIndia / isInterstate / businessState / clientState / isIntraUT /
//   taxLabel — tax-context values for the Place-of-Supply badges
export function SheetParties({
  pdfStyle, profile, details, client, labels,
  showState, showGSTIN, showPlaceOfSupply,
  showClientAddress, showClientEmail, showClientPhone,
  showGST, isIndia, isInterstate, businessState, clientState, isIntraUT, taxLabel,
}) {
  const padStyle = pdfStyle === 'modern' ? { padding: '1rem 2rem' } : pdfStyle === 'minimal' ? { padding: '0 2rem 1rem', border: 'none' } : {};
  // v1.10.11 — Ship To block. When the user unchecked "Ship to same as
  // bill-to" in the invoice form, `details.shipToSameAsBilling === false`
  // and shipping fields are populated. Renders as a third column in
  // the parties row. When same-as-billing, we don't render it (bill-to
  // covers both).
  const shipDifferent = details?.shipToSameAsBilling === false &&
    (details?.shippingAddress || details?.shippingCity || details?.shippingState);
  return (
    <div className="inv-parties" style={padStyle}>
      <div className="inv-party">
        <h4 className="inv-section-label">{getLabel(labels, 'billTo')}</h4>
        <p className="inv-party-name">{details?.billingName?.trim() || client?.name || 'Client Name'}</p>
        {details?.billingName?.trim() && client?.name && details.billingName.trim() !== client.name && <p className="inv-party-details" style={{ margin: 0 }}>c/o {client.name}</p>}
        <div className="inv-party-details">
          {showClientAddress && client?.address && <p>{client.address}</p>}
          {showClientAddress && (client?.city || client?.pin) && <p>{[client.city, client.pin].filter(Boolean).join(' - ')}</p>}
          {showState && client?.state && <p>{client.state}</p>}
          {showGSTIN && client?.gstin && <p>{getCountryConfig(profile?.country).taxIdLabel}: <strong>{client.gstin}</strong></p>}
          {showClientEmail && client?.email && <p>{client.email}</p>}
          {showClientPhone && client?.phone && <p>Ph: {client.phone}</p>}
        </div>
      </div>
      {shipDifferent && (
        <div className="inv-party">
          <h4 className="inv-section-label">{getLabel(labels, 'shipTo')}</h4>
          <p className="inv-party-name">{client?.name || 'Client Name'}</p>
          <div className="inv-party-details">
            {details.shippingAddress && <p>{details.shippingAddress}</p>}
            {(details.shippingCity || details.shippingPin) && <p>{[details.shippingCity, details.shippingPin].filter(Boolean).join(' - ')}</p>}
            {details.shippingState && <p>{details.shippingState}</p>}
          </div>
        </div>
      )}
      {showPlaceOfSupply && (
        <div className="inv-party inv-party-right">
          <h4 className="inv-section-label">{getLabel(labels, 'placeOfSupply')}</h4>
          <p className="inv-party-name">{details?.placeOfSupply || client?.state || '-'}</p>
          {showGST && isIndia && isInterstate && <span className="inv-tax-badge">Interstate (IGST)</span>}
          {showGST && isIndia && !isInterstate && businessState && clientState && <span className="inv-tax-badge inv-tax-badge-green">{isIntraUT ? 'Intra-UT (CGST + UTGST)' : 'Intrastate (CGST + SGST)'}</span>}
          {showGST && !isIndia && <span className="inv-tax-badge inv-tax-badge-green">{taxLabel}</span>}
        </div>
      )}
    </div>
  );
}
