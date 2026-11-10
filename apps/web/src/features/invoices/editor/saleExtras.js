// Vyapar parity Phase 2 in the invoice editor: how the payment rows, charges and save checks map onto the invoice
// document the editor saves (workspace collection `bills`). The decisions themselves are the tax-engine's
// (inlinePaymentCheck, creditCheck, cashLimitCheck), the same ones the /v1 API makes.
import {
  cashLimitCheck,
  cleanCharges,
  creditCheck,
  inlinePaymentCheck,
  overReturns,
  returnableQty,
  saleOrderProgress,
} from '@ledgora/tax-engine';
import { amountDue, isCancelledBill, SALES_INVOICE_TYPES } from '../../../utils';

export const INLINE = 'invoice_inline';

export const PAYMENT_MODE_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** The document types money can be taken with: a sale is settled by it, a sale order keeps it as an advance. */
export const takesPayment = (type) => SALES_INVOICE_TYPES.includes(type || 'tax-invoice') || type === 'sales-order';

/** The rows the Payment block edits: this invoice's own inline payments. */
export const inlineRowsOf = (bill) =>
  (bill?.payments || [])
    .filter((p) => p?.source === INLINE)
    .map((p) => ({
      id: p.id,
      mode: p.mode || 'cash',
      amount: Number(p.amount) || 0,
      reference: p.reference || '',
      chequeDate: p.chequeDate || '',
      accountId: p.accountId || null,
    }));

/** Payments recorded some other way (receipts, the Dashboard, client credit): shown read-only in the block. */
export const earlierPaymentsOf = (payments) => (payments || []).filter((p) => p?.source !== INLINE);

/**
 * The bill's payments after a save: everything that is not an inline row kept as it is, then the block's rows as
 * payment entries dated with the invoice. Rows keep their id across saves so edits do not duplicate them.
 */
export function mergeInlinePayments(payments, rows, { date, invoiceNumber, now = () => new Date().toISOString() }) {
  const kept = earlierPaymentsOf(payments);
  const fresh = (rows || [])
    .filter((r) => Number(r.amount) > 0)
    .map((r, i) => ({
      id: r.id || `inl_${Date.now().toString(36)}${i}${Math.random().toString(36).slice(2, 5)}`,
      amount: r2(r.amount),
      date,
      mode: r.mode || 'cash',
      reference: r.reference || '',
      ...(r.mode === 'cheque' ? { chequeDate: r.chequeDate || '' } : {}),
      ...(r.accountId ? { accountId: r.accountId } : {}),
      note: `Received with ${invoiceNumber}${r.reference ? ` · ref ${r.reference}` : ''}`,
      source: INLINE,
      recordedAt: now(),
    }));
  return [...kept, ...fresh];
}

/** What the block shows under the rows, and the error that disables Save. */
export function paymentSummary(rows, { total, payments }) {
  const earlier = r2(earlierPaymentsOf(payments).reduce((s, p) => s + (Number(p.amount) || 0), 0));
  return inlinePaymentCheck({ payments: rows, total, earlier });
}

/** What a client owes across their live sales, less credit notes, for the credit-limit check. */
export function clientOutstanding(bills, clientName, excludeId = null) {
  let owed = 0;
  for (const b of bills || []) {
    if (!b || b.id === excludeId || isCancelledBill(b)) continue;
    if (!sameName(b.clientName || b.data?.client?.name, clientName)) continue;
    const type = b.invoiceType || 'tax-invoice';
    if (type === 'credit-note') owed -= Number(b.totalAmount) || 0;
    else if (SALES_INVOICE_TYPES.includes(type)) owed += amountDue(b) - (Number(b.paidAmount) || 0);
  }
  return r2(owed);
}

/** Cash this client already paid on a day, across saved bills (§269ST counts per person per day). */
export function dayCashFromBills(bills, clientName, date, excludeId = null) {
  let sum = 0;
  for (const b of bills || []) {
    if (!b || b.id === excludeId || isCancelledBill(b)) continue;
    if (!sameName(b.clientName || b.data?.client?.name, clientName)) continue;
    for (const p of b.payments || []) if (p?.mode === 'cash' && p.date === date) sum += Number(p.amount) || 0;
  }
  return r2(sum);
}

/**
 * The checks Save runs before writing (P2-S4), as a list the editor answers one by one: a credit-limit warning to
 * confirm, a block that stops the save, and the §269ST banner that needs a typed acknowledgement.
 */
export function saveChecks({ client, bills, invoiceType, total, rows, payments, invoiceDate, editingId, cashLimit }) {
  const out = [];
  const name = client?.name;
  const isSale = SALES_INVOICE_TYPES.includes(invoiceType || 'tax-invoice');
  if (isSale && name && client?.creditMode && client.creditMode !== 'none') {
    const received = (rows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const earlier = earlierPaymentsOf(payments).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const c = creditCheck({
      limit: Number(client.creditLimit) || 0,
      mode: client.creditMode,
      used: clientOutstanding(bills, name, editingId),
      newAmount: r2(total - received - earlier),
    });
    if (!c.ok) out.push({ kind: 'credit', ...c, party: name });
  }
  const newCash = (rows || []).filter((r) => r.mode === 'cash').reduce((s, r) => s + (Number(r.amount) || 0), 0);
  if (name && newCash > 0) {
    const cash = cashLimitCheck({ dayCashTotal: dayCashFromBills(bills, name, invoiceDate, editingId), newCash, limit: cashLimit });
    if (cash.breached) out.push({ kind: 'cash', ...cash, party: name });
  }
  return out;
}

/** Charge rows → what is saved in data.charges (blank rows dropped, numbers cleaned). */
export const savedCharges = (rows) =>
  cleanCharges(rows).map((c, i) => ({ ...c, id: c.id || `chg_${i + 1}` }));

/** Settings > Transaction charge presets, falling back to the built-in list. */
export const chargePresets = (prefs, fallback) => {
  const list = prefs?.transaction?.chargePresets;
  return Array.isArray(list) && list.length ? list : fallback;
};

// ---- P2-S6 ---------------------------------------------------------------------------------------------------------------

const isCreditNoteAgainst = (b, number) =>
  (b?.invoiceType || b?.data?.invoiceType) === 'credit-note' &&
  String(b?.data?.details?.originalInvoiceRef || '').trim() === number;

/** Lines of a credit note that return more than is left on the invoice it is against. Empty = fine. */
export function creditNoteOverReturns({ bills, againstNumber, items, editingId = null }) {
  const inv = (bills || []).find((b) => b && (b.invoiceNumber === againstNumber || b.id === againstNumber));
  if (!inv) return [];
  const prior = (bills || [])
    .filter((b) => b && b.id !== editingId && isCreditNoteAgainst(b, inv.invoiceNumber || inv.id))
    .map((b) => ({ status: isCancelledBill(b) ? 'cancelled' : b.status, items: (b.data?.items || []).filter((i) => !i.isCharge) }));
  const left = returnableQty((inv.data?.items || []).filter((i) => !i.isCharge), prior);
  return overReturns((items || []).filter((i) => !i.isCharge && String(i.name || '').trim()), left);
}

/** A saved sale order's progress from the documents converted from it (data.sourceDoc names the order). */
export function orderProgressFromBills(order, bills) {
  const made = (bills || [])
    .filter((b) => b && b.id !== order.id && b.data?.sourceDoc?.number === order.invoiceNumber)
    .map((b) => ({ status: isCancelledBill(b) ? 'cancelled' : b.status, items: b.data?.items || [] }));
  return saleOrderProgress(
    (order.data?.items || []).filter((i) => !i.isCharge),
    made,
    isCancelledBill(order),
  );
}
