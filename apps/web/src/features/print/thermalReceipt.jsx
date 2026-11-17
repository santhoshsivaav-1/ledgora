// Thermal receipt render — single column, no colour panels, no margins.
// Used for both 80mm and 58mm; the CSS class (`paper-thermal-58` vs
// `paper-thermal-80`) further trims (hide QR at 58mm etc.).
//
// v-split note: this used to be inlined inside InvoicePreview because it
// needed access to all the opt() / totals / items closures. It now lives
// here with explicit props — same markup, same precedence rules.
// Escape-hatch: user can switch back to A4/A5 any time in Customize.

import DOMPurify from 'dompurify';
import { getCountryConfig, printedSubtotal } from '../../utils';

// Props (explicit, from InvoicePreview):
//   paperCfg / containerStyle / containerRef / previewOnly — paper + container wiring
//   profile / client / details / items / totals            — invoice data
//   options                                                — per-invoice invoiceOptions
//   printSettings                                          — app-wide _ps (defaults layer)
//   typeConfig / showReverseChargeLine / reverseChargeText — header details
//   showGST / showAmountWords / showBankDetails / showNotes— content toggles
//   account / qrDataUrl                                    — payment block + generated UPI QR
//   customNotes / fmtDate / amountInWords                  — rich notes + formatters
export default function ThermalReceipt({
  paperCfg, containerStyle, containerRef, previewOnly,
  profile, client, details, items, totals, options, printSettings,
  typeConfig, showReverseChargeLine, reverseChargeText,
  showGST, showAmountWords, showBankDetails, showNotes,
  account, qrDataUrl, customNotes, fmtDate, amountInWords,
}) {
  const opt = (key, fallback = true) => options[key] !== undefined ? options[key] : fallback;
  // v1.8.4 thermal render — every user-configurable setting from
  // PrintSettings component flows through here. Backward compat: fields
  // fall back to sensible defaults if the bill was created pre-v1.8.4.
  //
  // The app-wide printSettings (localStorage) provides DEFAULTS. Each
  // invoice's own invoiceOptions.thermal* fields OVERRIDE those defaults.
  // Priority: options → printSettings → hardcoded fallback.
  const _ps = printSettings;  // same settings object the sheet layout reads
  const eff = {
    thermalFontSize:    options.thermalFontSize    ?? printSettings.fontSize,
    thermalFontFamily:  options.thermalFontFamily  ?? printSettings.fontFamily,
    thermalFontWeight:  options.thermalFontWeight  ?? printSettings.fontWeight,
    thermalAllCaps:     options.thermalAllCaps     ?? printSettings.allCaps,
    thermalLineSpacing: options.thermalLineSpacing ?? printSettings.lineSpacing,
    thermalContrast:    options.thermalContrast    ?? printSettings.contrast,
    thermalHeaderAlign: options.thermalHeaderAlign ?? printSettings.headerAlign,
    thermalHeaderCaps:  options.thermalHeaderCaps  ?? printSettings.headerCaps,
    thermalShowLogo:    options.thermalShowLogo    ?? printSettings.showLogo,
    thermalShowHSN:     options.thermalShowHSN     ?? printSettings.showHSN,
    thermalShowRate:    options.thermalShowRate    ?? printSettings.showRateLine,
    thermalQrSize:      options.thermalQrSize      ?? printSettings.qrSize,
    thermalCutMark:     options.thermalCutMark     ?? printSettings.cutMark,
    thermalFeedLines:   options.thermalFeedLines   ?? printSettings.feedLines,
    thermalFooterMessage: options.thermalFooterMessage ?? printSettings.footerMessage,
    thermalTagline:     options.thermalTagline     ?? (printSettings.showTagline ? printSettings.tagline : ''),
    thermalCompact:     options.thermalCompact     ?? false,
  };

  const invoiceNum = details?.invoiceNumber || '';
  // Receipts keep their short d/m/yyyy unless a date format was chosen.
  const invoiceDate = !details?.invoiceDate ? ''
    : ((_ps.dateFormat || 'dd-mon-yyyy') !== 'dd-mon-yyyy' ? fmtDate(details.invoiceDate) : new Date(details.invoiceDate).toLocaleDateString('en-IN'));
  const sellerCurrency = getCountryConfig(profile?.country).currency;
  const currencySymbol = sellerCurrency === 'INR' ? 'Rs.' : sellerCurrency;
  const showRoundOff = opt('showRoundOff', false);
  // v1.10.33 — Split the single "isNarrow" threshold into two.
  // Prior code used `widthMm < 80` for everything, but thermal80 has
  // widthMm=72 (printable area) and thermal76 has 68 — BOTH tripped
  // the flag and silently:
  //   (a) hid the HSN column even with showHSN=true
  //   (b) rendered at the same tiny font as thermal58
  // Now:
  //   - isVeryNarrow (< 60mm) → thermal58 only, aggressive compaction
  //     (smaller font, hide HSN inline, tighter "Amt" header)
  //   - isNarrow (< 80mm) kept for column-width math where the
  //     thermal80 receipt still needs slightly narrower columns than
  //     thermal112 sheet-style rolls
  const isVeryNarrow = paperCfg.widthMm < 60;
  const isNarrow = paperCfg.widthMm < 80;

  // -- Settings pulled from `eff` (merged options + printSettings) ---------
  const fontSize = eff.thermalFontSize || 'medium';
  const fontFamily = eff.thermalFontFamily || 'mono';
  const fontWeight = eff.thermalFontWeight || 'bold';
  const allCaps = eff.thermalAllCaps === true;
  const lineSpacing = eff.thermalLineSpacing || 'normal';
  const contrast = eff.thermalContrast || 'normal';
  const headerAlign = eff.thermalHeaderAlign || 'center';
  const headerCaps = eff.thermalHeaderCaps !== false;
  const showLogo = eff.thermalShowLogo !== false;
  const showHSN = eff.thermalShowHSN !== false;
  const showRate = eff.thermalShowRate !== false;
  const qrSizePx = eff.thermalQrSize === 'small' ? 60
                 : eff.thermalQrSize === 'large' ? 120 : 90;
  const cutMark = eff.thermalCutMark !== false;
  const feedLines = Number(eff.thermalFeedLines ?? 2);
  const footerMessage = eff.thermalFooterMessage
    || 'Thank you for your business!';
  const tagline = eff.thermalTagline || '';
  const thermalCompact = !!eff.thermalCompact;

  // Base font-size in px based on paper width + user preference.
  // Larger widths get slightly bigger base so 80mm reads bolder than 58mm.
  // v1.10.30 — reported: "fix the font issue and print issue in thermal".
  // Bumped every size ~10-15% so even 58mm at 'small' stays readable
  // after the print driver's raster smoothing. Baseline print quality on
  // low-DPI POS printers is what these numbers are tuned against.
  const fontSizeMap = {
    small:  isVeryNarrow ? 9.5 : 11,
    medium: isVeryNarrow ? 11 : 12.5,
    large:  isVeryNarrow ? 12.5 : 14.5,
    xlarge: isVeryNarrow ? 14 : 16.5,
  };
  const fontSizeBase = (fontSizeMap[fontSize] || fontSizeMap.medium) + 'px';
  // FontFamily: monospace prints crisper on thermal, but some printers
  // handle sans-serif better with newer firmware.
  const fontFamilyCss = fontFamily === 'sans'
    ? '"Arial", "Helvetica", sans-serif'
    : '"Courier New", "Consolas", monospace';
  // FontWeight: baseline 500 (bold), or 800 (ultra) for the darkest print.
  // Normal (400) is included for users on modern printers who want lighter.
  const baseWeight = fontWeight === 'ultra' ? 800
                   : fontWeight === 'normal' ? 500
                   : 700; // bold (default)
  // Bold multiplier for headers/totals — 100 heavier than baseline capped at 900
  const strongWeight = Math.min(900, baseWeight + 200);
  const contrastFilter = contrast === 'ultra' ? 'grayscale(1) contrast(3) brightness(0.85)'
                      : contrast === 'high' ? 'grayscale(1) contrast(2) brightness(0.95)'
                      : 'grayscale(1) contrast(1.4)';
  // Line spacing → line-height multiplier
  const lineHeight = lineSpacing === 'compact' ? 1.2
                   : lineSpacing === 'comfortable' ? 1.6 : 1.4;
  // Section padding pulls from spacing preference
  const secPad = lineSpacing === 'compact' ? '3px 4px'
               : lineSpacing === 'comfortable' ? '8px 4px' : '5px 4px';
  // Helper: apply ALL CAPS transformation if flag is on
  const cap = (s) => allCaps ? String(s || '').toUpperCase() : String(s || '');
  // Consistent divider styling (dashed lines don't print well; solid does)
  const dashLine = { borderBottom: '1px solid #000', borderTop: 'none' };
  // Root style — EVERY visual attribute set here so nothing accidentally
  // inherits lighter/gray from parent CSS.
  //
  // v1.8.5 darkness fix: text-shadow with a 0.5px horizontal offset in the
  // SAME colour effectively double-strokes each glyph, making thermal
  // print noticeably darker without needing a heavier font. Combined with
  // -webkit-text-stroke this makes even the lightest thermal printer
  // produce crisp readable output. User can turn it OFF via Ultra weight
  // setting if they don't need it.
  // v1.10.30 — stronger double-strike for thermal readability. Prior
  // 0.4px shadow was thin; bumping to 0.6px + adding a diagonal makes
  // glyphs read darker on lightly-burning heads without needing a
  // heavier font weight (which fattens columns and misaligns numbers).
  const textDarkenShadow = fontWeight === 'normal' ? 'none'
                         : '0.6px 0 0 currentColor, 0 0.6px 0 currentColor, 0.4px 0.4px 0 currentColor';
  const rootStyle = {
    ...containerStyle,
    color: '#000',
    background: '#fff',
    fontFamily: fontFamilyCss,
    fontSize: fontSizeBase,
    fontWeight: baseWeight,
    lineHeight,
    letterSpacing: allCaps ? '0.02em' : 0,
    textShadow: textDarkenShadow,
    // Prevent OS-level font smoothing from lightening glyphs at small sizes
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
  };

  return (
    <div
      className={`invoice-preview-container ${paperCfg.cssClass} paper-thermal`}
      ref={containerRef} {...(previewOnly ? {} : { id: 'invoice-preview' })} style={rootStyle}>
      {/* ================= HEADER ================= */}
      <div style={{ padding: '8px 4px 6px', textAlign: headerAlign, ...dashLine, color: '#000' }}>
        {showLogo && profile?.logo && (
          /* v1.10.36 — Reverted the v1.10.33 formula
             `Math.min(45, widthMm * 3.78 * 0.4)` which shrank the
             logo on standard 58/80mm rolls (thermal80 → 45px cap
             vs the historical 45px, thermal58 → 40px). The historical
             45px cap worked on every preset roll. Custom-thermal is
             the only case where the logo can overshoot a narrow roll,
             and the .paper-thermal-custom CSS handles that via
             max-width. */
          <img src={profile.logo} alt="" className="thermal-logo"
            style={{ maxHeight: 45, marginBottom: 4, filter: contrastFilter }} />
        )}
        <div style={{ fontWeight: strongWeight, fontSize: '1.15em', letterSpacing: '0.02em' }}>
          {(headerCaps || allCaps) ? (profile?.businessName || '').toUpperCase() : (profile?.businessName || '')}
        </div>
        {tagline && <div style={{ fontSize: '0.85em', fontWeight: baseWeight, fontStyle: 'italic' }}>{cap(tagline)}</div>}
        {profile?.address && <div style={{ fontSize: '0.9em', fontWeight: baseWeight }}>{cap(profile.address)}</div>}
        {(profile?.city || profile?.state || profile?.pin) && (
          <div style={{ fontSize: '0.9em', fontWeight: baseWeight }}>
            {cap([profile?.city, profile?.state, profile?.pin].filter(Boolean).join(', '))}
          </div>
        )}
        {profile?.gstin && (
          <div style={{ fontSize: '0.9em', fontWeight: strongWeight, marginTop: 2 }}>{cap('GSTIN: ' + profile.gstin)}</div>
        )}
        {profile?.phone && <div style={{ fontSize: '0.9em', fontWeight: baseWeight }}>{cap('Ph: ' + profile.phone)}</div>}
      </div>

      {/* ================= TYPE BANNER ================= */}
      <div style={{ padding: secPad, textAlign: 'center', fontWeight: strongWeight, textTransform: 'uppercase', fontSize: '1.05em', letterSpacing: '0.08em', ...dashLine }}>
        {typeConfig?.label || 'Invoice'}
      </div>

      {/* ================= INVOICE DETAILS ================= */}
      <div style={{ padding: secPad, fontSize: '0.95em', fontWeight: baseWeight, ...dashLine }}>
        <div><strong style={{ fontWeight: strongWeight }}>{cap('Invoice #')}: </strong>{cap(invoiceNum)}</div>
        {showReverseChargeLine && <div><strong style={{ fontWeight: strongWeight }}>{cap('Reverse charge')}: </strong>{cap(reverseChargeText)}</div>}
        <div><strong style={{ fontWeight: strongWeight }}>{cap('Date')}: </strong>{cap(invoiceDate)}</div>
        {client?.name && (
          <div style={{ marginTop: 3 }}>
            <strong style={{ fontWeight: strongWeight }}>{cap('Bill to')}: </strong>{cap(client.name)}
          </div>
        )}
        {client?.gstin && <div>{cap('GSTIN: ' + client.gstin)}</div>}
        {client?.phone && <div>{cap('Ph: ' + client.phone)}</div>}
      </div>

      {/* ================= ITEMS =================
           CSS Grid with a FIXED-WIDTH amount column so every amount lines
           up vertically no matter how long the qty/rate text is. Fixes the
           photo issue where "Rs.225" and "Rs.25" didn't align across rows. */}
      {(() => {
        // Amount column width scales with paper: narrow rolls get less
        // space; wider rolls give amounts more room.
        const amountColMm = isNarrow ? 16 : paperCfg.widthMm < 100 ? 22 : 26;
        const gridCols = `1fr ${amountColMm}mm`;
        return (
          <div style={{ padding: secPad, ...dashLine }}>
            <div style={{
              display: 'grid', gridTemplateColumns: gridCols,
              fontWeight: strongWeight, paddingBottom: 3, marginBottom: 3,
              borderBottom: '1px solid #000', fontSize: '0.95em',
              textTransform: 'uppercase', gap: '4px',
            }}>
              <span>Item</span>
              <span style={{ textAlign: 'right' }}>{isVeryNarrow ? 'Amt' : 'Amount'}</span>
            </div>
            {(items || []).map((item, idx) => {
              const amount = (Number(item.quantity) || 0) * (Number(item.rate) || 0);
              const qty = Number(item.quantity) || 0;
              const rate = Number(item.rate) || 0;
              const tax = showGST && item.taxPercent > 0 ? ` +${item.taxPercent}%` : '';
              const hsnBit = showHSN && item.hsn && !isVeryNarrow ? '  |  HSN ' + item.hsn : '';
              return (
                <div key={idx} style={{ marginBottom: 5, fontSize: '0.95em' }}>
                  <div style={{ fontWeight: strongWeight, wordBreak: 'break-word' }}>
                    {(idx + 1) + '. ' + cap(item.name || item.description || 'Item')}
                  </div>
                  <div style={{
                    display: 'grid', gridTemplateColumns: gridCols, gap: '4px',
                    fontSize: '0.92em', paddingLeft: thermalCompact ? 0 : 8, fontWeight: baseWeight,
                  }}>
                    <span style={{ wordBreak: 'break-word' }}>
                      {cap(showRate
                        ? `${qty}${item.unit ? ' ' + item.unit : ''} × ${currencySymbol}${rate.toFixed(2)}${tax}${hsnBit}`
                        : `${qty}${item.unit ? ' ' + item.unit : ''}${hsnBit}`)}
                    </span>
                    <span style={{ textAlign: 'right', fontWeight: strongWeight }}>{currencySymbol}{amount.toFixed(2)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ================= TOTALS =================
           Grid with fixed-width right column so every amount aligns
           vertically (Subtotal / CGST / SGST / Total all rightmost x). */}
      {(() => {
        const totalsColMm = isNarrow ? 18 : paperCfg.widthMm < 100 ? 24 : 30;
        const gridCols = `1fr ${totalsColMm}mm`;
        const rowStyle = { display: 'grid', gridTemplateColumns: gridCols, gap: '4px' };
        const amt = (n) => currencySymbol + (Number(n) || 0).toFixed(2);
        return (
          <div style={{ padding: secPad, fontSize: '1em', fontWeight: baseWeight, ...dashLine }}>
            <div style={rowStyle}>
              <span>{cap('Subtotal')}</span>
              <span style={{ textAlign: 'right' }}>{amt(printedSubtotal(totals))}</span>
            </div>
            {Number(totals?.totalDiscount) > 0 && (
              <div style={rowStyle}>
                <span>{cap('Discount')}</span>
                <span style={{ textAlign: 'right' }}>-{amt(totals.totalDiscount)}</span>
              </div>
            )}
            {showGST && Number(totals?.cgst) > 0 && (
              <div style={rowStyle}>
                <span>{cap('CGST')}</span>
                <span style={{ textAlign: 'right' }}>{amt(totals.cgst)}</span>
              </div>
            )}
            {showGST && Number(totals?.sgst) > 0 && (
              <div style={rowStyle}>
                <span>{cap('SGST')}</span>
                <span style={{ textAlign: 'right' }}>{amt(totals.sgst)}</span>
              </div>
            )}
            {/* Intra-UT supplies (Chandigarh, Ladakh...): without this row
                the receipt's tax lines did not add up to its total. */}
            {showGST && Number(totals?.utgst) > 0 && (
              <div style={rowStyle}>
                <span>{cap('UTGST')}</span>
                <span style={{ textAlign: 'right' }}>{amt(totals.utgst)}</span>
              </div>
            )}
            {showGST && Number(totals?.igst) > 0 && (
              <div style={rowStyle}>
                <span>{cap('IGST')}</span>
                <span style={{ textAlign: 'right' }}>{amt(totals.igst)}</span>
              </div>
            )}
            {Number(totals?.cess) > 0 && (
              <div style={rowStyle}>
                <span>{cap('Cess')}</span>
                <span style={{ textAlign: 'right' }}>{amt(totals.cess)}</span>
              </div>
            )}
            {/* v1.10.74 - TOTAL already includes TCS and the whole-bill
                discount; print them so the receipt adds up (same values as the sheet layout). */}
            {Number(totals?.tcsAmount) > 0 && (
              <div style={rowStyle}>
                <span>{cap('TCS')}</span>
                <span style={{ textAlign: 'right' }}>{amt(totals.tcsAmount)}</span>
              </div>
            )}
            {Number(totals?.invoiceDiscountAmount) > 0 && (
              <div style={rowStyle}>
                <span>{cap('Discount on total')}</span>
                <span style={{ textAlign: 'right' }}>-{amt(totals.invoiceDiscountAmount)}</span>
              </div>
            )}
            {showRoundOff && Number(totals?.roundOff) !== 0 && (
              <div style={rowStyle}>
                <span>{cap('Round-off')}</span>
                <span style={{ textAlign: 'right' }}>
                  {Number(totals.roundOff) > 0 ? '+' : ''}{amt(totals.roundOff)}
                </span>
              </div>
            )}
            <div style={{
              ...rowStyle,
              fontWeight: strongWeight, fontSize: '1.2em', marginTop: 4,
              paddingTop: 4, borderTop: '1px solid #000',
              borderBottom: '2px solid #000', paddingBottom: 4,
            }}>
              <span>{cap('TOTAL')}</span>
              <span style={{ textAlign: 'right' }}>{amt(totals?.total)}</span>
            </div>
            {Number(totals?.tdsAmount) > 0 && (
              <>
                <div style={{ ...rowStyle, marginTop: 4 }}>
                  <span>{cap('Less: TDS')}</span>
                  <span style={{ textAlign: 'right' }}>-{amt(totals.tdsAmount)}</span>
                </div>
                <div style={{ ...rowStyle, fontWeight: strongWeight }}>
                  <span>{cap('Net Receivable')}</span>
                  <span style={{ textAlign: 'right' }}>{amt(totals.netReceivable)}</span>
                </div>
              </>
            )}
          </div>
        );
      })()}

      {showAmountWords && (
        <div style={{ padding: secPad, fontSize: '0.9em', textAlign: 'center', ...dashLine, fontStyle: 'italic', fontWeight: baseWeight }}>
          {cap(amountInWords(totals?.total || 0))}
        </div>
      )}

      {showBankDetails && (account?.bankName || profile?.bankName) && (
        <div style={{ padding: secPad, fontSize: '0.9em', fontWeight: baseWeight, ...dashLine }}>
          <div style={{ fontWeight: strongWeight, textAlign: 'center', marginBottom: 3 }}>{cap('BANK DETAILS')}</div>
          {/* v1.10.37 — Account holder name on thermal too, ONLY if
              the user explicitly filled it (differs from business
              name). Skip when blank so the compact 48/72mm receipt
              doesn't grow a line for a value that would be redundant
              with the business name already printed at the top. */}
          {account?.accountHolderName && account.accountHolderName.trim() && (
            <div>{cap(account.accountHolderName)}</div>
          )}
          <div>{cap(account?.bankName || profile?.bankName)}</div>
          {(account?.accountNumber || profile?.accountNumber) && (
            <div>{cap('A/c: ' + (account?.accountNumber || profile?.accountNumber))}{
              account?.accountType ? ' · ' + cap(({ savings: 'Sav', current: 'Cur', cc: 'CC', od: 'OD', nre: 'NRE', nro: 'NRO' })[account.accountType] || account.accountType) : ''
            }</div>
          )}
          {(account?.ifsc || profile?.ifsc) && <div>{cap('IFSC: ' + (account?.ifsc || profile?.ifsc))}</div>}
        </div>
      )}

      {/* v1.10.13 — reported: "QR for payment should also add on 2 inch
           thermal too because this feature is working in market". Prior
           code gated the UPI QR on `!isNarrow` (widthMm < 80) so 58mm
           rolls silently dropped it. Now: always render when enabled;
           on 58mm the QR is smaller (auto via qrSizePx below) to fit
           the 48mm printable width. */}
      {opt('showUPI') && qrDataUrl && (() => {
        // v1.10.36 — Reverted to the pre-v1.10.33 QR sizing.
        // Reported (Hinglish): "qr small ho gaya hai ... phele jaisa
        // kar dijiye just custom me problem tha". The 50%-of-width
        // formula introduced in v1.10.33 was too aggressive on
        // standard rolls (thermal58/76/80 all shrank), and users had
        // already tuned qrSizePx via the thermalQrSize picker
        // (small=60/medium=90/large=120px). The ONLY roll that needed
        // a defensive cap was the custom sub-100mm case — on a 40mm
        // custom roll the fixed 90px QR spilled off the paper edge.
        // Now: keep the historical behaviour on every preset roll,
        // apply the width-based cap ONLY when paperSize === 'custom'.
        const isCustomThermal = paperCfg.cssClass === 'paper-thermal-custom';
        const size = isCustomThermal
          ? Math.min(qrSizePx, Math.round(paperCfg.widthMm * 3.78 * 0.55))
          : (isNarrow ? Math.min(qrSizePx, 90) : qrSizePx);
        return (
        <div style={{ padding: secPad, textAlign: 'center', ...dashLine }}>
          <img src={qrDataUrl} alt="UPI QR" className="thermal-qr"
            style={{ width: size, height: size, filter: contrastFilter }} />
          <div style={{ fontSize: '0.85em', fontWeight: strongWeight }}>{cap('Scan to pay via UPI')}</div>
        </div>
        );
      })()}

      {showNotes && customNotes && (
        <div style={{ padding: secPad, fontSize: '0.9em', fontWeight: baseWeight, ...dashLine }}
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(customNotes) }} />
      )}

      {footerMessage && (
        <div style={{ padding: '6px 4px 6px', textAlign: 'center', fontSize: '0.95em', fontWeight: strongWeight }}>
          {cap(`*** ${footerMessage} ***`)}
          {profile?.email && <div style={{ fontWeight: baseWeight, marginTop: 2 }}>{cap(profile.email)}</div>}
        </div>
      )}

      {cutMark && (
        <div style={{ padding: '10px 4px 4px', textAlign: 'center', fontSize: '0.85em', letterSpacing: '0.15em', color: '#000', fontFamily: 'monospace', fontWeight: strongWeight }}>
          {'- - - - -  ✂  CUT HERE  ✂  - - - - -'}
        </div>
      )}

      {/* Feed lines: extra blank lines at bottom so the auto-cutter (or
           manual tear) has clearance below the cut mark. */}
      {feedLines > 0 && (
        <div style={{ height: `${feedLines * 8}px` }} />
      )}
    </div>
  );
}
