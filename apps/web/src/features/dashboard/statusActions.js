// Extracted from Dashboard.jsx (audit Phase 3: no file over 800 lines).
// Cancel / un-cancel / status-change actions for single invoices, plus the
// stock-planning helpers they share with the bulk paths. A factory (not a
// hook) because nothing here owns React state — it only needs the
// Dashboard's loadBills to refresh the list after each change.

import { saveBill, deleteReceipt, applyStockChanges, markSavedPdfCancelled } from '../../lib/data';
import {
  isCancelledBill, paymentStatusFor, SALES_INVOICE_TYPES, markPaidPatch, markUnpaidPatch,
  stockEffect, appliedStock, stockDelta,
} from '../../utils';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import { STATUS_CONFIG } from '../invoices/list/statusConfig';

export function createStatusActions({ loadBills }) {
  // v1.10.67 (#66 item 12, @sangwanmail-eng) — an issued invoice is not
  // deleted: its number has to stay in the books, gapless, for GST. Cancelling
  // keeps the document and takes it out of every total and return. Any other
  // status from the dropdown brings it back.
  // Put an invoice's stock back (+1, on cancel) or take it out again (-1, on
  // un-cancel). One place for the single-row and bulk paths: bulk cancel used
  // to skip this, so stock went missing for invoices cancelled in bulk.
  // v1.10.76 (#80) - moves stock from what each bill has done to what it
  // should do in its new status (stockEffect), and returns the bills with
  // their new stock record, ready to save. Cancelling a quotation used to put
  // back stock it never took; now it moves nothing.
  // Plans it from each bill AS SAVED (its current status), so an old bill
  // cancelled before v1.10.76 is known to have had its stock put back. The bill
  // is saved first and the stock moved only for bills whose save succeeded,
  // so a failed save never leaves stock moved with the old record.
  const planStock = (b, newStatus) => {
    if (!b.data) return { bill: b, changes: {} };
    const next = stockEffect(b.data.items, b.invoiceType || b.data.invoiceType, newStatus);
    return { bill: { ...b, data: { ...b.data, stockApplied: next } }, changes: stockDelta(appliedStock(b), next) };
  };
  const moveStock = (plans) => {
    const total = {};
    for (const p of plans) for (const [id, d] of Object.entries(p.changes)) total[id] = (total[id] || 0) + d;
    return applyStockChanges(total);
  };
  // Saves each planned bill with its new status; moves the stock of those that saved.
  const saveWithStock = async (plans, patchFor) => {
    const results = await Promise.allSettled(plans.map((p) => saveBill(patchFor(p.bill), { overwrite: true })));
    await moveStock(plans.filter((_, i) => results[i].status === 'fulfilled'));
    return results;
  };

  // v1.10.79 (#94) - the PDF in Saved Invoices follows: stamped CANCELLED, or
  // back to the original on Undo. A save problem here never undoes the cancel.
  const syncSavedPdfs = async (bills, cancelled) => {
    const results = await Promise.allSettled(bills.map((b) => markSavedPdfCancelled(b, cancelled)));
    const failed = results.filter((r) => r.status === 'rejected' || r.value?.failed > 0).length;
    if (failed) toast(`${failed === 1 ? 'A saved PDF' : `${failed} saved PDFs`} could not be ${cancelled ? 'marked CANCELLED' : 'put back'}. Close the PDF if it is open, then ${cancelled ? 'cancel' : 'undo'} again.`, 'warning', 8000);
  };

  const handleCancelInvoice = async (bill) => {
    if (isCancelledBill(bill)) return;
    const ok = await confirmAction({
      title: 'Cancel this invoice?',
      message: `Invoice ${bill.invoiceNumber} for ${bill.clientName} keeps its number but stops counting in totals, reports and GST returns. Stock is restored for any products on it. You can undo this from the status dropdown.`,
      confirmLabel: 'Cancel invoice',
      tone: 'danger',
    });
    if (ok) {
      try {
        const [res] = await saveWithStock([planStock(bill, 'cancelled')], (b) => ({ ...b, status: 'cancelled', cancelledAt: new Date().toISOString() }));
        if (res.status === 'rejected') throw res.reason;
        syncSavedPdfs([bill], true);
        toast('Invoice cancelled & stock restored', 'success');
        loadBills();
      } catch { toast('Failed to cancel', 'error'); }
    }
  };

  const changeStatus = async (bill, newStatus) => {
    // v1.10.67 (#66 item 12) / v1.10.76 - moving into or out of Cancelled moves
    // the stock (into it from the dropdown too, which used to skip that).
    const plan = isCancelledBill(bill) !== (newStatus === 'cancelled') ? planStock(bill, newStatus) : { bill, changes: {} };
    const updated = { ...plan.bill, status: newStatus };
    if (newStatus === 'cancelled') updated.cancelledAt = new Date().toISOString();
    else delete updated.cancelledAt;
    if (newStatus === 'paid') {
      // Also records a payment for the balance, so payment history and
      // reports agree with the status (see markPaidPatch).
      Object.assign(updated, markPaidPatch(bill));
    }
    if (newStatus === 'unpaid') Object.assign(updated, markUnpaidPatch(bill));
    await saveBill(updated, { overwrite: true });
    // A payment taken back also leaves the Receipts page.
    for (const p of (bill.payments || []).filter((x) => !(updated.payments || []).includes(x))) {
      if (p.id) deleteReceipt(p.id).catch(() => {});
    }
    try { await moveStock([plan]); } catch { /* the status change is saved */ }
    if (isCancelledBill(bill) !== (updated.status === 'cancelled')) syncSavedPdfs([bill], updated.status === 'cancelled');
    toast(updated.status === newStatus
      ? `Marked as ${STATUS_CONFIG[newStatus].label}`
      : `Payments recorded with a receipt remain, so it is ${STATUS_CONFIG[updated.status]?.label || updated.status}`, 'info');
    loadBills();
  };

  // v1.10.77 (#86) - Undo on a cancelled document: back to the status its
  // payments say (it used to come back as Unpaid even when it had been paid).
  // v1.10.78 (#92) - asks first: it puts the document back into totals, GST
  // returns and stock.
  const undoCancel = async (bill) => {
    const type = bill.invoiceType || 'tax-invoice';
    const what = SALES_INVOICE_TYPES.includes(type) ? 'comes back into your totals and GST returns, and any stock it uses is taken out again.'
      : type === 'credit-note' ? 'comes back into your GST returns, and the stock it returned is added back.'
        : type === 'delivery-challan' ? 'comes back, and the stock it sends out is taken out again.'
          : 'comes back as an open document.';
    const ok = await confirmAction({
      title: 'Undo the cancel?',
      message: `${bill.invoiceNumber} ${what}`,
      confirmLabel: 'Yes, undo',
      cancelLabel: 'No',
    });
    if (!ok) return undefined;
    const paid = (bill.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const next = !SALES_INVOICE_TYPES.includes(bill.invoiceType || 'tax-invoice') ? 'unpaid' : paymentStatusFor(bill, paid);
    return changeStatus(bill, next);
  };

  return { planStock, moveStock, saveWithStock, syncSavedPdfs, handleCancelInvoice, changeStatus, undoCancel };
}
