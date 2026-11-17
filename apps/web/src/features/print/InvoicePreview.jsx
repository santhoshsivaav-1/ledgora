import { getAppSetting } from '../../lib/appSettings';
import React, { useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
import { amountInWordsLang } from '@ledgora/tax-engine';
import { numberToWords, formatCurrency, INVOICE_TYPES, getCountryConfig, CURRENCY_NAMES, formatExchangeRateLine, getAccountById, getPaperSize, htmlHasText, splitNumberedTerms, invoiceOptionOn, DEFAULT_DECLARATION, filledOrderDetails, formatShortDate } from '../../utils';
import { getPrintSettings, getLabel, formatCurrencyEx, formatDate } from './printSettingsStore';
import InvoiceGridLayout, { HsnSummaryTable } from '../invoices/editor/InvoiceGridLayout';
import TaxSummary from './TaxSummary';
import TotalsPanel from './TotalsPanel';
import ThermalReceipt from './thermalReceipt';
import { ModernHeader, MinimalHeader, ClassicHeader, SheetParties } from './sheetHeaders';
import ItemsTable from './sheetItemsTable';
import SheetFooter from './sheetFooter';
import { makeLineCalc, buildHsnRows } from './invoiceLines';

// P11-S2: the QR encoder loads when a QR is first drawn, not with the app.
const toQrDataUrl = (text, opts) => import('qrcode').then((m) => m.default.toDataURL(text, opts));

// v1.10.36 — Optional `previewOnly` prop suppresses the internal
// `id="invoice-preview"`. The parent's on-screen preview keeps the id
// (needed by the @media print CSS rules in index.css:1258 for the
// A4 window.print fallback path); the PrintPreviewModal's *second*
// instance renders with previewOnly=true so it doesn't create a
// duplicate id on the page — HTML-invalid + could confuse getElementById
// lookups.
//
// v-split — the big self-contained renders live in sibling files:
//   thermalReceipt.jsx (80/58mm receipt), sheetHeaders.jsx (modern /
//   minimal / classic headers + parties), sheetItemsTable.jsx,
//   sheetFooter.jsx and invoiceLines.js (shared per-line tax math).
// This file keeps option resolution, QR generation and the sheet shell.
const InvoicePreview = React.forwardRef(({ profile: profileProp, client, details, items, totals, invoiceType = 'tax-invoice', customTerms, customNotes, extraSections = [], options = {}, previewOnly = false, cancelled = false }, ref) => {
  // v1.10.76 - the business profile can still be loading on the first render
  // (a page refresh while editing an invoice), and reading a bank field from
  // null blanked the whole app. Empty until it arrives.
  const profile = profileProp || {};
  // Interstate detection must match InvoiceGenerator.jsx — it honours
  // details.placeOfSupply (POS override) and client.isSEZ (SEZ supplies
  // are always interstate regardless of physical state). Without this
  // the totals block could show IGST while the item table showed
  // CGST+SGST for the same bill (POS override or SEZ client).
  //
  // Cheapest correct signal: totals.igst > 0 means the computation upstream
  // routed the tax as IGST — so trust that, and fall back to the state
  // comparison only if totals aren't populated (e.g. legacy JSON with no
  // igst field).
  const businessState = profile?.state?.trim().toLowerCase();
  const clientState = client?.state?.trim().toLowerCase();
  //
  // v1.10.66 (#61) — the tax engine's own decision now wins. computeInvoiceTotals
  // records `isInterstate` beside the amounts it produced, and every row below
  // has to describe THOSE amounts. The name comparison further down could
  // disagree with the engine — a Delhi client supplied in Punjab, say — and the
  // invoice then printed "IGST ₹0.00" above a total that really held CGST +
  // SGST. The comparison survives only for invoices saved before the flag.
  const isInterstate = typeof totals?.isInterstate === 'boolean'
    ? totals.isInterstate
    : ((typeof totals?.igst === 'number' && totals.igst > 0)
      || !!client?.isSEZ
      || (details?.placeOfSupply && businessState && details.placeOfSupply.toLowerCase() !== businessState)
      || (businessState && clientState && businessState !== clientState));
  const typeConfig = INVOICE_TYPES[invoiceType] || INVOICE_TYPES['tax-invoice'];
  // Seller's country drives tax label (GST / VAT / SST / MwSt etc.) and bank label.
  const sellerCC = getCountryConfig(profile?.country);
  const isIndia = (profile?.country || 'India') === 'India';
  const taxLabel = sellerCC.taxLabel || 'GST';

  // Resolve the payment account once per render. Falls back to the synthesised
  // legacy account (built from flat profile bank fields) when no array exists,
  // so v1.4.3 invoices render byte-identical with no `selectedAccountId`.
  // v1.10.18 — Prefer options.paymentAccountSnapshot when present. That's the
  // frozen-at-save-time copy of the account details, so editing a bank in
  // Settings after the invoice was made no longer rewrites the invoice's
  // displayed bank. Old invoices without the snapshot (pre-v1.10.18) fall
  // through to the live profile lookup — legacy behaviour preserved.
  const account = options.paymentAccountSnapshot || getAccountById(profile, options.selectedAccountId);
  const showAccountLabel = options.showAccountLabel === true;

  // Options with defaults. Each toggle defaults to ON so old invoices keep rendering as
  // before; users opt INTO hiding fields via Customize.
  const opt = (key, fallback = true) => options[key] !== undefined ? options[key] : fallback;
  const showGST = opt('showGST', typeConfig.showGST);
  const showState = opt('showState');
  const showGSTIN = opt('showGSTIN');
  const showPlaceOfSupply = opt('showPlaceOfSupply', showGST);
  const showHSN = opt('showHSN');
  const showDiscount = opt('showDiscount');
  const showBankDetails = opt('showBankDetails');
  const showUPI = opt('showUPI');
  const showLogo = opt('showLogo');
  const showSignature = opt('showSignature');
  const showSignatoryText = opt('showSignatoryText');
  const showTerms = opt('showTerms');
  const showNotes = opt('showNotes');
  // v1.10.70 - requested (#72, @sangwanmail-eng). OFF unless chosen: most
  // invoices are signed, and this line would contradict a signature.
  const showSystemGeneratedNote = opt('showSystemGeneratedNote', false);
  const showAmountWords = opt('showAmountWords');
  const showDueDate = opt('showDueDate');
  const showItemQty = opt('showItemQty');
  const showItemUnit = opt('showItemUnit');
  const showRateColumn = opt('showRateColumn');
  const showSubtotal = opt('showSubtotal');
  // Header / client meta — default ON
  const showBusinessName = opt('showBusinessName');
  const showBusinessAddress = opt('showBusinessAddress');
  const showBusinessPhone = opt('showBusinessPhone');
  const showBusinessEmail = opt('showBusinessEmail');
  const showClientAddress = opt('showClientAddress');
  const showClientPhone = opt('showClientPhone');
  const showClientEmail = opt('showClientEmail');
  const showInvoiceNumber = opt('showInvoiceNumber');
  const showInvoiceDate = opt('showInvoiceDate');
  const customTitle = options.customTitle || typeConfig.title;
  // v1.10.66 (#62) — Rule 46(p) of the CGST Rules: a tax invoice has to state
  // whether tax is payable on reverse charge. The notice under the totals only
  // appears for "Yes", so an ordinary invoice never said "No" at all. Credit
  // notes carry the same flag, which GSTR-1 reports for them.
  const showReverseChargeLine = isIndia && showGST && (invoiceType === 'tax-invoice' || invoiceType === 'credit-note');
  const reverseChargeText = options.reverseCharge ? 'Yes' : 'No';
  const currencySymbol = options.currency || 'INR';

  // v1.10.4 — Single read of print settings per render. Prior code
  // called getPrintSettings() at 6 different points, each hitting
  // localStorage.getItem + JSON.parse. Multiplied by every keystroke
  // in InvoiceGenerator (which rerenders the preview), this was a
  // measurable hot spot. Now: one lookup + downstream aliases keep
  // JSX shape untouched.
  const _ps = getPrintSettings();
  // Settings > GST > Exempt / nil label: a 0% line prints this word in the rate column instead of "0%".
  const exemptLabel = (getAppSetting('gst.exemptLabel') || '').trim();
  const rateText = (r) => (Number(r) === 0 && exemptLabel ? exemptLabel : `${r}%`);

  // Print Settings -> Formatting (number grouping, decimals, symbol position,
  // date format) was saved but never used on the invoice. The defaults keep
  // the formatting the invoice always had.
  const fmt = (amount) => {
    if ((_ps.numberFormat && _ps.numberFormat !== 'indian') || Number(_ps.decimalPlaces ?? 2) !== 2 || _ps.currencyPosition === 'after') {
      return formatCurrencyEx(amount, currencySymbol, _ps);
    }
    if (currencySymbol === 'INR') return formatCurrency(amount);
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencySymbol, minimumFractionDigits: 2 }).format(amount || 0);
  };
  const fmtDate = (value) => formatDate(value, _ps);

  // Aliases for the different callsites below; all point to the same
  // object so they stay in sync.
  const _ps_dc = _ps;
  // v1.9.3 — same settings alias used by getLabel() calls throughout the JSX
  const _ps_labels = _ps_dc;
  // v1.10.74 - "Total Due" follows the label language; English keeps "Total Due" (preset says "Total").
  const _totalLabel = getLabel(_ps_labels, 'total');
  const totalDueLabel = _totalLabel === 'Total' ? 'Total Due' : _totalLabel;
  const dualCurrencyOn = _ps_dc.dualCurrencyEnabled && currencySymbol === 'INR' && _ps_dc.dualCurrencyCode && Number(_ps_dc.dualCurrencyRate) > 0;
  const fmtDualSecondary = (amount) => {
    if (!dualCurrencyOn || _ps_dc.dualCurrencyPosition !== 'below') return '';
    const secondary = (Number(amount) || 0) / Number(_ps_dc.dualCurrencyRate);
    return '≈ ' + new Intl.NumberFormat('en-US', { style: 'currency', currency: _ps_dc.dualCurrencyCode, minimumFractionDigits: 2 }).format(secondary);
  };

  const amountInWords = (num) => {
    // Settings > General > Amount in words language (rupees only; other currencies stay in English).
    if (currencySymbol === 'INR') return amountInWordsLang(num, getAppSetting('fmt.wordsLang'));
    const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const convert = (n) => {
      if (n === 0) return 'Zero';
      let result = '';
      if (n >= 1000000) { result += convert(Math.floor(n / 1000000)) + ' Million '; n %= 1000000; }
      if (n >= 1000) { result += convert(Math.floor(n / 1000)) + ' Thousand '; n %= 1000; }
      if (n >= 100) { result += a[Math.floor(n / 100)] + ' Hundred '; n %= 100; }
      if (n >= 20) { result += b[Math.floor(n / 10)] + ' '; if (n % 10) result += a[n % 10] + ' '; }
      else if (n > 0) { result += a[n] + ' '; }
      return result.trim();
    };
    const names = CURRENCY_NAMES[currencySymbol] || { major: currencySymbol, minor: 'Cents' };
    const rounded = Math.round(num * 100) / 100;
    const whole = Math.floor(rounded);
    const cents = Math.round((rounded - whole) * 100);
    let result = convert(whole) + ' ' + names.major;
    if (cents > 0) result += ' and ' + convert(cents) + ' ' + names.minor;
    return result + ' Only';
  };

  const [qrDataUrl, setQrDataUrl] = useState('');

  // P10-S7: an invoice registered on the IRP prints its IRN, Ack No/date and the signed QR the IRP returned.
  const einv = options.einvoice?.status === 'generated' && options.einvoice?.signedQr ? options.einvoice : null;
  const [einvQr, setEinvQr] = useState('');
  useEffect(() => {
    if (!einv) { setEinvQr(''); return; }
    toQrDataUrl(einv.signedQr, { width: 150, margin: 1, errorCorrectionLevel: 'L' })
      .then(setEinvQr)
      .catch(() => setEinvQr(''));
  }, [einv?.signedQr]); // eslint-disable-line react-hooks/exhaustive-deps

  // Generate UPI QR code. The VPA now comes from the selected payment account
  // (so switching account swaps both bank block + QR), with fallback to the
  // legacy flat profile.upiId for invoices that pre-date multi-account support.
  const upiId = account?.upiId || profile?.upiId || '';
  // The QR asks for what the client actually pays: the total less any TDS
  // they deduct (Net Receivable), not the full total.
  const upiAmount = Number(totals.netReceivable ?? totals.total) || 0;
  useEffect(() => {
    if (!showUPI || !upiId || !(upiAmount > 0) || currencySymbol !== 'INR') {
      setQrDataUrl('');
      return;
    }
    const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(profile?.businessName || '')}&am=${upiAmount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Payment for ${details?.invoiceNumber || 'Invoice'}`)}`;
    toQrDataUrl(upiUrl, { width: 120, margin: 1, errorCorrectionLevel: 'M' })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [showUPI, upiId, profile?.businessName, upiAmount, details?.invoiceNumber, currencySymbol]);

  const accentColors = {
    'tax-invoice': '#1e40af',
    'proforma': '#7c3aed',
    'sales-order': '#0369a1',
    'bill-of-supply': '#0f766e',
    'credit-note': '#be123c',
  };
  // v1.9.14 — When userColorsEnabled is on, pdfAccent MUST feed the
  // header-block background too.
  // v1.10.4 — reuses `_ps` from top of function (was a fresh
  // getPrintSettings() call — one of 6 in this render).
  const accent = options.accentColor
    || (_ps.userColorsEnabled && _ps.pdfAccent)
    || accentColors[invoiceType]
    || accentColors['tax-invoice'];
  // v1.9.1 — template style. Priority: per-invoice options.pdfStyle → app-wide
  // printSettings.pdfTemplate → 'classic' fallback. Also accept the new
  // "corporate" and "minimalist" values that map to existing render paths
  // with slight tweaks (colour tint + spacing) applied via CSS class.
  const pdfStyleRaw = options.pdfStyle || _ps.pdfTemplate || 'classic';
  const pdfStyle = ['corporate', 'minimalist'].includes(pdfStyleRaw)
    ? (pdfStyleRaw === 'corporate' ? 'classic' : 'minimal')
    : pdfStyleRaw;
  const pdfStyleVariant = pdfStyleRaw; // full value for CSS class targeting

  // Check if any item has discount
  const hasAnyDiscount = showDiscount && items.some(item => (item.discount || 0) > 0);

  // v1.10.73 - shared per-line math (moved to invoiceLines.js; factory binds
  // the tax-inclusive flag + GST toggle exactly as the old inline closure did).
  const lineCalc = makeLineCalc(totals, showGST);
  const hsnRows = buildHsnRows(items, totals, lineCalc);
  const pdfStyleForOptions = pdfStyleRaw;
  const showHsnSummary = showGST && invoiceOptionOn(options, 'showHsnSummary', pdfStyleForOptions);
  const showTaxInWords = showGST && invoiceOptionOn(options, 'showTaxInWords', pdfStyleForOptions);
  const showDeclaration = invoiceOptionOn(options, 'showDeclaration', pdfStyleForOptions);
  const showCustomerSeal = invoiceOptionOn(options, 'showCustomerSeal', pdfStyleForOptions);
  const declarationText = options.declarationText ?? DEFAULT_DECLARATION;
  const totalTax = Number(totals.totalTaxAmount) || ((totals.cgst || 0) + (totals.sgst || 0) + (totals.utgst || 0) + (totals.igst || 0) + (totals.cess || 0));
  const orderDetails = filledOrderDetails(details || {});

  // Props shared by every sheet header variant (see sheetHeaders.jsx).
  const headerProps = {
    accent, profile, customTitle, invoiceType, details, fmtDate,
    showLogo, showBusinessName, showBusinessAddress, showState, showGSTIN,
    showBusinessEmail, showBusinessPhone, showInvoiceNumber, showInvoiceDate,
    showDueDate, showReverseChargeLine, reverseChargeText,
  };

  // Paper-size class + width (v1.8.1 / adapted v1.8.2). Preview container
  // adopts the target paper's width in mm so what-you-see matches
  // what-you-print. For A4/A5 (sheets), the existing multi-column layout
  // renders at scaled type. For thermal 80mm/58mm, we switch to a
  // completely different template — see renderThermalReceipt below.
  //
  // The problem in v1.8.1 was: only the container width changed; the inline
  // margins (`margin: '0 2rem'`) inside the items table + party blocks
  // stayed at A4 sizes. On an 80mm roll, that meant the items were pushed
  // off the right edge. v1.8.2 branches on `kind === 'thermal'` and
  // renders a proper single-column receipt.
  const paperCfg = getPaperSize(options.paperSize, options);
  const isThermal = paperCfg.kind === 'thermal';
  const containerStyle = {
    width: `${paperCfg.widthMm}mm`,
    minHeight: paperCfg.kind === 'sheet' ? `${paperCfg.heightMm}mm` : undefined,
    ...(isThermal ? { fontFamily: '"Courier New", monospace', fontSize: paperCfg.widthMm >= 80 ? '10.5px' : '9px' } : {}),
  };

  // Thermal receipt render — extracted to ThermalReceipt (thermalReceipt.jsx).
  // Used for both 80mm and 58mm; the CSS class (`paper-thermal-58` vs
  // `paper-thermal-80`) further trims (hide QR at 58mm etc.). Escape-hatch:
  // user can switch back to A4/A5 any time in Customize.
  if (isThermal) {
    return (
      <ThermalReceipt
        paperCfg={paperCfg}
        containerStyle={containerStyle}
        containerRef={ref}
        previewOnly={previewOnly}
        profile={profile}
        client={client}
        details={details}
        items={items}
        totals={totals}
        options={options}
        printSettings={_ps}
        typeConfig={typeConfig}
        showReverseChargeLine={showReverseChargeLine}
        reverseChargeText={reverseChargeText}
        showGST={showGST}
        showAmountWords={showAmountWords}
        showBankDetails={showBankDetails}
        showNotes={showNotes}
        account={account}
        qrDataUrl={qrDataUrl}
        customNotes={customNotes}
        fmtDate={fmtDate}
        amountInWords={amountInWords}
      />
    );
  }

  // v1.9.1 — company letterhead + template variant CSS class
  // v1.9.2 — user-configurable colours via CSS custom properties + font scale
  const _ps_final = _ps;  // v1.10.4 — reuse top-of-function read
  const letterheadOn = _ps_final.letterheadEnabled && _ps_final.letterheadImage;
  const hideHeaderBecauseLetterhead = letterheadOn && _ps_final.letterheadHideHeader;

  // v1.9.14 — Inline style typography wiring. Data-attribute CSS from
  // v1.9.13 lost specificity wars against dark-mode overrides and
  // template-* rules, so users saw the font stay put no matter what
  // they picked. Inline styles beat every CSS class regardless of
  // specificity — this is the reliable path.
  //
  // v1.10.9 — decoupled Typography settings from PDF. The Typography
  // section explicitly says "Monospace prints crisper on most thermal
  // printers" — users reasonably expect it to be thermal-only.
  // Meanwhile the dedicated "PDF FONT FAMILY" dropdown (helvetica /
  // times / courier) had NO consumer at all — clicking it did
  // nothing. Now: Typography → thermal only. `pdfFontFamily` →
  // actual PDF font. Font weight + ALL CAPS still bridge to PDF via
  // Typography (they're layout-neutral choices).
  const PDF_FAMILY_MAP = {
    helvetica: 'Helvetica, Arial, "Segoe UI", sans-serif',
    times:     '"Times New Roman", Times, "Liberation Serif", serif',
    courier:   '"Courier New", Courier, "Liberation Mono", monospace',
  };
  const pdfFontFamilyCss = !isThermal
    ? (PDF_FAMILY_MAP[_ps_final.pdfFontFamily] || PDF_FAMILY_MAP.helvetica)
    : undefined;

  // v1.10.10 — pdfFontScale REMOVED from the preview CSS layer.
  // Previously we multiplied `basePct × pdfFontScale` here, but most
  // child elements use `rem`/`px` (not `em`), so a container
  // `font-size: 80%` only cascaded to a handful of nodes and neither
  // the preview nor the real PDF actually shrank. The scale now applies
  // at the PDF-placement layer in buildPDF — shrinking the whole image
  // area on the page — which is both reliable and matches how MS Word
  // "shrink to fit" works. Preview font-size stays base-preset only.
  const PDF_FONT_SIZE_PCT = { small: 87, medium: 100, large: 112, xlarge: 122 };
  const basePct = !isThermal ? (PDF_FONT_SIZE_PCT[_ps_final.fontSize] || 100) : 100;
  const pdfFontSizeCss = !isThermal ? `${basePct}%` : undefined;

  const PDF_FONT_WEIGHT = { normal: 400, bold: 600, ultra: 800 };
  const pdfFontWeightCss = !isThermal ? (PDF_FONT_WEIGHT[_ps_final.fontWeight] || 400) : undefined;
  const pdfCapsOn = !isThermal && _ps_final.allCaps === true;

  // v1.10.37 — Terms & Notes rendering mode. Per-invoice option.termsFormatMode
  // wins over the global printSettings.termsFormatMode. Falls back to
  // 'compact' (historical) so old invoices keep the same PDF pixel-for-pixel.
  //
  // v1.10.38 — Smart default. If no explicit choice was made AND the
  // invoice is services-only (freelancers / consultants / dev shops
  // typically have B2B clients who actually read the terms), default
  // to 'formatted'. Goods invoices stay on 'compact' because their
  // terms are usually retail boilerplate the client never reads.
  // Explicit user choice at either the per-invoice or global level
  // always wins over this heuristic.
  const explicitMode = options.termsFormatMode || _ps_final.termsFormatMode;
  const isServicesInvoice = (options.invoiceMode || 'goods') === 'services';
  const termsFormatMode = explicitMode || (isServicesInvoice ? 'formatted' : 'compact');
  const termsClassMod = termsFormatMode === 'formatted' ? 'inv-terms-formatted' : '';

  const finalContainerStyle = {
    ...containerStyle,
    ...(letterheadOn ? {
      backgroundImage: `url(${_ps_final.letterheadImage})`,
      backgroundSize: 'cover',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center top',
    } : {}),
    // v1.9.2 — CSS custom properties for user-controlled colours. Only
    // applied when userColorsEnabled = true (data attribute gates the CSS).
    // Each var falls back to a template default if the user doesn't set it.
    ...(_ps_final.userColorsEnabled ? (() => {
      const accent = _ps_final.pdfAccent || '#1e40af';
      // v1.10.40 — Also compute an RGB channel string so CSS rules can
      // build rgba(var(--pdf-accent-rgb), α) tints. Was using
      // color-mix(in oklab, …) but html2canvas doesn't parse it and
      // fails on Save & Download with "unsupported color function oklab".
      const hex = accent.startsWith('#') ? accent.slice(1) : '';
      const rgb = hex.length === 6
        ? `${parseInt(hex.slice(0,2),16)}, ${parseInt(hex.slice(2,4),16)}, ${parseInt(hex.slice(4,6),16)}`
        : '30, 64, 175';  // fallback to default blue
      return {
        '--pdf-primary-text': _ps_final.pdfPrimaryText || '#0f172a',
        '--pdf-muted-text':   _ps_final.pdfMutedText   || '#334155',
        '--pdf-accent':       accent,
        '--pdf-accent-rgb':   rgb,
        '--pdf-accent-text':  _ps_final.pdfAccentText  || '#ffffff',
        '--pdf-header-bg':    _ps_final.pdfHeaderBg    || '#f8fafc',
        '--pdf-divider':      _ps_final.pdfDividerColor|| '#334155',
      };
    })() : {}),
    // v1.9.14/1.10.9 — inline typography. pdfFontSizeCss already folds
    // in the pdfFontScale multiplier (see the compute above).
    ...(pdfFontFamilyCss ? { fontFamily: pdfFontFamilyCss } : {}),
    ...(pdfFontSizeCss ? { fontSize: pdfFontSizeCss } : {}),
    ...(pdfFontWeightCss ? { fontWeight: pdfFontWeightCss } : {}),
    ...(pdfCapsOn ? { textTransform: 'uppercase' } : {}),
    // v1.10.67 (#66 item 12) — origin for the CANCELLED watermark below.
    position: 'relative',
  };

  // v1.10.73 - Boxed grid / Tally style get everything already worked out
  // above, so their numbers are the same as every other design's.
  const isGrid = pdfStyle === 'boxed' || pdfStyle === 'tally';
  const sanitizedTerms = customTerms ? splitNumberedTerms(DOMPurify.sanitize(customTerms)) : '';
  // Settings > Print > Footer text is printed as the last line of the notes on every sheet design.
  const footerLine = (getAppSetting('print.footer') || '').trim();
  const sanitizedNotes = (customNotes || footerLine)
    ? splitNumberedTerms(DOMPurify.sanitize(`${customNotes || ''}${footerLine ? `<p>${footerLine.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>` : ''}`))
    : '';
  const taxedRates = [...new Set(items.map((it) => lineCalc(it)).filter((l) => l.tax > 0).map((l) => l.rate))];
  const gridSig = (() => {
    const sigImg = profile?.signature || (_ps.signatureShow !== false ? _ps.signatureImage : null);
    const stampImg = profile?.stamp || null;
    return {
      show: showSignature && !!(sigImg || stampImg), sigImg, stampImg,
      sigHeight: Number(profile?.signatureHeight) || 60, stampHeight: Number(profile?.stampHeight) || 70,
    };
  })();
  const shipToParty = details?.shipToSameAsBilling === false
    && (details?.shippingAddress || details?.shippingCity || details?.shippingState)
    ? { name: client?.name, address: details.shippingAddress, city: details.shippingCity, pin: details.shippingPin, state: details.shippingState }
    : null;
  const gridNotices = (
    <>
      {options.reverseCharge && isIndia && showGST && (
        <div data-pdf-page-boundary="" style={{ margin: '2px 0 6px', fontSize: '0.92em' }}>
          <strong>Reverse Charge applicable.</strong> GST is payable by the recipient under Section 9(3)/9(4) of the CGST Act.
        </div>
      )}
      {invoiceType === 'composition' && (
        <div data-pdf-page-boundary="" style={{ margin: '2px 0 6px', fontStyle: 'italic', fontSize: '0.92em' }}>
          &quot;Composition taxable person, not eligible to collect tax on supplies.&quot; (Rule 46A, CGST Rules)
        </div>
      )}
      {options.exchangeRate && currencySymbol !== 'INR' && (
        <div data-pdf-page-boundary="" style={{ margin: '2px 0 6px', fontSize: '0.92em' }}>
          {formatExchangeRateLine(currencySymbol, options.exchangeRate, profile?.country === 'India' || !profile?.country ? 'INR' : sellerCC.currency)}
          {/* Settings > Multi Currency > Show both amounts: the bill's total in rupees at its own rate */}
          {getAppSetting('mc.showBoth') && Number(options.exchangeRate) > 0 && isIndia && (
            <strong> · Total in INR: {formatCurrency((Number(totals?.total) || 0) * Number(options.exchangeRate))}</strong>
          )}
        </div>
      )}
    </>
  );
  const gridCtx = isGrid ? {
    style: pdfStyle, profile, client, details, items, totals, options, invoiceType, accent, fmt, lineCalc, hsnRows,
    invoiceTitle: customTitle, isIndia, isInterstate, taxLabel, sellerCC, account,
    showGST, hasAnyDiscount, showAmountWords, showBankDetails, showSignatoryText, showSystemGeneratedNote,
    showReverseChargeLine, reverseChargeText, qrDataUrl, upiId,
    showHsnSummary, showTaxInWords, showDeclaration, showCustomerSeal, declarationText, totalTax,
    singleRate: taxedRates.length === 1 ? taxedRates[0] : null,
    words: (n) => (currencySymbol === 'INR' ? `INR ${numberToWords(n)}` : amountInWords(n)),
    shortDate: formatShortDate,
    isServices: (options.invoiceMode || 'goods') === 'services',
    docLabel: ({ quotation: 'Quotation', 'sales-order': 'Sales Order', proforma: 'Proforma', 'credit-note': 'Credit Note', 'delivery-challan': 'Challan' })[invoiceType] || 'Invoice',
    placeOfSupply: details?.placeOfSupply || client?.state || '',
    shipTo: shipToParty,
    sig: gridSig,
    notices: gridNotices,
    termsHtml: !_ps.termsSeparatePage && showTerms && htmlHasText(sanitizedTerms) ? sanitizedTerms : '',
    notesHtml: !_ps.termsSeparatePage && showNotes && htmlHasText(sanitizedNotes) ? sanitizedNotes : '',
    termsClassMod,
    t: {
      logo: showLogo, businessName: showBusinessName, businessAddress: showBusinessAddress,
      businessPhone: showBusinessPhone, businessEmail: showBusinessEmail, gstin: showGSTIN, state: showState,
      clientAddress: showClientAddress, clientPhone: showClientPhone, clientEmail: showClientEmail,
      placeOfSupply: showPlaceOfSupply, invoiceNumber: showInvoiceNumber, invoiceDate: showInvoiceDate, dueDate: showDueDate,
      hsn: showHSN, itemQty: showItemQty, itemUnit: showItemUnit, rate: showRateColumn,
    },
  } : null;

  return (
    <div
      className={`invoice-preview-container ${paperCfg.cssClass} template-${pdfStyleVariant}`}
      data-user-colors={_ps_final.userColorsEnabled ? '1' : '0'}
      data-row-density={_ps_final.rowDensity || 'normal'}
      data-header-compact={_ps_final.headerCompact ? '1' : '0'}
      ref={ref} {...(previewOnly ? {} : { id: 'invoice-preview' })} style={finalContainerStyle}>
      {einv && (
        <div className="inv-einvoice" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid #e5e7eb', fontSize: '0.72em' }}>
          {einvQr && <img src={einvQr} alt="E-invoice signed QR" style={{ width: 90, height: 90 }} />}
          <div style={{ wordBreak: 'break-all' }}>
            <div><strong>IRN:</strong> {einv.irn}</div>
            <div><strong>Ack No:</strong> {einv.ackNo} &nbsp; <strong>Ack Date:</strong> {einv.ackDt}</div>
            {einv.sandbox && <div style={{ color: '#b91c1c', fontWeight: 700 }}>SANDBOX: not a real IRN, not valid for GST</div>}
          </div>
        </div>
      )}
      {cancelled && (
        <div aria-hidden="true" style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', zIndex: 5,
        }}>
          <span style={{
            transform: 'rotate(-24deg)', whiteSpace: 'nowrap',
            fontSize: '3.6rem', fontWeight: 800, letterSpacing: '0.18em',
            color: 'rgba(220, 38, 38, 0.22)',
            border: '6px solid rgba(220, 38, 38, 0.22)', borderRadius: 14,
            padding: '0.3rem 1.6rem',
          }}>CANCELLED</span>
        </div>
      )}
      {isGrid && <InvoiceGridLayout ctx={gridCtx} />}
      {isGrid && _ps.termsSeparatePage && (htmlHasText(sanitizedTerms) || htmlHasText(sanitizedNotes)) && (
        <div data-pdf-page="terms" style={{ padding: '2rem', pageBreakBefore: 'always', breakBefore: 'page' }}>
          {showTerms && htmlHasText(sanitizedTerms) && (
            <div className="inv-footer-block">
              <h4 className="inv-section-label">{getLabel(_ps_labels, 'terms')}</h4>
              <div className={`inv-terms inv-rich ${termsClassMod}`} dangerouslySetInnerHTML={{ __html: sanitizedTerms }} />
            </div>
          )}
          {showNotes && htmlHasText(sanitizedNotes) && (
            <div className="inv-footer-block" style={{ marginTop: '2rem' }}>
              <h4 className="inv-section-label">{getLabel(_ps_labels, 'notes')}</h4>
              <div className={`inv-terms inv-rich ${termsClassMod}`} dangerouslySetInnerHTML={{ __html: sanitizedNotes }} />
            </div>
          )}
        </div>
      )}
      {!isGrid && (<>
      {!hideHeaderBecauseLetterhead && pdfStyle === 'modern' && <ModernHeader {...headerProps} />}
      {!hideHeaderBecauseLetterhead && pdfStyle === 'minimal' && <MinimalHeader {...headerProps} />}
      {!hideHeaderBecauseLetterhead && pdfStyle === 'classic' && <ClassicHeader {...headerProps} />}

      <SheetParties
        pdfStyle={pdfStyle} profile={profile} details={details} client={client} labels={_ps_labels}
        showState={showState} showGSTIN={showGSTIN} showPlaceOfSupply={showPlaceOfSupply}
        showClientAddress={showClientAddress} showClientEmail={showClientEmail} showClientPhone={showClientPhone}
        showGST={showGST} isIndia={isIndia} isInterstate={isInterstate}
        businessState={businessState} clientState={clientState} isIntraUT={totals?.isIntraUT} taxLabel={taxLabel} />

      {/* v1.10.73 - order / dispatch / reference details, when any are filled */}
      {orderDetails.length > 0 && (
        <div className="inv-parties inv-order-details" data-pdf-page-boundary=""
          style={{ margin: pdfStyle === 'classic' ? '0 0 0.75rem' : '0 2rem 0.75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.25rem 1rem', fontSize: '0.75rem' }}>
          {orderDetails.map((f) => (
            <div key={f.key} style={f.wide ? { gridColumn: '1 / -1' } : undefined}>
              <span style={{ color: '#475569' }}>{f.label}: </span><strong>{f.value}</strong>
            </div>
          ))}
        </div>
      )}

      {/* Items table — markup lives in sheetItemsTable.jsx */}
      <ItemsTable
        items={items} totals={totals}
        showGST={showGST} isIndia={isIndia} isInterstate={isInterstate}
        showHSN={showHSN} showItemQty={showItemQty} showItemUnit={showItemUnit} showRateColumn={showRateColumn}
        hasAnyDiscount={hasAnyDiscount} taxLabel={taxLabel}
        lineCalc={lineCalc} fmt={fmt} rateText={rateText} pdfStyle={pdfStyle} />

      {/* Totals section */}
      <div className="inv-totals-section" style={pdfStyle !== 'classic' ? { padding: '1rem 2rem' } : {}}>
        <div className="inv-words">
          {showAmountWords && (
            <>
              <h4 className="inv-section-label">{getLabel(_ps_labels, 'amountInWords')}</h4>
              <p className="inv-words-text">{amountInWords(totals.total)}</p>
              {/* v1.9.1 — dual currency below the words line (foreign clients) */}
              {dualCurrencyOn && (
                <p style={{ fontSize: '0.85em', color: '#555', fontStyle: 'italic', margin: '0.15rem 0 0' }}>
                  Total: {fmt(totals.total)} · {fmtDualSecondary(totals.total)}
                </p>
              )}
            </>
          )}
          {/* UPI QR Code */}
          {qrDataUrl && (
            <div style={{ marginTop: '1.25rem' }}>
              <h4 className="inv-section-label">SCAN TO PAY (UPI)</h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <img src={qrDataUrl} alt="UPI QR" style={{ width: '90px', height: '90px', borderRadius: '6px', border: '1px solid #e2e8f0' }} />
                <div style={{ fontSize: '0.7rem', color: '#475569', lineHeight: 1.5 }}>
                  <p style={{ margin: 0, color: '#475569' }}>UPI ID:</p>
                  <p style={{ margin: 0, color: '#334155', fontWeight: 600, fontSize: '0.75rem' }}>{upiId}</p>
                  <p style={{ margin: '0.25rem 0 0', color: '#475569' }}>{fmt(totals.total)}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <TotalsPanel
          _ps_labels={_ps_labels}
          accent={accent}
          fmt={fmt}
          invoiceType={invoiceType}
          isIndia={isIndia}
          isInterstate={isInterstate}
          options={options}
          pdfStyle={pdfStyle}
          showGST={showGST}
          showSubtotal={showSubtotal}
          taxLabel={taxLabel}
          totalDueLabel={totalDueLabel}
          totals={totals}
        />
      </div>

      {(showHsnSummary && hsnRows.length > 0) || (showTaxInWords && totalTax > 0) ? (
        <div style={{ margin: pdfStyle === 'classic' ? '0 0 0.75rem' : '0 2rem 0.75rem', fontSize: '0.75rem' }}>
          {showHsnSummary && hsnRows.length > 0 && (
            <HsnSummaryTable ctx={{ hsnRows, isIndia, isInterstate, taxLabel, totals }} />
          )}
          {showTaxInWords && totalTax > 0 && (
            <p data-pdf-page-boundary="" style={{ margin: '0.35rem 0 0' }}>
              Tax amount (in words): <strong>{currencySymbol === 'INR' ? numberToWords(totalTax) : amountInWords(totalTax)}</strong>
            </p>
          )}
        </div>
      ) : null}

      {/* Reverse-charge declaration (India) — printed prominently between the
          tax block and the footer when the seller has flagged this invoice as
          RCM. The buyer is responsible for paying GST under Section 9(3)/9(4). */}
      {options.reverseCharge && isIndia && showGST && (
        <div style={{ margin: '0 2rem 0.5rem', padding: '0.5rem 0.75rem', background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', borderRadius: 4, fontSize: '0.78rem', color: 'var(--warn-text)' }}>
          <strong>Reverse Charge applicable.</strong> GST is payable by the recipient under Section 9(3)/9(4) of the CGST Act.
        </div>
      )}

      {/* Composition-scheme mandatory declaration — Rule 46A of CGST Rules. The
          exact wording is prescribed; do not paraphrase. */}
      {invoiceType === 'composition' && (
        <div style={{ margin: '0 2rem 0.5rem', padding: '0.5rem 0.75rem', background: 'var(--info-bg)', border: '1px solid var(--info-border)', borderRadius: 4, fontSize: '0.78rem', color: 'var(--info-text)', fontStyle: 'italic' }}>
          "Composition taxable person, not eligible to collect tax on supplies."
          &nbsp;<span style={{ fontStyle: 'normal', fontSize: '0.7rem' }}>(Rule 46A, CGST Rules)</span>
        </div>
      )}

      {/* Footer — markup lives in sheetFooter.jsx */}
      <SheetFooter
        pdfStyle={pdfStyle} profile={profile} account={account} sellerCC={sellerCC}
        options={options} currencySymbol={currencySymbol} isIndia={isIndia}
        showAccountLabel={showAccountLabel}
        showBankDetails={showBankDetails} showTerms={showTerms} showNotes={showNotes}
        showSystemGeneratedNote={showSystemGeneratedNote}
        showDeclaration={showDeclaration} declarationText={declarationText}
        showSignature={showSignature} showSignatoryText={showSignatoryText}
        _ps={_ps} _ps_labels={_ps_labels}
        customTerms={customTerms} customNotes={customNotes} termsClassMod={termsClassMod} />
      </>)}

      {/* Extra Sections - each starts on new page */}
      {(() => {
        const filtered = extraSections.filter(s => s.title || s.content);
        // v1.10.74 - dropped "Page N of M": M assumed a one-page invoice, so it
        // was wrong whenever the invoice itself ran longer.
        return filtered.map((section, idx) => (
          <div key={section.id} className="inv-extra-page" data-pdf-page={idx + 2}>
            <div className="inv-extra-page-header">
              <div>
                <span className="inv-extra-ref">{customTitle} — {details?.invoiceNumber}</span>
                {client?.name && <span className="inv-extra-ref"> | {client.name}</span>}
              </div>
            </div>
            {section.title && <h4 className="inv-section-label" style={{ marginBottom: '0.75rem' }}>{section.title.toUpperCase()}</h4>}
            {section.content && (
              <div className="inv-extra-content" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(section.content) }} />
            )}
          </div>
        ));
      })()}

      {/* Settings > Print: payment mode, party balance and the PAID stamp, for every layout */}
      {options.payInfo && (getAppSetting('print.show.paymentMode') || getAppSetting('print.show.partyBalance') || (getAppSetting('print.show.paidStamp') && options.payInfo.fullyPaid)) && (
        <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', flexWrap: 'wrap', padding: '0.4rem 2rem', fontSize: '0.85em' }}>
          {getAppSetting('print.show.paymentMode') && options.payInfo.modes.length > 0 && (
            <span>Paid by: <strong style={{ textTransform: 'capitalize' }}>{options.payInfo.modes.join(', ')}</strong></span>
          )}
          {getAppSetting('print.show.partyBalance') && (
            <span>Previous balance: <strong>{fmt(options.payInfo.balanceBefore)}</strong> · Current balance: <strong>{fmt(options.payInfo.balanceAfter)}</strong></span>
          )}
          {getAppSetting('print.show.paidStamp') && options.payInfo.fullyPaid && (
            <span style={{ border: '2px solid #15803d', color: '#15803d', fontWeight: 800, letterSpacing: 2, padding: '0 10px', borderRadius: 4, transform: 'rotate(-6deg)' }}>PAID</span>
          )}
        </div>
      )}

      {/* Watermark for proforma */}
      {invoiceType === 'proforma' && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%) rotate(-35deg)',
          fontSize: '5rem', fontWeight: 800, color: `${accent}0a`,
          pointerEvents: 'none', whiteSpace: 'nowrap'
        }}>
          ESTIMATE
        </div>
      )}

      {/* Bottom bar for modern style */}
      {pdfStyle === 'modern' && (
        <div style={{ height: '4px', background: accent, marginTop: 'auto' }} />
      )}
    </div>
  );
});

export default InvoicePreview;
