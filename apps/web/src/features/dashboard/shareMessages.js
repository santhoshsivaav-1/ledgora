// Extracted from Dashboard.jsx (audit Phase 3: no file over 800 lines).
// Pure message builders for the WhatsApp / Email share flows — kept free of
// React, toast and window so they are trivially unit-testable.

import { formatCurrency, amountDue } from '../../utils';

// v1.10.24 — Build a rich WhatsApp / Email caption that carries the full
// payment status. Reported: "please forward with text message too with
// status op payment." On mobile the message rides as WhatsApp caption
// alongside the PDF; on desktop (where PDF can't attach via Web Share)
// this text is ALL the client sees, so we want it to stand alone.
export function buildShareMessage(bill, profile) {
  const currency = bill.currency || bill.data?.invoiceOptions?.currency || 'INR';
  const fmt = (n) => formatCurrency(Number(n) || 0, currency);
  const total = Number(bill.totalAmount) || 0;
  const paidFromArr = (bill.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const paid = paidFromArr > 0 ? paidFromArr : (Number(bill.paidAmount) || 0);
  const outstanding = amountDue(bill) - paid;
  const dueDate = bill.data?.details?.dueDate ? new Date(bill.data.details.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const invDate = bill.invoiceDate ? new Date(bill.invoiceDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const businessName = profile?.businessName || '';
  const status = (bill.status || 'unpaid').toUpperCase();

  // Payment line adapts to state: fully paid / overpaid / partial / unpaid.
  let paymentLine;
  if (outstanding < -0.005) {
    paymentLine = `Paid: ${fmt(paid)}  (Overpaid by ${fmt(Math.abs(outstanding))})`;
  } else if (outstanding <= 0.005) {
    paymentLine = `Paid: ${fmt(paid)}  ✅ FULLY PAID`;
  } else if (paid > 0.005) {
    paymentLine = `Paid: ${fmt(paid)}  ·  *Outstanding: ${fmt(outstanding)}*`;
  } else {
    paymentLine = `*Amount Due: ${fmt(total)}*`;
  }

  const lines = [
    `*Invoice: ${bill.invoiceNumber}*`,
    `Date: ${invDate}${dueDate ? `   ·   Due: ${dueDate}` : ''}`,
    `Client: ${bill.clientName}`,
    `Total: ${fmt(total)}`,
    paymentLine,
    `Status: ${status}`,
  ];
  if (businessName) lines.push('', `— ${businessName}`);
  return lines.join('\n');
}

// v1.10.12 — Status-aware reminder text. Prior code said "due on X" even
// for partial invoices, which read oddly ("paid Rs. 5000 was due
// on...") to clients. Now the wording matches the actual state.
// The "no outstanding balance" guard stays with the caller (it toasts and
// skips the share entirely); this builder assumes there IS an outstanding
// amount. `businessName` is passed in so the caller keeps its own profile.
export function reminderMessage(bill, businessName) {
  const clientName = bill.clientName || 'Sir/Madam';
  const dueDate = bill.data?.details?.dueDate ? new Date(bill.data.details.dueDate).toLocaleDateString('en-IN') : 'N/A';
  const outstanding = amountDue(bill) - (bill.paidAmount || 0);
  const outstandingStr = formatCurrency(outstanding, bill.currency);
  const totalStr = formatCurrency(bill.totalAmount || 0, bill.currency);
  const isPartial = (bill.paidAmount || 0) > 0.01 && outstanding > 0.01;
  const isOverdueDate = bill.data?.details?.dueDate && new Date(bill.data.details.dueDate) < new Date();
  return isPartial
    ? `Hi ${clientName}, this is a gentle reminder that a balance of ${outstandingStr} is pending on Invoice ${bill.invoiceNumber} (total ${totalStr}). Kindly clear the remaining amount at your earliest convenience. Thank you! - ${businessName}`
    : isOverdueDate
      ? `Hi ${clientName}, this is a gentle reminder that Invoice ${bill.invoiceNumber} for ${outstandingStr} was due on ${dueDate}. Kindly arrange the payment at your earliest convenience. Thank you! - ${businessName}`
      : `Hi ${clientName}, this is a gentle reminder about the pending payment of ${outstandingStr} on Invoice ${bill.invoiceNumber}. Kindly arrange the payment at your earliest convenience. Thank you! - ${businessName}`;
}
