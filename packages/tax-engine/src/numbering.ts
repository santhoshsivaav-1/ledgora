// Moved verbatim from apps/web/src/utils.js (Phase 0, change 0.7/0.8/0.9).
// Types are deliberately loose until the Zod contracts land in Phase 1 (change 1.13).

import type { Rec, Numeric } from './types.ts';
import { INVOICE_TYPES } from './invoiceTypes.ts';

// v1.10.78 (#93) - the next number of a document counter: one more than the
// last one used, but at least `start`, so a business can carry on from its
// paper bill book (1001). A number already used is never handed out again.
// Only tax invoices pass a start ("Start numbering from" in Settings; see
// startFor); every other type counts from 1.
export const MAX_START_NUMBER = 999999999;

export const nextCounterValue = (current: Numeric, start: Numeric = 1) => {
  const last = Math.max(0, Math.floor(Number(current) || 0));
  const from = Math.min(MAX_START_NUMBER, Math.max(1, Math.floor(Number(start) || 1)));
  return Math.max(last + 1, from);
};

// The start a document type uses: Settings' start for tax invoices, else 1.
export const startFor = (invoiceType: string, numberSettings: Rec | null | undefined) =>
  (invoiceType || 'tax-invoice') === 'tax-invoice' ? numberSettings?.startNumber : 1;

// ---- v1.10.79 (#95) invoice number series ----
// Each business can have its own series (own prefix, start, counters) or use
// the shared one. Invoices are stored under their number, so a business with
// its own series must print a prefix no other series uses.
export const DOC_TYPE_PREFIXES = ['INV', 'QUO', 'SO', 'EST', 'BOS', 'COMP', 'CN', 'DC', 'RCP'];

export const DEFAULT_NUMBER_SETTINGS = {
  format: 'branded',
  brandPrefix: '',
  separator: '/',
  showFinYear: true,
  startNumber: 1,
  padDigits: 4,
};

// Who a series belongs to: the GSTIN, else the business name (as belongsToProfile matches).
export const businessKeyOf = (profile: Rec | null | undefined) => {
  const gstin = String(profile?.gstin || '')
    .trim()
    .toUpperCase();
  if (gstin) return gstin;
  const name = String(profile?.businessName || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return name ? `NAME:${name}` : '';
};

// The settings a business numbers with: its own series, else the shared one.
export const numberSeriesFor = (
  shared: Rec,
  seriesMap: Rec | null | undefined,
  businessKey: string,
) => {
  const base = { ...DEFAULT_NUMBER_SETTINGS, ...(shared || {}) };
  const own = businessKey ? seriesMap?.[businessKey] : null;
  return own ? { ...base, ...own, own: true } : { ...base, own: false };
};

// The counter a document type uses in that series.
export const counterKeyFor = (
  typePrefix: string,
  series: Rec | null | undefined,
  businessKey: string,
) =>
  series?.own && businessKey ? `counter_${typePrefix}@${businessKey}` : `counter_${typePrefix}`;

// A document number. With a brand prefix, tax invoices print the brand alone
// (ACME/2026-27/0001) and every other type the brand and its type
// (ACME-QUO/..., ACME-DC/..., ACME-RCP/...): they count separately, so one
// prefix for all of them made a quotation collide with an invoice of the same
// number. A per-type prefix from Print Settings (explicitPrefix) is used as is.
export const formatDocNumber = ({
  settings,
  typePrefix,
  next,
  explicitPrefix = false,
  fyLabel = '',
}: {
  settings: Rec;
  typePrefix: string;
  next: number;
  explicitPrefix?: boolean;
  fyLabel?: string;
}) => {
  const s: Rec = { ...DEFAULT_NUMBER_SETTINGS, ...(settings || {}) };
  const brand = String(s.brandPrefix || '').trim();
  const pfx = explicitPrefix
    ? typePrefix
    : brand
      ? typePrefix === 'INV'
        ? brand
        : `${brand}-${typePrefix}`
      : typePrefix;
  const sep = s.separator || '/';
  if (s.format === 'random')
    return `${pfx}${sep}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  const padded = String(next).padStart(s.padDigits || 4, '0');
  // fyStyle 'short' writes 26-27 instead of 2026-27 (two characters fewer
  // against the portal's 16).
  const fy = s.fyStyle === 'short' ? String(fyLabel).replace(/^\d\d(?=\d\d-)/, '') : fyLabel;
  return s.showFinYear && fy ? `${pfx}${sep}${fy}${sep}${padded}` : `${pfx}${sep}${padded}`;
};

// GST (CGST Rule 46 / 53): an invoice, bill of supply or credit note number is
// at most 16 characters of letters, digits, "-" and "/"; GSTR-1 refuses any
// other. Why this number format breaks that, or '' when it does not.
export const GST_DOC_NUMBER = /^[A-Za-z0-9\-/]{1,16}$/;

// Checked: what GSTR-1 refuses. (Bills of supply have the same legal limit;
// the default COMP/2026-27/0001 is 17 characters - to be decided separately.)
export const GST_NUMBERED_TYPES = ['tax-invoice', 'credit-note'];

export const numberFormatProblem = (
  settings: Rec,
  {
    nextInvoice = 1,
    own = false,
    customPrefixes = {} as Rec,
    fyLabel = '',
  }: { nextInvoice?: number; own?: boolean; customPrefixes?: Rec; fyLabel?: string } = {},
) => {
  const s: Rec = { ...DEFAULT_NUMBER_SETTINGS, ...(settings || {}) };
  if (s.format !== 'random' && !/^[-/]$/.test(s.separator || '/'))
    return `The GST portal does not accept "${s.separator}" in invoice numbers. Use / or -.`;
  for (const type of GST_NUMBERED_TYPES) {
    const override = own ? '' : String(customPrefixes?.[type] || '').trim();
    const sample = formatDocNumber({
      settings:
        s.format === 'random' ? { ...s, format: 'branded', showFinYear: false, padDigits: 6 } : s,
      typePrefix: override || INVOICE_TYPES[type].prefix,
      explicitPrefix: !!override,
      next: type === 'tax-invoice' ? nextInvoice : 1,
      fyLabel,
    });
    if (!GST_DOC_NUMBER.test(sample)) {
      return `${INVOICE_TYPES[type].label} numbers would look like ${sample}: ${sample.length} characters, but the GST portal allows 16. Use a shorter prefix, the short year (${String(fyLabel).replace(/^\d\d(?=\d\d-)/, '') || '26-27'}), or fewer digits.`;
    }
  }
  return '';
};

// Why a business's own prefix cannot be used, or '' when it can. Its numbers
// must never look like another series' numbers.
export const ownPrefixProblem = (
  prefix: string,
  { shared, seriesMap, businessKey, customPrefixes }: Rec = {},
) => {
  const p = String(prefix || '')
    .trim()
    .toUpperCase();
  if (!p) return 'A business with its own numbering needs its own prefix, such as its initials.';
  if (DOC_TYPE_PREFIXES.includes(p))
    return `${p} is used for every business by default. Choose another prefix.`;
  if (
    p ===
    String(shared?.brandPrefix || '')
      .trim()
      .toUpperCase()
  )
    return `${p} is the shared numbering's prefix. Choose another.`;
  const takenBy = Object.entries((seriesMap || {}) as Rec).find(
    ([k, v]) =>
      k !== businessKey &&
      String(v?.brandPrefix || '')
        .trim()
        .toUpperCase() === p,
  );
  if (takenBy) return `Another business already numbers with ${p}. Choose another.`;
  if (
    Object.values(customPrefixes || {}).some(
      (v) =>
        String(v || '')
          .trim()
          .toUpperCase() === p,
    )
  )
    return `${p} is a document prefix in Print Settings. Choose another.`;
  return '';
};
