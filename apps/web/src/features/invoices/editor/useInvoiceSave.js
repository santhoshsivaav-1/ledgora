import { useCallback, useEffect, useRef, useState } from 'react';
import { saveBill, deleteBill, applyStockChanges, getNextInvoiceNumber, getAllBills, getAllRecurring, saveRecurring, saveClient, getAllProducts } from '../../../lib/data';
import { businessKeyOf, GST_DOC_NUMBER, appliedStock, stockEffect, stockDelta, formatCurrency, parseLocalDate, paymentStatusFor, getAccountById } from '../../../utils';
import { getPrintSettings } from '../../print/printSettingsStore';
import { confirmAction, promptAction } from '../../../components/ui/ConfirmModal';
import { toast } from '../../../components/ui/Toast';
import { einvoiceLocked } from '../einvoice';
import { getAllAppSettings } from '../../../lib/appSettings';
import { planCreditApplication } from '@ledgora/tax-engine';
import { serialProblems, hsnDigitsProblem, batchStock, serialsInStock } from '../../items/itemExtras';
import { paymentSummary, mergeInlinePayments, savedCharges, takesPayment, saveChecks, creditNoteOverReturns } from './saleExtras';
import { numberPrefixFor } from './invoiceNumbering';
import { clearDraft } from './hooks/useInvoiceDraft';
import { FEATURES } from '../../../config/featureFlags';

const PHASE2 = FEATURES.saleInlinePayments;

// Saving the invoice: the meaningful-content rule, the save validation, the debounced auto-save, the
// leave-before-save guard, the pre-save checks (credit limit, §269ST) and saveInvoiceToDB itself — reserving the
// number, preserving payments, computing status, stock movement, recurring templates and PDF-refresh bookkeeping.
// All of it reads the editor's state through the arguments below and reports back through the returned values.
export function useInvoiceSave({
  onBack, editingBill, invoiceType, client, details, setDetails, items, totals, totalRef, profile,
  invoiceOptions, taxInclusive, showGST,
  charges, paymentRows, salesman, returnInfo, expectedDeliveryDate,
  customTerms, customNotes, internalNote, extraSections,
  creditToApply, setCreditToApply, allBillsForCredit, setAllBillsForCredit,
  savedClients, setSavedClients, selectedClientId,
  productsRef, allBillsRef, purchasesRef, editingBillIdRef, setProducts,
  stockStart, numberReserved, peekedNumber, savedId, hasBeenSaved,
  readOnlyDoc, hasInitialized,
}) {
  // v1.10.4 — totals is now a `useMemo` in hooks/useInvoiceTotals (was a
  // `useState` fed by `useEffect + setTotals` which forced a second full
  // render on every keystroke). Same value on every render for the same
  // inputs; the extra render pass per character was the biggest perf hit
  // in this component per the audit's finding H15.
  const [saving, setSaving] = useState(false);
  const guardNotes = useRef({});
  const conversionMarked = useRef(false);
  const warnedLongNumber = useRef(false);
  // v1.10.22 — reported: "if user click back without even changing anything
  // it always ask to save and close". Cause: handleBack checked
  // `autoSaveStatus !== 'saved'`, and autoSaveStatus started at 'idle' on
  // mount (never flipping to 'saved' until an auto-save fired). So opening
  // an existing bill and immediately clicking Back showed the modal even
  // with zero edits. Now: `isDirty` is set only on real post-init changes,
  // and Back reads it instead. Cleared on successful save.
  const isDirty = useRef(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved'
  const autoSaveTimer = useRef(null);

  // An invoice is "meaningful" once it has a client name AND at least one line item
  // with a description and a non-zero amount. Until then we only auto-save to
  // sessionStorage (draft) — never to the persistent bills list. This prevents the
  // bug where opening "New Invoice" and clicking away saves an empty bill to the list.
  const isMeaningfulInvoice = useCallback(() => {
    if (editingBill) return true; // editing an existing bill — always persist changes
    if (!client?.name?.trim()) return false;
    return items.some(item => (item.name || '').trim() && (item.quantity || 0) * (item.rate || 0) > 0);
  }, [client?.name, items, editingBill]);

  // v1.10.58 — reported (#47 item 1, @sangwanmail-eng): "New invoice save
  // and print without client name and without any product add."
  //
  // isMeaningfulInvoice() above already encoded exactly the right rule, but
  // it only gated AUTO-save and the leave-guard. The explicit Save button
  // and the Print / Download paths called saveInvoiceToDB() with no checks
  // at all, so an empty form saved happily.
  //
  // That is worse than an empty record: saving reserves an invoice number
  // from the atomic counter. A blank invoice permanently consumes a number
  // in the sequence, and GST expects that sequence to be gapless — so a few
  // stray saves leave holes a CA has to explain.
  //
  // Returns null when the invoice is fit to save, otherwise the specific
  // reason, so the user is told which field is missing rather than just
  // being refused.
  const validateForSave = useCallback(() => {
    // P2-S2: over-paying or a cheque without its date stops every save, new or edited.
    if (PHASE2 && takesPayment(invoiceType) && paymentRows.length) {
      const pay = paymentSummary(paymentRows, { total: totalRef.current, payments: editingBill && !editingBill._isDuplicate ? editingBill.payments : [] });
      if (!pay.ok) return pay.errors[0].message;
    }
    if (editingBill) return null; // an existing bill is already a real record
    if (!client?.name?.trim()) {
      return 'Add a client name before saving.';
    }
    const hasRealItem = items.some(
      item => (item.name || '').trim() && (item.quantity || 0) * (item.rate || 0) > 0,
    );
    if (!hasRealItem) {
      return 'Add at least one item with a quantity and rate before saving.';
    }
    return null;
  }, [client?.name, items, editingBill, invoiceType, paymentRows]);

  // Debounced auto-save (2s after last change), gated on meaningful content.
  //
  // v1.8.1 CHANGE: for NEW bills that haven't been explicitly saved yet,
  // auto-save persists ONLY to the sessionStorage draft (via the effect
  // below that saves invoiceOptions). It does NOT hit the server or reserve
  // a counter number.
  //
  // Reason: users reported that opening "New Invoice" and typing burned
  // a counter value even if they never clicked Save. Auto-save was the
  // culprit — it fired 2s after any meaningful edit and atomically
  // reserved. The counter should only increment when the user commits.
  //
  // For EDITING existing bills (or after the first manual save), auto-save
  // still writes through to the server so mid-session edits are safe.
  useEffect(() => {
    if (!hasInitialized.current || readOnlyDoc) return;
    // v1.10.22 — any real post-init change flips the dirty flag so Back
    // can distinguish "loaded and untouched" from "actually edited".
    isDirty.current = true;
    if (!details.invoiceNumber) return;
    if (!isMeaningfulInvoice()) {
      setAutoSaveStatus(s => s === 'saved' ? 'idle' : s);
      return;
    }

    // NEW-bill guard: skip server auto-save until the user has explicitly
    // saved once. The sessionStorage draft is still auto-persisted via the
    // separate effect below, so nothing is lost if the tab crashes.
    // Nothing is stored yet, so the badge must not say "All changes saved"
    // (it used to flash that here); it reads "Not saved yet" instead.
    // Duplicates and conversions too (v1.10.79): nothing is stored, and no
    // number is taken, until the first Save.
    if ((!editingBill || editingBill._isDuplicate) && !hasBeenSaved.current) return;

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      try {
        setAutoSaveStatus('saving');
        await saveInvoiceToDB(true);
        setAutoSaveStatus('saved');
        isDirty.current = false; // successful save clears dirty
        setTimeout(() => setAutoSaveStatus(s => s === 'saved' ? 'idle' : s), 2000);
      } catch (err) {
        console.error('Auto-save failed:', err);
        setAutoSaveStatus('idle');
      }
    }, 2000);

    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [invoiceType, client, details, items, customTerms, customNotes, internalNote, extraSections, invoiceOptions, isMeaningfulInvoice]);

  // Save-before-leave guard. P2 #32 rewrites this from the dangerous
  // browser `confirm()` (OK = save, Cancel = stay — users conditioned to
  // "Cancel = discard" hit Cancel expecting to leave) to a proper 3-option
  // modal. Modal state below; handleBack just opens it.
  const [leaveModal, setLeaveModal] = useState(false);
  const handleBack = () => {
    // v1.10.22 — use isDirty (real change tracking) instead of
    // autoSaveStatus. autoSaveStatus starts at 'idle' on mount and only
    // flips to 'saved' after an auto-save fires, so the old check reported
    // dirty-not-saved for every freshly-loaded bill.
    if (isMeaningfulInvoice() && isDirty.current) {
      setLeaveModal(true);
      return;
    }
    clearDraft();
    onBack();
  };

  const leaveActions = {
    saveAndExit: async () => {
      try {
        setAutoSaveStatus('saving');
        const no = await saveInvoiceToDB();
        if (!no) { setAutoSaveStatus('idle'); return; }
        toast('Invoice saved', 'success');
        clearDraft();
        setLeaveModal(false);
        onBack();
      } catch {
        toast('Save failed — staying on the page so you can retry', 'error');
      }
    },
    discardAndExit: () => {
      clearDraft();
      setLeaveModal(false);
      onBack();
    },
    cancel: () => setLeaveModal(false),
  };

  useEffect(() => {
    const handler = (e) => {
      // v1.10.22 — mirror the handleBack fix: only warn on real dirty state.
      if (isMeaningfulInvoice() && isDirty.current) {
        e.preventDefault();
        e.returnValue = ''; // browsers show their own confirmation dialog
        return '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isMeaningfulInvoice]);

  // Settings > Item (batch, serial) and Settings > GST (HSN digits): what must be right before a bill that sells stock saves.
  const salesLineProblems = () => {
    const s = getAllAppSettings();
    const sells = ['tax-invoice', 'bill-of-supply', 'composition', 'delivery-challan'].includes(invoiceType);
    for (const it of items) {
      if (!it.name?.trim()) continue;
      if (showGST && s['gst.hsnDigits'] > 4 && it.hsn) {
        const bad = hsnDigitsProblem(it.hsn, s['gst.hsnDigits']);
        if (bad) return `${it.name}: ${bad}`;
      }
      const product = it.productId ? productsRef.current.find((p) => p.id === it.productId) : null;
      if (!product || !sells) continue;
      const ctx = { bills: allBillsRef.current, purchases: purchasesRef.current, excludeBillId: editingBillIdRef.current };
      if (s['item.batch'] && (product.batches?.length || it.batchNo)) {
        if (!it.batchNo) return `${it.name}: pick a batch`;
        const row = batchStock(product, ctx).find((b) => b.batchNo.toLowerCase() === String(it.batchNo).toLowerCase());
        const need = (Number(it.quantity) || 0) * (Number(it.unitFactor) > 0 ? Number(it.unitFactor) : 1);
        if (row && row.expDate && row.expDate < details.invoiceDate) return `${it.name}: batch ${row.batchNo} expired on ${row.expDate}`;
        if (row && need > row.qty + 0.0005 && s['txn.negativeStock'] === 'block') return `${it.name}: batch ${row.batchNo} has only ${row.qty} left`;
      }
      if (s['item.serial'] && (product.serials?.length || it.serials?.length)) {
        const bad = serialProblems(it, serialsInStock(product, ctx))[0];
        if (bad) return `${it.name}: ${bad}`;
      }
    }
    return null;
  };

  const saveInvoiceToDBNow = async (skipStockDeduction = false, extraPatch = {}) => {
    if (readOnlyDoc) {
      toast(editingBill.convertedTo
        ? `Already converted to ${editingBill.convertedTo}, so it is not changed. Use Duplicate to make a new one.`
        : einvoiceLocked(editingBill)
          ? 'This invoice has an e-invoice IRN, so it is not changed. Cancel the IRN within 24 hours, or issue a credit note.'
          : 'A cancelled invoice is not changed. Undo the cancel on the Dashboard, or use Duplicate.', 'warning');
      return null;
    }
    const lineProblem = salesLineProblems();
    if (lineProblem) { toast(lineProblem, 'warning'); return null; }
    // Lazy counter reservation: if this is a NEW bill (no editingBill) and
    // the invoice number is still the peeked value, do the atomic increment
    // now. This means a mounted-but-cancelled form doesn't burn a counter
    // number → gapless sequences for CA-audited businesses.
    //
    // v1.9.0 — extraPatch lets callers stamp print-history fields
    // (printedCount + lastPrintedAt) at save time without needing to
    // pipe them through the entire bill state.
    let finalInvoiceNumber = details.invoiceNumber;
    // v1.10.79 - a duplicate or a conversion is a new document too: it reserves
    // its number like a new invoice. It used to save under the number it only
    // peeked, without moving the counter, so the next conversion got the same
    // number and failed to save.
    const isNewDoc = !editingBill || !!editingBill._isDuplicate;
    if (isNewDoc && !numberReserved.current) {
      try {
        // v1.10.10 — honour user's per-type prefix override.
        const { prefix, overridePrefix } = numberPrefixFor(getPrintSettings(), invoiceType);
        const numOpts = { explicitPrefix: overridePrefix, invoiceType, businessKey: businessKeyOf(profile), invoiceDate: details.invoiceDate };
        // A number typed by hand (a paper bill book's next number) is kept. It
        // used to be replaced by the next counter number on the first save,
        // whatever was in the field. Only the number the editor filled in
        // itself (or none) takes the next counter number.
        const typed = String(details.invoiceNumber || '').trim();
        const ownNumber = !!typed && typed !== peekedNumber.current
          && typed !== await getNextInvoiceNumber(prefix, { ...numOpts, peek: true });
        if (!ownNumber) {
          finalInvoiceNumber = await getNextInvoiceNumber(prefix, numOpts);
          setDetails(prev => ({ ...prev, invoiceNumber: finalInvoiceNumber }));
        }
        numberReserved.current = true;
      } catch { /* fall back to the peeked value; server will 409 if it collides */ }
    }

    // v1.10.18 — reported: "if i change bank account for the customer to one
    // bank then other also changed to that — it should show the bank was
    // selected at the time of making but it wont." Root cause: InvoicePreview
    // resolves the account via getAccountById(profile, selectedAccountId) at
    // render time. Only the id is stored on the bill; account details
    // (bankName, accountNumber, IFSC, UPI) come from the CURRENT profile at
    // render time. So editing "Bank A" in Settings retroactively rewrote
    // every historical invoice that had used Bank A. Fix: freeze the resolved
    // account into invoiceOptions.paymentAccountSnapshot at save time.
    // v1.10.19 — When the invoiceOptions already carry a snapshot AND its id
    // matches the current selection, KEEP it. This preserves the backfilled
    // snapshot for pre-v1.10.18 bills that get re-saved without a bank
    // change. Only re-snapshot from the live profile when the user
    // intentionally switched to a different account (id changed) or when
    // no prior snapshot exists.
    const priorSnapshot = invoiceOptions.paymentAccountSnapshot;
    const priorMatchesSelection = priorSnapshot && priorSnapshot.id === invoiceOptions.selectedAccountId;
    const snapAccount = priorMatchesSelection
      ? priorSnapshot
      : getAccountById(profile, invoiceOptions.selectedAccountId);
    const invoiceOptionsWithSnapshot = { ...invoiceOptions, paymentAccountSnapshot: snapAccount || null };

    // v1.10.24 — Plan client-credit application. If the user chose to
    // apply any credit on this invoice (via the banner in the Billed To
    // section), compute the dual-entry patches now: a `credit-applied`
    // payment on this bill + `credit-transferred-out` entries on the
    // source overpaid bills. Both are applied inside the try/catch
    // below so a save failure doesn't leave the source bills half-updated.
    const creditPlan = (!editingBill && creditToApply > 0.005)
      ? planCreditApplication(client.name, allBillsForCredit, creditToApply, finalInvoiceNumber)
      : null;

    // v1.10.41 — Payment-preservation guard. Reported: user recorded
    // a payment on the Dashboard while an editor tab still had the
    // pre-payment `editingBill` cached; when the editor was later
    // saved (e.g. printed, marked, or manually saved), the stale
    // editingBill.payments overwrote the server copy and the
    // payment vanished from the invoice while the receipt file
    // survived on disk. Fix: for edits, fetch the latest server
    // bill first and union any payments (by receiptNo, or by
    // amount+date+mode fingerprint for older records) that
    // aren't already in editingBill's copy. Non-fatal on network
    // error — worst case reverts to old behaviour, and the
    // Dashboard reconciliation pass catches it on next load.
    // v1.10.77 (#86) - a duplicate or a conversion is a NEW invoice: it starts
    // unpaid. It used to copy the original's payments (and, through the fetch
    // below, any paid on the original later), so a converted quotation could
    // come out as Paid.
    const ownBill = !!editingBill && !editingBill._isDuplicate;
    const priorId = savedId.current;
    const renameFrom = priorId && priorId !== finalInvoiceNumber ? priorId : null;
    // A rename saves under the new number, then removes the old copy. The
    // server refuses to remove a bill whose credit paid another invoice, which
    // left two live copies (the sale counted twice). Stop before saving.
    if (renameFrom) {
      let usedBy = null;
      try {
        usedBy = (await getAllBills()).find((b) => b.id !== renameFrom && (b.payments || b.data?.payments || [])
          .some((p) => p?.mode === 'credit-applied' && (p.creditSourceBillIds || []).includes(renameFrom)));
      } catch { /* the server's own check still stands */ }
      if (usedBy) {
        toast(`${renameFrom} can't be renumbered: its credit paid ${usedBy.invoiceNumber || usedBy.id}. Keep the number ${renameFrom}.`, 'error', 8000);
        return null;
      }
    }
    const seedPayments = ownBill && editingBill.payments ? [...editingBill.payments] : [];
    // Also for a NEW bill once it is saved: its stored copy holds the client
    // credit applied on the first save (and any payment recorded since). A
    // later save started from no payments and wiped them.
    if (priorId) {
      try {
        const serverBills = await getAllBills();
        const fresh = serverBills.find(b => b.id === priorId);
        const freshPayments = Array.isArray(fresh?.payments) ? fresh.payments : [];
        for (const fp of freshPayments) {
          const dup = seedPayments.some(p =>
            (fp.receiptNo && p.receiptNo === fp.receiptNo)
            || (fp.id && p.id === fp.id)
            || (Math.abs((Number(p.amount) || 0) - (Number(fp.amount) || 0)) < 0.005
                && p.date === fp.date
                && (p.mode || '') === (fp.mode || ''))
          );
          if (!dup) seedPayments.push(fp);
        }
      } catch { /* non-fatal — reconciliation pass will catch it */ }
    }
    if (creditPlan?.targetEntry) seedPayments.push(creditPlan.targetEntry);
    // P2-S2: the Payment block's rows replace this invoice's own inline payments; other payments stay as they are.
    if (PHASE2 && takesPayment(invoiceType)) {
      const merged = mergeInlinePayments(seedPayments, paymentRows, { date: details.invoiceDate, invoiceNumber: finalInvoiceNumber });
      seedPayments.splice(0, seedPayments.length, ...merged);
    }
    const seedPaidAmount = seedPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    // v1.10.41 — Recompute status from the merged paid amount rather
    // than trusting editingBill.status. If a payment was recorded on
    // Dashboard while the editor was open (see comment above), that
    // stale status would still say 'unpaid' and this save would
    // downgrade a fully-paid invoice.
    // v1.10.76 (#80) - the server's copy of this bill once we know the number
    // is ours: its stock record is what has really been moved, even if this
    // editor was opened from an older copy (a page refresh, another tab).
    const isIssued = !!editingBill && !editingBill._isDuplicate;
    let serverCopy = null;
    if (isIssued || hasBeenSaved.current) {
      try { serverCopy = (await getAllBills()).find((b) => b.id === (renameFrom || finalInvoiceNumber)) || null; } catch { /* treated as not saved yet */ }
    }
    const stockFrom = serverCopy ? appliedStock(serverCopy) : stockStart.current;
    // v1.10.76 - editing a cancelled invoice keeps it cancelled. It used to come
    // back as Unpaid: into totals and GST returns again, and now stock too.
    const keepCancelled = isIssued && (serverCopy?.status || editingBill.status) === 'cancelled';
    // Paid once the payments cover the total less any TDS the client deducts.
    const computedStatus = paymentStatusFor({ totalAmount: totals.total, data: { totals } }, seedPaidAmount);
    // Preserve 'overdue' when nothing is paid — otherwise trust the
    // freshly computed status.
    const seedStatus = keepCancelled ? 'cancelled' : (computedStatus === 'unpaid' && ownBill && editingBill.status === 'overdue')
      ? 'overdue'
      : computedStatus;

    const sourceDoc = editingBill?._convertToType
      ? { number: editingBill.invoiceNumber, type: editingBill.invoiceType || 'tax-invoice' }
      : (ownBill ? editingBill.data?.sourceDoc : undefined);
    const bill = {
      id: finalInvoiceNumber,
      clientName: client.name,
      invoiceNumber: finalInvoiceNumber,
      invoiceDate: details.invoiceDate,
      invoiceType,
      currency: invoiceOptions.currency || 'INR',
      totalAmount: totals.total,
      // v1.10.1 — was `cgst + sgst + igst` which omitted UTGST and cess.
      // Reports treated cess as revenue for tobacco/auto/coal sellers.
      totalTaxAmount: totals.totalTaxAmount ?? (totals.cgst + totals.sgst + (totals.utgst || 0) + totals.igst + (totals.cess || 0)),
      status: seedStatus,
      paidAmount: seedPaidAmount,
      payments: seedPayments,
      // Preserve any pre-existing print history + carry through the patch
      printedCount: extraPatch.printedCount ?? (ownBill ? editingBill.printedCount : 0) ?? 0,
      lastPrintedAt: extraPatch.lastPrintedAt ?? (ownBill ? editingBill.lastPrintedAt : null) ?? null,
      // Kept from the saved bill: rebuilt from scratch, they used to be lost.
      ...(keepCancelled ? { cancelledAt: serverCopy?.cancelledAt || editingBill.cancelledAt || null } : {}),
      ...(isIssued && (serverCopy?.convertedTo || editingBill.convertedTo) ? { convertedTo: serverCopy?.convertedTo || editingBill.convertedTo, convertedToType: serverCopy?.convertedToType || editingBill.convertedToType } : {}),
      data: { profile, client, details: { ...details, invoiceNumber: finalInvoiceNumber }, items, totals, invoiceType, customTerms, customNotes, internalNote, extraSections, invoiceOptions: invoiceOptionsWithSnapshot, taxInclusive,
        // Which document this one was raised from (quotation -> sales order -> ...), shown in the lists.
        ...(sourceDoc ? { sourceDoc } : {}),
        // Phase 2 fields, written only when used so older invoices keep their exact shape.
        ...(PHASE2 && savedCharges(charges).length ? { charges: savedCharges(charges) } : {}),
        ...(PHASE2 && salesman.salesmanId ? { salesmanId: salesman.salesmanId, salesmanName: salesman.salesmanName } : {}),
        ...(PHASE2 && invoiceType === 'credit-note' ? { returnInfo } : {}),
        ...(PHASE2 && invoiceType === 'sales-order' && expectedDeliveryDate ? { expectedDeliveryDate } : {}),
        ...(PHASE2 && guardNotes.current.cashAcknowledgement ? { cashAcknowledgement: guardNotes.current.cashAcknowledgement } : {}),
        // A converted quotation/proforma/challan's stock moved to its invoice:
        // its own record stays empty, or a save would take the stock twice.
        // P2-S6: a credit note with "Put returned goods back in stock" off returns no stock.
        stockApplied: (isIssued && (serverCopy?.convertedTo || editingBill.convertedTo)) || (PHASE2 && invoiceType === 'credit-note' && returnInfo.restock === false) ? {} : stockEffect(items, invoiceType, seedStatus) }
    };
    // Editing an existing bill → always overwrite. NEW bill on second-and-
    // later save this session → also overwrite (same invoice number, would
    // otherwise 409). NEW bill on first save → no overwrite, so a typo
    // hitting an existing invoice number gets caught by the server.
    // v1.10.79 - a duplicate or conversion is NEW on its first save. It used to
    // count as "editing", so saving it overwrote whatever invoice already had
    // that number: converting two quotations in a row replaced the first
    // invoice with the second.
    // A rename never overwrites: the new number must be free.
    const shouldOverwrite = !renameFrom && (!isNewDoc || hasBeenSaved.current);
    // The number this bill actually ended up under: the 409 retry below can
    // move it, and the recurring template + callers must use the real one.
    let savedNumber = bill.id;
    try {
      await saveBill(bill, { overwrite: shouldOverwrite });
      // v1.10.24 — Follow-up: write the `credit-transferred-out` entries
      // to each source overpaid bill. Sequential so a failure on any one
      // stops the chain (rare — same origin, same server, right after we
      // just succeeded on the primary save). If any patch does fail, the
      // primary bill still has the credit-applied entry; the source
      // bill's overpayment display just remains stale until it's edited.
      // Toast lets the user know.
      if (creditPlan?.sourcePatches?.length) {
        try {
          for (const { updatedBill } of creditPlan.sourcePatches) {
            await saveBill(updatedBill, { overwrite: true });
          }
          const applied = creditPlan.amountApplied;
          const from = creditPlan.consumedFrom.map(c => c.invoiceNumber).join(', ');
          toast(`${formatCurrency(applied, invoiceOptions.currency || 'INR')} credit applied from ${from}`, 'success');
          // Refresh local bills list so the credit banner drops for next time.
          getAllBills().then(setAllBillsForCredit).catch(() => {});
          setCreditToApply(0);
        } catch (creditErr) {
          console.error('Source-bill credit patch failed:', creditErr);
          toast('Credit applied on this bill, but source bill update failed. Please review Client ledger.', 'warning');
        }
      }
      // v1.10.35 — Reported: "if user has selected thermal or any paper
      // size according to client it should always show that same auto or
      // else if user create new invoice and select thermal and if again
      // create new invoice with a4 pdf it should remember the choice and
      // next time show same so that if user change in new it won't
      // change that in older one".
      //
      // Behaviour:
      //  - Client selected: persist paperSize + currency + auto-print
      //    onto the client record so next invoice for that client
      //    defaults to the same choice.
      //  - No client selected: fall through to global default (already
      //    persisted via localStorage 'freegstbill_invoiceOptions' on
      //    every options change — see the persist effect in useInvoiceOptions).
      //  - Prior client-select code reads cli.preferred* already, so this
      //    write-side fix closes the loop.
      // Fire-and-forget: don't block the save UX on a preference update.
      if (selectedClientId) {
        const cli = savedClients.find(c => c.id === selectedClientId);
        if (cli) {
          const nextPaperSize = invoiceOptions.paperSize || 'a4';
          const nextCurrency = invoiceOptions.currency || 'INR';
          // v1.10.48 — Persist the custom dimensions too. Saving only the
          // paper-size KEY meant 'custom' round-tripped without its width,
          // and getPaperSize() reads a missing custom width as 80mm, i.e.
          // thermal. See the restore side in handleSelectClient.
          const nextCustomW = invoiceOptions.customPaperWidth || 80;
          const nextCustomH = invoiceOptions.customPaperHeight || 297;
          const changed = cli.preferredPaperSize !== nextPaperSize
            || cli.preferredCurrency !== nextCurrency
            || cli.preferredCustomPaperWidth !== nextCustomW
            || cli.preferredCustomPaperHeight !== nextCustomH;
          if (changed) {
            const updatedClient = {
              ...cli,
              preferredPaperSize: nextPaperSize,
              preferredCurrency: nextCurrency,
              preferredCustomPaperWidth: nextCustomW,
              preferredCustomPaperHeight: nextCustomH,
            };
            saveClient(updatedClient).then(() => {
              // Refresh the in-memory clients list so subsequent
              // handleSelectClient calls see the new preference.
              setSavedClients(prev => prev.map(c => c.id === cli.id ? updatedClient : c));
            }).catch(() => { /* non-blocking */ });
          }
        }
      }
      // Mark that the invoice has been persisted at least once — subsequent
      // saves (auto-save, Save & Leave, Save & Download) can safely overwrite.
      hasBeenSaved.current = true;
      isDirty.current = false; // v1.10.22 — successful save clears dirty flag
    } catch (err) {
      if (err?.status === 409 && renameFrom) {
        toast(`Invoice number ${bill.id} is already used by another invoice. This invoice is still saved as ${renameFrom}.`, 'error');
        return null;
      }
      if (err?.status === 409) {
        // v1.10.23 — reported (GH #16): "A bill with this invoice number
        // already exists" on create/update/status-change/add-payment. Root
        // cause: the atomic counter can lag behind the actual bills on
        // disk (backup restore, cross-tab save, hand-crafted bill numbers)
        // so `peek` returns an id that already exists → 409. Prior code
        // forced the user to hand-fix the number. Now: for a NEW bill,
        // retry with a fresh reservation, incrementing the counter until
        // we land on a truly unused number (capped at 1000 tries so a
        // pathological data state can't spin forever).
        if (isNewDoc && !shouldOverwrite) {
          const { prefix, overridePrefix } = numberPrefixFor(getPrintSettings(), invoiceType);
          let nextNum = bill.id;
          let success = false;
          // Each try moves the counter on for good, so this walks past a run of
          // numbers taken by a CSV import or a restore once, then never again.
          // ponytail: one local request pair per taken number; fine up to ~1000.
          for (let i = 0; i < 1000; i++) {
            try {
              nextNum = await getNextInvoiceNumber(prefix, { explicitPrefix: overridePrefix, invoiceType, businessKey: businessKeyOf(profile), invoiceDate: details.invoiceDate });
              const retryBill = { ...bill, id: nextNum, invoiceNumber: nextNum };
              retryBill.data = { ...retryBill.data, details: { ...retryBill.data.details, invoiceNumber: nextNum } };
              await saveBill(retryBill, { overwrite: false });
              success = true;
              savedNumber = nextNum;
              // Push the new number back into the form so the preview + any
              // subsequent save operate on the resolved id.
              setDetails(prev => ({ ...prev, invoiceNumber: nextNum }));
              hasBeenSaved.current = true;
              isDirty.current = false;
              if (nextNum !== bill.id) {
                toast(`Invoice number ${bill.id} was already used — saved as ${nextNum} instead.`, 'info');
              }
              break;
            } catch (retryErr) {
              if (retryErr?.status !== 409) throw retryErr;
              // else: number still taken, loop and try again with next counter.
            }
          }
          if (!success) {
            toast(`Could not find a free invoice number after 1000 attempts. Please change the number manually.`, 'error');
            return null;
          }
        } else {
          toast(`Invoice number ${bill.id} already exists. Change it before saving.`, 'error');
          return null;
        }
      } else {
        throw err;
      }
    }

    savedId.current = savedNumber;
    // A rename: the bill now lives under its new number, so the old file goes
    // (to the Trash, from where it can be restored).
    if (renameFrom && renameFrom !== savedNumber) {
      // The old copy's stock moved to the new number (stockFrom above), so
      // the trashed copy records none: restoring it must not move it again.
      try {
        if (serverCopy?.data) await saveBill({ ...serverCopy, data: { ...serverCopy.data, stockApplied: {} } }, { overwrite: true });
        await deleteBill(renameFrom);
      }
      catch { toast(`Saved as ${savedNumber}, but the old copy ${renameFrom} could not be removed. Delete it from the Dashboard.`, 'warning', 8000); }
    }

    // If the user ticked "Make this recurring", create/update the recurring
    // template alongside the invoice. We store enough on the template to
    // regenerate identical future invoices: client snapshot + items +
    // invoice options. Server-side processDueRecurring uses these.
    if (invoiceOptions.recurring?.enabled) {
      try {
        const rec = invoiceOptions.recurring;
        // The template this invoice already has (also under its old number
        // after a rename). Every save of the invoice used to rewrite it from
        // scratch - occurrences back to 0 and nextDate back to the first date -
        // so a template that had already fired fired again.
        const allTemplates = await getAllRecurring().catch(() => []);
        const existing = allTemplates.find((t) => t.id === `tpl_${savedNumber}`)
          || (renameFrom ? allTemplates.find((t) => t.id === `tpl_${renameFrom}`) : null);
        const templateId = existing?.id || `tpl_${savedNumber}`; // stable: tied to source invoice number
        // The schedule the server has advanced is kept unless the first date
        // was changed on this invoice.
        const keepSchedule = !!existing && existing.requestedNextDate === rec.nextDate;
        // Days from invoice date to due date, so generated invoices get a due date too.
        const dueDays = details.dueDate && details.invoiceDate
          ? Math.round((parseLocalDate(details.dueDate) - parseLocalDate(details.invoiceDate)) / 86400000) : null;
        await saveRecurring({
          ...(existing || {}),
          id: templateId,
          sourceInvoiceId: savedNumber,
          active: existing ? existing.active !== false : true,
          frequency: rec.frequency || 'monthly',
          interval: rec.interval || 1,
          nextDate: keepSchedule ? existing.nextDate : rec.nextDate,
          anchorDay: keepSchedule ? existing.anchorDay ?? null : null,
          requestedNextDate: rec.nextDate,
          endMode: rec.endMode || 'never',
          endDate: rec.endDate || '',
          maxOccurrences: rec.maxOccurrences || null,
          occurrencesCreated: existing?.occurrencesCreated || 0,
          createdAt: existing?.createdAt || new Date().toISOString(),
          lastGenerated: existing?.lastGenerated || null,
          // Which business it bills for (the server matches ownerGstin first),
          // where the supply is, and the payment terms.
          ownerGstin: profile?.gstin || '',
          ownerName: profile?.businessName || '',
          placeOfSupply: details.placeOfSupply || '',
          dueDays: Number.isFinite(dueDays) && dueDays >= 0 ? dueDays : null,
          // Snapshot the data needed to regenerate. Profile is resolved live at
          // generation time (so business renames flow through), but client,
          // items, invoiceType, customTerms, etc. are frozen as the user wants
          // them on every recurring instance.
          clientName: client.name,
          clientState: client.state,
          clientGstin: client.gstin,
          clientAddress: client.address,
          clientCountry: client.country,
          clientCity: client.city,
          clientPin: client.pin,
          clientEmail: client.email,
          clientPhone: client.phone,
          isSEZ: client.isSEZ,
          invoiceType,
          profileId: profile?.id || null,
          profileBusinessName: profile?.businessName || null,
          items: items.map(i => ({ ...i })),
          customTerms,
          customNotes,
          extraSections,
          taxInclusive,
          invoiceOptions: { ...invoiceOptions, recurring: null }, // strip the recurring config from clones
        });
      } catch (err) {
        console.error('Failed to save recurring template:', err);
        toast('Invoice saved, but recurring template failed to save', 'warning');
      }
    }

    // v1.10.76 (#83) - converting a quotation / proforma / challan: once the new
    // invoice is saved, mark the original so its Convert button goes away and
    // it cannot be converted into a second invoice by mistake.
    // Written to a fresh copy of the original, not the one cloned when Convert
    // was clicked, so nothing done to it since is undone. Its stock record went
    // to the new invoice (stockStart), so its own is now empty.
    if (editingBill?._convertToType && !editingBill._linkOnly && !conversionMarked.current && savedNumber) {
      conversionMarked.current = true;
      try {
        const source = (await getAllBills()).find((b) => b.id === editingBill.id);
        if (source) {
          await saveBill({ ...source, convertedTo: savedNumber, convertedToType: invoiceType, ...(source.data ? { data: { ...source.data, stockApplied: {} } } : {}) }, { overwrite: true });
        }
      } catch { /* the invoice itself is saved */ }
    }

    // v1.10.76 (#80) - every save, auto-saves included, moves stock by the
    // difference between what this bill should do now and what it has done
    // (stockEffect: sales take stock out, credit notes put it back, quotes and
    // proformas do nothing). Editing 10 -> 15 takes 5 more; saving again moves
    // nothing. Saves run one at a time (saveInvoiceToDB), so two can never
    // start from the same record.
    const changes = stockDelta(stockFrom, bill.data.stockApplied);
    const moved = await applyStockChanges(changes);
    if (moved.length) {
      setProducts(await getAllProducts());
      if (!skipStockDeduction) {
        for (const product of moved) {
          if (!(changes[product.id] < 0)) continue;
          if (product.stock <= 0) toast(`${product.name} is now out of stock!`, 'warning');
          else if (product.stock <= 5) toast(`${product.name} has only ${product.stock} left in stock`, 'warning');
        }
      }
    }
    // GSTR-1 refuses invoice and credit-note numbers over 16 characters
    // (letters, digits, - and /). Say so now rather than at filing time.
    if (['tax-invoice', 'credit-note'].includes(invoiceType) && savedNumber && !GST_DOC_NUMBER.test(savedNumber) && !warnedLongNumber.current) {
      warnedLongNumber.current = true;
      toast(`${savedNumber} has ${savedNumber.length} characters; GST allows 16, so GSTR-1 will refuse it. Shorten the format in Settings → Invoice Number Format.`, 'warning', 10000);
    }
    return savedNumber;
  };

  // v1.10.76 - one save at a time. An auto-save landing in the middle of a
  // manual save could otherwise start from the same stock record and move
  // the stock twice, or leave an older record on the server.
  const saveQueue = useRef(Promise.resolve());
  const saveInvoiceToDB = (...args) => {
    const run = saveQueue.current.then(() => saveInvoiceToDBNow(...args));
    saveQueue.current = run.catch(() => {});
    return run;
  };

  // P2-S4: the checks Save runs first. A credit-limit warning asks to continue; a block stops the save; §269ST cash
  // needs a typed acknowledgement, which is kept on the invoice.
  const passSaveChecks = async () => {
    const party = savedClients.find((c) => c.id === selectedClientId)
      || savedClients.find((c) => (c.name || '').trim().toLowerCase() === (client.name || '').trim().toLowerCase());
    const editingId = editingBill && !editingBill._isDuplicate ? editingBill.id : savedId.current;
    const checks = saveChecks({
      client: { ...client, creditLimit: party?.creditLimit, creditMode: party?.creditMode },
      bills: allBillsForCredit, invoiceType, total: totals.total,
      rows: takesPayment(invoiceType) ? paymentRows : [],
      payments: editingBill && !editingBill._isDuplicate ? editingBill.payments : [],
      invoiceDate: details.invoiceDate, editingId,
    });
    // P2-S6: a credit note may not return more than is left on the invoice it is against.
    if (invoiceType === 'credit-note' && details.originalInvoiceRef) {
      const over = creditNoteOverReturns({ bills: allBillsForCredit, againstNumber: details.originalInvoiceRef.trim(), items, editingId });
      if (over.length) {
        toast(`More than is left to return on ${details.originalInvoiceRef}: ${over.map((o) => `${o.name || 'item'} (${o.returnable} left)`).join(', ')}`, 'error', 9000);
        return false;
      }
    }
    for (const c of checks) {
      if (c.kind === 'credit') {
        const text = `${c.party} has a limit of ${formatCurrency(c.limit)}. Outstanding ${formatCurrency(c.used)} + this sale = ${formatCurrency(c.after)}. Exceeds by ${formatCurrency(c.exceededBy)}.`;
        if (c.mode === 'block') {
          toast(`Credit limit exceeded. ${text} Ask the owner to raise the limit.`, 'error', 9000);
          return false;
        }
        if (!(await confirmAction({ title: 'Credit limit exceeded', message: text, confirmLabel: 'Save anyway', cancelLabel: 'Go back', tone: 'warning' }))) return false;
      }
      if (c.kind === 'cash') {
        const ack = await promptAction({
          title: 'Cash limit (section 269ST)',
          message: `Cash from ${c.party} today reaches ${formatCurrency(c.total)}. Receiving ${formatCurrency(c.limit)} or more in cash from one person in a day attracts a penalty equal to the amount. Type an acknowledgement to save anyway.`,
          placeholder: 'I understand',
          confirmLabel: 'Save anyway',
        });
        if (!ack || !String(ack).trim()) return false;
        guardNotes.current.cashAcknowledgement = String(ack).trim();
      }
    }
    return true;
  };

  return {
    saving, setSaving,
    autoSaveStatus,
    leaveModal, setLeaveModal,
    handleBack, leaveActions,
    isMeaningfulInvoice, validateForSave, passSaveChecks, saveInvoiceToDB,
  };
}
