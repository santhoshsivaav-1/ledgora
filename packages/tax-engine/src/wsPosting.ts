// The billing screens keep bills, purchases, receipts and expenses as workspace documents, in the shapes the screens
// use. These rules turn one such document into the same vouchers the typed documents post (posting.ts), so a business
// that only uses those screens still has books. Pure; the API resolves the business and the ledger accounts.
//
// Money is counted once:
//   a sale's own inline payments post with the sale, but a payment that came from a receipt (it carries `receiptNo`),
//   one moved between bills as credit, and one settled from an advance (`:adj` id) are posted by their receipt, or not
//   at all (credit moved between bills is not money);
//   a purchase posts only the payments made with the bill (`source: 'purchase_inline'`); Payment Out vouchers post
//   themselves.
// Workspace parties are names, not ledger parties, so party lines carry no party id.

import { postExpense, postInvoice, postPayment, postPurchase, type Posting } from './posting.ts';
import { itcSplit, itcClaimable } from './purchase.ts';
import type { Rec } from './types.ts';

const n = (v: unknown) => Number(v) || 0;
const r2 = (x: number) => Math.round(x * 100) / 100;
const split = (tax: number, cess: number, inter: boolean) =>
  inter
    ? { igst: r2(tax), cgst: 0, sgst: 0, cess: r2(cess) }
    : { igst: 0, cgst: r2(tax / 2), sgst: r2(tax - r2(tax / 2)), cess: r2(cess) };

const INTERNAL_MODES = new Set(['credit-applied', 'credit-transferred-out']);

/** The money entries of a workspace bill that are posted with the bill itself. */
export const billOwnPayments = (b: Rec) =>
  ((b.payments ?? b.data?.payments ?? []) as Rec[]).filter(
    (p) =>
      !p?.receiptNo &&
      !INTERNAL_MODES.has(String(p?.mode || '')) &&
      !String(p?.id || '').includes(':adj') &&
      n(p?.amount) > 0,
  );

export function wsBillPostings(b: Rec, refId: string): Posting[] {
  const t = (b.data?.totals ?? {}) as Rec;
  const inter = !!t.isInterstate || n(t.igst) > 0;
  const tax = {
    cgst: inter ? 0 : n(t.cgst),
    sgst: inter ? 0 : n(t.sgst) + n(t.utgst),
    igst: inter ? n(t.igst) : 0,
    cess: n(t.cess),
  };
  return postInvoice({
    id: refId,
    invoiceType: b.invoiceType || b.data?.invoiceType || 'tax-invoice',
    status: b.status,
    number: b.invoiceNumber,
    invoiceDate: b.invoiceDate,
    total: n(t.total ?? b.totalAmount),
    ...tax,
    tcsAmount: n(t.tcsAmount),
    roundOff: n(t.roundOff),
    chargesTaxable: 0,
    payments: billOwnPayments(b).map((p) => ({ amount: p.amount, mode: p.mode, date: p.date })),
  });
}

export function wsPurchasePostings(p: Rec, refId: string): Posting[] {
  const inter = !!p.interstate || p.importType === 'goods' || p.importType === 'services';
  const items = (p.items ?? []) as Rec[];
  const legacy = !(p.charges as Rec[] | undefined)?.length && items.every(itcClaimable);
  const totalTax = n(p.totalTax);
  const heads = legacy
    ? split(totalTax, 0, inter)
    : (() => {
        const s = itcSplit(items, { interstate: inter, charges: p.charges as never });
        return { ...s.total };
      })();
  const eligible = legacy
    ? heads
    : itcSplit(items, { interstate: inter, charges: p.charges as never }).eligible;
  return postPurchase({
    id: refId,
    docType: p.docType || 'bill',
    purchaseDate: p.date,
    invoiceNumber: p.invoiceNumber || p.number,
    number: p.number,
    total: n(p.totalAmount),
    taxableAmount: n(p.taxableAmount),
    ...heads,
    itc: { eligible },
    tdsAmount: n(p.tdsAmount),
    reverseCharge: !!p.reverseCharge || p.importType === 'services',
    refundMode: p.refundMode,
    payments: ((p.payments ?? []) as Rec[])
      .filter((x) => x?.source === 'purchase_inline' && n(x.amount) > 0)
      .map((x) => ({ amount: x.amount, mode: x.mode, date: x.date })),
  });
}

/** A receipt (Payment In) or a Payment Out voucher. */
export function wsReceiptPostings(r: Rec, refId: string): Posting[] {
  const out = r.direction === 'out';
  return postPayment({
    id: refId,
    direction: out ? 'out' : 'in',
    number: r.receiptNo || r.voucherNo,
    paymentDate: r.date,
    amount: n(r.amount),
    tdsAmount: n(r.tds),
    discountAmount: n(r.discount),
    mode: r.mode || r.paymentMode || 'cash',
  });
}

/** An expense or other income (`kind: 'income'`). The screens keep `amount` with GST in it. */
export function wsExpensePostings(e: Rec, refId: string): Posting[] {
  const gst = n(e.gstAmount);
  return postExpense({
    id: refId,
    kind: e.kind === 'income' ? 'income' : 'expense',
    expenseDate: e.date,
    number: e.invoiceNo,
    description: e.description || e.category,
    amount: r2(n(e.amount) - gst),
    taxAmount: gst,
    interstate: !!e.interstate,
    itcEligible: e.itcEligible,
    exempt: !!e.exempt,
    paymentMode: e.paymentMode || 'cash',
  });
}

export const WS_LEDGER_COLLECTIONS = ['bills', 'purchases', 'receipts', 'expenses'] as const;
export type WsLedgerCollection = (typeof WS_LEDGER_COLLECTIONS)[number];

/** The vouchers of one workspace document (`refId` is its row id). Cancelled or deleted documents post nothing. */
export function workspacePostings(collection: string, doc: Rec | null, refId: string): Posting[] {
  if (!doc) return [];
  if (collection === 'bills') return wsBillPostings(doc, refId);
  if (collection === 'purchases') return wsPurchasePostings(doc, refId);
  if (collection === 'receipts') return wsReceiptPostings(doc, refId);
  if (collection === 'expenses') return wsExpensePostings(doc, refId);
  return [];
}
