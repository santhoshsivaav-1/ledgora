// Tax and invoice maths now lives in @ledgora/tax-engine (Phase 0). This file re-exports it so
// every existing import of './utils' keeps working while features move to the new package.
import { BUILTIN_UNITS, INDIAN_STATES, INVOICE_TYPES, amountDue, getFinancialYearStart, localToday, paymentStatusFor, toLocalIsoDate } from '@ledgora/tax-engine';
export { BUILTIN_UNITS, DEFAULT_NUMBER_SETTINGS, DOC_TYPE_PREFIXES, GST_DOC_NUMBER, GST_PORTAL_RATES, INDIAN_STATES, INVOICE_TYPES, MAX_START_NUMBER, REMOVED_TCS_SECTIONS, SALES_INVOICE_TYPES, TCS_SECTIONS, TDS_SECTIONS, TDS_TCS_THRESHOLD, amountDue, appliedStock, b2clThreshold, businessKeyOf, calculateLineItemTax, calculateRoundOff, clientYearToDate, computeInvoiceTotals, counterKeyFor, countsAsSales, decodeGstin, formatDateGST, formatDocNumber, getFilingPeriod, getFinancialYearLabel, getFinancialYearStart, getStateCode, gstinChecksumOk, isCancelledBill, isCreditNote, isInterstateSupply, isUnionTerritoryWithoutLegislature, localToday, nextCounterValue, numberFormatProblem, numberSeriesFor, numberToWords, ownPrefixProblem, parseLocalDate, paymentStatusFor, placeOfSupplyLabel, printedSubtotal, resolveLineDiscount, roundQty, salesSign, setOffITC, splitLineTax, startFor, stateNameForCode, stockDelta, stockEffect, templateTotals, toLocalIsoDate } from '@ledgora/tax-engine';
import {
  getUnitUQC as engineUnitUQC,
  hsnUqc as engineHsnUqc,
  generateEWayBillJSON as engineEWayBillJSON,
} from '@ledgora/tax-engine';

// Custom units live in the browser (localStorage), so the pure engine takes them as an argument.
export const getUnitUQC = (label) => engineUnitUQC(label, getCustomUnits());
export const hsnUqc = (item) => engineHsnUqc(item, getCustomUnits());
export const generateEWayBillJSON = (profile, client, details, items, totals, invoiceType, opts = {}) =>
  engineEWayBillJSON(profile, client, details, items, totals, invoiceType, { customUnits: getCustomUnits(), ...opts });


export const formatCurrency = (amount, currency = 'INR') => {
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency || 'INR',
    minimumFractionDigits: 2
  }).format(amount || 0);
};

// v1.10.66 (#63) — CSV cells that start with = + - @ (or a tab / carriage
// return) are run as FORMULAS by Excel, LibreOffice and Google Sheets. A client
// or item named `=HYPERLINK("http://evil.example","Invoice")` turned into a
// live link inside an exported ledger. Such text is prefixed with an
// apostrophe so the spreadsheet shows it as plain text. Plain numbers —
// including negatives such as a credit note's -500.00 — are left alone so the
// amount columns still add up.
const CSV_FORMULA_START = /^[=+\-@\t\r]/;
const CSV_PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
export const toCsvCell = (value) => {
  let s = String(value ?? '');
  if (s.length > 1 && CSV_FORMULA_START.test(s) && !CSV_PLAIN_NUMBER.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsvLine = (cells) => cells.map(toCsvCell).join(',');


// v1.10.73 - optional order / dispatch / reference details on an invoice,
// the boxes a Tally-style invoice carries. One list drives the editor and
// every PDF design, so a field can never be typed in but not printed.
export const ORDER_DETAIL_FIELDS = [
  { key: 'workDetails', label: 'Work details', wide: true, placeholder: 'e.g. Supply and installation of high mast lights, scope as per annexure' },
  { key: 'revisionNo', label: 'Revision No', placeholder: 'e.g. Rev-1' },
  { key: 'vehicleNo', label: 'Vehicle No', placeholder: 'e.g. TS09AB1234' },
  { key: 'periodFrom', label: 'Service period from', type: 'date' },
  { key: 'periodTo', label: 'Service period to', type: 'date' },
  { key: 'buyerOrderNo', label: "Buyer's Order No", placeholder: 'PO / work order number' },
  { key: 'buyerOrderDate', label: 'Order date', type: 'date' },
  { key: 'referenceNo', label: 'Reference No & Date' },
  { key: 'otherReferences', label: 'Other references' },
  { key: 'deliveryNote', label: 'Delivery Note' },
  { key: 'deliveryNoteDate', label: 'Delivery note date', type: 'date' },
  { key: 'dispatchDocNo', label: 'Dispatch Doc No' },
  { key: 'dispatchedThrough', label: 'Dispatched through', placeholder: 'e.g. VRL Logistics, by road' },
  { key: 'destination', label: 'Destination' },
  { key: 'paymentTerms', label: 'Mode / Terms of payment', placeholder: 'e.g. 30 days, NEFT' },
  { key: 'deliveryTerms', label: 'Terms of delivery', wide: true },
];
// Whether a Customize option is on. Most are on unless switched off; a few are
// off unless chosen; the Tally-style extras are on by default only in that
// design. The Customize panel and the printed invoice both use this, so a tick
// box can never show one thing while the invoice prints another (and the first
// click always flips what you see - it used to take two clicks for options
// that had never been saved).
export const OPTIONS_OFF_BY_DEFAULT = ['showRoundOff', 'showAccountLabel', 'showCess', 'reverseCharge', 'showSystemGeneratedNote'];
export const OPTIONS_ON_FOR_TALLY = ['showHsnSummary', 'showTaxInWords', 'showDeclaration', 'showCustomerSeal'];
export const invoiceOptionOn = (options, key, style = options?.pdfStyle) => {
  const v = options?.[key];
  if (v !== undefined && v !== null) return !!v;
  if (OPTIONS_OFF_BY_DEFAULT.includes(key)) return false;
  if (OPTIONS_ON_FOR_TALLY.includes(key)) return style === 'tally';
  return true;
};
export const DEFAULT_DECLARATION = 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.';

// dd-Mon-yy for printing (31-Aug-26), the way Tally prints dates.
export const formatShortDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-');
};
// The filled-in order details, ready to print as label / value pairs.
export const filledOrderDetails = (details = {}) => ORDER_DETAIL_FIELDS
  .filter((f) => String(details[f.key] || '').trim())
  .map((f) => ({ ...f, value: f.type === 'date' ? formatShortDate(details[f.key]) : String(details[f.key]).trim() }));

// v1.10.70 - where a PDF page is allowed to end.
//
// `edges` are candidate y positions (the tops and bottoms of table rows and
// footer blocks). `keepWhole` are [top, bottom] spans a page edge must never
// pass through. An edge that is safe in one column is not safe in the column
// beside it: the invoice footer puts bank details and terms on the left and
// the signature and stamp on the right, so the gap between bank details and
// terms runs straight through the stamp. The page broke there, printing the
// top of the stamp at the foot of page 1 and the rest on page 2 (ERR-024).
export const safePageBoundaries = (edges, keepWhole) => {
  const spans = (keepWhole || []).filter(([t, b]) => b - t > 2);
  const inside = (y) => spans.some(([t, b]) => y > t + 1 && y < b - 1);
  return [...new Set(edges)].filter((y) => !inside(y)).sort((a, b) => a - b);
};


// Marking an invoice Paid by hand: record a payment for whatever is still
// owed, so payment history, receipts and reports agree with the status. Used
// by the Dashboard and the Clients screen (Clients used to set the paid amount
// only, with no payment). The id gives the payment a real receipt number.
export const markPaidPatch = (bill, note = 'Marked paid') => {
  const payments = Array.isArray(bill.payments) ? bill.payments : [];
  const already = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  // TDS the client deducts is not paid to us (see amountDue).
  const outstanding = Math.max(0, amountDue(bill) - already);
  const now = new Date();
  const amount = Math.round(outstanding * 100) / 100;
  const add = outstanding > 0.005;
  return {
    // What the payments add up to (it used to be the invoice total, even
    // when more had been received or TDS was deducted).
    paidAmount: Math.round((already + (add ? amount : 0)) * 100) / 100,
    payments: add
      ? [...payments, { id: `pay_${now.getTime()}`, amount, date: localToday(), mode: 'other', note, recordedAt: now.toISOString(), auto: true }]
      : payments,
  };
};

// v1.10.77 (#86) - choosing Unpaid takes back the payment that choosing Paid
// recorded (auto: true, or older ones noted "Marked paid ..."). It used to
// leave it, so an "Unpaid" invoice still showed the full amount as Paid and
// never offered a reminder. Payments you recorded (or edited) are kept, and
// the status then follows what they cover. Older "Marked paid" payments have
// no auto flag; they are recognised by that note with mode "other".
export const isAutoPaidPayment = (p) => !!p && (p.auto === true
  || (p.auto === undefined && p.mode === 'other' && /^Marked paid/i.test(String(p.note || ''))));
export const markUnpaidPatch = (bill) => {
  const payments = (Array.isArray(bill.payments) ? bill.payments : []).filter((p) => !isAutoPaidPayment(p));
  const paidAmount = Math.round(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0) * 100) / 100;
  return { payments, paidAmount, status: paymentStatusFor(bill, paidAmount) };
};

// The online documentation. Help buttons link straight to the section for
// their screen, and the sidebar User Guide opens the start (v1.10.75). The
// build of docs-site checks that every doc="page#section" used in src exists.
export const DOCS_URL = 'https://ledgora.com/free-gst-software-documentation/';
export const docsLink = (doc = '') => {
  const [page, section] = String(doc).split('#');
  if (!page || page === 'index') return DOCS_URL + (section ? `#${section}` : '');
  return `${DOCS_URL}${page}.html${section ? `#${section}` : ''}`;
};


// US States + DC
export const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware',
  'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
  'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi',
  'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico',
  'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
  'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'District of Columbia'
];

// Canada Provinces & Territories
export const CANADA_PROVINCES = [
  'Alberta', 'British Columbia', 'Manitoba', 'New Brunswick', 'Newfoundland and Labrador',
  'Northwest Territories', 'Nova Scotia', 'Nunavut', 'Ontario', 'Prince Edward Island',
  'Quebec', 'Saskatchewan', 'Yukon'
];

// Australia States & Territories
export const AUSTRALIA_STATES = [
  'New South Wales', 'Victoria', 'Queensland', 'South Australia',
  'Western Australia', 'Tasmania', 'Australian Capital Territory', 'Northern Territory'
];

// Returns states/provinces list for a country, or [] if free-text is better
export const getStatesForCountry = (countryName) => {
  switch (countryName) {
    case 'India': return INDIAN_STATES;
    case 'United States': return US_STATES;
    case 'Canada': return CANADA_PROVINCES;
    case 'Australia': return AUSTRALIA_STATES;
    default: return [];
  }
};

// ========== Country Configuration ==========
// Each entry: { name, code, currency, currencySymbol, taxLabel, taxIdLabel, taxIdPlaceholder, bankLabel, postalLabel, stateLabel, hasStates, taxRates, taxIdRegex }
// taxRates: common rates for that country's tax dropdown (always allow custom entry)
// taxIdRegex: optional pattern for soft validation (warning only, never blocks save)
export const COUNTRIES = [
  { name: 'India', code: 'IN', currency: 'INR', currencySymbol: '₹', taxLabel: 'GST', taxIdLabel: 'GSTIN', taxIdPlaceholder: '22AAAAA0000A1Z5', bankLabel: 'IFSC Code', postalLabel: 'PIN Code', stateLabel: 'State', hasStates: true, taxRates: [0, 0.1, 0.25, 3, 5, 12, 18, 28, 40], taxIdRegex: /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][A-Z\d]$/ },
  { name: 'United Arab Emirates', code: 'AE', currency: 'AED', currencySymbol: 'AED', taxLabel: 'VAT', taxIdLabel: 'TRN', taxIdPlaceholder: '100123456700003', bankLabel: 'IBAN', postalLabel: 'Postal Code', stateLabel: 'Emirate', hasStates: false, taxRates: [0, 5], taxIdRegex: /^\d{15}$/ },
  { name: 'United States', code: 'US', currency: 'USD', currencySymbol: '$', taxLabel: 'Sales Tax', taxIdLabel: 'EIN / TIN', taxIdPlaceholder: '12-3456789', bankLabel: 'Routing Number', postalLabel: 'ZIP Code', stateLabel: 'State', hasStates: false, taxRates: [0, 4, 6, 7, 8, 9, 10], taxIdRegex: /^\d{2}-?\d{7}$/ },
  { name: 'United Kingdom', code: 'GB', currency: 'GBP', currencySymbol: '£', taxLabel: 'VAT', taxIdLabel: 'VAT Number', taxIdPlaceholder: 'GB123456789', bankLabel: 'Sort Code', postalLabel: 'Postcode', stateLabel: 'County', hasStates: false, taxRates: [0, 5, 20], taxIdRegex: /^GB\d{9}(\d{3})?$/i },
  { name: 'Australia', code: 'AU', currency: 'AUD', currencySymbol: 'A$', taxLabel: 'GST', taxIdLabel: 'ABN', taxIdPlaceholder: '12 345 678 901', bankLabel: 'BSB Number', postalLabel: 'Postcode', stateLabel: 'State/Territory', hasStates: false, taxRates: [0, 10], taxIdRegex: /^\d{2}\s?\d{3}\s?\d{3}\s?\d{3}$/ },
  { name: 'Canada', code: 'CA', currency: 'CAD', currencySymbol: 'CA$', taxLabel: 'GST/HST', taxIdLabel: 'GST/HST Number', taxIdPlaceholder: '123456789 RT 0001', bankLabel: 'Transit Number', postalLabel: 'Postal Code', stateLabel: 'Province', hasStates: false, taxRates: [0, 5, 13, 15], taxIdRegex: /^\d{9}\s?(RT)\s?\d{4}$/i },
  { name: 'Singapore', code: 'SG', currency: 'SGD', currencySymbol: 'S$', taxLabel: 'GST', taxIdLabel: 'GST Reg No.', taxIdPlaceholder: 'M12345678X', bankLabel: 'Bank Code', postalLabel: 'Postal Code', stateLabel: 'Region', hasStates: false, taxRates: [0, 9], taxIdRegex: /^[MTFG]\d{7,8}[A-Z]$/i },
  { name: 'Malaysia', code: 'MY', currency: 'MYR', currencySymbol: 'RM', taxLabel: 'SST', taxIdLabel: 'SST No.', taxIdPlaceholder: 'W10-1234-56789012', bankLabel: 'Bank Code', postalLabel: 'Postcode', stateLabel: 'State', hasStates: false, taxRates: [0, 6, 8, 10] },
  { name: 'Germany', code: 'DE', currency: 'EUR', currencySymbol: '€', taxLabel: 'MwSt', taxIdLabel: 'USt-IdNr.', taxIdPlaceholder: 'DE123456789', bankLabel: 'IBAN', postalLabel: 'PLZ', stateLabel: 'Bundesland', hasStates: false, taxRates: [0, 7, 19], taxIdRegex: /^DE\d{9}$/i },
  { name: 'France', code: 'FR', currency: 'EUR', currencySymbol: '€', taxLabel: 'TVA', taxIdLabel: 'N° TVA', taxIdPlaceholder: 'FR12345678901', bankLabel: 'IBAN', postalLabel: 'Code Postal', stateLabel: 'Région', hasStates: false, taxRates: [0, 5.5, 10, 20], taxIdRegex: /^FR[A-Z\d]{2}\d{9}$/i },
  { name: 'Netherlands', code: 'NL', currency: 'EUR', currencySymbol: '€', taxLabel: 'BTW', taxIdLabel: 'BTW-nummer', taxIdPlaceholder: 'NL123456789B01', bankLabel: 'IBAN', postalLabel: 'Postcode', stateLabel: 'Provincie', hasStates: false, taxRates: [0, 9, 21], taxIdRegex: /^NL\d{9}B\d{2}$/i },
  { name: 'South Africa', code: 'ZA', currency: 'ZAR', currencySymbol: 'R', taxLabel: 'VAT', taxIdLabel: 'VAT Number', taxIdPlaceholder: '4123456789', bankLabel: 'Branch Code', postalLabel: 'Postal Code', stateLabel: 'Province', hasStates: false, taxRates: [0, 15], taxIdRegex: /^4\d{9}$/ },
  { name: 'Nigeria', code: 'NG', currency: 'NGN', currencySymbol: '₦', taxLabel: 'VAT', taxIdLabel: 'TIN', taxIdPlaceholder: '12345678-0001', bankLabel: 'Bank Code', postalLabel: 'Postal Code', stateLabel: 'State', hasStates: false, taxRates: [0, 7.5] },
  { name: 'Kenya', code: 'KE', currency: 'KES', currencySymbol: 'KSh', taxLabel: 'VAT', taxIdLabel: 'KRA PIN', taxIdPlaceholder: 'A123456789Z', bankLabel: 'Bank Code', postalLabel: 'Postal Code', stateLabel: 'County', hasStates: false, taxRates: [0, 8, 16], taxIdRegex: /^[A-Z]\d{9}[A-Z]$/i },
  { name: 'Saudi Arabia', code: 'SA', currency: 'SAR', currencySymbol: 'SAR', taxLabel: 'VAT', taxIdLabel: 'VAT Number', taxIdPlaceholder: '300012345600003', bankLabel: 'IBAN', postalLabel: 'Postal Code', stateLabel: 'Region', hasStates: false, taxRates: [0, 15], taxIdRegex: /^3\d{14}$/ },
  { name: 'Nepal', code: 'NP', currency: 'NPR', currencySymbol: 'Rs', taxLabel: 'VAT', taxIdLabel: 'PAN/VAT No.', taxIdPlaceholder: '123456789', bankLabel: 'Bank Code', postalLabel: 'Postal Code', stateLabel: 'Province', hasStates: false, taxRates: [0, 13] },
  { name: 'Bangladesh', code: 'BD', currency: 'BDT', currencySymbol: '৳', taxLabel: 'VAT', taxIdLabel: 'BIN', taxIdPlaceholder: '123456789-0101', bankLabel: 'Bank Code', postalLabel: 'Postal Code', stateLabel: 'Division', hasStates: false, taxRates: [0, 5, 7.5, 10, 15] },
  { name: 'Sri Lanka', code: 'LK', currency: 'LKR', currencySymbol: 'Rs', taxLabel: 'VAT', taxIdLabel: 'VAT Reg No.', taxIdPlaceholder: '123456789-7000', bankLabel: 'Bank Code', postalLabel: 'Postal Code', stateLabel: 'Province', hasStates: false, taxRates: [0, 18] },
  { name: 'Pakistan', code: 'PK', currency: 'PKR', currencySymbol: 'Rs', taxLabel: 'GST', taxIdLabel: 'NTN', taxIdPlaceholder: '1234567-8', bankLabel: 'Bank Code', postalLabel: 'Postal Code', stateLabel: 'Province', hasStates: false, taxRates: [0, 5, 10, 17, 18] },
  { name: 'Philippines', code: 'PH', currency: 'PHP', currencySymbol: '₱', taxLabel: 'VAT', taxIdLabel: 'TIN', taxIdPlaceholder: '123-456-789-000', bankLabel: 'Bank Code', postalLabel: 'ZIP Code', stateLabel: 'Region', hasStates: false, taxRates: [0, 12] },
  { name: 'Indonesia', code: 'ID', currency: 'IDR', currencySymbol: 'Rp', taxLabel: 'PPN', taxIdLabel: 'NPWP', taxIdPlaceholder: '12.345.678.9-012.000', bankLabel: 'Bank Code', postalLabel: 'Kode Pos', stateLabel: 'Provinsi', hasStates: false, taxRates: [0, 11, 12] },
  { name: 'New Zealand', code: 'NZ', currency: 'NZD', currencySymbol: 'NZ$', taxLabel: 'GST', taxIdLabel: 'GST Number', taxIdPlaceholder: '123-456-789', bankLabel: 'Bank Branch', postalLabel: 'Postcode', stateLabel: 'Region', hasStates: false, taxRates: [0, 15] },
  { name: 'Other', code: 'XX', currency: 'USD', currencySymbol: '$', taxLabel: 'Tax', taxIdLabel: 'Tax ID', taxIdPlaceholder: 'Your tax registration number', bankLabel: 'Bank Routing', postalLabel: 'Postal Code', stateLabel: 'State/Region', hasStates: false, taxRates: [0, 5, 10, 15, 20] },
];

export const getCountryConfig = (countryName) => {
  if (!countryName) return COUNTRIES[0]; // default India
  return COUNTRIES.find(c => c.name === countryName) || COUNTRIES.find(c => c.code === countryName) || COUNTRIES[COUNTRIES.length - 1];
};

// Filter the country list according to the user's region preference.
// 'india' → only India + a synthetic "Other" entry as escape hatch.
// 'international' → everything except India.
// 'both' (default) → all 22 countries.
export const getCountriesForRegion = (regionMode = 'both') => {
  if (regionMode === 'india') {
    return COUNTRIES.filter(c => c.name === 'India' || c.name === 'Other');
  }
  if (regionMode === 'international') {
    return COUNTRIES.filter(c => c.name !== 'India');
  }
  return COUNTRIES;
};


// Upcoming Indian GST / TDS filing due dates relative to `today`. Returns an
// ordered list capped at 60 days out so the notifications centre doesn't show
// 3-month-distant items as "due soon".
//
// Cadence (monthly filer; QRMP / quarterly users will see the same dates but
// only need to act on their schedule):
//   GSTR-1   — 11th of the following month
//   GSTR-3B  — 20th of the following month
//   Form 26Q — 31st of the month following quarter end (Jul / Oct / Jan / Apr)
//   Form 27EQ — 15th of the month following quarter end
export const getUpcomingFilings = (today = new Date()) => {
  const out = [];
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const push = (label, dueDate) => {
    const diff = Math.round((dueDate - t) / 86400000);
    // Local date: toISOString() is UTC, which in India is the previous day
    // for a local midnight, so every due date was shown a day early.
    if (diff >= 0 && diff <= 60) out.push({ label, dueDate: toLocalIsoDate(dueDate), daysAway: diff });
  };
  // From LAST month: its returns fall due this month (GSTR-3B for September
  // is due 20 October) and are the most urgent ones. Starting at this month
  // left them out of the list entirely.
  for (let i = -1; i < 3; i++) {
    const nextMonth = new Date(t.getFullYear(), t.getMonth() + i, 1);
    const m = nextMonth.getMonth();
    const y = nextMonth.getFullYear();
    push(`GSTR-1 (${nextMonth.toLocaleString('en-IN', { month: 'short', year: 'numeric' })})`, new Date(y, m + 1, 11));
    push(`GSTR-3B (${nextMonth.toLocaleString('en-IN', { month: 'short', year: 'numeric' })})`, new Date(y, m + 1, 20));
    // Quarterly TDS / TCS — applies to the quarter the month falls into.
    const quarterEnd = m % 3 === 2; // Mar / Jun / Sep / Dec
    if (quarterEnd) {
      // The January-March quarter is due later: 26Q on 31 May, 27EQ on 15 May.
      const isQ4 = m === 2;
      push(`Form 26Q (TDS Q ending ${nextMonth.toLocaleString('en-IN', { month: 'short' })})`, isQ4 ? new Date(y, 4, 31) : new Date(y, m + 2, 0)); // last day of next month after quarter
      push(`Form 27EQ (TCS Q ending ${nextMonth.toLocaleString('en-IN', { month: 'short' })})`, isQ4 ? new Date(y, 4, 15) : new Date(y, m + 1, 15));
    }
  }

  // Advance-tax installments — same 60-day lookahead. Users on the presumptive
  // scheme (single 15-Mar payment) still see all four so they can plan cashflow,
  // but the interest calc only fires against the 15-Mar row.
  // Each date is tried this year and next; push() keeps only the ones 0-60
  // days away. (The 15 March instalment used to jump to next year from
  // 1 March, so it never showed in the fortnight it is due.)
  const advDates = [
    { label: 'Advance Tax Installment 1 (15% cumulative)', month: 5 },   // 15 Jun
    { label: 'Advance Tax Installment 2 (45% cumulative)', month: 8 },   // 15 Sep
    { label: 'Advance Tax Installment 3 (75% cumulative)', month: 11 },  // 15 Dec
    { label: 'Advance Tax Installment 4 (100% — final)', month: 2 },   // 15 Mar
  ];
  for (const y of [t.getFullYear(), t.getFullYear() + 1]) {
    advDates.forEach(a => push(a.label, new Date(y, a.month, 15)));
    // ITR for the year that ended on 31 March: 31 July / 31 October. It used
    // to point at the NEXT year's deadline from April, so the one actually
    // due that July never appeared.
    push('ITR filing (non-audit) — due', new Date(y, 6, 31));
    push('ITR filing (audit / §44AB) — due', new Date(y, 9, 31));
  }

  return out.sort((a, b) => a.daysAway - b.daysAway);
};

// ============================================================================
// Paper / print sizes
// ----------------------------------------------------------------------------
// Invoices can render at 4 different sizes. A4 is the default (matches the
// current preview + PDF). A5 is half a sheet — same layout, smaller. Thermal
// 80mm and 58mm are receipt-printer strips: single-column compact layout,
// monospace-style typography, no decorative panels.
//
// Each entry:
//   jsPdfFormat  — passed to `new jsPDF({ format })`. For custom sizes it's
//                  an array [widthMm, heightMm]. Thermal uses a large-ish
//                  fixed height because jsPDF needs to know the page size
//                  up-front; extra whitespace is fine on roll paper.
//   cssClass     — applied to the invoice-preview container so styles
//                  branch on size.
//   kind         — 'sheet' | 'thermal'. Thermal switches to a completely
//                  compact template.
// ============================================================================
// ============================================================================
// Paper / print sizes — comprehensive list covering thermal receipt rolls
// AND standard office paper sizes. Each entry declares:
//
//   widthMm         — CONTENT width (printable area, not physical paper).
//                     For thermal rolls, this is smaller than the physical
//                     paper because the print head has margins it can't
//                     reach (e.g. 58mm roll → 48mm printable).
//   heightMm        — Content height (portrait). Thermal uses a large
//                     placeholder height since roll paper is continuous.
//   jsPdfFormat     — Either a jsPDF preset ('a4'/'a5'/'letter'/'legal')
//                     or a custom [widthMm, heightMm] tuple for thermal.
//   jsPdfOrientation— 'portrait' or 'landscape'.
//   cssClass        — Added to invoice-preview-container.
//   kind            — 'sheet' (A4/A5/Letter/Legal) or 'thermal' (roll).
//
// v1.8.5: expanded coverage based on user-shared 58mm printer spec sheet
// (which showed 48mm printable area, not 58mm). Added US Letter, Legal,
// B5, and thermal 76mm / 112mm variants.
// ============================================================================
export const PAPER_SIZES = {
  // ---- Sheet paper (A4 family, Letter, Legal, B5) ------------------------
  a4: {
    label: 'A4 Portrait (default)',
    hint: 'Standard business invoice — 210 × 297 mm',
    widthMm: 210, heightMm: 297,
    jsPdfFormat: 'a4', jsPdfOrientation: 'portrait',
    cssClass: 'paper-a4',
    kind: 'sheet',
  },
  a4Landscape: {
    label: 'A4 Landscape',
    hint: 'Sideways A4 — 297 × 210 mm. More columns fit; useful for detailed itemized invoices.',
    widthMm: 297, heightMm: 210,
    jsPdfFormat: 'a4', jsPdfOrientation: 'landscape',
    cssClass: 'paper-a4-landscape',
    kind: 'sheet',
  },
  a5: {
    label: 'A5 Portrait (compact)',
    hint: 'Half sheet — 148 × 210 mm. Fits smaller printers.',
    widthMm: 148, heightMm: 210,
    jsPdfFormat: 'a5', jsPdfOrientation: 'portrait',
    cssClass: 'paper-a5',
    kind: 'sheet',
  },
  a5Landscape: {
    label: 'A5 Landscape (2 per A4 sheet)',
    hint: 'Sideways A5 — 210 × 148 mm. Print two invoices per A4 sheet.',
    widthMm: 210, heightMm: 148,
    jsPdfFormat: 'a5', jsPdfOrientation: 'landscape',
    cssClass: 'paper-a5-landscape',
    kind: 'sheet',
  },
  letter: {
    label: 'US Letter (216 × 279 mm)',
    hint: 'US / Canada / Mexico standard business size.',
    widthMm: 216, heightMm: 279,
    jsPdfFormat: 'letter', jsPdfOrientation: 'portrait',
    cssClass: 'paper-letter',
    kind: 'sheet',
  },
  legal: {
    label: 'US Legal (216 × 356 mm)',
    hint: 'Longer than Letter — useful for detailed invoices with many line items.',
    widthMm: 216, heightMm: 356,
    jsPdfFormat: 'legal', jsPdfOrientation: 'portrait',
    cssClass: 'paper-legal',
    kind: 'sheet',
  },
  b5: {
    label: 'B5 (176 × 250 mm)',
    hint: 'Between A5 and A4 — used in some Asian markets.',
    widthMm: 176, heightMm: 250,
    jsPdfFormat: 'b5', jsPdfOrientation: 'portrait',
    cssClass: 'paper-b5',
    kind: 'sheet',
  },

  // ---- Thermal rolls ------------------------------------------------------
  // widthMm = ACTUAL PRINTABLE area (per user's shared printer spec sheet:
  // 58mm roll has 48mm printable, 80mm roll typically has 72mm printable).
  // The jsPdfFormat width matches so the PDF page = printable area, and the
  // thermal driver naturally handles the physical roll margin.
  thermal80: {
    label: '80mm Thermal (POS receipt)',
    hint: '80 mm wide roll · ~72 mm printable area. Standard restaurant / retail POS printers (Epson TM, Star TSP, etc.).',
    widthMm: 72, heightMm: 297,
    jsPdfFormat: [72, 297], jsPdfOrientation: 'portrait',
    cssClass: 'paper-thermal-80',
    kind: 'thermal',
  },
  thermal76: {
    label: '76mm Thermal (kitchen printer)',
    hint: '76 mm wide roll · ~68 mm printable area. Older Epson / Bixolon kitchen printers.',
    widthMm: 68, heightMm: 297,
    jsPdfFormat: [68, 297], jsPdfOrientation: 'portrait',
    cssClass: 'paper-thermal-76',
    kind: 'thermal',
  },
  thermal58: {
    label: '58mm Thermal (compact / mobile)',
    hint: '58 mm wide roll · ~48 mm printable area (most common on 58mm printers). Portable / battery / bluetooth thermal.',
    widthMm: 48, heightMm: 297,
    jsPdfFormat: [48, 297], jsPdfOrientation: 'portrait',
    cssClass: 'paper-thermal-58',
    kind: 'thermal',
  },
  thermal112: {
    label: '112mm Thermal (wide receipt)',
    hint: '112 mm wide roll · ~104 mm printable area. Airline boarding passes, warehouse labels, wider receipts.',
    widthMm: 104, heightMm: 297,
    jsPdfFormat: [104, 297], jsPdfOrientation: 'portrait',
    cssClass: 'paper-thermal-112',
    kind: 'thermal',
  },

  // ---- Custom (user-specified dimensions) ---------------------------------
  // A single "custom" preset that reads its actual dimensions from
  // invoiceOptions.customPaperWidth / customPaperHeight. The Customize
  // panel exposes two number inputs when this is selected.
  custom: {
    label: 'Custom size (thermal / roll / stationery)',
    hint: 'Enter any width + height in mm. Widths under 100mm auto-switch to thermal receipt layout (same behaviour as 58 / 80mm presets). Use for 40mm / 76mm / 90mm rolls, or A6 / letter / label stationery.',
    widthMm: 210, heightMm: 297, // fallback defaults if the user hasn't set custom values yet
    jsPdfFormat: [210, 297], jsPdfOrientation: 'portrait',
    cssClass: 'paper-custom',
    kind: 'custom',
  },
};

// Resolve a paper-size config, applying custom dimensions if this is the
// "custom" preset. Callers can pass the invoiceOptions object as the
// second argument to get width/height overrides applied.
// v1.10.51 — Does this rich-text HTML contain any actual visible text?
//
// Adapted from a fix proposed by @venkateshpabbati in #38. The previous
// idiom, duplicated in five places, was:
//
//     html.replace(/<[^>]*>/g, '').trim()
//
// which strips tags but leaves HTML ENTITIES encoded. So `<p>&nbsp;</p>`
// — precisely what a rich-text editor leaves behind when the user clears
// the field — survives as the literal string "&nbsp;" and reads as
// non-empty. The invoice then printed a "Terms & Conditions" heading with
// nothing underneath it.
//
// Parsing decodes entities, and String.trim() treats U+00A0 as
// whitespace, so a cleared field correctly reads as empty. Parsing is
// also robust against tag text the regex mis-handles, e.g.
// `<div title="a>b">`.
//
// Note this is an EMPTINESS CHECK, not a sanitisation boundary — the
// rendering path still runs the HTML through DOMPurify. Parsing with
// DOMParser is inert: it builds a detached document that never executes
// scripts or loads resources.
export const htmlHasText = (html) => {
  if (!html) return false;
  try {
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    return (doc.body?.textContent || '').trim().length > 0;
  } catch {
    // Non-browser context (SSR, tests) — fall back to the old behaviour
    // rather than reporting every field as empty.
    return String(html).replace(/<[^>]*>/g, '').trim().length > 0;
  }
};

export const getPaperSize = (key, options = {}) => {
  const base = PAPER_SIZES[key] || PAPER_SIZES.a4;
  if (base.kind !== 'custom') return base;
  const w = Math.max(30, Math.min(500, Number(options.customPaperWidth) || 80));
  const h = Math.max(50, Math.min(1200, Number(options.customPaperHeight) || 297));
  // Custom paper defaults to thermal-style rendering when width < 100mm.
  const kind = w < 100 ? 'thermal' : 'sheet';
  return {
    ...base,
    widthMm: w, heightMm: h,
    jsPdfFormat: [w, h],
    kind,
    cssClass: kind === 'thermal' ? 'paper-thermal-custom' : 'paper-custom',
  };
};

// v1.10.53 — THE single definition of "which financial year is this date in".
//
// India's FY runs 1 April → 31 March, so the FY that a date belongs to is
// NOT its calendar year for January, February and March — those months
// belong to the FY that started the previous April.
//
// This existed correctly inside getFYOptions and the ITR helper, but
// store.js had reimplemented it as a bare `new Date().getFullYear()`,
// which stamped the WRONG financial year onto every invoice number minted
// between 1 Jan and 31 Mar — three months a year, on the number that gets
// reported in GSTR-1. Anything that needs the FY of a date calls this.
//
//   getFinancialYearStart(new Date('2027-01-15')) === 2026   (FY 2026-27)
//   getFinancialYearStart(new Date('2027-04-01')) === 2027   (FY 2027-28)
// v1.10.60 — reported (#50, @sangwanmail-eng): "Terms and conditions show
// as paragraph in formatted".
//
// The 13 built-in presets all use real <ul>/<li> markup and render as
// lists. But many users type or paste their own terms from Word as ONE
// paragraph with the numbers typed by hand:
//
//   <p>1. Payment due in 15 days. 2. Interest 18% p.a. 3. ...</p>
//
// That is genuinely a single paragraph, so no stylesheet can separate it —
// the app was faithfully rendering what was written. It still reads as a
// wall of text on the invoice, which is the complaint.
//
// This splits such a paragraph at the numbering. It is deliberately
// conservative: it needs THREE OR MORE markers before it will touch
// anything, so ordinary prose containing "Section 2. of the Act" or a
// price like "Rs 2. 50" is left alone. Content already using <li> or <br>
// is skipped entirely — that is already structured.
export const splitNumberedTerms = (html) => {
  if (!html || typeof html !== 'string') return html;
  // v1.10.77 (#84) - plain text (a Terms template typed in Settings, which
  // has no formatting) keeps its line breaks. HTML ignores them, so separate
  // lines printed as one paragraph.
  if (!/<[a-z!/][^>]*>/i.test(html) && /\n/.test(html)) return html.trim().replace(/\r?\n/g, '<br />');
  if (/<(li|br)[ />]/i.test(html)) return html;   // already structured — leave it alone
  const marker = /(^|[\s>])(\d{1,2})\.\s+/g;
  const count = (html.match(marker) || []).length;
  if (count < 3) return html;                         // not a list
  // Break before every marker except the first, so item 1 keeps its place.
  let seen = 0;
  return html.replace(marker, (m, pre, num) => {
    seen += 1;
    return seen === 1 ? m : `${pre}<br />${num}. `;
  });
};

// v1.10.77 (#84) - the saved business profile that is the SAME business as
// this one: the same GSTIN, or the same name on a saved profile that has no
// GSTIN yet (ignoring case and spaces). Saving updates that profile instead of
// adding a duplicate; matching on the name only let the same GSTIN be saved
// twice under two spellings. A different GSTIN is a different business (two
// branches can share a name), and a profile without a GSTIN never overwrites
// one that has it. `loaded` is the saved profile the form was loaded from:
// with the same name it is the one to update (a corrected GSTIN typo).
export const findSameBusiness = (list, p, loaded = null) => {
  const norm = (v) => String(v || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const gstin = norm(p?.gstin);
  const name = norm(p?.businessName);
  return (list || []).find((bp) => (gstin && norm(bp.gstin) === gstin) || (name && norm(bp.businessName) === name && !norm(bp.gstin)))
    || (loaded && name && norm(loaded.businessName) === name ? loaded : null);
};

// v1.10.64 — requested (#55, @sangwanmail-eng): "keep both companies' data
// stored and displayed separately based on their respective GST numbers. An
// invoice belonging to one company should not appear under the other."
//
// Multi-business profiles already switch the letterhead, but every list —
// dashboard, GST returns, reports — showed ALL invoices regardless of which
// business was active. Two businesses meant one mixed set of books.
//
// Scoping by GSTIN rather than by a profile id is deliberate, and it is what
// makes this safe to ship:
//
//   * Older invoices carry NO profile id — the field was added later. Had we
//     filtered on it, every historical invoice would have vanished from the
//     user's books the moment they updated. In accounting software that is
//     the worst failure available.
//   * Every invoice, however old, stores the seller's details at save time
//     under `data.profile`, so the GSTIN is always there to match on.
//   * It survives a rename. This user has invoices reading "Dice Codes" and
//     "Anahat Exclusive" under one GSTIN — the same business, renamed. GSTIN
//     keeps them together; matching on name would have split them in two.
//
// A business with no GSTIN yet (not registered, or mid-setup) falls back to
// its name. And anything we cannot attribute at all is SHOWN, never hidden —
// if in doubt the user sees their invoice.
const normaliseGstin = (v) => String(v || '').trim().toUpperCase();
const normaliseName = (v) => String(v || '').trim().toLowerCase();

// v1.10.65 (#58 item 3) — expenses, purchase bills and recurring templates
// have no `data.profile` block: invoices snapshot the seller onto themselves,
// those records never did. So they also carry a plain `ownerGstin` /
// `ownerName`, stamped when they are saved.
//
// Note the field names. A purchase bill already has `supplierGstin` and an
// expense has `vendorGstin` — those are the OTHER party. Confusing the two
// would file your own purchases under your supplier's business, so the
// owning business is named `owner*` and never read from those fields.
export const getRecordSeller = (record) => ({
  gstin: normaliseGstin(record?.data?.profile?.gstin ?? record?.ownerGstin),
  name: normaliseName(record?.data?.profile?.businessName ?? record?.ownerName),
});

/**
 * Has this record never been attributed to any business?
 *
 * These are records saved before businesses were kept separate. They show
 * under every business, because hiding them would be worse than showing them
 * twice — which is also why the user is offered the chance to assign them
 * rather than having it done silently on their behalf.
 */
export const isUnassignedToBusiness = (record) => {
  const seller = getRecordSeller(record);
  return !seller.gstin && !seller.name;
};

/**
 * Does this saved record belong to the business currently selected?
 *
 * Returns TRUE when it cannot be determined, so an un-attributable record is
 * always visible rather than silently lost.
 */
export const belongsToProfile = (record, profile) => {
  if (!profile) return true;                     // no active business — show everything
  const seller = getRecordSeller(record);
  const activeGstin = normaliseGstin(profile.gstin);
  const activeName = normaliseName(profile.businessName);

  // Prefer GSTIN: unique per taxpayer, and unaffected by renames.
  if (seller.gstin && activeGstin) return seller.gstin === activeGstin;
  // Fall back to the business name when either side has no GSTIN.
  if (seller.name && activeName) return seller.name === activeName;
  // Not attributable — show it.
  return true;
};


// Fiscal-year dropdown options for the last N years. Was previously
// duplicated in 5 files (Dashboard / PurchaseBills / ExpenseTracker /
// GSTReturns / ReportsView) — extracted here so a bugfix only has to
// touch one place. Each entry: { value, label, from, to }.
export const getFYOptions = (n = 5, today = new Date()) => {
  const currentYear = getFinancialYearStart(today);
  const options = [];
  for (let i = 0; i < n; i++) {
    const y = currentYear - i;
    options.push({
      value: `${y}-${y + 1}`,
      label: `FY ${y}-${String(y + 1).slice(-2)}`,
      from: `${y}-04-01`,
      to: `${y + 1}-03-31`,
    });
  }
  return options;
};


// Default unit per invoice mode — used when adding a new line item so the user
// doesn't have to flip the unit dropdown 90% of the time.
// v1.10.77 (#87) - delivery / shipping charges. Added as their own invoice
// line (SAC 996812), so every total, GST return, HSN summary, report and
// export includes them with no special case. Delivery billed with the goods
// is a composite supply, taxed at the rate of the goods (the principal
// supply), so the line starts at the highest GST rate on the invoice; the
// user can change it. isCharge keeps it out of stock and product sales.
export const DELIVERY_SAC = '996812';
export const deliveryChargeLine = (items, amount = 0) => {
  const goodsRates = (items || []).filter((i) => !i.isCharge).map((i) => Number(i.taxPercent) || 0);
  return {
    id: `dlv-${Date.now()}`, name: 'Delivery charges', description: '', hsn: DELIVERY_SAC,
    quantity: 1, unit: 'Nos', rate: Number(amount) || 0, discount: 0,
    taxPercent: goodsRates.length ? Math.max(...goodsRates) : 18, cessPercent: 0, isCharge: true,
  };
};

export const getDefaultUnitForMode = (mode) => {
  if (mode === 'services') return 'Hrs';
  if (mode === 'mixed') return 'Pcs';
  return 'Pcs'; // goods (default) - #66 item 2
};

// Filter units by invoice mode for the dropdown. Service mode hides
// kg/ltr/box etc. (the user can still pick them via "Add custom…" if
// they truly need a goods unit on a service invoice — rare).
export const filterUnitsByMode = (units, mode) => {
  if (mode === 'mixed' || !mode) return units;
  return units.filter(u => u.kind === mode || u.kind === 'both' || u.custom);
};

const CUSTOM_UNITS_KEY = 'gst_customUnits';

export const getCustomUnits = () => {
  try {
    const raw = localStorage.getItem(CUSTOM_UNITS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(u => u && typeof u.label === 'string') : [];
  } catch { return []; }
};

export const addCustomUnit = (label) => {
  const trimmed = (label || '').trim();
  if (!trimmed || trimmed.length > 20) return false;
  const existing = getCustomUnits();
  if (existing.some(u => u.label.toLowerCase() === trimmed.toLowerCase())) return false;
  if (BUILTIN_UNITS.some(u => u.label.toLowerCase() === trimmed.toLowerCase())) return false;
  const next = [...existing, { label: trimmed, uqc: 'OTH', custom: true }];
  try { localStorage.setItem(CUSTOM_UNITS_KEY, JSON.stringify(next)); } catch { return false; }
  return true;
};

export const removeCustomUnit = (label) => {
  const next = getCustomUnits().filter(u => u.label !== label);
  try { localStorage.setItem(CUSTOM_UNITS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
};

export const getAllUnits = () => [...BUILTIN_UNITS, ...getCustomUnits()];


// ========== Tax ID validation ==========
// Returns { ok: boolean, message: string }. Empty value is treated as ok (field is optional).
export const validateTaxId = (countryName, value) => {
  if (!value || !value.trim()) return { ok: true, message: '' };
  const cc = getCountryConfig(countryName);
  if (!cc.taxIdRegex) return { ok: true, message: '' };
  const ok = cc.taxIdRegex.test(value.trim().toUpperCase());
  return ok
    ? { ok: true, message: '' }
    : { ok: false, message: `${cc.taxIdLabel} format looks unusual. Expected like: ${cc.taxIdPlaceholder}` };
};

// ========== Country detection from browser locale ==========
// Maps Intl region code → COUNTRIES.name. Falls back to 'India' on no match.
export const detectCountryFromBrowser = () => {
  try {
    const locale = (navigator?.language || 'en-IN').split('-');
    const region = locale[1]?.toUpperCase() || '';
    const match = COUNTRIES.find(c => c.code === region);
    return match?.name || 'India';
  } catch { return 'India'; }
};

// ========== Currency exchange rate snapshot ==========
// Stored on the invoice itself so historical reports stay accurate even if rates change.
// User enters rate manually; we don't fetch from the network (offline-first).
export const formatExchangeRateLine = (currency, rate, baseCurrency = 'INR') => {
  if (!rate || !currency || currency === baseCurrency) return '';
  return `1 ${currency} = ${Number(rate).toFixed(4)} ${baseCurrency}`;
};

// ========== Payment accounts ==========
// Profiles store an array `paymentAccounts: [{ id, label, bankName,
// accountNumber, ifsc, swift, upiId, isDefault, notes }]`. The legacy flat
// fields (profile.bankName / accountNumber / ifsc / swift / upiId) are kept
// in place for backwards compatibility — `getPaymentAccounts(profile)`
// transparently synthesises a single entry from them when no array exists,
// so old invoices and old profiles keep working without a data migration.

const newAccountId = () => `acc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const getPaymentAccounts = (profile) => {
  if (!profile) return [];
  if (Array.isArray(profile.paymentAccounts) && profile.paymentAccounts.length > 0) {
    return profile.paymentAccounts;
  }
  // Synthesise a single legacy entry if any flat bank/UPI field is set.
  const hasLegacy = profile.bankName || profile.accountNumber || profile.ifsc || profile.swift || profile.upiId;
  if (!hasLegacy) return [];
  return [{
    id: 'legacy',
    label: profile.bankName ? `${profile.bankName}` : 'Default account',
    bankName: profile.bankName || '',
    accountNumber: profile.accountNumber || '',
    ifsc: profile.ifsc || '',
    swift: profile.swift || '',
    upiId: profile.upiId || '',
    isDefault: true,
    notes: '',
  }];
};

export const getDefaultAccount = (profile) => {
  const accounts = getPaymentAccounts(profile);
  return accounts.find(a => a.isDefault) || accounts[0] || null;
};

export const getAccountById = (profile, id) => {
  if (!id) return getDefaultAccount(profile);
  const accounts = getPaymentAccounts(profile);
  return accounts.find(a => a.id === id) || getDefaultAccount(profile);
};

// Create a fresh empty account ready for the user to fill in.
export const createEmptyAccount = (label = 'New account') => ({
  id: newAccountId(),
  label,
  bankName: '',
  // v1.10.37 — Reported: bank account name often differs from the trading
  // name (proprietor's personal name for sole proprietorships, HUF name,
  // abbreviated Pvt Ltd name, etc.). Client NEFT/RTGS transfers fail with
  // "beneficiary name mismatch" when the name doesn't match exactly.
  // Optional — falls back to profile.businessName on the PDF render.
  accountHolderName: '',
  accountNumber: '',
  // v1.10.37 — Optional. NEFT/RTGS doesn't strictly need this but corporate
  // finance teams often categorize by type, and wholesale users routinely
  // use CC/OD accounts. 'savings' | 'current' | 'cc' | 'od' | ''.
  accountType: '',
  ifsc: '',
  swift: '',
  upiId: '',
  isDefault: false,
  isActive: true,
  notes: '',
});

// Active accounts only — used to populate the new-invoice dropdown so
// archived/disabled accounts don't appear, but they remain editable in
// Settings and still resolve for historical invoices that referenced them.
export const getActiveAccounts = (profile) =>
  getPaymentAccounts(profile).filter(a => a.isActive !== false);

// Account number is sensitive — mask all but the last 4 digits for list rows.
// Preserves the visual cue of length without leaking the full number.
export const maskAccountNumber = (n) => {
  const s = String(n || '').trim();
  if (s.length <= 4) return s; // too short to mask
  return '••••' + s.slice(-4);
};

// Returns a NEW accounts array with the entry at fromIdx moved to toIdx.
// Pure — caller writes the result back to profile.paymentAccounts.
export const reorderAccounts = (accounts, fromIdx, toIdx) => {
  if (!Array.isArray(accounts)) return accounts;
  if (fromIdx === toIdx || fromIdx < 0 || fromIdx >= accounts.length) return accounts;
  if (toIdx < 0 || toIdx >= accounts.length) return accounts;
  const next = accounts.slice();
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
};

// Returns a NEW accounts array with exactly one default — the one matching
// `accountId`. Used by the Settings UI's ⭐ buttons. If no match, returns
// the input unchanged.
export const setDefaultAccount = (accounts, accountId) => {
  if (!Array.isArray(accounts) || !accountId) return accounts;
  if (!accounts.some(a => a.id === accountId)) return accounts;
  return accounts.map(a => ({ ...a, isDefault: a.id === accountId }));
};

// Soft UPI VPA format check (warning-only). Allows alphanumerics, dot, hyphen,
// underscore on either side of the @ — covers Indian VPAs like
// "9999999999@upi", "acme.corp@hdfcbank", "merchant-1@paytm".
export const isValidUpiId = (s) => /^[\w.-]+@[\w.-]+$/.test(String(s || '').trim());

// ========== Feature modules ==========
// Each module can be turned off by the user in Settings → Modules. Modules in
// the 'core' group are always on (creating invoices, managing clients, settings)
// — disabling them would leave the app unusable.
//
// `nav` is the corresponding sidebar view id (or null if the module doesn't
// have its own page). When a module is disabled, its nav entry is hidden and
// any related fields/sections in other views are suppressed too.
export const FEATURE_GROUPS = [
  {
    id: 'sales',
    label: 'Sales & Invoicing',
    description: 'Invoice creation, recurring invoices, payment receipts',
    modules: [
      { id: 'invoicing', label: 'Tax invoices, proforma, credit notes', nav: 'new', core: true },
      { id: 'recurring', label: 'Recurring invoices', nav: 'recurring', defaultOn: true },
      { id: 'receipts', label: 'Payment receipts', nav: 'receipts', defaultOn: true },
    ],
  },
  {
    id: 'directory',
    label: 'Directory',
    description: 'Clients and product catalog',
    modules: [
      { id: 'clients', label: 'Clients', nav: 'clients', core: true },
      { id: 'inventory', label: 'Products & Services (inventory)', nav: 'inventory', defaultOn: true },
    ],
  },
  {
    id: 'purchases',
    label: 'Purchases & Expenses',
    description: 'Vendor bills, expense tracking, ITC',
    modules: [
      { id: 'expenses', label: 'Expense tracker', nav: 'expenses', defaultOn: true },
      { id: 'purchases', label: 'Purchase bills', nav: 'purchases', defaultOn: true },
      { id: 'gstr2b', label: 'GSTR-2B reconciliation (purchase ITC matching)', nav: null, defaultOn: true, indiaOnly: true },
    ],
  },
  {
    id: 'gst',
    label: 'GST & Tax (India)',
    description: 'GSTR returns, e-Way Bill, TDS/TCS, HSN summaries',
    modules: [
      { id: 'gstReturns', label: 'GSTR-1 / GSTR-3B exports + filing guide', nav: 'filing', defaultOn: true, indiaOnly: true },
      { id: 'ewayBill', label: 'E-Way Bill JSON export', nav: null, defaultOn: true, indiaOnly: true },
      { id: 'tdsTcs', label: 'TDS / TCS on invoices', nav: null, defaultOn: false, indiaOnly: true },
      { id: 'incomeTax', label: 'Income Tax Helper (regime calc + bank import)', nav: 'incometax', defaultOn: true, indiaOnly: true },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    description: 'Dashboards and financial reports',
    modules: [
      { id: 'dashboard', label: 'Dashboard', nav: 'dashboard', core: true },
      { id: 'reports', label: 'Reports view', nav: 'reports', defaultOn: true },
    ],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    description: 'Payment QR codes',
    modules: [
      { id: 'upiQr', label: 'UPI QR code on invoices', nav: null, defaultOn: true, indiaOnly: true },
    ],
  },
];

// v1.10.6 — audit L3: removed unused exports `ALL_MODULES` and
// `getModuleDefaults` (no importers anywhere in src/). Reintroduce
// if a future consumer needs the flat list.
const ALL_MODULES = FEATURE_GROUPS.flatMap(g => g.modules.map(m => ({ ...m, group: g.id })));

// Returns true if a module is currently enabled. Core modules can never be off.
// User overrides in localStorage (via Settings → Modules) take precedence over defaults.
export const isModuleEnabled = (moduleId, userMap = {}) => {
  const mod = ALL_MODULES.find(m => m.id === moduleId);
  if (!mod) return true; // unknown module — fail open rather than hiding things
  if (mod.core) return true;
  if (Object.prototype.hasOwnProperty.call(userMap, moduleId)) return !!userMap[moduleId];
  return mod.defaultOn !== false;
};

// ========== Built-in Terms & Conditions presets ==========
// Drop-in starter T&C wording grouped by India-common business types. Users pick a
// preset, edit it however they want, and optionally save the result as one of their
// own reusable templates via the existing Terms Templates feature in Settings.
//
// Each entry is rich HTML so the in-invoice rich editor renders bullets and bold
// correctly. Every preset includes an India-relevant jurisdiction line and an
// "all disputes subject to <city> jurisdiction" clause that the user can edit.
export const TERMS_PRESETS = [
  {
    id: 'generic-sme',
    label: 'Generic SME / Trader',
    region: 'IN',
    body: `<p><strong>Payment Terms</strong></p>
<ul>
  <li>Payment is due within <strong>15 days</strong> from the date of invoice.</li>
  <li>Goods once sold will not be taken back or exchanged.</li>
  <li>Interest @ <strong>18% p.a.</strong> will be charged on overdue payments.</li>
  <li>All cheques to be drawn in favour of the company name printed above.</li>
</ul>
<p><strong>Delivery & Title</strong></p>
<ul>
  <li>Goods remain the property of the seller until full payment is received.</li>
  <li>Risk passes to the buyer on dispatch from our premises.</li>
</ul>
<p><strong>Disputes:</strong> Subject to <em>[your city]</em> jurisdiction only.</p>`,
  },
  {
    id: 'freelancer',
    label: 'Freelancer / Consultant',
    region: 'IN',
    body: `<p><strong>Scope</strong></p>
<ul>
  <li>This invoice is for professional services as agreed in our scope of work.</li>
  <li>Any work outside the agreed scope will be quoted separately.</li>
</ul>
<p><strong>Payment</strong></p>
<ul>
  <li>Payment is due within <strong>7 days</strong> from invoice date.</li>
  <li>Late payments accrue interest at <strong>1.5% per month</strong>.</li>
  <li>TDS, if applicable, may be deducted under Section 194J. Please share Form 16A.</li>
</ul>
<p><strong>Intellectual Property:</strong> Final deliverables transfer to client only after the full invoice value is settled.</p>
<p>Disputes subject to <em>[your city]</em> jurisdiction.</p>`,
  },
  {
    id: 'manufacturer',
    label: 'Manufacturer / Wholesale',
    region: 'IN',
    body: `<p><strong>Order & Delivery</strong></p>
<ul>
  <li>Goods are dispatched ex-works unless otherwise agreed in writing.</li>
  <li>Delivery dates are estimates; we are not liable for delays caused by transporters or force majeure events.</li>
  <li>Buyer is responsible for inspection of goods at the time of delivery.</li>
</ul>
<p><strong>Payment</strong></p>
<ul>
  <li>Net <strong>30 days</strong> from date of invoice.</li>
  <li>Interest @ <strong>24% p.a.</strong> on overdue amounts.</li>
  <li>TDS under Section 194Q applicable for buyers with turnover &gt; ₹10 cr.</li>
</ul>
<p><strong>Returns:</strong> Goods sold are not returnable unless defective and notified within 7 days of delivery.</p>
<p>Subject to <em>[your city]</em> jurisdiction.</p>`,
  },
  {
    id: 'retail-shop',
    label: 'Retail Shop',
    region: 'IN',
    body: `<ul>
  <li><strong>No exchange or refund</strong> on goods once sold, except in case of manufacturing defects within 7 days, with original bill.</li>
  <li>Discounted items are not eligible for return or exchange.</li>
  <li>Goods may be exchanged of equal value within 7 days, subject to availability.</li>
  <li>Cheques to be drawn in favour of <em>[shop name]</em>. Interest @ 24% p.a. on dishonoured cheques.</li>
  <li>All disputes subject to <em>[your city]</em> jurisdiction only.</li>
</ul>`,
  },
  {
    id: 'restaurant',
    label: 'Restaurant / Café',
    region: 'IN',
    body: `<ul>
  <li>Service charge, where applicable, is at the discretion of the customer.</li>
  <li>GST as applicable is included as per current government rates.</li>
  <li>Cheques are not accepted. Card and UPI welcomed.</li>
  <li>We reserve the right of admission.</li>
  <li>Disputes subject to <em>[your city]</em> jurisdiction.</li>
</ul>`,
  },
  {
    id: 'it-saas',
    label: 'IT / Software Services',
    region: 'IN',
    body: `<p><strong>Service Terms</strong></p>
<ul>
  <li>Services are billed on a project / monthly retainer basis as agreed.</li>
  <li>Software licenses, third-party services, and infrastructure costs are billed at actuals.</li>
</ul>
<p><strong>Payment</strong></p>
<ul>
  <li>Net <strong>15 days</strong> from invoice date.</li>
  <li>Late payments accrue interest at <strong>18% p.a.</strong></li>
  <li>TDS under Section 194J applicable.</li>
</ul>
<p><strong>SLA & Support:</strong> Support is provided per the agreed SLA. Outages caused by hosting providers, third-party APIs, or scheduled maintenance are excluded.</p>
<p><strong>IP & Confidentiality:</strong> Custom code is licensed to client on full settlement. Confidential information is protected per the signed NDA.</p>
<p>Subject to <em>[your city]</em> jurisdiction.</p>`,
  },
  {
    id: 'construction',
    label: 'Construction / Contractor',
    region: 'IN',
    body: `<p><strong>Work & Materials</strong></p>
<ul>
  <li>Work is executed per the approved drawings and BOQ.</li>
  <li>Any change orders or additional work will be billed separately at agreed rates.</li>
  <li>Materials remain the property of the contractor until full payment is received.</li>
</ul>
<p><strong>Payment Schedule</strong></p>
<ul>
  <li>Payment as per agreed milestones in the contract.</li>
  <li>Final payment due within <strong>30 days</strong> of completion certificate.</li>
  <li>TDS under Section 194C applicable.</li>
  <li>Retention, if any, will be released as per the contract terms.</li>
</ul>
<p><strong>Defects Liability:</strong> 12 months from handover, covering workmanship only.</p>
<p>Subject to <em>[your city]</em> jurisdiction.</p>`,
  },
  {
    id: 'medical',
    label: 'Medical / Healthcare',
    region: 'IN',
    body: `<ul>
  <li>Medicines and consumables once sold cannot be exchanged or returned (Drugs and Cosmetics Rules).</li>
  <li>Services rendered are non-refundable.</li>
  <li>Payment is due at the time of service unless covered by a pre-authorized insurance claim.</li>
  <li>Insurance reimbursement is between patient and insurer; we provide all documentation needed.</li>
  <li>Disputes subject to <em>[your city]</em> jurisdiction.</li>
</ul>`,
  },
  {
    id: 'education',
    label: 'Educational Services / Coaching',
    region: 'IN',
    body: `<ul>
  <li>Fees are non-refundable once classes commence, except as per the published refund policy.</li>
  <li>Course material remains the property of the institute and may not be reproduced without permission.</li>
  <li>Late fee of ₹500 per month after the due date.</li>
  <li>The institute reserves the right to reschedule or cancel classes with prior notice.</li>
  <li>Disputes subject to <em>[your city]</em> jurisdiction.</li>
</ul>`,
  },
  {
    id: 'transport',
    label: 'Transport / Logistics',
    region: 'IN',
    body: `<ul>
  <li>Goods are carried at <strong>owner's risk</strong> unless transit insurance is separately arranged and paid for.</li>
  <li>Delivery times are best-effort estimates and not guaranteed.</li>
  <li>Liability for loss or damage is limited to ₹100 per consignment unless declared value is paid.</li>
  <li>Demurrage / detention charges as per the schedule attached.</li>
  <li>Payment due within <strong>15 days</strong>; interest @ 24% p.a. on overdue amounts.</li>
  <li>Subject to <em>[your city]</em> jurisdiction.</li>
</ul>`,
  },
  {
    id: 'real-estate-rent',
    label: 'Real Estate / Rental Invoice',
    region: 'IN',
    body: `<ul>
  <li>Rent is payable on or before the <strong>5th of every month</strong>.</li>
  <li>Late payments attract a penalty of ₹100 per day after grace period.</li>
  <li>TDS under Section 194I applicable for tenant if annual rent exceeds ₹2.4 lakh.</li>
  <li>Maintenance, electricity, and water charges are billed separately as per usage.</li>
  <li>Premises must be vacated in the same condition as handed over, normal wear and tear excepted.</li>
  <li>Disputes subject to <em>[your city]</em> jurisdiction.</li>
</ul>`,
  },
  {
    id: 'ecommerce',
    label: 'E-commerce Seller',
    region: 'IN',
    body: `<ul>
  <li>Returns accepted within 7 days of delivery, in original packaging, subject to product category policy.</li>
  <li>Refunds are processed to the original payment mode within 7-10 working days of return receipt.</li>
  <li>Products with broken seals, used items, and clearance-sale items are not returnable.</li>
  <li>Shipping charges, where applicable, are non-refundable.</li>
  <li>For warranty, please contact the manufacturer's authorized service center.</li>
  <li>Disputes subject to <em>[your city]</em> jurisdiction. Governed by the Consumer Protection Act, 2019.</li>
</ul>`,
  },
  {
    id: 'export',
    label: 'Export / International (LUT)',
    region: 'IN',
    body: `<p><strong>Tax Status:</strong> Supplied as a zero-rated export under <strong>LUT (Letter of Undertaking)</strong> — IGST not charged. Bond / LUT reference: <em>[insert LUT number]</em>.</p>
<p><strong>Payment</strong></p>
<ul>
  <li>Payable in <em>[USD/EUR/etc.]</em> by SWIFT wire transfer to the bank account printed above.</li>
  <li>All bank charges (sender + intermediary + beneficiary) are to be borne by the buyer.</li>
  <li>Payment due within <strong>30 days</strong> of invoice date.</li>
</ul>
<p><strong>Delivery:</strong> FOB / CIF as per Incoterms 2020 — see the contract for the agreed term.</p>
<p>Disputes subject to <em>[your city]</em>, India jurisdiction.</p>`,
  },
  {
    id: 'custom-blank',
    label: '— Start from blank —',
    region: '*',
    body: '',
  },
];


// ========== Currency name map (for amount-in-words) ==========
// Used by InvoicePreview when rendering "Amount in Words" footer for foreign currencies.
export const CURRENCY_NAMES = {
  INR: { major: 'Rupees', minor: 'Paise' },
  USD: { major: 'Dollars', minor: 'Cents' },
  EUR: { major: 'Euros', minor: 'Cents' },
  GBP: { major: 'Pounds', minor: 'Pence' },
  AUD: { major: 'Dollars', minor: 'Cents' },
  CAD: { major: 'Dollars', minor: 'Cents' },
  SGD: { major: 'Dollars', minor: 'Cents' },
  AED: { major: 'Dirhams', minor: 'Fils' },
  SAR: { major: 'Riyals', minor: 'Halalas' },
  MYR: { major: 'Ringgit', minor: 'Sen' },
  ZAR: { major: 'Rand', minor: 'Cents' },
  NGN: { major: 'Naira', minor: 'Kobo' },
  KES: { major: 'Shillings', minor: 'Cents' },
  NPR: { major: 'Rupees', minor: 'Paisa' },
  BDT: { major: 'Taka', minor: 'Poisha' },
  LKR: { major: 'Rupees', minor: 'Cents' },
  PKR: { major: 'Rupees', minor: 'Paisa' },
  PHP: { major: 'Pesos', minor: 'Centavos' },
  IDR: { major: 'Rupiah', minor: 'Sen' },
  NZD: { major: 'Dollars', minor: 'Cents' },
};

// v1.10.79 (#94) - where the editor keeps an invoice's PDF in Saved Invoices:
// <client>/<month>/<TYPE>_<number>.pdf (see saveToInvoicesFolder).
export const savedPdfNameFor = (bill) => ({
  fileName: `${INVOICE_TYPES[bill?.invoiceType || bill?.data?.invoiceType || 'tax-invoice']?.prefix || 'INV'}_${String(bill?.invoiceNumber || bill?.id || '').replace(/\//g, '-')}.pdf`,
  clientName: bill?.data?.client?.name || 'General',
});


