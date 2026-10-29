// Moved verbatim from apps/web/src/utils.js (Phase 0, change 0.7/0.8/0.9).
// Types are deliberately loose until the Zod contracts land in Phase 1 (change 1.13).

import type { Rec } from './types.ts';
import { getFinancialYearLabel, parseLocalDate } from './dates.ts';
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
