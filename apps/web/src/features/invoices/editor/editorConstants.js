// Choices, defaults and layout helpers shared by the invoice editor and its panels (change 3.9).
import { COUNTRIES, PAPER_SIZES } from '../../../utils';

export const DEFAULT_OPTIONS = {
  showGST: true,
  showState: true,
  showGSTIN: true,
  showPlaceOfSupply: true,
  showHSN: true,
  showDiscount: true,
  showBankDetails: true,
  showUPI: true,
  showLogo: true,
  showSignature: true,
  showTerms: true,
  showNotes: true,
  showAmountWords: true,
  showDueDate: true,
  showItemQty: true,
  showRoundOff: true, // v1.10.75 - on for new installs; a saved choice still wins
  invoiceMode: 'goods',    // 'goods' | 'services' | 'mixed' — drives default unit + dropdown filter
  // Paper / print size (v1.8.1+). See PAPER_SIZES in utils.js.
  //   Sheet: 'a4' | 'a4Landscape' | 'a5' | 'a5Landscape'
  //   Thermal: 'thermal80' | 'thermal58'
  paperSize: 'a4',
  // Thermal-only settings (v1.8.3) — only apply when paperSize starts with
  // 'thermal'. Left at defaults for sheet formats (they're ignored).
  //   thermalFontSize: 'small' | 'medium' (default) | 'large'
  //   thermalCompact: false → include address/HSN/rate line per item
  //                   true  → compact mode, shorter format
  //   thermalCutMark: true  → adds "----- cut here -----" at end for
  //                          auto-cutter thermal printers
  thermalFontSize: 'medium',
  thermalCompact: false,
  thermalCutMark: true,
  recurring: null,         // null OR { enabled, frequency, interval, nextDate, endMode, endDate, maxOccurrences }
  showCess: false,         // when true, exposes per-line Cess % input (India-only)
  reverseCharge: false,    // when true, GST is paid by the recipient (Section 9(3)/9(4))
  showTDS: false,
  tdsSection: '194Q',
  tdsRate: 0.1,
  // v1.10.31 — Data-F2.3: `tdsCumulativeThisYear` / `tcsCumulativeThisYear`
  // were read by the totals memo and by `computeInvoiceTotals`'s ₹50L
  // threshold logic, but never declared in DEFAULT_OPTIONS. That meant a
  // fresh invoice had `undefined` for both, so the marginal-only threshold
  // logic silently charged TDS/TCS from rupee-one instead of only after
  // the client's running annual cumulative crossed ₹50L. Now the defaults
  // exist; a future feature can auto-populate them from prior bills.
  tdsCumulativeThisYear: 0,
  showTCS: false,
  tcsSection: '52',
  tcsRate: 1,
  tcsCumulativeThisYear: 0,
  customTitle: '',
  currency: 'INR',
  exchangeRate: '',
  selectedAccountId: null,   // null ⇒ resolve via last-used / default / first-active at render time
  showAccountLabel: false,   // when true, prints "Pay via: <account label>" above the bank block
  accentColor: '',
  pdfStyle: 'classic',
  // v1.10.22 — invoice-level (whole-bill) discount. Treated as a cash
  // discount / trade allowance applied AFTER tax. Doesn't affect the
  // GSTR-1 taxable value (which per Section 15(3) requires pre-supply
  // agreement — user should use per-line discount for that). Renders as
  // its own line above the grand total when > 0.
  invoiceDiscountValue: 0,
  invoiceDiscountType: 'fixed', // 'fixed' | 'percent'
  // v1.10.24 — Client-credit auto-apply. When true, opening a new invoice
  // for a client with an existing overpayment auto-applies the credit up
  // to the invoice total. When false (default), the user sees a banner
  // and clicks Apply manually. Reported: "this extra payment can be
  // added to the next bill of customer if u enabled — auto or manual".
  autoApplyClientCredit: false,
};

export const ACCENT_PRESETS = [
  { color: '#1e40af', label: 'Blue' },
  { color: '#7c3aed', label: 'Purple' },
  { color: '#0f766e', label: 'Teal' },
  { color: '#be123c', label: 'Red' },
  { color: '#c2410c', label: 'Orange' },
  { color: '#15803d', label: 'Green' },
  { color: '#0369a1', label: 'Sky' },
  { color: '#1e293b', label: 'Dark' },
];

export const PDF_STYLES = [
  { id: 'classic', label: 'Classic', desc: 'Clean with top accent bar' },
  { id: 'modern', label: 'Modern', desc: 'Bold header with color block' },
  { id: 'minimal', label: 'Minimal', desc: 'Simple, borderless layout' },
  { id: 'boxed', label: 'Boxed grid', desc: 'Every section in ruled boxes, item table filled to a fixed height' },
  { id: 'tally', label: 'Tally style', desc: 'The Tally layout: order and dispatch boxes, HSN tax summary, declaration' },
];

// v1.10.7 — audit H14. Extracted from the inline `items.map(...)` block
// in InvoiceGenerator. Wrapped in React.memo so only the row whose
// `item` reference changed re-renders on any keystroke.
//
// Contract:
//  • `item` — the specific line-item object. Only THIS row's ref
//    changes when the user types in it (handleItemChange uses
//    functional setState with `prev.map`, preserving unchanged item
//    references).
//  • All shared config props (invoiceOptions, units, countryTaxRates,
//    taxLabel, taxLabelIntlLabel, currency, showGST, profileCountry)
//    only change identity when they legitimately change — those DO
//    warrant a re-render across all rows.
//  • All handlers are useCallback in the parent so their identity
//    stays stable across renders.
//  • `suggestions` — the ROW's list of product suggestions. Passed in
//    as a plain array so React.memo can compare it shallowly.
//
// Perf win: typing "Widget" (6 chars) in row 1 of an invoice with 20
// items used to trigger 20 × 6 = 120 row re-renders. Now: 6 (just row 1).
// v1.10.74 - the fixed-discount pickers showed "₹" on every invoice; show
// the invoice currency's own symbol (falls back to the code, e.g. "AED").
export const currencySymbolFor = (code) =>
  COUNTRIES.find(c => c.currency === (code || 'INR'))?.currencySymbol || code || '₹';



// v1.10.77 (#88) - the Tally and Boxed designs pad the item table so a short
// bill still looks like a full page. When that padding alone pushes the
// invoice past one PDF page, trim it (from the bottom) just enough, so the
// terms, bank details and signature stay on page 1. Returns a function that
// puts everything back. Elements: [data-pdf-spacer="stretch"] rows have their
// cells shortened; [data-pdf-spacer="row"] rows are hidden whole.
export function fitSpacersToOnePage(container, pageWmm, pageHmm, ps) {
  const m = (k) => Math.max(0, Number(ps?.[k]) || 0);
  const availW = Math.max(20, pageWmm - m('marginLeft') - m('marginRight'));
  const availH = Math.max(20, pageHmm - m('marginTop') - m('marginBottom'));
  const onePagePx = availH * container.getBoundingClientRect().width / availW;
  let over = container.scrollHeight - onePagePx + 3;
  const spacers = [...container.querySelectorAll('[data-pdf-spacer]')];
  const room = spacers.reduce((s, el) => s + el.getBoundingClientRect().height, 0);
  if (over <= 3 || over > room) return () => {};
  const undo = [];
  for (const el of spacers.reverse()) {
    if (over <= 0) break;
    const h = el.getBoundingClientRect().height;
    if (el.dataset.pdfSpacer === 'row') {
      const prev = el.style.display;
      el.style.display = 'none';
      undo.push(() => { el.style.display = prev; });
      over -= h;
    } else {
      const cells = [...el.children];
      const prev = cells.map((c) => c.style.height);
      const next = Math.max(0, h - over);
      cells.forEach((c) => { c.style.height = `${next}px`; });
      undo.push(() => cells.forEach((c, i) => { c.style.height = prev[i]; }));
      over -= h - next;
    }
  }
  return () => undo.reverse().forEach((f) => f());
}
