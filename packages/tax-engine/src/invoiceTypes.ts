// Moved verbatim from apps/web/src/utils.js (Phase 0, change 0.7/0.8/0.9).
// Types are deliberately loose until the Zod contracts land in Phase 1 (change 1.13).

import type { Rec } from './types.ts';
// Invoice type configuration
export const INVOICE_TYPES: Record<string, Rec> = {
  'tax-invoice': {
    label: 'Tax Invoice',
    prefix: 'INV',
    title: 'TAX INVOICE',
    showGST: true,
    description: 'Standard GST tax invoice',
  },
  // v1.10.73 - a priced offer for work or supply (QUO/26-27/080 style). Like a
  // proforma it is not a sale and never reaches GST returns; convert it to a
  // tax invoice once the client accepts.
  quotation: {
    label: 'Quotation',
    prefix: 'QUO',
    title: 'QUOTATION',
    showGST: true,
    description:
      'Priced offer for work or supply — not a tax document. Convert it to a tax invoice when accepted',
  },
  proforma: {
    label: 'Proforma / Estimate',
    prefix: 'EST',
    title: 'PROFORMA INVOICE',
    showGST: true,
    description: 'Quotation or estimate — not a legal tax document',
  },
  'bill-of-supply': {
    label: 'Bill of Supply (No GST)',
    prefix: 'BOS',
    title: 'BILL OF SUPPLY',
    showGST: false,
    description: 'For exempt goods/services or non-composition dealers selling exempt supplies',
  },
  composition: {
    label: 'Composition (Bill of Supply)',
    prefix: 'COMP',
    title: 'BILL OF SUPPLY',
    showGST: false,
    description: 'For composition-scheme dealers under Section 10. Auto-adds Rule 46A declaration.',
  },
  'credit-note': {
    label: 'Credit Note',
    prefix: 'CN',
    title: 'CREDIT NOTE',
    showGST: true,
    description: 'Issued for returns, price adjustments, or corrections',
  },
  'delivery-challan': {
    label: 'Delivery Challan',
    prefix: 'DC',
    title: 'DELIVERY CHALLAN',
    showGST: false,
    description: 'For goods transport, job work, or supply on approval — not a tax document',
  },
};

// v1.10.67 (#66 item 7, @sangwanmail-eng) — which documents are actual sales.
// A proforma/estimate is only a quote and a delivery challan moves goods
// without selling them, so neither is turnover. A credit note reduces it. A
// cancelled document counts for nothing at all (#66 item 12).
export const SALES_INVOICE_TYPES = ['tax-invoice', 'bill-of-supply', 'composition'];

export const isCancelledBill = (bill: Rec | null | undefined) =>
  (bill?.status || '') === 'cancelled';

export const countsAsSales = (bill: Rec | null | undefined) =>
  !isCancelledBill(bill) && SALES_INVOICE_TYPES.includes(bill?.invoiceType || 'tax-invoice');

export const isCreditNote = (bill: Rec | null | undefined) =>
  (bill?.invoiceType || '') === 'credit-note' && !isCancelledBill(bill);

// +1 for a sale, -1 for a credit note, 0 for quotes, challans and anything cancelled.
export const salesSign = (bill: Rec | null | undefined) =>
  countsAsSales(bill) ? 1 : isCreditNote(bill) ? -1 : 0;
