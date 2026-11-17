import { useEffect, useRef } from 'react';
import { getAllProfiles, getTermsTemplates, getAllClients, getAllProducts, getAllBills, getNextInvoiceNumber } from '../../../lib/data';
import { getAllPurchaseDocs } from '../../../lib/data/purchases';
import { INVOICE_TYPES, businessKeyOf, getAccountById, getActiveAccounts, getDefaultAccount, localToday } from '../../../utils';
import { getAppSetting } from '../../../lib/appSettings';
import { getPrintSettings } from '../../print/printSettingsStore';
import { DEFAULT_OPTIONS } from './editorConstants';
import { inlineRowsOf } from './saleExtras';
import { numberPrefixFor } from './invoiceNumbering';
import { FEATURES } from '../../../config/featureFlags';

const PHASE2 = FEATURES.saleInlinePayments;

// The editor's bootstrapping effects: refetching business profiles, the one-time mount loads (terms templates,
// clients, products, bills, purchases), hydrating the form from the bill being edited or a duplicate/conversion,
// peeking the next invoice number per business, and seeding the payment account. All it does is fill the state
// the page owns — every setter arrives as an argument.
export function useInvoiceBootstrap({
  draft, editingBill, profile, profileProp, activeProfile, setActiveProfile,
  bizKey, invoiceType, invoiceOptions, details, client, allProfiles,
  setAllProfiles, setTermsTemplates, selectedTermsId, setSelectedTermsId, setCustomTerms,
  setSavedClients, setSelectedClientId, setProducts, purchasesRef, setAllBillsForCredit,
  setClient, setItems, setCharges, setPaymentRows, setSalesman, setReturnInfo, setExpectedDeliveryDate,
  setInvoiceType, setCustomNotes, setInternalNote, setExtraSections, setTaxInclusive,
  setInvoiceOptions, setDetails, peekSeq, peekedNumber, numberReserved, hasBeenSaved,
}) {
  const draftInitialized = useRef(!!draft);
  // v1.10.77 - only a brand-new blank invoice gets the first saved Terms
  // template filled in. It used to happen to every form once the templates
  // loaded, so opening a SAVED invoice replaced its terms (and auto-save then
  // stored the wrong terms on it), and a restored draft lost its terms too.
  const blankNewInvoice = useRef(!editingBill && !draft);
  // The last business these number peeks were for, so a business change re-peeks once.
  const peekedFor = useRef(bizKey);

  // v1.10.16 — reported: user adds a 2nd business profile in Settings, comes
  // back to the invoice generator, but the "Billing From (Business Profile)"
  // chip row (which only renders when allProfiles.length > 1) doesn't
  // appear until they switch profiles once. Root cause: getAllProfiles()
  // fired once on mount; if the SPA kept InvoiceGenerator mounted while the
  // user was in Settings, the new profile never showed. Fix: also refetch
  // when the window regains visibility. Belt-and-braces since the
  // conditional-render path in App.jsx already unmounts+remounts, but this
  // covers the case where a stale server response is cached mid-navigation.
  useEffect(() => {
    const refetchProfiles = () => getAllProfiles().then(setAllProfiles).catch(() => {});
    const onVisible = () => { if (document.visibilityState === 'visible') refetchProfiles(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refetchProfiles);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refetchProfiles);
    };
  }, []);

  // Load terms templates and saved clients
  useEffect(() => {
    getAllProfiles().then(p => { setAllProfiles(p); if (!activeProfile && p.length > 0) setActiveProfile(profileProp); }).catch(() => {});
    getTermsTemplates().then(templates => {
      setTermsTemplates(templates);
      if (templates.length > 0 && blankNewInvoice.current && !selectedTermsId) {
        setSelectedTermsId(templates[0].id);
        setCustomTerms(templates[0].content);
      }
    });
    getAllClients().then(clients => {
      setSavedClients(clients);
      // Auto-link if editing a bill with a known client
      if (client.name.trim()) {
        const match = clients.find(c => c.name.toLowerCase() === client.name.trim().toLowerCase());
        if (match) setSelectedClientId(match.id);
      }
    });
    getAllProducts().then(setProducts);
    // v1.10.24 — Load bills once for client-credit lookup. Refreshed after
    // save (inside saveInvoiceToDB's success path) so the balance stays
    // current when the same session creates multiple invoices for one client.
    getAllBills().then(setAllBillsForCredit).catch(() => {});
    // Batch and serial stock count what was bought, so the purchases are read once when either is tracked.
    if (getAppSetting('item.batch') || getAppSetting('item.serial')) getAllPurchaseDocs().then((p) => { purchasesRef.current = p || []; }).catch(() => {});
  }, []);

  // Initialize from editing bill or generate new number (skip if restoring from draft)
  useEffect(() => {
    if (draftInitialized.current) {
      draftInitialized.current = false;
      return;
    }
    if (editingBill?.data) {
      const d = editingBill.data;
      setClient(d.client);
      setItems(d.items);
      if (PHASE2) {
        setCharges(d.charges || []);
        // A duplicate or conversion is a new document: it starts with no payments of its own.
        setPaymentRows(editingBill._isDuplicate ? [] : inlineRowsOf(editingBill));
        setSalesman({ salesmanId: d.salesmanId || '', salesmanName: d.salesmanName || '' });
        if (d.returnInfo) setReturnInfo(d.returnInfo);
        setExpectedDeliveryDate(d.expectedDeliveryDate || '');
      }
      setInvoiceType(d.invoiceType || 'tax-invoice');
      if (d.customTerms !== undefined) setCustomTerms(d.customTerms);
      if (d.customNotes !== undefined) setCustomNotes(d.customNotes);
      if (d.internalNote !== undefined) setInternalNote(d.internalNote);
      if (d.extraSections) setExtraSections(d.extraSections);
      if (d.taxInclusive !== undefined) setTaxInclusive(d.taxInclusive);
      if (d.invoiceOptions) {
        // User's persisted defaults as base, bill options overlay
        // v1.10.19 — Backfill paymentAccountSnapshot for pre-v1.10.18 bills.
        // Reported after v1.10.18: "swaping bank account issue solve work on
        // old bills or not... i cant see it is working". Right — v1.10.18
        // only froze the snapshot at save time, so bills saved before that
        // release still resolved the bank via the live profile. But those
        // bills DID persist a full profile snapshot in d.profile since
        // v1.4.x, so we can recover the original account by looking it up
        // in d.profile.paymentAccounts (or the flat legacy fields).
        // v1.10.20 — Strip paymentAccountSnapshot from `persisted` before
        // merging. Otherwise Invoice A's snapshot (auto-saved to
        // localStorage) contaminates Invoice B's merge, and the
        // `!mergedOpts.paymentAccountSnapshot` check below sees a snapshot
        // that isn't actually the current bill's. That single bug defeated
        // the entire v1.10.19 backfill in practice.
        let mergedOpts = null;
        try {
          const saved = localStorage.getItem('freegstbill_invoiceOptions');
          const persisted = saved ? JSON.parse(saved) : {};
          delete persisted.paymentAccountSnapshot;
          // showRoundOff: a saved bill that never stored it was not rounded
          // (OPTIONS_OFF_BY_DEFAULT); the new ON default must not change its total.
          mergedOpts = { ...DEFAULT_OPTIONS, ...persisted, showRoundOff: false, ...d.invoiceOptions };
        } catch { mergedOpts = { ...DEFAULT_OPTIONS, showRoundOff: false, ...d.invoiceOptions }; }
        // Backfilling only happens if the bill genuinely has no snapshot.
        // Check d.invoiceOptions directly (not mergedOpts) to sidestep any
        // remaining cross-store bleed-through.
        // v1.10.21 — Also heal contaminated snapshots from the v1.10.18–19
        // window. Reported: "after i full reloaded again all vanished and
        // asigned to same account which is default." Cause: bills saved
        // between v1.10.18 and v1.10.19 had snapshots polluted by
        // cross-invoice localStorage bleed — the snapshot's own `id` didn't
        // match the bill's selectedAccountId. v1.10.20 stopped the leak but
        // didn't touch the already-saved bad snapshots. Now: if the stored
        // snapshot's id doesn't match the stored selection, treat it as
        // stale and re-derive from d.profile (the frozen-at-save profile
        // snapshot, which still has the original account).
        const billSnap = d.invoiceOptions.paymentAccountSnapshot;
        const billSelId = d.invoiceOptions.selectedAccountId;
        const snapshotIsStale = billSnap && billSelId && billSnap.id && billSnap.id !== billSelId;
        if ((!billSnap || snapshotIsStale) && d.profile) {
          const snap = getAccountById(d.profile, billSelId);
          if (snap) mergedOpts.paymentAccountSnapshot = snap;
        }
        setInvoiceOptions(mergedOpts);
      } else {
        // A bill saved with no options at all was never rounded.
        setInvoiceOptions(prev => ({ ...prev, showRoundOff: false }));
      }

      if (editingBill._isDuplicate) {
        const convertType = editingBill._convertToType;
        const type = convertType || d.invoiceType || 'tax-invoice';
        if (convertType) {
          setInvoiceType(convertType);
          const config = INVOICE_TYPES[convertType];
          if (config) setInvoiceOptions(prev => ({ ...prev, showGST: config.showGST, showPlaceOfSupply: config.showGST }));
        }
        // v1.10.10 — read per-type prefix override from print settings.
        const { prefix, overridePrefix } = numberPrefixFor(getPrintSettings(), type);
        const seq = ++peekSeq.current;
        getNextInvoiceNumber(prefix, { peek: true, explicitPrefix: overridePrefix, invoiceType: type, businessKey: businessKeyOf(profile) }).then(num => {
          if (seq !== peekSeq.current) return;
          peekedNumber.current = num;
          setDetails({ ...d.details, invoiceNumber: num, invoiceDate: localToday(),
            // A credit note names the invoice it corrects.
            ...(convertType === 'credit-note' ? { originalInvoiceRef: d.details?.invoiceNumber || '' } : {}) });
          numberReserved.current = false;
        });
      } else {
        setDetails(d.details);
      }
    } else if (!details.invoiceNumber) {
      // v1.10.10 — honour the per-type prefix override for fresh invoices.
      const { prefix, overridePrefix } = numberPrefixFor(getPrintSettings(), invoiceType);
      const seq = ++peekSeq.current;
      getNextInvoiceNumber(prefix, { peek: true, explicitPrefix: overridePrefix, invoiceType, businessKey: businessKeyOf(profile) }).then(num => {
        if (seq !== peekSeq.current) return;
        peekedNumber.current = num;
        setDetails(prev => ({ ...prev, invoiceNumber: num }));
        numberReserved.current = false;
      });
    }
  }, [editingBill]);

  // v1.10.79 (#95) - the number shown on an unsaved invoice follows the
  // business it is for: each business can number on its own, and the business
  // is often known only after the first render. Without this the screen showed
  // the shared series' next number while Save took the business's own.
  useEffect(() => {
    if (!bizKey || peekedFor.current === bizKey) return;
    peekedFor.current = bizKey;
    if ((editingBill && !editingBill._isDuplicate) || numberReserved.current || hasBeenSaved.current) return;
    // Only a number the editor filled in itself (or none): a draft's own
    // number, or one typed by hand, stays as it is.
    if (details.invoiceNumber && details.invoiceNumber !== peekedNumber.current) return;
    const { prefix, overridePrefix } = numberPrefixFor(getPrintSettings(), invoiceType);
    const seq = ++peekSeq.current;
    getNextInvoiceNumber(prefix, { peek: true, explicitPrefix: overridePrefix, invoiceType, businessKey: bizKey })
      .then((num) => {
        if (seq !== peekSeq.current || numberReserved.current) return;
        setDetails((prev) => (prev.invoiceNumber && prev.invoiceNumber !== peekedNumber.current ? prev : { ...prev, invoiceNumber: num }));
        peekedNumber.current = num;
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bizKey]);

  // Seed the payment-account selection on first render. For a freshly-created
  // invoice (no editingBill, no value yet) we prefer the profile's ⭐ default,
  // then the last-used account from localStorage, then the first active
  // account. Resolving here once means the dropdown shows the right value
  // immediately rather than flickering through nulls.
  // v1.10.22 — reported: "if user added two account and star the one account
  // while creating new invoice it shows old star account not new". Root
  // cause: prior priority was last-used → default → first-active. Changing
  // the ⭐ in Settings didn't invalidate the last-used pointer, so new
  // invoices kept picking the old account. Fix: ⭐ default always wins
  // when set. Last-used stays as a fallback when no account is starred
  // (e.g. an in-progress migration).
  useEffect(() => {
    if (editingBill) return; // editing — keep whatever the bill stored
    if (invoiceOptions.selectedAccountId) return; // already set
    if (!profile) return;
    const lastUsedKey = `gst_lastUsedAccountId_${profile.id || profile.businessName || 'default'}`;
    let candidate = null;
    try { candidate = localStorage.getItem(lastUsedKey); } catch { /* sandboxed */ }
    const active = getActiveAccounts(profile);
    const defaultId = getDefaultAccount(profile)?.id || null;
    const candidateResolves = candidate && active.some(a => a.id === candidate);
    const next = defaultId
      || (candidateResolves ? candidate : null)
      || active[0]?.id
      || null;
    if (next) setInvoiceOptions(prev => ({ ...prev, selectedAccountId: next }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.businessName, editingBill]);

  // Persist the just-used account to localStorage so the NEXT new invoice on
  // this profile defaults to the same one. Saved on every change rather than
  // only on Save so power users typing through 5 invoices in a row get sticky
  // behaviour even if they navigate without saving each one.
  useEffect(() => {
    if (!profile || !invoiceOptions.selectedAccountId) return;
    const lastUsedKey = `gst_lastUsedAccountId_${profile.id || profile.businessName || 'default'}`;
    try { localStorage.setItem(lastUsedKey, invoiceOptions.selectedAccountId); } catch { /* ignore */ }
  }, [profile?.id, profile?.businessName, invoiceOptions.selectedAccountId]);

  // When loading a saved bill, prefer the LIVE business profile that matches the bill's
  // snapshot (by id, falling back to businessName). Means a Settings rename / address
  // edit / new logo flows through to all historical invoices on next PDF render. Falls
  // back to the snapshot if that profile was deleted.
  useEffect(() => {
    if (!editingBill?.data?.profile || allProfiles.length === 0) return;
    const snap = editingBill.data.profile;
    const liveMatch = allProfiles.find(p =>
      (p.id && snap.id && p.id === snap.id) ||
      (p.businessName && p.businessName === snap.businessName)
    );
    if (liveMatch && liveMatch !== activeProfile) setActiveProfile(liveMatch);
  }, [editingBill, allProfiles, activeProfile]);
}
