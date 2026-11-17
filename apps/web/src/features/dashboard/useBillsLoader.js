// Extracted from Dashboard.jsx (audit Phase 3: no file over 800 lines).
// The load-and-reconcile logic behind the invoice list: fetching bills (full
// list, or one 50-invoice page at a time — audit S6), repairing orphaned
// payments and auto-marking overdue invoices. The reconciliation / overdue
// cores are plain functions so they can be unit-tested; the hook only wires
// them to React state and the API.

import { useRef, useState } from 'react';
import { toast } from '../../components/ui/Toast';
import { saveBill, getAllBills, listBillsPage, getAllReceipts } from '../../lib/data';
import { localToday, belongsToProfile, isCancelledBill, paymentStatusFor, SALES_INVOICE_TYPES } from '../../utils';

export const BILLS_PAGE_SIZE = 50;

// v1.10.41 — Orphaned-payment reconciliation. Reported: user
// recorded a payment in an older version — the receipt file
// exists on disk (Receipts page shows it) but the bill's
// paidAmount stayed at 0 and Dashboard showed the invoice as
// Overdue with PAID = "—". Root cause was cross-file data
// drift: receipts persist in data/receipts/*.json with a
// billId reference; bills persist in data/bills/*.json with
// their own payments[] array. If a save regression or stale
// editingBill overwrite ever emptied the bill's payments,
// the receipt survived but the linkage was lost.
//
// Reconciliation: for every receipt with a bill reference,
// check if the bill's payments array contains a matching
// entry (by receiptNo or by amount+date+mode). If not, merge
// it back and re-save the bill. Runs on every Dashboard load,
// catches this whole class of orphaned-payment bugs
// retroactively, and silently no-ops in the healthy case.
//
// Mutates the given bills in place (the loaded list is about to become
// state anyway) and resolves to how many payments were repaired. Under
// server-side paging this runs per loaded page — the user only ever sees
// bills they have loaded, and reconciling all 50,000 up front would defeat
// the purpose of paging.
export const reconcilePayments = async (bills) => {
  let reconciled = 0;
  try {
    const receipts = await getAllReceipts().catch(() => []);
    const receiptsByBillKey = new Map();
    for (const r of receipts) {
      const key = r.billId || r.againstInvoice;
      if (!key) continue;
      if (!receiptsByBillKey.has(key)) receiptsByBillKey.set(key, []);
      receiptsByBillKey.get(key).push(r);
    }
    const reconcileWrites = [];
    for (const bill of bills) {
      // v1.10.66 (#64) — only a receipt from the business that raised the
      // invoice may repair it. Two businesses can share an invoice number,
      // and matching on the number alone posted one company's payment onto
      // the other company's invoice every time the Dashboard opened.
      // Receipts saved before businesses were separated carry no business
      // and still match, as before.
      const rcpts = (receiptsByBillKey.get(bill.id) || receiptsByBillKey.get(bill.invoiceNumber) || [])
        .filter(r => belongsToProfile(bill, { gstin: r.ownerGstin, businessName: r.ownerName }));
      if (!rcpts.length) continue;
      const currentPayments = Array.isArray(bill.payments) ? bill.payments : [];
      const missing = rcpts.filter(r => {
        // Match by receiptNo (post-v1.10.10 payments store the receipt no),
        // OR by amount+date signature for pre-v1.10.10 payments.
        return !currentPayments.some(p =>
          // Receipts made from a payment carry the payment's id.
          (r.id && p.id === r.id)
          || (r.receiptNo && p.receiptNo === r.receiptNo)
          || (Math.abs((Number(p.amount) || 0) - (Number(r.amount) || 0)) < 0.005
              && p.date === r.date
              && (p.mode || '').toLowerCase() === (r.paymentMode || '').toLowerCase().replace(' ', '-'))
        );
      });
      if (!missing.length) continue;
      const modeMap = { 'Bank Transfer': 'bank-transfer', 'UPI': 'upi', 'Cash': 'cash', 'Cheque': 'cheque', 'Card': 'card', 'Other': 'other' };
      const merged = [...currentPayments, ...missing.map(r => ({
        id: r.id || ('pay_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
        amount: Number(r.amount) || 0,
        date: r.date,
        mode: modeMap[r.paymentMode] || (r.paymentMode || 'other').toLowerCase().replace(' ', '-'),
        note: r.note || (r.receiptNo ? `Reconciled from receipt ${r.receiptNo}` : 'Reconciled from orphaned receipt'),
        recordedAt: r.recordedAt || new Date().toISOString(),
        receiptNo: r.receiptNo,
      }))];
      const totalPaid = merged.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      // A cancelled invoice stays cancelled: restoring a payment must not
      // bring it back into totals and GST returns without its stock.
      const nextStatus = isCancelledBill(bill) ? 'cancelled' : paymentStatusFor(bill, totalPaid);
      // Mutate the in-memory bill so the state update below shows the
      // reconciled value immediately; also queue the server write.
      bill.payments = merged;
      bill.paidAmount = totalPaid;
      bill.status = nextStatus;
      reconciled += missing.length;
      reconcileWrites.push(saveBill(bill, { overwrite: true }).catch(() => null));
    }
    if (reconcileWrites.length) await Promise.allSettled(reconcileWrites);
  } catch { /* non-fatal — worst case, user still sees orphaned state */ }
  return reconciled;
};

// Auto-detect overdue: if due date passed and not paid, mark as overdue.
// Previously this did sequential `await saveBill(bill)` inside a for-loop,
// which (a) made N round-trips serialised and (b) silently stopped on the
// first failure. Now we collect dirty bills and save them concurrently via
// allSettled so one slow save can't block the rest. `today` is injectable
// for tests; defaults to the machine's local date.
export const markOverdue = async (bills, today = localToday()) => {
  const dirty = bills.filter(bill => {
    const dueDate = bill.data?.details?.dueDate;
    // Only sales can be overdue: a quotation, proforma, challan or credit
    // note is not money the client owes.
    return dueDate && dueDate < today && bill.status !== 'paid' && bill.status !== 'overdue' && bill.status !== 'cancelled'
      && SALES_INVOICE_TYPES.includes(bill.invoiceType || 'tax-invoice');
  });
  if (dirty.length > 0) {
    const updates = dirty.map(bill => { bill.status = 'overdue'; return saveBill(bill, { overwrite: true }); });
    await Promise.allSettled(updates);
  }
  return dirty;
};

// Loads bills into `setBills`, either the whole collection (quotations,
// credit notes and the other scoped pages — unchanged behaviour) or 50 at a
// time with a cursor (audit S6: a 50,000-invoice list opens instantly).
//
// `loadBills(filters?)` — full mode ignores filters and refetches everything
// (the post-mutation refresh path). Paged mode stores the last filter set and
// reuses it, so a refresh after recording a payment keeps the user's search /
// status / date filters and their page position is reset to page 1 of the
// same query.
export function useBillsLoader({ paged, setBills }) {
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const pagedRef = useRef(paged);
  pagedRef.current = paged;
  const filtersRef = useRef(null);   // current { q, status, from, to } in paged mode
  const loadedRef = useRef([]);      // everything accumulated so far in paged mode

  const loadBills = async (filters) => {
    try {
      if (filters) filtersRef.current = filters;
      let data;
      let cursor = null;
      if (pagedRef.current) {
        const page = await listBillsPage({ limit: BILLS_PAGE_SIZE, ...(filtersRef.current || {}) });
        data = page.data || [];
        cursor = page.nextCursor || null;
        loadedRef.current = data;
      } else {
        data = await getAllBills();
      }
      const reconciled = await reconcilePayments(data);
      if (reconciled > 0) {
        toast(`Reconciled ${reconciled} orphaned payment${reconciled === 1 ? '' : 's'} against ${reconciled === 1 ? 'its' : 'their'} invoice${reconciled === 1 ? '' : 's'}`, 'success', 6000);
      }
      await markOverdue(data);
      // Headline totals are derived from the business-filtered list (`stats`).
      setBills(data);
      setNextCursor(cursor);
    } catch {
      toast('Failed to load invoices', 'error');
    }
  };

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listBillsPage({ limit: BILLS_PAGE_SIZE, cursor: nextCursor, ...(filtersRef.current || {}) });
      const batch = page.data || [];
      const reconciled = await reconcilePayments(batch);
      if (reconciled > 0) {
        toast(`Reconciled ${reconciled} orphaned payment${reconciled === 1 ? '' : 's'} against ${reconciled === 1 ? 'its' : 'their'} invoice${reconciled === 1 ? '' : 's'}`, 'success', 6000);
      }
      await markOverdue(batch);
      loadedRef.current = [...loadedRef.current, ...batch];
      setBills(loadedRef.current);
      setNextCursor(page.nextCursor || null);
    } catch {
      toast('Failed to load more invoices', 'error');
    }
    setLoadingMore(false);
  };

  return { loadBills, loadMore, nextCursor, loadingMore };
}
