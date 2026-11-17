// Extracted from Dashboard.jsx (audit Phase 3: no file over 800 lines).
// The Record Payment / Edit Payment / Receipt flows: modal state plus the
// handlers that write payments, keep the Receipts store in sync and refresh
// the invoice list. `onBillsChanged` is the Dashboard's loadBills (so the
// paged list refetches the same query after a payment changes).

import { useState } from 'react';
import { saveBill, saveReceipt, deleteReceipt } from '../../lib/data';
import { formatCurrency, localToday, amountDue, paymentStatusFor, isCancelledBill } from '../../utils';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';

export function usePaymentActions({ onBillsChanged }) {
  const [paymentModal, setPaymentModal] = useState(null);
  const [editPaymentModal, setEditPaymentModal] = useState(null);
  const [paymentInput, setPaymentInput] = useState({ amount: '', date: '', mode: 'bank-transfer', note: '' });
  // v1.10.9 — receipt modal state. Opens automatically after
  // recordPayment succeeds; can also be opened via openReceiptFor(...)
  // for reprints.
  const [receiptTarget, setReceiptTarget] = useState(null); // { bill, payment, remaining }

  const openPaymentModal = (bill) => {
    setPaymentModal(bill);
    setPaymentInput({ amount: '', date: localToday(), mode: 'bank-transfer', note: '' });
  };

  const recordPayment = async () => {
    // v1.10.74 - a payment used to flip a cancelled invoice to paid/partial
    // without taking its stock back out. Block it; un-cancel from the status
    // dropdown first (that path fixes stock).
    if (isCancelledBill(paymentModal)) {
      toast('This invoice is cancelled. Change its status back before recording a payment.', 'warning'); return;
    }
    const amount = parseFloat(paymentInput.amount);
    if (!isFinite(amount) || amount <= 0) {
      toast('Enter a positive payment amount', 'warning'); return;
    }
    const bill = paymentModal;
    const alreadyPaid = Number(bill.paidAmount) || 0;
    // What is left to receive: the total less TDS the client deducts.
    const outstanding = Math.max(0, amountDue(bill) - alreadyPaid);
    if (amount > outstanding + 0.01) {
      const proceed = await confirmAction({
        title: 'Record as overpayment?',
        message: `This payment (${formatCurrency(amount, bill.currency)}) is more than the outstanding balance (${formatCurrency(outstanding, bill.currency)}).\n\nThe extra will be saved as client credit and can be applied to future invoices.`,
        confirmLabel: 'Yes, record overpayment',
        tone: 'warning',
      });
      if (!proceed) return;
    }
    const paymentEntry = {
      id: 'pay_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      amount, date: paymentInput.date, mode: paymentInput.mode,
      note: paymentInput.note, recordedAt: new Date().toISOString(),
    };
    const payments = [...(bill.payments || []), paymentEntry];
    const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const updatedBill = {
      ...bill, payments, paidAmount: totalPaid,
      status: paymentStatusFor(bill, totalPaid),
    };
    await saveBill(updatedBill, { overwrite: true });
    // v1.10.10 — Also persist a Receipt record so this payment shows up
    // in the Receipts view. Prior code only appended to bill.payments —
    // the standalone Receipts page saw "No receipts generated yet"
    // even after multiple payments were recorded, which was the user's
    // exact complaint. `saveReceipt` writes to data/receipts/*.json.
    try {
      await saveReceipt({
        id: paymentEntry.id,
        date: paymentEntry.date,
        receiptNo: `RCPT-${paymentEntry.id.replace('pay_', '').toUpperCase().slice(0, 10)}`,
        clientName: bill.data?.client?.name || bill.clientName || '',
        clientAddress: bill.data?.client?.address || '',
        amount: paymentEntry.amount,
        paymentMode: paymentEntry.mode,
        referenceNo: paymentEntry.note || '',
        againstInvoice: bill.invoiceNumber || bill.id || '',
        note: paymentEntry.note || '',
        currency: bill.currency || bill.data?.invoiceOptions?.currency || 'INR',
        source: 'auto-from-payment',
        billId: bill.id,
        // The business that raised the invoice: without it the receipt was
        // listed under every business on the Receipts page.
        ownerGstin: bill.data?.profile?.gstin || bill.ownerGstin || '',
        ownerName: bill.data?.profile?.businessName || bill.ownerName || '',
      });
    } catch { /* non-fatal — receipt is still viewable from the invoice's Payment History */ }
    toast(`Payment of ${formatCurrency(amount, bill.currency)} recorded`, 'success');
    setPaymentModal(null);
    // v1.10.22 — reported: "Balance should be 1 but calculating zero" —
    // ₹649 invoice + ₹650 paid was hiding the ₹1 overpayment because the
    // remaining calc used Math.max(0, …). Now: send the signed value so
    // the receipt can show "Overpaid ₹1" instead of silently rounding away.
    setReceiptTarget({ bill: updatedBill, payment: paymentEntry, remaining: amountDue(bill) - totalPaid });
    onBillsChanged();
  };

  // v1.10.9 — Reprint / view an existing payment's receipt.
  const openReceiptFor = (bill, payment) => {
    const totalPaid = (bill.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    // v1.10.22 — signed remaining; see setReceiptTarget above for context.
    setReceiptTarget({ bill, payment, remaining: amountDue(bill) - totalPaid });
  };

  // v1.10.10 — Delete/Edit a specific payment BY INDEX.
  // Prior code used `p.id === paymentId`, but legacy payments (recorded
  // before v1.10.9 which added `pay_<base36>` ids) don't have ids —
  // `(p.id || '') === undefined` matched EVERY legacy row, so editing
  // one silently edited none (or all). Now the caller passes the row
  // index directly. Modern rows still have ids for the receipt modal
  // to reference, but mutation is index-based.
  const deletePaymentAt = async (bill, idx) => {
    if (!await confirmAction({
      title: 'Delete this payment?',
      message: 'The invoice will revert to unpaid/partial if the sum drops below the total.',
      confirmLabel: 'Delete payment',
      tone: 'danger',
    })) return;
    const target = (bill.payments || [])[idx];
    const payments = (bill.payments || []).filter((_, i) => i !== idx);
    const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const updated = { ...bill, payments, paidAmount: totalPaid, status: paymentStatusFor(bill, totalPaid) };
    await saveBill(updated, { overwrite: true });
    // v1.10.10 — Also remove the linked Receipt record so the Receipts
    // page stays in sync. Silently skips if this was a legacy payment
    // that never had a receipt written (pre-v1.10.10 recordings).
    if (target?.id) {
      try { await deleteReceipt(target.id); } catch { /* ignore */ }
    }
    toast('Payment deleted', 'success');
    setPaymentModal(updated);
    onBillsChanged();
  };

  // v1.10.13 — reported: "receipt edit option edit only enables to add
  // notes to that should give option to edit the amount too because by
  // mistake if wrong amount entered, customer without delete can edit
  // directly". Now opens a proper edit modal (see editPaymentModal
  // state + JSX below) that lets the user change amount, date, mode,
  // and note together — with the same "cannot exceed outstanding"
  // guard that recordPayment already enforces.
  const editPaymentAt = (bill, idx) => {
    const target = (bill.payments || [])[idx];
    if (!target) return;
    setEditPaymentModal({
      bill, idx,
      form: {
        amount: String(target.amount || ''),
        date: target.date || localToday(),
        mode: target.mode || 'bank-transfer',
        note: target.note || '',
      },
    });
  };

  const saveEditedPayment = async () => {
    if (!editPaymentModal) return;
    const { bill, idx, form } = editPaymentModal;
    const newAmount = parseFloat(form.amount);
    if (!isFinite(newAmount) || newAmount <= 0) {
      toast('Enter a positive amount', 'warning'); return;
    }
    // Check the new total doesn't exceed the invoice unless user confirms.
    const others = (bill.payments || []).filter((_, i) => i !== idx);
    const othersSum = others.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const newTotal = othersSum + newAmount;
    const billTotal = Number(bill.totalAmount) || 0;
    if (newTotal > billTotal + 0.01) {
      const ok = await confirmAction({
        title: 'Save as overpayment?',
        message: `This edit brings the total received (${formatCurrency(newTotal, bill.currency)}) above the invoice total (${formatCurrency(billTotal, bill.currency)}).`,
        confirmLabel: 'Save overpayment',
        tone: 'warning',
      });
      if (!ok) return;
    }
    const target = (bill.payments || [])[idx];
    const withId = target.id || ('pay_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    const payments = (bill.payments || []).map((p, i) => i === idx
      // Edited by you, so no longer the automatic "Marked paid" payment (auto is dropped).
      ? { ...p, id: withId, amount: newAmount, date: form.date, mode: form.mode, note: form.note, auto: false }
      : p);
    const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const status = paymentStatusFor(bill, totalPaid);
    const updated = { ...bill, payments, paidAmount: totalPaid, status };
    await saveBill(updated, { overwrite: true });
    // Also update the linked Receipt record so the Receipts page reflects the edit.
    try {
      await saveReceipt({
        id: withId,
        date: form.date,
        // A receipt made on the Receipts page keeps its own number (RCP/...).
        receiptNo: target.receiptNo || `RCPT-${withId.replace('pay_', '').toUpperCase().slice(0, 10)}`,
        clientName: bill.data?.client?.name || bill.clientName || '',
        clientAddress: bill.data?.client?.address || '',
        amount: newAmount,
        paymentMode: form.mode,
        referenceNo: form.note || '',
        againstInvoice: bill.invoiceNumber || bill.id || '',
        note: form.note || '',
        currency: bill.currency || bill.data?.invoiceOptions?.currency || 'INR',
        source: 'auto-from-payment',
        billId: bill.id,
        // The business that raised the invoice: without it the receipt was
        // listed under every business on the Receipts page.
        ownerGstin: bill.data?.profile?.gstin || bill.ownerGstin || '',
        ownerName: bill.data?.profile?.businessName || bill.ownerName || '',
      });
    } catch { /* non-fatal */ }
    toast('Payment updated', 'success');
    setPaymentModal(updated);
    setEditPaymentModal(null);
    onBillsChanged();
  };

  return {
    paymentModal, setPaymentModal,
    editPaymentModal, setEditPaymentModal,
    paymentInput, setPaymentInput,
    receiptTarget, setReceiptTarget,
    openPaymentModal, recordPayment, openReceiptFor,
    editPaymentAt, deletePaymentAt, saveEditedPayment,
  };
}
