import DOMPurify from 'dompurify';
import { formatExchangeRateLine, htmlHasText, splitNumberedTerms } from '../../utils';
import { getLabel } from './printSettingsStore';

// Sheet-layout footer (moved out of InvoicePreview.jsx with explicit props
// — markup unchanged): bank details, exchange rate, terms/notes (inline or
// on the separate `data-pdf-page="terms"` page), declaration and the
// signature/stamp block.
//
// Props:
//   pdfStyle                          — template style (padding variant)
//   profile / account / sellerCC      — bank + country label context
//   options / currencySymbol          — exchange-rate line inputs
//   isIndia                           — PAN line gate
//   showAccountLabel                  — "Pay via" label toggle
//   showBankDetails / showTerms / showNotes / showSystemGeneratedNote /
//   showDeclaration / declarationText / showSignature / showSignatoryText — toggles
//   _ps / _ps_labels                  — app-wide print settings (termsSeparatePage,
//                                       signature defaults) + label lookup object
//   customTerms / customNotes         — rich HTML from the invoice editor
//   termsClassMod                     — 'inv-terms-formatted' or ''
export default function SheetFooter({
  pdfStyle, profile, account, sellerCC, options, currencySymbol, isIndia,
  showAccountLabel, showBankDetails, showTerms, showNotes, showSystemGeneratedNote,
  showDeclaration, declarationText, showSignature, showSignatoryText,
  _ps, _ps_labels, customTerms, customNotes, termsClassMod,
}) {
  return (
    <div className="inv-footer" style={pdfStyle !== 'classic' ? { padding: '1rem 2rem' } : {}}>
      <div className="inv-footer-left">
        {/* Bank details render from the resolved payment account. Account fields
            fall back to the flat profile fields when neither array entry nor flat
            field exists — guarantees byte-identical PDFs for v1.4.3 invoices. */}
        {showBankDetails && (account?.bankName || profile?.bankName) && (
          <div className="inv-footer-block">
            <h4 className="inv-section-label">{getLabel(_ps_labels, 'bankDetails')}</h4>
            {showAccountLabel && account?.label && (
              <p style={{ margin: '0 0 0.25rem', fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic' }}>
                Pay via: <strong style={{ color: '#334155' }}>{account.label}</strong>
              </p>
            )}
            <div className="inv-footer-details">
              {/* v1.10.37 — Account Holder Name renders FIRST (above
                  Bank) because clients doing NEFT/RTGS need it for
                  beneficiary lookup — printing it prominently
                  prevents the "name mismatch" payment failures
                  reported by users. Falls back to businessName when
                  the field is blank so existing accounts render the
                  same as before. */}
              {(account?.accountHolderName || profile?.businessName) && (
                <p><span className="inv-detail-label">A/C Name:</span> {account?.accountHolderName || profile.businessName}</p>
              )}
              <p><span className="inv-detail-label">Bank:</span> {account?.bankName || profile.bankName}</p>
              <p><span className="inv-detail-label">A/C No:</span> {account?.accountNumber || profile.accountNumber}
                {/* v1.10.37 — Account type appended inline next to
                    the number so it doesn't add a whole extra row on
                    the PDF. Uses the human label for CC/OD which
                    won't parse well as an abbreviation to non-banking
                    readers. */}
                {account?.accountType && (
                  <span style={{ marginLeft: '0.4rem', fontSize: '0.85em', color: '#64748b' }}>
                    · {({ savings: 'Savings', current: 'Current', cc: 'Cash Credit', od: 'Overdraft', nre: 'NRE', nro: 'NRO' })[account.accountType] || account.accountType}
                  </span>
                )}
              </p>
              {(account?.ifsc || profile.ifsc) && <p><span className="inv-detail-label">{sellerCC.bankLabel || 'IFSC'}:</span> {account?.ifsc || profile.ifsc}</p>}
              {(account?.swift || profile.swift) && <p><span className="inv-detail-label">SWIFT/BIC:</span> {account?.swift || profile.swift}</p>}
              {profile.pan && isIndia && <p><span className="inv-detail-label">PAN:</span> {profile.pan}</p>}
            </div>
          </div>
        )}
        {options.exchangeRate && currencySymbol !== 'INR' && (
          <div className="inv-footer-block">
            <h4 className="inv-section-label">EXCHANGE RATE</h4>
            <p className="inv-terms">{formatExchangeRateLine(currencySymbol, options.exchangeRate, profile?.country === 'India' || !profile?.country ? 'INR' : sellerCC.currency)}</p>
          </div>
        )}
        {/* Terms and notes accept rich HTML; same DOMPurify sanitization the extraSections
            block uses, which keeps b/i/u/lists/links/headings and strips everything else.
            v1.10.5 — audit M25 fix. `termsSeparatePage` was a saved
            setting the UI toggled but nothing consumed. Now: when
            true, T&C + notes render inside a `data-pdf-page` container
            (same mechanism the extraSections feature uses). buildPDF's
            extraPages loop then captures it as its own PDF page. */}
        {!_ps.termsSeparatePage && (() => {
          const termsHtml = customTerms ? splitNumberedTerms(DOMPurify.sanitize(customTerms)) : '';
          const hasTerms = htmlHasText(termsHtml);
          return showTerms && hasTerms ? (
            <div className="inv-footer-block">
              <h4 className="inv-section-label">{getLabel(_ps_labels, 'terms')}</h4>
              <div className={`inv-terms inv-rich ${termsClassMod}`} dangerouslySetInnerHTML={{ __html: termsHtml }} />
            </div>
          ) : null;
        })()}
        {!_ps.termsSeparatePage && (() => {
          const notesHtml = customNotes ? splitNumberedTerms(DOMPurify.sanitize(customNotes)) : '';
          const hasNotes = htmlHasText(notesHtml);
          return showNotes && hasNotes ? (
            <div className="inv-footer-block">
              <h4 className="inv-section-label">{getLabel(_ps_labels, 'notes')}</h4>
              <div className={`inv-terms inv-rich ${termsClassMod}`} dangerouslySetInnerHTML={{ __html: notesHtml }} />
            </div>
          ) : null;
        })()}
        {/* v1.10.70 (#72) - below Terms & Conditions, as asked. */}
        {showSystemGeneratedNote && (
          <div className="inv-footer-block inv-system-note">
            <p className="inv-terms" style={{ margin: 0, fontStyle: 'italic' }}>
              <strong>Note:</strong> This is a system-generated invoice. No signature or stamp is required.
            </p>
          </div>
        )}
        {showDeclaration && (
          <div className="inv-footer-block">
            <h4 className="inv-section-label">DECLARATION</h4>
            <p className="inv-terms" style={{ margin: 0 }}>{declarationText}</p>
          </div>
        )}
      </div>
      {/* v1.10.5 — Separate T&C page. Uses the same data-pdf-page
           attribute the extraSections feature uses, so buildPDF's
           existing extraPages loop captures it on its own page. */}
      {_ps.termsSeparatePage && (customTerms || customNotes) && (
        <div data-pdf-page="terms" style={{ padding: '2rem', pageBreakBefore: 'always', breakBefore: 'page' }}>
          {(() => {
            const termsHtml = customTerms ? splitNumberedTerms(DOMPurify.sanitize(customTerms)) : '';
            const hasTerms = htmlHasText(termsHtml);
            return showTerms && hasTerms ? (
              <div className="inv-footer-block">
                <h4 className="inv-section-label">{getLabel(_ps_labels, 'terms')}</h4>
                <div className={`inv-terms inv-rich ${termsClassMod}`} dangerouslySetInnerHTML={{ __html: termsHtml }} />
              </div>
            ) : null;
          })()}
          {(() => {
            const notesHtml = customNotes ? splitNumberedTerms(DOMPurify.sanitize(customNotes)) : '';
            const hasNotes = htmlHasText(notesHtml);
            return showNotes && hasNotes ? (
              <div className="inv-footer-block" style={{ marginTop: '2rem' }}>
                <h4 className="inv-section-label">{getLabel(_ps_labels, 'notes')}</h4>
                <div className={`inv-terms inv-rich ${termsClassMod}`} dangerouslySetInnerHTML={{ __html: notesHtml }} />
              </div>
            ) : null;
          })()}
        </div>
      )}
      {(() => {
        // v1.9.0: signature source priority — profile.signature (per-business,
        // legacy), then printSettings.signatureImage (app-wide default set
        // via Print Settings). Same for the signatory name.
        const printCfg = _ps;
        const sigImg = profile?.signature || (printCfg.signatureShow !== false ? printCfg.signatureImage : null);
        const sigName = profile?.businessName || printCfg.signatureName;
        // v1.10.67 (#66 item 13) — the stamp is a separate image with its own
        // height, so it no longer has to be pasted into the signature file.
        // Either one alone is enough to print the block.
        const stampImg = profile?.stamp || null;
        const sigMaxHeight = Number(profile?.signatureHeight) || 60;
        const stampMaxHeight = Number(profile?.stampHeight) || 70;
        if (!showSignature || (!sigImg && !stampImg)) return null;
        return (
          <div className="inv-signature">
            {showSignatoryText && <p className="inv-sig-label">{getLabel(_ps_labels, 'authorizedSignatory')}</p>}
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
              {stampImg && <img src={stampImg} alt="Stamp" style={{
                maxHeight: `${stampMaxHeight}px`, maxWidth: '120px', objectFit: 'contain', display: 'block',
              }} />}
              {sigImg && <img src={sigImg} alt="Signature" style={{
                maxHeight: `${sigMaxHeight}px`, maxWidth: '180px', objectFit: 'contain', display: 'block',
              }} />}
            </div>
            <p className="inv-sig-name">{sigName}</p>
          </div>
        );
      })()}
    </div>
  );
}
