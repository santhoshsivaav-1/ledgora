// Moved verbatim from apps/web/src/utils.js (Phase 0, change 0.7/0.8/0.9).
// Types are deliberately loose until the Zod contracts land in Phase 1 (change 1.13).

import type { Numeric, Rec } from './types.ts';
import { getFinancialYearLabel, parseLocalDate } from './dates.ts';
import { finiteNonNeg, r2, sum } from './money.ts';
import { countsAsSales } from './invoiceTypes.ts';

// What this client has already been billed in the financial year of
// `invoiceDate` (sales only, rupees, including GST), for the ₹50L threshold of
// sections 194Q / 206C(1H). `excludeId` leaves out the invoice being edited.
// Used by the invoice screen and the server's recurring invoices, so both
// count the same way (the invoice screen used to always pass 0, which made
// TCS/TDS 0 on any invoice under ₹50L however much the client had bought).
export const clientYearToDate = (
  bills: Rec[] | null | undefined,
  clientName: string,
  invoiceDate: string,
  excludeId: string | null = null,
) => {
  const name = String(clientName || '')
    .trim()
    .toLowerCase();
  if (!name) return 0;
  const fy = getFinancialYearLabel(invoiceDate ? parseLocalDate(invoiceDate) : new Date());
  return (bills || []).reduce((sum: number, b: Rec) => {
    if (!b || b.id === excludeId || !countsAsSales(b)) return sum;
    if ((b.currency || 'INR') !== 'INR') return sum;
    if (
      String(b.clientName || '')
        .trim()
        .toLowerCase() !== name
    )
      return sum;
    if (!b.invoiceDate || getFinancialYearLabel(parseLocalDate(b.invoiceDate)) !== fy) return sum;
    return sum + (Number(b.totalAmount) || 0);
  }, 0);
};

// What the client still has to pay to settle a bill: the total less any TDS
// the client deducts (they pay "Net Receivable" and deposit the TDS with the
// government). Without this an invoice with TDS could never become Paid.
export const amountDue = (bill: Rec) => {
  const total = Number(bill?.totalAmount) || 0;
  const tds = Number(bill?.data?.totals?.tdsAmount) || 0;
  return Math.round((total - Math.min(Math.max(0, tds), total)) * 100) / 100;
};

// Status a bill's payments put it in (cancelled is never decided here).
export const paymentStatusFor = (bill: Rec, paid: number) => {
  const due = amountDue(bill);
  if (due > 0 && paid >= due - 0.005) return 'paid';
  return paid > 0.005 ? 'partial' : 'unpaid';
};

// ---- the allocation engine, shared by both sides (Vyapar parity P2-S5, P3-S2) ----------------------------------------------

/** in = money received from a customer (Payment In); out = money paid to a supplier (Payment Out). */
export type PaymentDirection = 'in' | 'out';

/** A document a payment can settle: a sale invoice (in) or a purchase bill (out), with what is still pending on it. */
export interface OpenDoc {
  id: string;
  date?: string;
  pending: Numeric;
}

const EPS = 0.005;
const n = (v: Numeric) => Number(v) || 0;

/**
 * Applies a payment to open documents. The maths is the same in both directions: what a payment settles is the money
 * plus any discount and TDS (`settled = amount + discount + tds`; on Payment In the discount is allowed and the TDS kept
 * by the customer, on Payment Out the discount is received and the TDS deducted by us), and whatever is not applied
 * stays as an advance. `oldest_first` fills documents by date; `manual` takes the user's amounts by document id, each
 * capped at what is pending. Only the sign of the effect on the party's balance differs (`balanceEffect`).
 */
export function allocatePayment(o: {
  direction?: PaymentDirection;
  amount: Numeric;
  discount?: Numeric;
  tds?: Numeric;
  docs: OpenDoc[];
  strategy?: 'oldest_first' | 'manual';
  manual?: Record<string, Numeric>;
}) {
  const direction = o.direction ?? 'in';
  const amount = r2(finiteNonNeg(o.amount));
  const discount = r2(finiteNonNeg(o.discount));
  const tds = r2(finiteNonNeg(o.tds));
  const settled = r2(amount + discount + tds);
  const errors: string[] = [];
  const list = [...(o.docs || [])];
  let allocations: { docId: string; amount: number }[] = [];
  if (o.strategy === 'manual') {
    for (const doc of list) {
      const want = r2(finiteNonNeg(o.manual?.[doc.id]));
      if (want <= 0) continue;
      if (want > r2(n(doc.pending)) + EPS)
        errors.push(`More than is pending on ${doc.id} (₹${r2(n(doc.pending)).toFixed(2)})`);
      allocations.push({ docId: doc.id, amount: Math.min(want, r2(n(doc.pending))) });
    }
  } else {
    list.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    let left = settled;
    for (const doc of list) {
      const pending = r2(n(doc.pending));
      if (left <= 0) break;
      if (pending <= 0) continue;
      const take = r2(Math.min(pending, left));
      allocations.push({ docId: doc.id, amount: take });
      left = r2(left - take);
    }
  }
  allocations = allocations.filter((a) => a.amount > 0);
  const allocated = r2(sum(allocations.map((a) => a.amount)));
  if (allocated > settled + EPS)
    errors.push(
      `Allocated ₹${allocated.toFixed(2)} is more than the ₹${settled.toFixed(2)} settled`,
    );
  return {
    direction,
    settled,
    allocations,
    allocated,
    advance: r2(Math.max(0, settled - allocated)),
    balanceEffect: paymentBalanceEffect(direction, settled),
    ok: errors.length === 0,
    errors,
  };
}

/**
 * What a payment does to the party's balance, read as "they owe us" (positive = receivable, negative = payable).
 * Money in from a customer lowers what they owe; money out to a supplier lowers what we owe them, which moves the
 * balance up by the same amount. The mirror image of one rule, not two rules.
 */
export const paymentBalanceEffect = (direction: PaymentDirection, settled: Numeric) =>
  direction === 'out' ? r2(finiteNonNeg(settled)) : -r2(finiteNonNeg(settled));

/**
 * Splits a payment's allocations into the parts that came from money, discount and TDS, in proportion, so each
 * document's settled amount can be shown and reported in its three parts. Rounding remainder goes to the money part.
 */
export function splitSettlement(
  allocation: Numeric,
  o: { amount: Numeric; discount?: Numeric; tds?: Numeric },
) {
  const settled = n(o.amount) + n(o.discount) + n(o.tds);
  if (settled <= 0) return { money: 0, discount: 0, tds: 0 };
  const discount = r2((n(allocation) * n(o.discount)) / settled);
  const tds = r2((n(allocation) * n(o.tds)) / settled);
  return { money: r2(n(allocation) - discount - tds), discount, tds };
}

/**
 * A party's statement in one figure: documents raised less what payments settled less what returns took back. For a
 * supplier (P3 acceptance 3) that is bills − payments out − debit notes, the amount still payable.
 */
export function partyStatement(o: {
  documents?: { total?: Numeric; cancelled?: boolean }[];
  payments?: { amount?: Numeric; discount?: Numeric; tds?: Numeric }[];
  returns?: { total?: Numeric; cancelled?: boolean }[];
}) {
  const live = (d: { cancelled?: boolean }) => !d.cancelled;
  const documents = r2(sum((o.documents || []).filter(live).map((d) => finiteNonNeg(d.total))));
  const settled = r2(
    sum(
      (o.payments || []).map(
        (p) => finiteNonNeg(p.amount) + finiteNonNeg(p.discount) + finiteNonNeg(p.tds),
      ),
    ),
  );
  const returns = r2(sum((o.returns || []).filter(live).map((d) => finiteNonNeg(d.total))));
  return { documents, settled, returns, balance: r2(documents - settled - returns) };
}
