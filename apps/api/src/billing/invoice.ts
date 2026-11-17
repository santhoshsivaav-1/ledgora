// The GST tax invoice for a Ledgora subscription payment. Plan prices are shown without GST; the charge is the price plus GST.
// Same state as the seller = CGST + SGST halves; any other state = IGST. All figures in rupees, rounded to the paisa.

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface InvoiceFigures {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

/** Splits a price (without GST) into the tax lines. The halves of CGST/SGST always add back to the GST total. */
export function subscriptionInvoiceFigures(
  price: number,
  ratePct: number,
  sameState: boolean,
): InvoiceFigures {
  const taxable = r2(price);
  const gst = r2((taxable * ratePct) / 100);
  if (!sameState) return { taxable, cgst: 0, sgst: 0, igst: gst, total: r2(taxable + gst) };
  const cgst = r2(gst / 2);
  return { taxable, cgst, sgst: r2(gst - cgst), igst: 0, total: r2(taxable + gst) };
}

/** Financial year label for a date in India: 2026-27 for 1 Apr 2026 to 31 Mar 2027. */
export function fyLabel(d: Date) {
  const ist = new Date(d.getTime() + 330 * 60_000);
  const y = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

export const invoiceNumber = (d: Date, seq: number) =>
  `LS/${fyLabel(d)}/${String(seq).padStart(6, '0')}`;

/** What the trial-mail scheduler should send for a subscription today, given what has been sent already. */
export function trialNotice(
  sub: { status: string; trialEndsAt: Date | null; notices: string[] },
  now: Date,
): 'trial_3d' | 'trial_1d' | 'trial_ended' | null {
  if (sub.status !== 'trialing' || !sub.trialEndsAt) return null;
  const left = (sub.trialEndsAt.getTime() - now.getTime()) / 86_400_000;
  const due = left <= 0 ? 'trial_ended' : left <= 1 ? 'trial_1d' : left <= 3 ? 'trial_3d' : null;
  // Only the most urgent one that applies now, and each once: a trial that is 0.5 days from its end does not get "3 days left".
  return due && !sub.notices.includes(due) ? due : null;
}

/** The same split when the amount charged (GST included) is what we know, as with a payment the provider reports. */
export function subscriptionInvoiceFromTotal(total: number, ratePct: number, sameState: boolean) {
  const taxable = r2(total / (1 + ratePct / 100));
  const f = subscriptionInvoiceFigures(taxable, ratePct, sameState);
  // Rounding the taxable value can leave a paisa between the parts and what was charged; the charge is the truth.
  const diff = r2(total - f.total);
  if (diff === 0) return f;
  return sameState
    ? { ...f, sgst: r2(f.sgst + diff), total: r2(total) }
    : { ...f, igst: r2(f.igst + diff), total: r2(total) };
}
