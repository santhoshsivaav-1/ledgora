// Moved verbatim from apps/web/src/utils.js (Phase 0, change 0.7/0.8/0.9).
// Types are deliberately loose until the Zod contracts land in Phase 1 (change 1.13).

// GSTR-1 B2C Large: an inter-state sale to an unregistered buyer above this
// invoice value is reported invoice by invoice. The limit fell from ₹2.5 lakh
// to ₹1 lakh for invoices from 1 August 2024 (Notification 12/2024-CT).
export const b2clThreshold = (invoiceDate: string | null | undefined) =>
  String(invoiceDate || '') >= '2024-08-01' ? 100000 : 250000;

// GST rates the GST portal accepts in GSTR-1. 40% is the GST 2.0 rate from
// 22 Sep 2025; 12% and 28% stay for older invoices and the items still taxed so.
export const GST_PORTAL_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];

// v1.10.6 — audit L3: `getTermsPresets(region)` had no importers.
// Components read TERMS_PRESETS directly; that stays exported.

// ========== TDS / TCS (Income Tax Act) ==========
// Common TDS sections that appear on invoices. The buyer deducts this from the
// payment made to us (the seller); we surface it as an informational line so
// the client knows what to deduct, and so our records can track receivable TDS.
// Rates here are the default — users can override per-invoice.
export const TDS_SECTIONS = [
  { code: '194Q', label: '194Q — Purchase of goods (buyer turnover > ₹10cr)', rate: 0.1 },
  { code: '194C', label: '194C — Contractor / sub-contractor', rate: 1 },
  { code: '194C-co', label: '194C — Contractor (company)', rate: 2 },
  { code: '194J', label: '194J — Professional / technical services', rate: 10 },
  { code: '194J-tech', label: '194J — Technical services (lower rate)', rate: 2 },
  { code: '194I', label: '194I — Rent (land / building)', rate: 10 },
  { code: '194I-pm', label: '194I — Rent (plant / machinery)', rate: 2 },
  { code: '194H', label: '194H — Commission / brokerage', rate: 5 },
  { code: '194O', label: '194O — E-commerce participant', rate: 1 },
  { code: '195', label: '195 — Payments to non-residents (varies)', rate: 0 },
  { code: 'custom', label: 'Custom section / rate', rate: 0 },
];

// TCS (Section 206C) is collected BY the seller from the buyer and added to the
// invoice total. Common cases:
//
// v1.10.73 - 206C(1H) (TCS on sale of goods) was omitted from 1 April 2025 by
// the Finance Act 2025, so new invoices can no longer pick it. Invoices saved
// with it keep it and reprint unchanged (see REMOVED_TCS_SECTIONS).
export const REMOVED_TCS_SECTIONS = {
  '206C(1H)': '206C(1H) — removed from 1 April 2025 (older invoices only)',
};

export const TCS_SECTIONS = [
  { code: '52', label: 'CGST 52 — E-commerce operator', rate: 1 },
  { code: '206C(1)', label: '206C(1) — Tendu leaves / scrap / minerals (varies)', rate: 1 },
  { code: 'custom', label: 'Custom rate', rate: 0 },
];
