import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ArrowLeft, Plus, Trash2, Download, UserPlus, Pencil, Settings, ChevronUp, ChevronDown, MessageCircle, Check, Loader, Truck, Printer, Eye, EyeOff } from 'lucide-react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { saveBill, deleteBill, applyStockChanges, getNextInvoiceNumber, getTermsTemplates, getAllClients, saveClient, getAllProducts, getInvoiceDisplayOptions, saveInvoiceDisplayOptions, getAllProfiles, saveRecurring, getAllRecurring, getAllBills } from '../../../lib/data';
import { INVOICE_TYPES, businessKeyOf, GST_DOC_NUMBER, COUNTRIES, printedSubtotal, deliveryChargeLine, stockEffect, appliedStock, stockDelta, generateEWayBillJSON, formatCurrency, getCountryConfig, getAllUnits, addCustomUnit, removeCustomUnit, TDS_SECTIONS, TCS_SECTIONS, REMOVED_TCS_SECTIONS, TERMS_PRESETS, getActiveAccounts, getDefaultAccount, getAccountById, getDefaultUnitForMode, PAPER_SIZES, getPaperSize, ORDER_DETAIL_FIELDS, invoiceOptionOn, DEFAULT_DECLARATION, decodeGstin, safePageBoundaries, localToday, parseLocalDate, paymentStatusFor } from '../../../utils';
import { getPrintSettings, savePrintSettings } from '../../print/printSettingsStore';
import { openWhatsAppShare } from '../../import-export/share';
import { confirmAction, promptAction } from '../../../components/ui/ConfirmModal';
import PrintPreviewModal from '../../print/PrintPreviewModal';
import DOMPurify from 'dompurify';
import InvoicePreview from '../../print/InvoicePreview';
import { getClientCredit, planCreditApplication } from '@ledgora/tax-engine';
import HelpButton from '../../../components/ui/HelpButton';
import ClientModal from '../../parties/ClientModal';
import { toast } from '../../../components/ui/Toast';
import RichEditor from './RichEditor';
import { LineItem } from './LineItemRow';
import InvoiceTypePanel from './InvoiceTypePanel';
import PartyPicker from './PartyPicker';
import InvoiceDetailsPanel from './InvoiceDetailsPanel';
import LineItemsGrid from './LineItemsGrid';
import TermsPanel from './TermsPanel';
import ExtraSectionsPanel from './ExtraSectionsPanel';
import { DEFAULT_OPTIONS, ACCENT_PRESETS, PDF_STYLES, fitSpacersToOnePage } from './editorConstants';
import { useInvoiceTotals } from './hooks/useInvoiceTotals';
import { useInvoiceDraft, loadDraft } from './hooks/useInvoiceDraft';


export default function InvoiceEditorPage({ onBack, profile: profileProp, editingBill }) {
  const draft = loadDraft();
  const [allProfiles, setAllProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState(profileProp);
  const profile = activeProfile || profileProp;
  const [invoiceType, setInvoiceType] = useState(draft?.invoiceType || 'tax-invoice');
  // email/phone/isSEZ must be part of initial state — otherwise the SEZ flag
  // set inside ClientModal is silently discarded on save, and reopening the
  // bill can never restore contact fields even if the saved client has them.
  const [client, setClient] = useState(draft?.client || { name: '', address: '', city: '', pin: '', state: '', gstin: '', country: '', email: '', phone: '', isSEZ: false });
  // v1.9.1 — preview zoom (session-only). Reads from printSettings for the
  // initial value so the user's preference carries across bill switches.
  // v1.10.33 — Was READ-ONLY: the initial-load line pulled from
  // printSettings.previewZoom but nothing ever wrote it back. Every fresh
  // session started at 100% regardless of "sticky" comment. Now persists
  // on every change through the useEffect below. Also added a ref +
  // handleFitToWidth for the "Fit" button that actually fits.
  const previewPaneRef = useRef(null);
  const [previewZoom, setPreviewZoom] = useState(() => {
    try { return Number(getPrintSettings().previewZoom) || 100; } catch { return 100; }
  });
  useEffect(() => {
    try {
      const s = getPrintSettings();
      if (Number(s.previewZoom) !== previewZoom) {
        savePrintSettings({ ...s, previewZoom });
      }
    } catch { /* sandboxed localStorage — session-only degradation ok */ }
  }, [previewZoom]);
  // v1.10.33 — Actual fit-to-width. A4 preview renders at 794px @ 96dpi;
  // narrower paper sizes (A5, thermal, custom) can be smaller so we honor
  // the preview element's natural offsetWidth when possible. Fallback to
  // 794 covers the moment before InvoicePreview has mounted. Scale is
  // clamped 50-200% (matches the +/- limits so users don't get a "Fit"
  // that falls outside the range they can then tweak from).
  //
  // v1.10.33 (v2) — offsetWidth is LAYOUT width, unaffected by
  // `transform: scale(...)`. First cut divided by currentScale which
  // over-corrected on every click ("Fit → 44% → Fit → 24% → …").
  // Just read offsetWidth as-is — it's already the natural (unscaled)
  // width of the preview at the current paper size.
  const handleFitToWidth = useCallback(() => {
    if (!previewPaneRef.current) { setPreviewZoom(100); return; }
    const pane = previewPaneRef.current;
    const scaler = pane.querySelector('.preview-scaler');
    const preview = scaler?.querySelector('.invoice-preview-container');
    const paneWidth = pane.clientWidth - 16; // 8px inset breathing room on each side
    const naturalWidth = preview?.offsetWidth || 794;
    if (!(paneWidth > 0 && naturalWidth > 0)) { setPreviewZoom(100); return; }
    const ratio = paneWidth / naturalWidth;
    const nextZoom = Math.max(50, Math.min(200, Math.round(ratio * 100)));
    setPreviewZoom(nextZoom);
  }, []);
  // v1.10.22 — reported: "sidebar menu toggle option so customer will get
  // a close view for entries because quantity entry u see space is like
  // that we have to see in invoice preview what we are entering". Focus
  // mode: hide the preview so the editor gets the full width during
  // heavy data entry.
  const [previewCollapsed, setPreviewCollapsed] = useState(() => {
    try { return localStorage.getItem('fgsb_previewCollapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('fgsb_previewCollapsed', previewCollapsed ? '1' : '0'); } catch { /* sandboxed */ }
  }, [previewCollapsed]);
  const [details, setDetails] = useState(draft?.details || {
    invoiceNumber: '',
    // Local date: toISOString() is UTC, so between midnight and 05:30 in
    // India a new invoice was dated yesterday.
    invoiceDate: localToday(),
    dueDate: '',
    placeOfSupply: '',
    originalInvoiceRef: '',
    // v1.10.11 — Ship To fields. Default: same as billing (no extra
    // fields shown). Untick to type a separate delivery address.
    shipToSameAsBilling: true,
    shippingAddress: '',
    shippingCity: '',
    shippingPin: '',
    shippingState: '',
  });

  const [items, setItems] = useState(draft?.items || [
    { id: Date.now().toString(), name: '', hsn: '', quantity: 1, unit: 'Nos', rate: 0, discount: 0, taxPercent: 18, cessPercent: 0 }
  ]);
  // v1.10.24 — Client credit balance state. Loaded once on mount + refreshed
  // when the client name changes. `creditToApply` is what the user chose to
  // apply on THIS bill; it becomes a `credit-applied` payment at save time,
  // paired with a `credit-transferred-out` entry on each source bill.
  const [allBillsForCredit, setAllBillsForCredit] = useState([]);
  const [creditToApply, setCreditToApply] = useState(0);
  const [units, setUnits] = useState(getAllUnits());
  const [taxInclusive, setTaxInclusive] = useState(draft?.taxInclusive || false);

  // v1.10.4 — totals is now a `useMemo` (was a `useState` fed by
  // `useEffect + setTotals` which forced a second full render on every
  // keystroke). Same value on every render for the same inputs; the
  // extra render pass per character was the biggest perf hit in this
  // component per the audit's finding H15.
  const [saving, setSaving] = useState(false);
  const [termsTemplates, setTermsTemplates] = useState([]);
  const [selectedTermsId, setSelectedTermsId] = useState(draft?.selectedTermsId || '');
  const [customTerms, setCustomTerms] = useState(draft?.customTerms || '');
  const [customNotes, setCustomNotes] = useState(draft?.customNotes || '');
  const [internalNote, setInternalNote] = useState(draft?.internalNote || '');
  const [extraSections, setExtraSections] = useState(draft?.extraSections || []);
  const [savedClients, setSavedClients] = useState([]);
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  // v1.10.37 — Keyboard nav on client picker. Arrow keys cycle,
  // Enter commits, Escape closes. -1 = no highlight yet.
  const [clientPickerIdx, setClientPickerIdx] = useState(-1);
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [showClientModal, setShowClientModal] = useState(false);
  const [modalClient, setModalClient] = useState(null);
  const [isEditingClient, setIsEditingClient] = useState(false);
  const clientNameRef = useRef(null);
  const clientSuggestionsRef = useRef(null);
  const [products, setProducts] = useState([]);
  const [productSearch, setProductSearch] = useState({ itemId: null, query: '' });
  const [invoiceOptions, setInvoiceOptions] = useState(() => {
    try {
      const saved = localStorage.getItem('freegstbill_invoiceOptions');
      const persisted = saved ? JSON.parse(saved) : {};
      // v1.10.20 — paymentAccountSnapshot is per-bill data (frozen bank
      // details at time of save). It must NEVER be inherited via the
      // user-preference stores (localStorage / server). Strip on read so
      // opening Invoice B doesn't pick up Invoice A's snapshot.
      delete persisted.paymentAccountSnapshot;
      // Persisted options are the user's defaults, draft can override for in-progress work
      return { ...DEFAULT_OPTIONS, ...persisted, ...(draft?.invoiceOptions || {}) };
    } catch { return draft?.invoiceOptions || { ...DEFAULT_OPTIONS }; }
  });
  const [showOptions, setShowOptions] = useState(false);
  // v1.10.36 — Portal-based print preview modal state. Only opens for
  // thermal receipts; A4 users hit Print → OS dialog directly since the
  // OS dialog already shows a preview. See directPrint + executePrint.
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const printRef = useRef(null);
  // v1.10.48 — reported: "live preview show full when browser zoom on 50%".
  // `transform: scale()` shrinks what is PAINTED but never the element's
  // layout box, so the preview kept reserving its full natural width
  // (.invoice-preview-container is a hard `width: 210mm` ≈ 794px) at every
  // zoom level. On a pane narrower than that the sheet overflowed
  // horizontally, and because .preview-pane centres its children the LEFT
  // overflow scrolled out of reach entirely — the user saw a permanently
  // clipped invoice. Dropping the browser to 50% zoom "fixed" it only
  // because it doubles the viewport in CSS px, clearing 794px. That makes
  // this bug purely a function of pane width, so it is invisible on wide
  // monitors and reproduces every time on a 1366px laptop.
  //
  // Fix: measure the preview's natural size and reserve exactly
  // natural × zoom on a wrapper element, so the layout box tracks what is
  // actually painted. The container's width is intrinsic (mm, not %), so
  // sizing an ancestor cannot feed back into it — no observer loop.
  const [previewNatural, setPreviewNatural] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = printRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setPreviewNatural((prev) => (
      prev.w === el.offsetWidth && prev.h === el.offsetHeight
        ? prev
        : { w: el.offsetWidth, h: el.offsetHeight }
    ));
    // No explicit first call: observe() delivers an initial callback with
    // the current size, so the mount measurement comes for free without a
    // synchronous setState in the effect body.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [previewCollapsed]);
  const draftInitialized = useRef(!!draft);
  // v1.10.77 - only a brand-new blank invoice gets the first saved Terms
  // template filled in. It used to happen to every form once the templates
  // loaded, so opening a SAVED invoice replaced its terms (and auto-save then
  // stored the wrong terms on it), and a restored draft lost its terms too.
  const blankNewInvoice = useRef(!editingBill && !draft);
  const draftOptions = useRef(draft?.invoiceOptions || {});
  // v1.10.77 (#86) - a cancelled document, or one already converted into an
  // invoice, opens read-only: nothing is saved (no auto-save, Save explains
  // why); Download and Print still work. Duplicate it to make a new one.
  const [readOnlyDoc] = useState(() => !!editingBill && !editingBill._isDuplicate && !editingBill._convertToType
    && (editingBill.status === 'cancelled' || !!editingBill.convertedTo));
  const [autoSaveStatus, setAutoSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved'
  const autoSaveTimer = useRef(null);
  // v1.10.22 — reported: "if user click back without even changing anything
  // it always ask to save and close". Cause: handleBack checked
  // `autoSaveStatus !== 'saved'`, and autoSaveStatus started at 'idle' on
  // mount (never flipping to 'saved' until an auto-save fired). So opening
  // an existing bill and immediately clicking Back showed the modal even
  // with zero edits. Now: `isDirty` is set only on real post-init changes,
  // and Back reads it instead. Cleared on successful save.
  const isDirty = useRef(false);
  // Skip stock deduction when EDITING an existing bill — but NOT when
   // duplicating one (P1 #21: `_isDuplicate` marks a new sale that must
   // decrement stock). Same logic applies to convert-to-tax-invoice which
   // sets _convertToType — that's also a new bill in a new type.
  // v1.10.76 (#80) - what this bill has done to stock before it is first saved
  // from this editor: an issued bill, its own record; a conversion takes over
  // the original's record (so a challan's or an old quotation's stock is
  // counted once, not again); a duplicate or a new bill, nothing. Once the
  // bill is on the server, every save works from the server's record instead.
  const stockStart = useRef(editingBill && (!editingBill._isDuplicate || editingBill._convertToType) ? appliedStock(editingBill) : {});
  const conversionMarked = useRef(false);
  // v1.10.76 (#83) - has this invoice been downloaded or printed? Then a plain
  // Save refreshes its PDF in Saved Invoices too.
  const hasOutput = useRef(!!editingBill && !editingBill._isDuplicate && !editingBill._convertToType && (Number(editingBill.printedCount) || 0) > 0);
  const hasInitialized = useRef(false); // prevent auto-save during initial load
  // Whether we've already atomically reserved a counter number for this form.
  // Peek-on-mount + reserve-on-save (P0 #9) avoids burning counter values on
  // cancelled/abandoned forms.
  const numberReserved = useRef(!!editingBill);
  // Whether the bill has been successfully persisted to the server AT LEAST
  // ONCE this session. Editing = true from the start (bill already exists).
  // For new bills, flips to true after the first successful save. Used to
  // decide whether subsequent saves need overwrite: true (they do — same
  // invoice number, otherwise the server 409s).
  // v1.10.79 - a duplicate or conversion has not been saved yet.
  const hasBeenSaved = useRef(!!editingBill && !editingBill._isDuplicate);
  // The number this bill is stored under on the server (null until the first
  // save of a new bill). When the Invoice Number field no longer matches it,
  // the save is a RENAME: the bill moves to the new number, which must be
  // free, and the old file goes. It used to be saved as a second invoice with
  // overwrite on - replacing any other invoice that had the typed number - and
  // the old one stayed, so the sale was counted twice.
  const savedId = useRef(editingBill && !editingBill._isDuplicate ? editingBill.id : null);
  // The last number the editor filled in by itself (a peek), so it knows which
  // number it may replace when the business turns out to be another (#95).
  const peekedNumber = useRef(null);
  // Each number request gets a ticket; only the latest one's answer is used, so
  // an answer that arrives late (asked before the business was known) cannot
  // overwrite the right one.
  const peekSeq = useRef(0);
  const warnedLongNumber = useRef(false);

  const typeConfig = INVOICE_TYPES[invoiceType];
  const showGST = invoiceOptions.showGST;
  // Tax label and rate presets follow the seller's country, not the client's, since
  // the seller charges and remits the tax. Sellers without a country fall back to India.
  const sellerCountryConfig = getCountryConfig(profile?.country);
  // v1.10.5 — audit M25 fix. Merge user's custom tax rates from Print
  // Settings into the country's default preset list. Prior code
  // persisted `customTaxRates` in localStorage but never read them
  // back, so the "Custom tax rate presets" UI in Print Settings was
  // dead weight. Now: user adds 3, 0.25, 7.5 → they appear in the
  // per-line tax dropdown alongside 0/5/12/18/28.
  const _psPrintForRates = getPrintSettings();
  const customRates = Array.isArray(_psPrintForRates.customTaxRates)
    ? _psPrintForRates.customTaxRates.map(Number).filter(n => isFinite(n) && n >= 0 && n <= 100)
    : [];
  const baseCountryRates = sellerCountryConfig.taxRates && sellerCountryConfig.taxRates.length
    ? sellerCountryConfig.taxRates
    : [0, 5, 12, 18, 28, 40];
  const countryTaxRates = useMemo(
    () => [...new Set([...baseCountryRates, ...customRates])].sort((a, b) => a - b),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseCountryRates.join(','), customRates.join(',')]
  );
  // Rate for a new row: 18% where it exists (India's standard rate), else the
  // second-highest rate. Was always second-highest, which turns into 28% once
  // 40% is in the list.
  const defaultTaxRate = countryTaxRates.includes(18) ? 18 : (countryTaxRates[countryTaxRates.length - 2] ?? 0);
  const taxLabel = sellerCountryConfig.taxLabel || 'GST';

  // Clamp a numeric input to non-negative (and finite). Used for qty/rate/discount.
  // v1.10.7 — hoisted stable identity so memoized LineItem's props stay
  // shallow-equal across parent re-renders.
  const clampNonNeg = useCallback((raw) => {
    const n = parseFloat(raw);
    if (!isFinite(n) || n < 0) return 0;
    return n;
  }, []);

  // Persist options — v1.10.4 audit M16.
  // Prior: every checkbox flip fired an immediate `/api/display-options`
  // POST. Wiggling a toggle 10× → 10 network requests. localStorage
  // stays synchronous (needed for reload persistence); the server POST
  // is now debounced 800ms so quick option-tweak spins settle to one
  // request.
  const optionsPersistTimer = useRef(null);
  // v1.10.75 - a saved bill's options are that bill's, not the defaults for
  // new invoices. Opening an old bill used to write its options back as the
  // defaults (here) and then let the server defaults replace the bill's own
  // (the mount load below), so a bill saved without round-off could come back
  // rounded, with a different total, and the Settings switch flipped itself.
  const editingSaved = !!editingBill?.data && !editingBill?._isDuplicate;
  useEffect(() => {
    if (editingSaved) return undefined;
    // v1.10.20 — Strip paymentAccountSnapshot before persisting. It's per-
    // bill data (bank details frozen at save time), not a user preference.
    // Prior code auto-persisted the entire invoiceOptions to localStorage
    // AND to the server, so opening Invoice A (Bank X snapshot) polluted
    // both stores, and opening Invoice B inherited Bank X — defeating the
    // v1.10.19 backfill entirely.
    const { paymentAccountSnapshot: _snap, ...persistable } = invoiceOptions;
    localStorage.setItem('freegstbill_invoiceOptions', JSON.stringify(persistable));
    if (hasInitialized.current) {
      clearTimeout(optionsPersistTimer.current);
      optionsPersistTimer.current = setTimeout(() => {
        saveInvoiceDisplayOptions(persistable).catch(() => {});
      }, 800);
    }
    return () => clearTimeout(optionsPersistTimer.current);
  }, [invoiceOptions, editingSaved]);

  // Load saved display options from server on mount (overrides localStorage if available)
  useEffect(() => {
    if (editingSaved) return; // the bill's own options win (see above)
    getInvoiceDisplayOptions().then(serverOpts => {
      if (serverOpts) {
        // v1.10.20 — Strip cross-invoice bleed-through of paymentAccountSnapshot
        // from any stale server-persisted options (pre-v1.10.20 clients would
        // have posted it). Preserves the current bill's snapshot in `prev`.
        delete serverOpts.paymentAccountSnapshot;
        // v1.10.77 - a restored draft keeps its own choices (design, columns
        // ...); the saved defaults only fill what it does not set. They used
        // to replace the draft's options a moment after a page refresh.
        const merged = { ...DEFAULT_OPTIONS, ...serverOpts, ...draftOptions.current };
        setInvoiceOptions(prev => {
          // Only update if different to avoid unnecessary re-renders
          const changed = Object.keys(merged).some(k => merged[k] !== prev[k]);
          if (changed) {
            // Preserve the per-bill snapshot from prev when applying server defaults.
            const nextOpts = { ...merged, paymentAccountSnapshot: prev.paymentAccountSnapshot };
            const { paymentAccountSnapshot: _skip, ...toPersist } = nextOpts;
            localStorage.setItem('freegstbill_invoiceOptions', JSON.stringify(toPersist));
            return nextOpts;
          }
          return prev;
        });
      }
    }).catch(() => {});
  }, [editingSaved]);

  // Debounced draft save (see hooks/useInvoiceDraft).
  useInvoiceDraft({ invoiceType, client, details, items, customTerms, customNotes, internalNote, extraSections, selectedTermsId, invoiceOptions, taxInclusive });

  // Mark initialized after first render cycle so auto-save doesn't trigger on load
  useEffect(() => {
    const t = setTimeout(() => { hasInitialized.current = true; }, 1500);
    return () => clearTimeout(t);
  }, []);

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
  }, [client?.name, items, editingBill]);

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

  const clearDraft = () => {
    clearDraft();
  };

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
        const _psForPrefix = getPrintSettings();
        const rawOverride = _psForPrefix.customPrefixes?.[type];
        const overridePrefix = rawOverride && rawOverride.trim();
        const prefix = overridePrefix || INVOICE_TYPES[type]?.prefix || 'INV';
        const seq = ++peekSeq.current;
        getNextInvoiceNumber(prefix, { peek: true, explicitPrefix: !!overridePrefix, invoiceType: type, businessKey: businessKeyOf(profile) }).then(num => {
          if (seq !== peekSeq.current) return;
          peekedNumber.current = num;
          setDetails({ ...d.details, invoiceNumber: num, invoiceDate: localToday() });
          numberReserved.current = false;
        });
      } else {
        setDetails(d.details);
      }
    } else if (!details.invoiceNumber) {
      // v1.10.10 — honour the per-type prefix override for fresh invoices.
      const _psForPrefix = getPrintSettings();
      const rawOverride = _psForPrefix.customPrefixes?.[invoiceType];
      const overridePrefix = rawOverride && rawOverride.trim();
      const prefix = overridePrefix || INVOICE_TYPES[invoiceType]?.prefix || 'INV';
      const seq = ++peekSeq.current;
      getNextInvoiceNumber(prefix, { peek: true, explicitPrefix: !!overridePrefix, invoiceType, businessKey: businessKeyOf(profile) }).then(num => {
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
  const bizKey = businessKeyOf(profile);
  const peekedFor = useRef(bizKey);
  useEffect(() => {
    if (!bizKey || peekedFor.current === bizKey) return;
    peekedFor.current = bizKey;
    if ((editingBill && !editingBill._isDuplicate) || numberReserved.current || hasBeenSaved.current) return;
    // Only a number the editor filled in itself (or none): a draft's own
    // number, or one typed by hand, stays as it is.
    if (details.invoiceNumber && details.invoiceNumber !== peekedNumber.current) return;
    const rawOverride = getPrintSettings().customPrefixes?.[invoiceType];
    const overridePrefix = rawOverride && rawOverride.trim();
    const prefix = overridePrefix || INVOICE_TYPES[invoiceType]?.prefix || 'INV';
    const seq = ++peekSeq.current;
    getNextInvoiceNumber(prefix, { peek: true, explicitPrefix: !!overridePrefix, invoiceType, businessKey: bizKey })
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

  const isIssuedInvoice = !!editingBill && !editingBill._isDuplicate && !editingBill._convertToType;

  // v1.10.68 (#68, idea from @deppen12) — the GSTIN already names the state and
  // carries a checksum, so fill the state and catch a typo without any API key
  // or internet. The state decides place of supply: get it wrong and the
  // invoice charges CGST + SGST where it owes IGST, or the other way round.
  const [gstinHint, setGstinHint] = useState(null);
  const handleClientGstinBlur = () => {
    const decoded = decodeGstin(client.gstin);
    if (!decoded) { setGstinHint(null); return; }
    if (!decoded.checksumOk) {
      setGstinHint({ tone: 'warn', message: 'This GSTIN fails its own checksum — check for a typo.' });
      return;
    }
    if (!decoded.state) { setGstinHint(null); return; }
    if (!client.state?.trim()) {
      setClient(prev => ({ ...prev, state: decoded.state }));
      setGstinHint({ tone: 'ok', message: `Registered in ${decoded.state} — state filled in.` });
    } else if (client.state.trim().toLowerCase() !== decoded.state.toLowerCase()) {
      setGstinHint({ tone: 'warn', message: `This GSTIN is registered in ${decoded.state}, but the state says ${client.state}.` });
    } else {
      setGstinHint({ tone: 'ok', message: `Registered in ${decoded.state}.` });
    }
  };

  const handleTypeChange = async (type) => {
    if (isIssuedInvoice) return;
    setInvoiceType(type);
    const config = INVOICE_TYPES[type];
    // v1.10.14 — honour the per-type prefix override when switching invoice type.
    const _psForPrefix = getPrintSettings();
    const rawOverride = _psForPrefix.customPrefixes?.[type];
    const overridePrefix = rawOverride && rawOverride.trim();
    const prefix = overridePrefix || config?.prefix || 'INV';
    // Peek — actual reservation happens on save.
    const seq = ++peekSeq.current;
    const num = await getNextInvoiceNumber(prefix, { peek: true, explicitPrefix: !!overridePrefix, invoiceType: type, businessKey: businessKeyOf(profile) });
    if (seq !== peekSeq.current) return;
    peekedNumber.current = num;
    numberReserved.current = false;
    setDetails(prev => ({ ...prev, invoiceNumber: num }));

    // Auto-set options based on type
    if (type === 'bill-of-supply') {
      setInvoiceOptions(prev => ({ ...prev, showGST: false, showPlaceOfSupply: false }));
    } else {
      setInvoiceOptions(prev => ({ ...prev, showGST: config.showGST, showPlaceOfSupply: config.showGST }));
    }
  };

  const toggleOption = (key) => {
    setInvoiceOptions(prev => ({ ...prev, [key]: !invoiceOptionOn(prev, key) }));
  };

  const { totals } = useInvoiceTotals({ allBillsForCredit, client, details, editingBill, items, profile, showGST, taxInclusive, invoiceOptions });

  // v1.10.24 — Compute available client credit from prior overpayments.
  // Excludes the bill we're editing (that would double-count our own
  // in-progress creditToApply state). `available` is the FIFO-orderable
  // total; `sources` powers the auditable "from Bill A/2026-27/00X" trail.
  const clientCredit = useMemo(() => {
    if (!client?.name?.trim()) return { available: 0, sources: [] };
    const otherBills = editingBill
      ? allBillsForCredit.filter(b => b.id !== editingBill.id)
      : allBillsForCredit;
    return getClientCredit(client.name, otherBills);
  }, [client?.name, allBillsForCredit, editingBill]);

  // Auto-apply once per client change when the setting is on. Uses a
  // ref-tracked "last seen client" so subsequent item edits (which move
  // totals.total up and down) don't blow away a user's manual override.
  const lastAutoAppliedClient = useRef(null);
  useEffect(() => {
    if (editingBill) return;
    if (!invoiceOptions.autoApplyClientCredit) {
      lastAutoAppliedClient.current = null;
      return;
    }
    const name = client?.name?.trim() || '';
    if (!name || lastAutoAppliedClient.current === name) return;
    lastAutoAppliedClient.current = name;
    const cap = Math.min(clientCredit.available, Number(totals.total) || 0);
    setCreditToApply(cap > 0.005 ? cap : 0);
  }, [client?.name, clientCredit.available, invoiceOptions.autoApplyClientCredit, editingBill]);

  // Warn when the seller's state is missing for Indian GST invoices — without it, the
  // interstate detection silently defaults to intrastate (CGST+SGST) which is a real money bug.
  useEffect(() => {
    const isIndia = (profile?.country || 'India') === 'India';
    if (!isIndia || !showGST) return;
    if (!profile?.state && client?.state) {
      const key = `gst_stateWarning_${profile?.businessName || 'profile'}`;
      if (!sessionStorage.getItem(key)) {
        toast('Set your business State in Settings — required for correct CGST/SGST vs IGST split.', 'warning');
        sessionStorage.setItem(key, '1');
      }
    }
  }, [profile?.state, profile?.country, profile?.businessName, client?.state, showGST]);

  // v1.10.7 — audit H14: handlers wrapped in useCallback so the memoized
  // LineItem below sees stable references and only re-renders the ROW
  // that actually changed. Prior code created new function identities
  // every render → every keystroke re-rendered EVERY line item.
  const handleItemChange = useCallback((id, field, value) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
    if (field === 'name') {
      setProductSearch({ itemId: id, query: value });
    }
  }, []);

  const selectProduct = useCallback((itemId, product) => {
    // v1.10.29 — Prefer sellingPrice for sales invoices (falls back to
    // legacy `rate` for pre-v1.10.29 products).
    const salePrice = product.sellingPrice ?? product.rate ?? 0;
    setItems(prev => prev.map(item => item.id === itemId ? {
      ...item,
      name: product.name,
      hsn: product.hsn || '',
      rate: salePrice,
      unit: product.unit || item.unit || 'Nos',
      taxPercent: product.taxPercent ?? defaultTaxRate,
      productId: product.id,
      isCharge: false, // a product picked on the delivery line makes it a product line
    } : item));
    setProductSearch({ itemId: null, query: '' });
  }, [countryTaxRates]);

  const getProductSuggestions = useCallback((itemId) => {
    if (productSearch.itemId !== itemId || !productSearch.query.trim()) return [];
    const q = productSearch.query.toLowerCase();
    return products.filter(p =>
      p.name?.toLowerCase().includes(q) || p.hsn?.toLowerCase().includes(q)
    ).slice(0, 5);
  }, [productSearch.itemId, productSearch.query, products]);

  // v1.10.77 (#87) - one delivery-charges line per invoice (see deliveryChargeLine).
  const hasDeliveryCharge = items.some((i) => i.isCharge);
  const addDeliveryCharge = () => {
    if (hasDeliveryCharge) return;
    setItems((prev) => [...prev, deliveryChargeLine(prev)]);
  };

  const addItem = () => {
    // Default unit depends on whether this invoice is for goods or services —
    // freelancers and consultants get 'Hrs' by default, retailers/manufacturers
    // get 'Nos'. The dropdown still shows the user's last-used unit if they've
    // overridden a previous row.
    const defaultUnit = items.length > 0 && items[items.length - 1].unit
      ? items[items.length - 1].unit
      : getDefaultUnitForMode(invoiceOptions.invoiceMode);
    const newId = Date.now().toString();
    setItems(prev => [...prev, {
      id: newId, name: '', hsn: '', quantity: 1, unit: defaultUnit, rate: 0, discount: 0,
      taxPercent: showGST ? defaultTaxRate : 0,
      cessPercent: 0,
    }]);
    // Move keyboard focus to the new row's Description field so users who
    // Tab to the Add Item button and press Enter don't have to grab the
    // mouse. requestAnimationFrame waits until React has actually rendered
    // the new row in the DOM before we try to find/focus it.
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-item-id="${newId}"] input.form-input`);
      if (el) el.focus();
    });
  };

  // Custom unit handler — prompts for a label, persists to localStorage, applies to current item.
  // v1.10.7 — useCallback for the LineItem memoization benefit.
  const handleAddCustomUnit = useCallback(async (itemId) => {
    const label = await promptAction({
      title: 'Add custom unit',
      message: 'Enter a short unit label. Saved for reuse across future invoices.',
      placeholder: 'e.g. Carat, Bundle, Bushel',
      confirmLabel: 'Add unit',
    });
    if (!label) return;
    const trimmed = label.trim();
    if (!trimmed) return;
    if (trimmed.length > 20) { toast('Unit name must be 20 characters or fewer', 'warning'); return; }
    const ok = addCustomUnit(trimmed);
    setUnits(getAllUnits());
    if (!ok) {
      toast(`Unit "${trimmed}" already exists or is reserved`, 'info');
    } else {
      toast(`Unit "${trimmed}" added`, 'success');
    }
    handleItemChange(itemId, 'unit', trimmed);
  }, [handleItemChange]);

  const handleRemoveCustomUnit = useCallback(async (label) => {
    if (!await confirmAction({
      title: `Remove custom unit "${label}"?`,
      message: 'Existing invoices keep this label unchanged. It just no longer appears in the unit dropdowns.',
      confirmLabel: 'Remove unit',
      tone: 'danger',
    })) return;
    removeCustomUnit(label);
    setUnits(getAllUnits());
    toast(`Removed custom unit "${label}"`, 'success');
  }, []);

  const removeItem = useCallback((id) => {
    // Uses functional setState so the useCallback dep can stay empty —
    // no stale-closure risk from items.length; the guard reads current.
    setItems(prev => prev.length > 1 ? prev.filter(item => item.id !== id) : prev);
  }, []);

  const handleTermsSelect = (templateId) => {
    setSelectedTermsId(templateId);
    const tpl = termsTemplates.find(t => t.id === templateId);
    if (tpl) setCustomTerms(tpl.content);
  };

  const selectSavedClient = (cli) => {
    // Spread the FULL client — earlier versions cherry-picked six fields
    // and silently dropped country/email/phone/isSEZ. Consequence: loading
    // an SEZ client via auto-complete cleared the SEZ flag, so the invoice
    // computed CGST+SGST instead of IGST → wrong tax on the filed return.
    setClient({
      name: cli.name || '',
      address: cli.address || '',
      city: cli.city || '',
      pin: cli.pin || '',
      state: cli.state || '',
      gstin: cli.gstin || '',
      country: cli.country || '',
      email: cli.email || '',
      phone: cli.phone || '',
      isSEZ: !!cli.isSEZ,
    });
    setSelectedClientId(cli.id);
    setShowClientSuggestions(false);
    // v1.9.1 — auto-apply per-client print preferences (if set on the client
    // record). Overrides invoice-level defaults for this session. Only fires
    // for NEW bills (not when editing) since editing bills keep saved options.
    //
    // v1.10.12 — reported: "one client is set with thermal invoice print,
    // others are also changing the preview". Root cause: prior code only
    // set a patch WHEN the client had a preference — so switching from
    // Client A (thermal) → Client B (no preference) left the thermal
    // setting sticky. Now we ALWAYS assign paperSize / currency /
    // clientAutoPrint to the new client's value OR the app default, so
    // client B resets to A4/INR cleanly.
    if (!editingBill) {
      setInvoiceOptions(prev => ({
        ...prev,
        // v1.10.33 — Was `cli.preferredPaperSize || 'a4'` which HARD-RESET
        // to A4 for every client without an explicit preference — wiping
        // out the user's globally saved default (e.g. someone who prints
        // every invoice on 80mm thermal would land back on A4 the moment
        // they picked a client). Now falls back to prev.paperSize so
        // globally-persisted choice sticks until the user changes it.
        paperSize: cli.preferredPaperSize || prev.paperSize || 'a4',
        // v1.10.48 — Custom paper carries its dimensions in SEPARATE
        // fields, and prior code restored only `preferredPaperSize`. So a
        // client saved on 'custom' came back as 'custom' with no width —
        // and getPaperSize() defaults a missing custom width to 80mm,
        // whose `kind` is 'thermal'. Net effect: selecting that client
        // silently turned the invoice into an 80mm receipt. Restore the
        // dimensions with the size, falling back to the current values
        // rather than to getPaperSize's thermal default.
        customPaperWidth: cli.preferredCustomPaperWidth || prev.customPaperWidth || 80,
        customPaperHeight: cli.preferredCustomPaperHeight || prev.customPaperHeight || 297,
        currency: cli.preferredCurrency || prev.currency || 'INR',
        // v1.10.5 — client-level auto-print override (see original comment).
        clientAutoPrint: !!cli.autoPrint,
      }));
    }
    toast(`Loaded client: ${cli.name}`, 'info');
  };

  // Open modal to add new client (pre-fill from current invoice fields)
  const openAddClientModal = () => {
    // v1.10.74 - pass country too; without it the modal fell back to the
    // business country and saving could overwrite the invoice's country.
    setModalClient({ name: client.name || '', address: client.address || '', city: client.city || '', pin: client.pin || '', state: client.state || '', gstin: client.gstin || '', country: client.country || '' });
    setIsEditingClient(false);
    setShowClientModal(true);
    setShowClientSuggestions(false);
  };

  // Open modal to edit existing saved client
  const openEditClientModal = (cli) => {
    setModalClient(cli);
    setIsEditingClient(true);
    setShowClientModal(true);
  };

  // Save from modal (add or update)
  const handleClientModalSave = async (formData) => {
    const data = { ...formData };
    if (isEditingClient && modalClient?.id) data.id = modalClient.id;
    await saveClient(data);
    const updated = await getAllClients();
    setSavedClients(updated);
    // Sync the invoice form with the FULL saved record — dropping
    // country/email/phone/isSEZ here was the SEZ tax bug.
    setClient({
      name: data.name || '',
      address: data.address || '',
      city: data.city || '',
      pin: data.pin || '',
      state: data.state || '',
      gstin: data.gstin || '',
      country: data.country || '',
      email: data.email || '',
      phone: data.phone || '',
      isSEZ: !!data.isSEZ,
    });
    if (isEditingClient && modalClient?.id) {
      setSelectedClientId(modalClient.id);
      toast(`Client "${data.name}" updated!`, 'success');
    } else {
      const found = updated.find(c => c.name === data.name.trim() && !savedClients.some(old => old.id === c.id));
      if (found) setSelectedClientId(found.id);
      toast(`Client "${data.name}" saved!`, 'success');
    }
    setShowClientModal(false);
  };

  // v1.10.6 — audit L15. Small filter but cheap to memoize; keeps the
  // suggestion list identity stable across renders where neither
  // input matters (saves a downstream re-render of the suggestion
  // dropdown).
  const filteredClients = useMemo(() => {
    const q = client.name.trim().toLowerCase();
    if (!q) return savedClients;
    return savedClients.filter(cli => cli.name.toLowerCase().includes(q));
  }, [client.name, savedClients]);

  // Close suggestions on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (clientSuggestionsRef.current && !clientSuggestionsRef.current.contains(e.target) &&
          clientNameRef.current && !clientNameRef.current.contains(e.target)) {
        setShowClientSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const saveInvoiceToDBNow = async (skipStockDeduction = false, extraPatch = {}) => {
    if (readOnlyDoc) {
      toast(editingBill.convertedTo
        ? `Already converted to ${editingBill.convertedTo}, so it is not changed. Use Duplicate to make a new one.`
        : 'A cancelled invoice is not changed. Undo the cancel on the Dashboard, or use Duplicate.', 'warning');
      return null;
    }
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
        const _psForPrefix = getPrintSettings();
        const rawOverride = _psForPrefix.customPrefixes?.[invoiceType];
        const overridePrefix = rawOverride && rawOverride.trim();
        const prefix = overridePrefix || INVOICE_TYPES[invoiceType]?.prefix || 'INV';
        const numOpts = { explicitPrefix: !!overridePrefix, invoiceType, businessKey: businessKeyOf(profile), invoiceDate: details.invoiceDate };
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
      ...(isIssued && (serverCopy?.convertedTo || editingBill.convertedTo) ? { convertedTo: serverCopy?.convertedTo || editingBill.convertedTo } : {}),
      data: { profile, client, details: { ...details, invoiceNumber: finalInvoiceNumber }, items, totals, invoiceType, customTerms, customNotes, internalNote, extraSections, invoiceOptions: invoiceOptionsWithSnapshot, taxInclusive,
        // A converted quotation/proforma/challan's stock moved to its invoice:
        // its own record stays empty, or a save would take the stock twice.
        stockApplied: isIssued && (serverCopy?.convertedTo || editingBill.convertedTo) ? {} : stockEffect(items, invoiceType, seedStatus) }
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
      //    every options change — see the useEffect around line 594).
      //  - Prior client-select code (~line 1131) reads cli.preferred*
      //    already, so this write-side fix closes the loop.
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
          const _psForPrefix = getPrintSettings();
          const rawOverride = _psForPrefix.customPrefixes?.[invoiceType];
          const overridePrefix = rawOverride && rawOverride.trim();
          const prefix = overridePrefix || INVOICE_TYPES[invoiceType]?.prefix || 'INV';
          let nextNum = bill.id;
          let success = false;
          // Each try moves the counter on for good, so this walks past a run of
          // numbers taken by a CSV import or a restore once, then never again.
          // ponytail: one local request pair per taken number; fine up to ~1000.
          for (let i = 0; i < 1000; i++) {
            try {
              nextNum = await getNextInvoiceNumber(prefix, { explicitPrefix: !!overridePrefix, invoiceType, businessKey: businessKeyOf(profile), invoiceDate: details.invoiceDate });
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
    if (editingBill?._convertToType && !conversionMarked.current && savedNumber) {
      conversionMarked.current = true;
      try {
        const source = (await getAllBills()).find((b) => b.id === editingBill.id);
        if (source) {
          await saveBill({ ...source, convertedTo: savedNumber, ...(source.data ? { data: { ...source.data, stockApplied: {} } } : {}) }, { overwrite: true });
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

  // Shared PDF generation helper. v1.10.3 — wraps the whole body in
  // try/finally so `scalerEl.style.transform` is always restored, even
  // if html2canvas or jsPDF throws mid-render. Prior code only restored
  // on the success path — an exception left the on-screen preview
  // stuck at scale 1.0 until the user navigated away.
  const buildPDF = async ({ archive = false, forPrint = false } = {}) => {
    const printSettings = getPrintSettings();
    const scalerEl = printRef.current.closest('.preview-scaler');
    const spacerFit = {};
    if (scalerEl) scalerEl.style.transform = 'none';
    try {
      return await __buildPDFInner(printSettings, archive, spacerFit, forPrint);
    } finally {
      spacerFit.restore?.();
      if (scalerEl) scalerEl.style.transform = '';
    }
  };

  // archive: the copy kept in Saved Invoices, which carries no REPRINT stamp.
  const __buildPDFInner = async (printSettings, archive = false, spacerFit = {}, forPrint = false) => {

    // v1.10.46 — Hoisted from line ~2133 to fix the v1.10.45 regression
    // where `isHeaderOn` / `isFooterOn` (introduced in v1.10.45 for the
    // page-2+ header/footer reserves) referenced this constant BEFORE
    // its declaration → Temporal Dead Zone ReferenceError → every
    // buildPDF() call threw → both `Print` and `Save & Download PDF`
    // buttons silently failed with the generic "Print failed" /
    // "Failed to generate PDF" toasts (reported in issue #20). Every
    // subsequent guard in this function that already referenced
    // isThermalPdf keeps working — this is a pure hoist.
    const isThermalPdf = getPaperSize(invoiceOptions.paperSize, invoiceOptions).kind === 'thermal';

    // PDF quality / size trade-off:
    //   - `compress: true` deflate-compresses PDF streams (incl. embedded images).
    //     Adds ~50-150ms but typically shrinks output by 15-30%.
    //   - Render scale = max(3, devicePixelRatio * 2). Bumping from 2 to 3 makes text
    //     visibly sharper without much file-size increase, because JPEG compresses
    //     clean line-art / glyphs efficiently. On Retina/4K screens we go higher.
    //   - JPEG quality 0.95 vs old 0.92: gain in legibility for small text outweighs
    //     the modest size bump.
    // Paper size (v1.8.1) — read from invoiceOptions. A4 default; A5 uses
    // jsPDF's built-in format; thermal 80mm/58mm use custom [width, height].
    // Thermal formats use a tall single-column layout — the InvoicePreview
    // component branches on options.paperSize CSS class to render compact.
    const paperCfg = getPaperSize(invoiceOptions.paperSize, invoiceOptions);
    // jsPDF orientation defaults to 'portrait' if the paper config doesn't
    // specify it, so pre-v1.8.3 saved bills keep rendering portrait.
    // Note: `let pdf` (not const) so the thermal path can replace it with
    // a content-height-sized instance after html2canvas returns — thermal
    // receipts were previously always 297mm tall regardless of actual
    // content, wasting 15-20cm of blank paper per receipt when the PDF
    // was reprinted.
    let pdf = new jsPDF({
      orientation: paperCfg.jsPdfOrientation || 'portrait',
      unit: 'mm',
      format: paperCfg.jsPdfFormat,
      compress: true,
    });
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfPageHeight = pdf.internal.pageSize.getHeight();
    const extraPages = printRef.current.querySelectorAll('[data-pdf-page]');
    // v1.9.1 — quality-driven render scale + JPEG quality:
    //   draft   → scale 2, JPEG 0.85 → ~50% smaller PDF, email-friendly
    //   standard→ scale 3, JPEG 0.95 → default (existing behaviour)
    //   hd      → scale max(4, dpr*3), JPEG 0.98 → archival quality, larger
    // v1.10.3 — Scale is now capped at 6× on any device. Prior code
    // `Math.max(4, dpr * 3)` on a 4× DPR Android phone hit 12× → an
    // A4 canvas at 100 megapixels → OOM crash before jsPDF ever ran.
    // Also: PNG for HD (crisp text edges — invoices are line-art),
    // JPEG for draft/standard (file size wins). Prior always-JPEG
    // smudged glyph edges on high-DPI screens.
    const capScale = (n) => Math.min(6, Math.max(2, Math.round(n)));
    const qualityCfg = {
      draft:    { scale: 2, imgFormat: 'JPEG', quality: 0.85 },
      standard: { scale: capScale(Math.max(3, (window.devicePixelRatio || 1) * 2)), imgFormat: 'JPEG', quality: 0.95 },
      hd:       { scale: capScale(Math.max(4, (window.devicePixelRatio || 1) * 2.5)), imgFormat: 'PNG', quality: 1.0 },
    };
    // v1.10.77 (#86) - printing always uses HD: a print is not emailed, so file
    // size does not matter, and the JPEG of "standard" (what most business
    // presets set) printed visibly softer than the downloaded PDF looked.
    const q = forPrint ? qualityCfg.hd : (qualityCfg[printSettings.pdfQuality] || qualityCfg.standard);
    const renderScale = q.scale;
    const jpegQuality = q.quality;
    const imgFormat = q.imgFormat;   // 'JPEG' or 'PNG'
    // v1.10.3 — Await webfonts before rasterising. On a cold load,
    // html2canvas fired before Inter finished downloading → the capture
    // used fallback fonts with wrong glyph metrics → table columns
    // overflowed. `document.fonts.ready` resolves once every declared
    // font has loaded (or failed).
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch { /* non-fatal */ }
    }

    // v1.10.60 — reported (#51, @sguptagzb): "when I try to print the
    // Invoice, the format is not coming as it comes in Preview", with a
    // sample PDF attached.
    //
    // Decoding that PDF showed the page rendered with NO layout CSS —
    // no table borders, no cards, no flex rows, so labels ran straight into
    // values ("Subtotal(rupee)1,78,000.00"). Inline styles survived, class
    // rules did not. Generating the same invoice here produced a correctly
    // styled PDF on the identical version, so the code was fine and their
    // environment was not.
    //
    // Root cause of the whole class: html2canvas clones the invoice into a
    // detached document, and that clone has to RE-FETCH the stylesheet by
    // URL. Any reason that fetch fails — a CSP source expression that does
    // not match the origin in use, a service worker (this is a PWA) serving
    // a stale or failed response, a clone document with a null origin —
    // produces a silently unstyled PDF. v1.10.48 widened the CSP, which
    // fixed one cause; this removes the dependency altogether.
    //
    // Now the document's own CSS rules are read out and injected into the
    // clone as a plain <style> element, so the clone never fetches anything.
    // The thermal print path has done exactly this since v1.10.42 — the PDF
    // path simply never adopted it.
    const collectDocumentStyles = () => {
      const parts = [];
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const rules = sheet.cssRules;
          if (!rules) continue;
          for (const rule of Array.from(rules)) parts.push(rule.cssText);
        } catch { /* cross-origin (Google Fonts) — skip; system fonts suffice */ }
      }
      return parts.join(String.fromCharCode(10));
    };

    const captureOptions = (el) => ({
      scale: renderScale,
      // v1.10.3 — useCORS was `true` but every image source is a base64
      // data URL (profile.logo, generated QR). `useCORS: true` triggers
      // a CORS preflight on any relative URL that slips in and silently
      // fails; today it's a dead flag but was flagged as fragile.
      useCORS: false,
      logging: false,
      letterRendering: true,
      backgroundColor: '#ffffff',
      // v1.10.3 — was `0` (disable). A broken image (bad logo, stale
      // QR) hung the capture indefinitely, giving the user a stuck
      // "Generating…" spinner. 15s is enough for real images + a
      // fallback for corrupt ones.
      imageTimeout: 15_000,
      width: el.scrollWidth,
      height: el.scrollHeight,
    });

    // Hide extra pages, capture main invoice.
    // v1.10.8 — audit M21 real fix. Prior code stamped the same tall
    // canvas at successive negative-Y offsets. Any row straddling a
    // pdfPageHeight boundary was cut mid-content on the PDF seam.
    // Now: pre-measure the DOM row boundaries so we can crop each
    // virtual page at a safe row-boundary instead of blindly slicing
    // every pdfPageHeight mm.
    //
    // Elements collected as "no-split-inside" anchors:
    //  • Every <tr> in the items table  → keep rows whole.
    //  • .inv-header / .inv-parties     → keep title + billing block whole.
    //  • .inv-footer-block              → keep bank / T&C / notes whole.
    //  • [data-pdf-page-boundary]       → escape hatch for future needs.
    //
    // The set collected here is DOM pixels relative to printRef.current.
    // We convert to canvas pixels below (× domToCanvasScale) once html2canvas
    // has returned and we know the true canvas.width.
    //
    // v1.10.70 - an edge is only offered if no row, footer block, signature
    // block or image straddles it (see safePageBoundaries). The footer is two
    // columns, and the gap between bank details and terms on the left ran
    // straight through the stamp on the right: the stamp printed half on
    // page 1 and half on page 2 (ERR-024).
    const collectRowBoundaries = (container) => {
      const top = container.getBoundingClientRect().top;
      const span = (el) => {
        const r = el.getBoundingClientRect();
        return [Math.max(0, r.top - top), Math.max(0, r.bottom - top)];
      };
      const edges = [0];
      container.querySelectorAll(
        '.inv-table tbody tr, .inv-table thead tr, .inv-header, .inv-parties, ' +
        '.inv-footer, .inv-footer-block, .inv-signature, .inv-totals, [data-pdf-page-boundary]'
      ).forEach(el => edges.push(...span(el)));
      const keepWhole = [...container.querySelectorAll(
        '.inv-table tbody tr, .inv-table thead tr, .inv-header, .inv-parties, ' +
        // v1.10.73 - [data-pdf-page-boundary] too: the Boxed grid and Tally
        // designs mark every block with it (signature included), and a page
        // must end at those blocks' edges, never through one.
        '.inv-footer-block, .inv-signature, .inv-totals, [data-pdf-page-boundary], img'
      )].map(span);
      return safePageBoundaries(edges, keepWhole);
    };
    // v1.10.70 - hide the extra pages BEFORE measuring, not after. The
    // separate-terms page sits inside the footer row, so measuring with it
    // still visible laid the footer out differently from the capture.
    extraPages.forEach(el => el.style.display = 'none');
    // v1.10.77 (#88) - trim the Tally / Boxed padding if it alone pushes the
    // invoice onto a second page; put back right after the capture.
    if (paperCfg.kind !== 'thermal') spacerFit.restore = fitSpacersToOnePage(printRef.current, pdfWidth, pdfPageHeight, printSettings);
    const domBoundariesPx = collectRowBoundaries(printRef.current);
    const domContainerWidth = printRef.current.getBoundingClientRect().width;

    const mainCanvas = await html2canvas(printRef.current, {
      ...captureOptions(printRef.current),
      onclone: (clonedDoc) => {
        // v1.10.60 (#51) — embed the stylesheet rather than letting the
        // clone re-fetch it. Without this, any fetch failure yields a
        // completely unstyled PDF with no error shown to the user.
        try {
          const css = collectDocumentStyles();
          if (css) {
            const styleEl = clonedDoc.createElement('style');
            styleEl.setAttribute('data-fgsb-inlined', '1');
            styleEl.textContent = css;
            (clonedDoc.head || clonedDoc.documentElement).appendChild(styleEl);
          }
        } catch { /* never block the capture over styling */ }
        clonedDoc.querySelectorAll('*').forEach(n => { n.style.letterSpacing = '0px'; n.style.wordSpacing = '0px'; });
        const inv = clonedDoc.getElementById('invoice-preview');
        if (inv) {
          // Match the target paper width so html2canvas captures at the right
          // aspect ratio. jsPDF will scale to fit the page width; we set the
          // HTML width to widthMm so glyphs land where CSS put them.
          inv.style.width = `${paperCfg.widthMm}mm`;
          inv.style.overflow = 'visible'; inv.style.minHeight = 'unset';
          inv.style.border = 'none'; inv.style.boxShadow = 'none'; inv.style.borderRadius = '0';
          // v1.9.2 — add printing-mode class so CSS rules force darker colours
          // in the PDF capture. Fixes user complaint that A4/A5 output had
          // very-light gray text that faded on paper printers. Users can
          // turn this off in Print Settings if their printer is fine with
          // lighter greys.
          if (printSettings.pdfDarkenOnPrint !== false) {
            inv.classList.add('printing-mode');
          }
        }
        clonedDoc.querySelectorAll('[data-pdf-page]').forEach(el => el.style.display = 'none');
      }
    });
    extraPages.forEach(el => el.style.display = '');
    spacerFit.restore?.();
    spacerFit.restore = null;

    // v1.10.3 — Record each original page as a "recipe" so multi-copy
    // (GST Rule 48) can duplicate multi-page invoices correctly.
    // v1.10.8 — Each recipe is now its own cropped image (was: one
    // shared tall image with negative-Y offsets). See M21 note above.
    const pageRecipes = [];

    // v1.10.9 — Wire print margins. Prior code ignored `marginTop/Bottom/
    // Left/Right` from printSettings entirely — the UI existed, defaults
    // were in printSettings.js, but no consumer read them. Now: margins
    // shift the invoice image inside each PDF page. Useful for
    // pre-printed letterheads where content must clear the top logo,
    // or for printers with built-in edge margins.
    const mTop = Math.max(0, Number(printSettings.marginTop) || 0);
    const mBottom = Math.max(0, Number(printSettings.marginBottom) || 0);
    const mLeft = Math.max(0, Number(printSettings.marginLeft) || 0);
    const mRight = Math.max(0, Number(printSettings.marginRight) || 0);

    // v1.10.10 — PDF Font Scale now applies at the PDF-placement layer,
    // not just via CSS on the preview. Prior fix (v1.10.9) set an inline
    // `font-size: 80%` on the container, which correctly changed the
    // preview because parent-relative sizing cascaded to a few text
    // nodes — but html2canvas captures the DOM at its natural size, and
    // most children use `rem`/`px` (not `em`), so the raster came out
    // at 100% and the "80% compact" setting silently did nothing in the
    // real PDF. Now: multiply BOTH placement width AND height by the
    // scale. The invoice image lands smaller on the page → text is
    // proportionally smaller → more content fits per PDF page. This
    // matches how MS Word / LibreOffice "shrink to fit" works.
    const rawScale = Number(printSettings.pdfFontScale);
    const pdfScale = isFinite(rawScale) && rawScale > 0
      ? Math.max(0.5, Math.min(1.4, rawScale))
      : 1.0;
    // v1.10.45 — Reserve vertical space for page-2+ header band and the
    // page-number footer band, so content never overlaps them.
    // Reported: business name "Hem E..." collided with the "TERMS &
    // CONDITIONS" heading on page 2 of a multi-page invoice because
    // contentYOffset was `mTop` (usually 0) on every page while the
    // header was drawn at Y=6mm. Now: shrink the multi-page content
    // area by the header + footer bands and shift the image down on
    // page 2+ to sit BELOW the header. Single-page invoices are
    // unaffected — page-header + footer aren't drawn on page 1.
    //
    // 14mm ≈ 9pt bold text (2mm cap) + 2mm gap + 2mm underline offset
    //         + 8mm safety pad (glyph descenders + page-scale slop).
    //  9mm ≈ 8pt footer text at Y = pageHeight - 4mm + safety pad above.
    const isHeaderOn = !isThermalPdf && !!printSettings.pageHeaderEnabled;
    const isFooterOn = !isThermalPdf && !!printSettings.pageNumbersEnabled;
    const pageHeaderReserve = isHeaderOn ? 14 : 0;
    const pageFooterReserve = isFooterOn ? 9  : 0;

    const availWidth  = Math.max(20, pdfWidth      - mLeft - mRight);
    // "Full" = single-page availability (no reserve — page 1 has no header/footer bands).
    // "Multi" = per-page availability during pagination (reserves both bands).
    const availHeightFull  = Math.max(20, pdfPageHeight - mTop - mBottom);
    const availHeightMulti = Math.max(20, availHeightFull - pageHeaderReserve - pageFooterReserve);
    const contentWidth        = availWidth        * pdfScale;
    const contentHeightFull   = availHeightFull   * pdfScale;
    const contentHeightMulti  = availHeightMulti  * pdfScale;
    // Centre the scaled invoice inside the available margin box so
    // shrunk PDFs don't hug the left edge.
    const contentXOffset = mLeft + (availWidth - contentWidth) / 2;
    const contentYOffset = mTop; // top-aligned; bottom margin absorbs slack
    // Recompute the image's rendered height using the reduced content width
    // so aspect ratio stays correct after margins are applied.
    const scaledImgHeight = (mainCanvas.height * contentWidth) / mainCanvas.width;

    // Test hook for tests/smoke.mjs (ERR-024): where each PDF page ends, and
    // where the things a page must never cut through sit - all in the same
    // DOM pixels. Read-only, and costs nothing to anyone else.
    try {
      const t = printRef.current.getBoundingClientRect().top;
      const rel = (el) => { const r = el.getBoundingClientRect(); return [r.top - t, r.bottom - t]; };
      const firstRow = printRef.current.querySelector('.inv-table tbody tr');
      const sig = printRef.current.querySelector('.inv-signature, [data-pdf-signature]');
      window.__lastPdfLayout = {
        pageHeight: contentHeightMulti * domContainerWidth / contentWidth,
        fullHeight: contentHeightFull * domContainerWidth / contentWidth,
        total: mainCanvas.height * domContainerWidth / mainCanvas.width,
        ends: [],
        rowHeight: firstRow ? rel(firstRow)[1] - rel(firstRow)[0] : 0,
        signature: sig ? rel(sig) : null,
        blocks: [...printRef.current.querySelectorAll('.inv-footer-block')].map(rel).filter(([a, b]) => b - a > 2),
        atoms: [...printRef.current.querySelectorAll('.inv-signature, img, [data-pdf-page-boundary]')].map(rel).filter(([a, b]) => b - a > 2),
      };
    } catch { /* test hook only */ }

    // v1.10.77 (#88) - a page that is only slightly too tall (up to 6%) is
    // shrunk to fit, instead of sending the footer to a page of its own: a
    // 4px overflow used to move the terms, bank details and signature to page 2.
    const fitsOnePage = scaledImgHeight <= contentHeightFull + 2
      || (paperCfg.kind !== 'thermal' && scaledImgHeight <= contentHeightFull * 1.06);
    if (window.__lastPdfLayout) window.__lastPdfLayout.onePage = fitsOnePage;
    if (fitsOnePage) {
      // Single-page fits — no cropping needed. Page 1 has no header/footer
      // bands so we can use the full page height (no v1.10.45 reserve).
      const mainImg = mainCanvas.toDataURL(imgFormat === 'PNG' ? 'image/png' : 'image/jpeg', jpegQuality);
      const fit = paperCfg.kind === 'thermal' ? 1 : Math.min(1, contentHeightFull / scaledImgHeight);
      const finalH = paperCfg.kind === 'thermal' ? Math.min(scaledImgHeight, contentHeightFull) : scaledImgHeight * fit;
      const finalW = contentWidth * fit;
      const finalX = contentXOffset + (contentWidth - finalW) / 2;
      // v1.10.33 — Thermal receipts: replace the padded 72×297mm page
      // with one exactly tall enough for the actual receipt content.
      // Prior behaviour: a 40-line receipt on thermal80 produced a PDF
      // with the receipt in the top ~130mm and 165mm of blank paper
      // below — visible in Chrome's Save-as-PDF preview as the huge
      // dark area below the "cut here" line the user reported. Now
      // the PDF page height matches the receipt height (+ margins),
      // so the PDF looks like the on-screen preview.
      //
      // Only fires for the single-page path — multi-page thermal
      // (extremely long receipts) still uses paperCfg.heightMm as a
      // reasonable page-break unit.
      if (paperCfg.kind === 'thermal') {
        const thermalHeightMm = Math.max(30, Math.ceil(finalH + mTop + mBottom + 2));
        pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: [paperCfg.widthMm, thermalHeightMm],
          compress: true,
        });
      }
      pdf.addImage(mainImg, imgFormat, finalX, contentYOffset, finalW, finalH, undefined, 'MEDIUM');
      pageRecipes.push({ img: mainImg, y: contentYOffset, h: finalH, x: finalX, w: finalW });
    } else {
      // v1.10.8 multi-page path — snap page breaks to safe DOM row boundaries.
      //
      // 1. Convert DOM-pixel boundaries → canvas-pixel boundaries.
      const domToCanvasScale = mainCanvas.width / domContainerWidth;
      const canvasBoundariesPx = domBoundariesPx.map(y => y * domToCanvasScale);
      const totalCanvasHeightPx = mainCanvas.height;
      if (!canvasBoundariesPx.includes(totalCanvasHeightPx)) {
        canvasBoundariesPx.push(totalCanvasHeightPx);
      }
      canvasBoundariesPx.sort((a, b) => a - b);

      // 2. How many canvas pixels correspond to one CONTENT height?
      // v1.10.9 — was pdfPageHeight * (mainCanvas.width / pdfWidth). Now
      // uses contentHeight (page - top - bottom margins) so page breaks
      // respect the margin band.
      // v1.10.45 — uses contentHeightMulti so page splits also
      // reserve room for the header/footer bands drawn on page 2+.
      const pdfPageHeightCanvasPx = contentHeightMulti * (mainCanvas.width / contentWidth);

      // 3. Walk the canvas top-to-bottom, allocating pages. For each
      //    page: find the largest boundary ≤ naive end, but > current
      //    page start (progress guarantee).
      const pageSplits = [];
      let pageStart = 0;
      let safety = 0;
      while (pageStart < totalCanvasHeightPx && safety++ < 100) {
        const naiveEnd = pageStart + pdfPageHeightCanvasPx;
        if (naiveEnd >= totalCanvasHeightPx) {
          pageSplits.push({ start: pageStart, end: totalCanvasHeightPx });
          break;
        }
        // Prefer the LAST boundary at or before naiveEnd; must exceed pageStart.
        let safeEnd = null;
        for (let i = canvasBoundariesPx.length - 1; i >= 0; i--) {
          const b = canvasBoundariesPx[i];
          if (b <= naiveEnd + 1 && b > pageStart + 20) {   // +20px min progress
            safeEnd = b;
            break;
          }
        }
        // No safe boundary found in range (a single "row" bigger than a page,
        // e.g. a huge terms block). Fall back to a hard slice — but still
        // print SOMETHING rather than looping forever.
        if (safeEnd === null) safeEnd = naiveEnd;
        pageSplits.push({ start: pageStart, end: safeEnd });
        pageStart = safeEnd;
      }

      if (window.__lastPdfLayout) {
        window.__lastPdfLayout.ends = pageSplits.slice(0, -1).map(s => s.end / domToCanvasScale);
      }

      // 4. For each page, crop mainCanvas → temp canvas → data URL → PDF.
      // v1.10.9 — margins; v1.10.10 — pdfFontScale via centred placement.
      // v1.10.45 — page 2+ shifts down by pageHeaderReserve so the
      // business-name header drawn later never overlaps the invoice.
      for (let i = 0; i < pageSplits.length; i++) {
        const { start, end } = pageSplits[i];
        const cropHeight = end - start;
        if (cropHeight < 1) continue;
        const tmp = document.createElement('canvas');
        tmp.width = mainCanvas.width;
        tmp.height = cropHeight;
        const ctx = tmp.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, tmp.width, cropHeight);
        ctx.drawImage(mainCanvas, 0, -start);
        const pageImg = tmp.toDataURL(imgFormat === 'PNG' ? 'image/png' : 'image/jpeg', jpegQuality);
        const pageMmHeight = (cropHeight * contentWidth) / mainCanvas.width;
        if (i > 0) pdf.addPage();
        const yForThisPage = contentYOffset + (i > 0 ? pageHeaderReserve : 0);
        pdf.addImage(pageImg, imgFormat, contentXOffset, yForThisPage, contentWidth, pageMmHeight, undefined, 'MEDIUM');
        pageRecipes.push({ img: pageImg, y: yForThisPage, h: pageMmHeight, x: contentXOffset, w: contentWidth });
      }
    }

    // Capture each extra section as a separate PDF page (also recipe-tracked).
    // v1.10.45 — Extra pages are always page 2+ so they must reserve room
    // for the header/footer bands too. Otherwise attached rich-text pages
    // hit the same "business name overlaps content" bug as multi-page
    // splits. yOffset shifts the image below the header band; the max
    // height clamps to the reduced available area.
    const extraYOffset = pageHeaderReserve;
    const extraMaxH = Math.max(20, pdfPageHeight - extraYOffset - pageFooterReserve);
    for (const pageEl of extraPages) {
      const c = await html2canvas(pageEl, {
        ...captureOptions(pageEl),
        onclone: (cd) => { cd.querySelectorAll('*').forEach(n => { n.style.letterSpacing = '0px'; n.style.wordSpacing = '0px'; }); }
      });
      const extraImg = c.toDataURL(imgFormat === 'PNG' ? 'image/png' : 'image/jpeg', jpegQuality);
      const extraH = Math.min((c.height * pdfWidth) / c.width, extraMaxH);
      pdf.addPage();
      pdf.addImage(extraImg, imgFormat, 0, extraYOffset, pdfWidth, extraH, undefined, 'MEDIUM');
      pageRecipes.push({ img: extraImg, y: extraYOffset, h: extraH });
    }

    // v1.10.3 — scalerEl restoration moved to outer buildPDF's `finally`
    // block so it runs even if a later step throws.

    // ============================================================
    // v1.9.0 post-processing — every step below is toggleable via
    // printSettings. Priority order is:
    //   1. Add margins (visual white border, if user set them)
    //   2. Multi-copy expansion (Original / Duplicate / Triplicate)
    //   3. Watermark overlay
    //   4. Reprint indicator
    //   5. Barcode / QR of invoice number
    //   6. Feedback QR
    //   7. Page numbers + business header on subsequent pages
    // ============================================================
    const ps = printSettings; // captured from closure below

    // ----- Multi-copy (Original / Duplicate / Triplicate) -----
    // GST Rule 48 for goods: 3 copies. For services: 2 copies.
    // v1.10.3 — Rebuilt to correctly duplicate multi-page invoices. See
    // pageRecipes comment above for background.
    if (ps.multiCopyEnabled && ps.multiCopyCount > 1) {
      const labels = ps.multiCopyLabels || ['ORIGINAL', 'DUPLICATE', 'TRIPLICATE'];
      const originalPageCount = pageRecipes.length;   // correct: 1 recipe per original page
      // Replay every original page for each additional copy.
      for (let copyIdx = 1; copyIdx < ps.multiCopyCount; copyIdx++) {
        for (const recipe of pageRecipes) {
          pdf.addPage();
          // v1.10.9 — margins carry through to duplicated copies via
          // recipe.x/w (fallback to 0/pdfWidth for legacy shapes).
          pdf.addImage(recipe.img, imgFormat,
            recipe.x ?? 0, recipe.y,
            recipe.w ?? pdfWidth, recipe.h,
            undefined, 'MEDIUM');
        }
      }
      // Now stamp corner labels using a math that actually corresponds
      // to which copy each page belongs to (was wrong before too).
      const totalCopies = ps.multiCopyCount;
      for (let copyIdx = 0; copyIdx < totalCopies; copyIdx++) {
        const label = labels[Math.min(copyIdx, labels.length - 1)] || `COPY ${copyIdx + 1}`;
        for (let p = 1; p <= originalPageCount; p++) {
          const absolutePage = copyIdx * originalPageCount + p;
          pdf.setPage(absolutePage);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(8);
          pdf.setTextColor(80, 80, 80);
          const labelWidth = pdf.getTextWidth(label) + 6;
          pdf.setDrawColor(80, 80, 80);
          pdf.setLineWidth(0.3);
          pdf.rect(pdfWidth - labelWidth - 4, 4, labelWidth, 6, 'S');
          pdf.text(label, pdfWidth - labelWidth - 1, 8);
          pdf.setTextColor(0);
        }
      }
    }

    // v1.10.3 — free the multi-megabyte base64 image strings once
    // multi-copy replay is done. Post-processing steps below only
    // mutate the PDF pages, they don't need the source images. Prior
    // code held mainImg + pageRecipes in closure through the whole
    // watermark/QR/page-number loop, doubling peak memory.
    pageRecipes.length = 0;

    // v1.10.12 — Gate the A4/A5-only post-processing on thermal paper.
    // Reports: (a) "watermark coming for thermal also — it should not
    // come", (b) page numbers "Page 2 of 3" don't make sense on a
    // continuous receipt roll, (c) invoice QR / feedback QR crowd out
    // the actual print on 58mm rolls. All post-processing steps below
    // are skipped when the paper is thermal.
    // v1.10.33 note: isThermalPdf is now hoisted to the top of
    // __buildPDFInner (see v1.10.46 comment). Original rationale
    // for the check: `.startsWith('thermal')` missed the `custom`
    // preset at sub-100mm widths, so a Custom 76mm PDF got the
    // sheet-only watermark / page numbers / QR overlays that
    // don't belong on a thermal roll.

    // ----- Watermark overlay -----
    // v1.10.12 — Cleaned up the preset ↔ custom decision:
    //   • Custom mode ON  + custom text FILLED   → use custom text.
    //   • Custom mode ON  + custom text EMPTY    → skip (no silent
    //     fallback to preset — that was the confusing behavior
    //     reported as "after selecting predefined then customer
    //     watermark or else it is not working").
    //   • Custom mode OFF → use preset.
    //   • Master toggle OFF or thermal paper       → skip entirely.
    let rawText = null;
    if (!isThermalPdf && ps.watermarkEnabled) {
      if (ps.watermarkUseCustomText) {
        rawText = ps.watermarkCustomText ? ps.watermarkCustomText : null;
      } else {
        rawText = ps.watermarkText || null;
      }
    }
    if (rawText) {
      const text = String(rawText).toUpperCase();
      const opacity = Math.max(0, Math.min(1, (Number(ps.watermarkOpacity) || 15) / 100));
      const angle = Number(ps.watermarkAngle) || -35;
      const size = Number(ps.watermarkFontSize) || 90;
      const finalPages = pdf.getNumberOfPages();
      for (let p = 1; p <= finalPages; p++) {
        pdf.setPage(p);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(size);
        // jsPDF opacity via GState (setGState)
        try {
          const gState = new pdf.GState({ opacity });
          pdf.setGState(gState);
        } catch { /* older jsPDF versions — fallback to grey text */ }
        pdf.setTextColor(200, 200, 200);
        // Center the watermark on the page
        const cx = pdfWidth / 2;
        const cy = pdfPageHeight / 2;
        pdf.text(text, cx, cy, { align: 'center', angle });
        try {
          const gState = new pdf.GState({ opacity: 1 });
          pdf.setGState(gState);
        } catch { /* no-op */ }
        pdf.setTextColor(0);
      }
    }

    // ----- Reprint indicator (automatic when this bill has been printed before) -----
    // v1.10.41 — Reported: "REPRINT · Copy #2" badge was overlapping the
    // business logo in the top-left of the PDF. Root cause: badge was
    // pinned at x=4, y=4 which is exactly where every template's logo
    // sits. Two fixes:
    //   1. Move the badge to the TOP-RIGHT corner (pageWidth - w - 4)
    //      so it never fights the logo for space.
    //   2. Default reprintLabelEnabled = false (see printSettings.js) so
    //      users don't get the surprise stamp on every second download.
    //      Only retail/restaurant users who genuinely need POS reprint
    //      tracking will turn it on — the Print Settings toggle is
    //      already gated to those business types.
    if (!archive && !isThermalPdf && ps.reprintLabelEnabled && Number(editingBill?.printedCount) > 0) {
      const label = `REPRINT · Copy #${(Number(editingBill.printedCount) || 0) + 1}`;
      const finalPages = pdf.getNumberOfPages();
      const pageWidthMm = pdf.internal.pageSize.getWidth();
      for (let p = 1; p <= finalPages; p++) {
        pdf.setPage(p);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(220, 38, 38);
        const w = pdf.getTextWidth(label) + 4;
        const x = pageWidthMm - w - 4;  // top-right corner
        pdf.setDrawColor(220, 38, 38);
        pdf.rect(x, 4, w, 6, 'S');
        pdf.text(label, x + 2, 8);
        pdf.setTextColor(0);
      }
    }

    // ----- Barcode / QR of invoice number -----
    if (!isThermalPdf && (ps.invoiceQrEnabled || ps.invoiceBarcodeEnabled)) {
      // Use the qrcode library that's already a dep for UPI QR
      const QRCode = (await import('qrcode')).default;
      const qrPayload = ps.invoiceQrUrl
        ? ps.invoiceQrUrl.replace(/\{invoice_number\}/g, encodeURIComponent(details.invoiceNumber))
        : details.invoiceNumber;
      if (ps.invoiceQrEnabled) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: 'M', margin: 0, width: 200 });
          pdf.setPage(pdf.getNumberOfPages());
          const size = 18; // mm
          pdf.addImage(qrDataUrl, 'PNG', pdfWidth - size - 6, pdfPageHeight - size - 12, size, size);
          pdf.setFontSize(6); pdf.setTextColor(80);
          pdf.text('Verify invoice', pdfWidth - size - 6, pdfPageHeight - 6);
          pdf.setTextColor(0);
        } catch { /* skip on error */ }
      }
      // "Barcode" — jsPDF can't render true Code128 without a lib, so we render
      // a big monospace text version of the invoice number that scans as OCR-able
      // and is legible for humans + warehouse workflows.
      if (ps.invoiceBarcodeEnabled) {
        pdf.setPage(pdf.getNumberOfPages());
        pdf.setFont('courier', 'bold');
        pdf.setFontSize(14);
        pdf.setTextColor(0);
        pdf.text(String(details.invoiceNumber), 8, pdfPageHeight - 6);
      }
    }

    // ----- Feedback / Review QR -----
    if (!isThermalPdf && ps.feedbackQrEnabled && ps.feedbackQrUrl) {
      const QRCode = (await import('qrcode')).default;
      try {
        const dataUrl = await QRCode.toDataURL(ps.feedbackQrUrl, { errorCorrectionLevel: 'M', margin: 0, width: 200 });
        pdf.setPage(pdf.getNumberOfPages());
        const size = 16;
        pdf.addImage(dataUrl, 'PNG', 6, pdfPageHeight - size - 12, size, size);
        pdf.setFontSize(6); pdf.setTextColor(80);
        pdf.text(ps.feedbackQrLabel || 'Rate us', 6, pdfPageHeight - 6);
        pdf.setTextColor(0);
      } catch { /* skip */ }
    }

    // ----- Page numbers + business header on subsequent pages -----
    if (!isThermalPdf && (ps.pageNumbersEnabled || ps.pageHeaderEnabled) && pdf.getNumberOfPages() > 1) {
      const finalPages = pdf.getNumberOfPages();
      for (let p = 2; p <= finalPages; p++) {
        pdf.setPage(p);
        if (ps.pageHeaderEnabled && profile?.businessName) {
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(9);
          pdf.setTextColor(80);
          pdf.text(profile.businessName, 8, 6);
          pdf.setDrawColor(200); pdf.setLineWidth(0.2);
          pdf.line(8, 8, pdfWidth - 8, 8);
          pdf.setTextColor(0);
        }
        if (ps.pageNumbersEnabled) {
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(8);
          pdf.setTextColor(120);
          pdf.text(`Page ${p} of ${finalPages}`, pdfWidth - 8, pdfPageHeight - 4, { align: 'right' });
          pdf.setTextColor(0);
        }
      }
    }

    return pdf;
  };

  // Per-view keyboard shortcuts.
  //   Ctrl/Cmd+S       — save invoice (no PDF) if meaningful
  //   Ctrl/Cmd+P       — download PDF
  //   Ctrl/Cmd+Enter   — add a new line item (v1.10.22)
  //   Ctrl/Cmd+Shift+D — duplicate the LAST line item (v1.10.22)
  //   Esc              — close the leave-guard modal (v1.10.22)
  useEffect(() => {
    const onKey = (e) => {
      // Esc closes the leave modal without needing Ctrl.
      if (e.key === 'Escape' && leaveModal) {
        e.preventDefault();
        setLeaveModal(false);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 's' || e.key === 'S') {
        if (!isMeaningfulInvoice()) return; // nothing to save
        e.preventDefault();
        saveInvoiceToDB().then(async (no) => { if (no) { toast('Invoice saved', 'success'); await refreshSavedPdf(no); } }).catch(() => toast('Save failed', 'error'));
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        // Defer to the next tick so the keydown doesn't race the PDF render.
        setTimeout(() => generatePDF(), 0);
      } else if (e.key === 'Enter') {
        // Add a new line item. Doesn't fire when the user is inside a form
        // element that should get Enter (rich-text editor autofocus etc.) —
        // browsers dispatch Ctrl+Enter to the row-level input which won't
        // preventDefault by itself.
        e.preventDefault();
        addItem();
      } else if (e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        // Duplicate the last item — quick win for "same item, next line".
        e.preventDefault();
        setItems(prev => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          return [...prev, { ...last, id: Date.now().toString() }];
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMeaningfulInvoice, leaveModal]);

  // v1.10.3 — Shared print-via-iframe helper. Prior code duplicated the
  // "createObjectURL + iframe + revoke on load" pattern in 3 places and
  // ALL 3 leaked the blob URL if `onload` never fired (broken PDF,
  // iframe blocked). Now: revoked in error handler AND unconditionally
  // on load. Iframe stays (reused by id) but does not accumulate.
  const printViaIframe = (blob) => {
    const url = URL.createObjectURL(blob);
    let cleaned = false;
    const cleanup = () => { if (!cleaned) { cleaned = true; URL.revokeObjectURL(url); } };
    // Belt: 90s hard timeout in case onload never fires.
    const timer = setTimeout(cleanup, 90_000);
    try {
      let frame = document.getElementById('fgsb-print-frame');
      if (!frame) {
        frame = document.createElement('iframe');
        frame.id = 'fgsb-print-frame';
        frame.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:0;height:0;border:0;';
        document.body.appendChild(frame);
      }
      frame.src = url;
      frame.onload = () => {
        try { frame.contentWindow.focus(); frame.contentWindow.print(); }
        catch { window.open(url, '_blank'); }
        // Give the print job ~60s to grab the buffer, then revoke.
        setTimeout(() => { clearTimeout(timer); cleanup(); }, 60_000);
      };
      frame.onerror = () => { clearTimeout(timer); cleanup(); };
    } catch (err) {
      clearTimeout(timer); cleanup(); throw err;
    }
  };

  // v1.10.42 — Vector-HTML thermal print (revived from v1.10.35). Clones
  // the on-screen invoice-preview element + the document's stylesheets
  // into a hidden iframe, sets @page: size WIDTHmm auto, and calls
  // iframe.contentWindow.print(). Text stays VECTOR all the way to the
  // printer driver — 203-dpi thermal rasterises at native resolution
  // → sharp glyphs regardless of font size, smaller print jobs, faster
  // buffer fill on cheap thermal printers with tiny buffers.
  //
  // This is what the v1.10.35 ThermalPreviewModal was doing before the
  // v1.10.36 revert. We lost it there because custom paper widths + a
  // separate modal-hosted <InvoicePreview> instance introduced CSS drift
  // vs the on-screen render. This revival uses the parent's existing
  // on-screen `printRef` (same DOM the user is seeing), avoiding that
  // drift class entirely.
  //
  // Returns true on success, false if the browser blocked programmatic
  // iframe print (rare — chrome/edge/safari all allow it from a user-
  // gesture click, which is our only caller). The false case lets the
  // caller fall back to the PDF path without a toast on the user.
  const printThermalViaHtml = async () => {
    if (!printRef.current) return false;
    const receipt = printRef.current.querySelector('#invoice-preview') || printRef.current;
    if (!receipt) return false;

    const paperCfg = getPaperSize(invoiceOptions.paperSize, invoiceOptions);
    const widthMm = paperCfg.widthMm || 80;

    // Collect the document's CSS text so the iframe renders identically.
    // Cross-origin stylesheets (Google Fonts, etc.) throw on cssRules
    // access — skip those; thermal renders fine with system fonts.
    const collectStyles = () => {
      const parts = [];
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const rules = sheet.cssRules;
          if (!rules) continue;
          for (const rule of Array.from(rules)) parts.push(rule.cssText);
        } catch { /* cross-origin, skip */ }
      }
      return parts.join('\n');
    };

    const doc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Print Receipt</title>
  <style>
    @page { size: ${widthMm}mm auto; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    #invoice-preview {
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
      box-shadow: none !important;
      background: #fff !important;
      color: #000 !important;
      min-height: 0 !important;
    }
    ${collectStyles()}
  </style>
</head>
<body>${receipt.outerHTML}</body>
</html>`;

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-99999px;top:0;width:0;height:0;border:0;';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);

    try {
      await new Promise((resolve) => {
        iframe.onload = resolve;
        iframe.srcdoc = doc;
      });
      // Wait for images (logo, QR) inside the iframe. 3s safety per image.
      const imgs = iframe.contentDocument?.querySelectorAll('img') || [];
      await Promise.all(Array.from(imgs).map(img => (
        img.complete
          ? Promise.resolve()
          : new Promise(r => { img.onload = r; img.onerror = r; setTimeout(r, 3000); })
      )));
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      // Give the driver ~8s to grab the buffer before we tear down.
      setTimeout(() => { try { iframe.remove(); } catch { /* ignore */ } }, 8000);
      return true;
    } catch (err) {
      console.warn('Direct thermal print failed, will fall back to PDF:', err);
      try { iframe.remove(); } catch { /* ignore */ }
      return false;
    }
  };

  // v1.10.3 — Thermal receipts (58mm / 80mm rolls) no longer go through
  // html2canvas → JPEG → jsPDF. That path was 100× the CPU/memory of
  // what's needed for a text-only receipt. Now: for thermal paper sizes
  // we hand the browser the invoice HTML directly via a print-focused
  // window.print() flow. Modern printer drivers handle 58/80mm rolls
  // natively when the CSS `@page size` matches.
  //
  // v1.10.33 — Bug fix: was `.startsWith('thermal')` which does NOT
  // match the `custom` preset even when its width is under 100mm
  // (getPaperSize returns kind='thermal' for those). So a user picking
  // Custom 76mm was routed through the sheet-print path — thick roll
  // wasted paper, watermark stamped on receipt, HSN/rate lines shown.
  // Now: single source of truth — getPaperSize().kind.
  const isThermalPaper = () => getPaperSize(invoiceOptions.paperSize, invoiceOptions).kind === 'thermal';

  // v1.10.26 — Focus mode moves the preview pane off-screen (position:
  // absolute), which is fine for html2canvas (layout still computed) but
  // breaks window.print() for thermal (prints visible viewport only).
  // Un-collapse the preview for the duration of any print / download
  // operation and restore after.
  //
  // v1.10.27 — Reported: "after print, preview panel comes back up and
  // hiding again have to click." Prior code registered an `afterprint`
  // listener + 30s safety timeout, which never fired in two of the three
  // paths and left the preview expanded:
  //   - Download PDF has NO print dialog → afterprint never fires
  //   - A4 iframe print → afterprint fires on iframe.contentWindow, not
  //     the parent window we were listening on
  //   - Only thermal window.print() correctly fired afterprint on parent
  //
  // Fix: restore in the finally block, unconditionally. window.print()
  // blocks the JS thread until the native dialog closes on all desktop
  // browsers, so the restore happens after the user is done with print.
  // On mobile Safari where print() may not block, the DOM was already
  // captured at the moment print() was invoked, so restoring right after
  // is safe.
  const withPreviewOnScreen = async (fn) => {
    const wasCollapsed = previewCollapsed;
    if (!wasCollapsed) return fn();
    setPreviewCollapsed(false);
    // v1.10.28 — bumped settle from 50ms → 200ms. Reported: PDF sometimes
    // came out with content shoved to top-left on slower devices. Root
    // cause: after removing position: absolute, browser needs a real layout
    // pass; 50ms wasn't enough for React commit + reflow on low-end Android.
    // Two rAFs + a settle timeout so React commits the DOM change AND
    // the browser lays out the newly-visible preview before we snapshot.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 200))));
    try {
      return await fn();
    } finally {
      setPreviewCollapsed(true);
    }
  };

  // v1.10.36 — Print pipeline split into two functions:
  //   1. `executePrint` — the actual work (buildPDF → printViaIframe).
  //      This is the SAME code path that was working in v1.10.34 and
  //      after the v1.10.35 → v1.10.36 revert. Guaranteed reliable.
  //   2. `directPrint` — user-facing Print button click handler. For
  //      thermal invoices, opens the PrintPreviewModal first so the
  //      user sees exactly what will print before it goes. For A4/sheet,
  //      calls executePrint directly because the OS print dialog
  //      already shows a full page preview.
  //
  // The modal DOES NOT re-render or re-serialize anything for printing
  // — its Print button just calls executePrint, which uses the parent's
  // existing on-screen `printRef`. Both the modal's <InvoicePreview>
  // and the printed output come from the SAME component with the SAME
  // props → bit-for-bit identical. Zero CSS drift risk (this was the
  // v1.10.35 bug — a re-serialized iframe DOM diverged from the on-
  // screen render because of dropped cross-origin fonts + max-width
  // caps beating inline widths). See PrintPreviewModal.jsx for details.
  // Save before any PDF or print is made, counting it as printed once more.
  // A new invoice gets its real number here (the form only shows a peek until
  // the first save), so the PDF must be built AFTER this, once the preview has
  // re-rendered with that number. Returns the saved number, or null.
  const saveForOutput = async () => {
    if (readOnlyDoc) return details.invoiceNumber; // printed or downloaded as it is
    const prevPrinted = editingBill && !editingBill._isDuplicate ? Number(editingBill.printedCount) || 0 : 0;
    const no = await saveInvoiceToDB(false, {
      printedCount: prevPrinted + 1,
      lastPrintedAt: new Date().toISOString(),
    });
    if (!no) return null;
    hasOutput.current = true;
    clearDraft();
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    return no;
  };

  // Prints what the preview shows. Returns true when it was sent to print.
  const printPreview = () => withPreviewOnScreen(async () => {
    try {
      // v1.10.42 — Thermal + user hasn't opted out of direct print?
      // Try the vector-HTML path first. If the browser blocks it
      // (returned false), silently fall through to the PDF path so
      // the user still gets a print — no surfaced error required.
      if (isThermalPaper() && (getPrintSettings().thermalPrintMode || 'direct') === 'direct') {
        const ok = await printThermalViaHtml();
        if (ok) return true;
      }
      const pdf = await buildPDF({ forPrint: true });
      printViaIframe(pdf.output('blob'));
      return true;
    } catch (err) {
      console.error('Print failed', err);
      toast('Print failed — try Download PDF instead', 'error');
      return false;
    }
  });

  const executePrint = async () => {
    if (!printRef.current) return;
    setSaving(true);
    try {
      // Printing hands the client a numbered invoice, so it is saved first,
      // like Save & Download (it used to print without saving at all).
      const saved = await saveForOutput();
      if (!saved) return;
      await printPreview();
    } catch (err) {
      console.error('Print failed', err);
      toast('Print failed — try Download PDF instead', 'error');
    } finally {
      setSaving(false);
    }
  };

  // v1.10.77 (#86) - opened by the Dashboard's Print button: print once the
  // preview has drawn, then go back to the Dashboard.
  // The timer only raises a flag: the print itself runs on the next render,
  // with the invoice loaded. (Calling the print from the timer used the first
  // render's empty form: 'Bill must have an id'.)
  const [printOnOpen, setPrintOnOpen] = useState(false);
  const printOnOpenDone = useRef(false);
  useEffect(() => {
    if (!editingBill?._printOnOpen) return undefined;
    const t = setTimeout(() => setPrintOnOpen(true), 1500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!printOnOpen || printOnOpenDone.current) return;
    printOnOpenDone.current = true;
    // A saved invoice printed as it is: nothing in it is saved again (a full
    // save would refresh its business details and options from today's
    // settings); only the print count goes up on the stored copy.
    (async () => {
      setSaving(true);
      try {
        if (printRef.current && await printPreview()) {
          const stored = (await getAllBills()).find((b) => b.id === editingBill.id);
          if (stored) {
            await saveBill({ ...stored, printedCount: (Number(stored.printedCount) || 0) + 1, lastPrintedAt: new Date().toISOString() }, { overwrite: true });
          }
        }
      } catch (err) {
        console.error('Print failed', err);
      } finally {
        setSaving(false);
      }
      clearDraft();
      onBack();
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printOnOpen]);

  const directPrint = async () => {
    if (!printRef.current) return;
    // v1.10.58 (#47) — same gate as Save: printing persists the bill and
    // reserves an invoice number, so a blank one must not get through here
    // either.
    const problem = validateForSave();
    if (problem) { toast(problem, 'warning'); return; }
    if (isThermalPaper()) {
      // Thermal → show the preview modal. Actual print fires from the
      // modal's Print button via executePrint. User can Cancel there
      // if the preview looks wrong.
      setShowPrintPreview(true);
      return;
    }
    // A4 / A5 / Letter / Legal — go straight to print. Chrome's own
    // dialog already shows a page-accurate preview, no in-app modal
    // needed for these.
    await executePrint();
  };

  // The old desktop app also kept a copy of every PDF in a "Saved Invoices" folder on the computer. Invoices are
  // downloaded or printed from the browser now, so there is no folder copy; the call sites stay and do nothing.
  const saveToInvoicesFolder = async () => {};

  // v1.10.76 (#83) - reported: editing an invoice and pressing Save updated
  // the invoice but left the old PDF in Saved Invoices. If this invoice was
  // ever downloaded or printed, Save now rebuilds that PDF too (no download).
  const refreshSavedPdf = async (savedNumber) => {
    if (!hasOutput.current || !printRef.current) return;
    try {
      const pdf = await withPreviewOnScreen(() => buildPDF({ archive: true }));
      await saveToInvoicesFolder(pdf.output('blob'), `${typeConfig.prefix}_${savedNumber.replace(/\//g, '-')}.pdf`);
      toast('The PDF in Saved Invoices is updated too', 'info');
    } catch (err) {
      console.error('Saved Invoices PDF refresh failed:', err);
      toast('Invoice saved, but its PDF in Saved Invoices could not be updated. Use Save & Download.', 'warning');
    }
  };

  const generatePDF = async () => {
    if (!printRef.current) return;
    // v1.10.58 (#47) — same gate as Save: printing persists the bill and
    // reserves an invoice number, so a blank one must not get through here
    // either.
    const problem = validateForSave();
    if (problem) { toast(problem, 'warning'); return; }
    try {
      setSaving(true);
      // Save first so the PDF shows the number the invoice was saved under.
      const savedNumber = await saveForOutput();
      if (!savedNumber) return;
      // v1.10.26 — force preview on-screen so html2canvas can snapshot it.
      const pdf = await withPreviewOnScreen(() => buildPDF());
      const fileName = `${typeConfig.prefix}_${savedNumber.replace(/\//g, '-')}.pdf`;
      pdf.save(fileName);

      const pdfBlob = pdf.output('blob');

      toast('Invoice downloaded', 'success');

      // v1.10.3 — auto-print via the shared printViaIframe helper.
      // v1.10.5 — also fire when the loaded client has autoPrint=true,
      // even if the app-wide autoPrintOnSave is off (per-client override).
      const ps = getPrintSettings();
      if (ps.autoPrintOnSave || invoiceOptions.clientAutoPrint) {
        try { printViaIframe(pdfBlob); }
        catch { /* non-fatal — user already has the PDF downloaded */ }
      }
    } catch (err) {
      console.error(err);
      toast('Failed to generate PDF.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const shareWhatsApp = () => {
    // v1.10.29 — reported: "when i use whatsapp button it is sending
    // subtotal amount". Cause: this used `items.reduce((s, i) => s +
    // (i.quantity * i.rate), 0)` — that's the pre-tax subtotal, not the
    // invoice total. Now uses totals.total (post-tax, post-discount, with
    // round-off + TCS + invoice-level discount all applied) — the same
    // number that appears on the PDF and gets saved as bill.totalAmount.
    const cur = invoiceOptions.currency || 'INR';
    const total = formatCurrency(Number(totals.total) || 0, cur);
    const subtotal = formatCurrency(printedSubtotal(totals), cur);
    const dateStr = details.invoiceDate ? new Date(details.invoiceDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    const businessName = profile?.businessName || '';
    const lines = [
      `*Invoice: ${details.invoiceNumber}*`,
      `Date: ${dateStr}`,
      `Client: ${client?.name || ''}`,
      `Subtotal: ${subtotal}`,
      `*Total: ${total}*`,
    ];
    if (businessName) lines.push('', `— ${businessName}`);
    openWhatsAppShare(client?.phone, lines.join('\n'));
  };

  const exportEWayBill = () => {
    if (!profile?.gstin) { toast('Set your GSTIN in Settings first', 'warning'); return; }
    // v1.10.74 - a blank invoice made an E-Way Bill JSON the portal rejects.
    if (!items.some(i => (i.name || '').trim() && (i.quantity || 0) * (i.rate || 0) > 0)) {
      toast('Add at least one item with a quantity and rate first.', 'warning');
      return;
    }
    // v1.10.1 — Pass taxInclusive so back-calc taxable value on line items.
    // Otherwise E-Way Bill portal rejects with `amount_mismatch` on MRP-inclusive invoices.
    const ewb = generateEWayBillJSON(profile, client, details, items, totals, invoiceType, { taxInclusive });
    const blob = new Blob([JSON.stringify(ewb, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `EWB-${details.invoiceNumber?.replace(/\//g, '-') || 'draft'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('E-Way Bill JSON downloaded', 'success');
  };

  return (
    <div className="generator-container">
      {readOnlyDoc && (
        <div className="notice notice-info" role="status" style={{ marginBottom: '0.75rem' }}>
          {editingBill.convertedTo
            ? `Converted to ${editingBill.convertedTo}. This copy is read-only; you can still download or print it.`
            : 'This invoice is cancelled and read-only; you can still download or print it. Undo the cancel on the Dashboard to change it.'}
        </div>
      )}
      <div className="generator-toolbar">
        <div className="flex gap-2 items-center">
          <button className="btn btn-secondary" onClick={handleBack}><ArrowLeft size={18} /> Back</button>
          <HelpButton title="Invoice Generator — how to use" doc="invoices">
            <ul style={{ paddingLeft: '1.1rem', margin: 0 }}>
              <li><strong>Invoice type</strong> — Tax Invoice / Proforma / Bill of Supply / Composition / Credit Note / Delivery Challan. Switching type refreshes the number to that type's counter (or your custom prefix from Print Settings).</li>
              <li><strong>Line items</strong> — start typing to auto-complete from your Products list. HSN autofills the GST rate for common codes. Click "+ Add description" for a detailed note under the item name.</li>
              <li><strong>Discount</strong> — per line: pick ₹ (fixed) or % of the line. Below the items: whole-bill discount, applied after tax.</li>
              <li><strong>Customize</strong> — toggle columns and sections on/off, pick paper size (A4, A5, Letter, Legal, B5, thermal rolls or a custom size), currency, TDS / TCS, recurring, the invoice title and PDF style. Changes are remembered for your next invoice.</li>
              <li><strong>Hide Preview</strong> — gives the form the full width for long invoices. Show Preview brings it back.</li>
              <li><strong>Keyboard</strong> — Ctrl+S save · Ctrl+P PDF · Ctrl+Enter add row · Ctrl+Shift+D duplicate last row · Esc close leave modal.</li>
              <li><strong>Saving</strong> — a new invoice is stored when you first click Save, Save &amp; Download or Print. After that, changes save automatically. Leaving with unsaved changes asks first.</li>
            </ul>
          </HelpButton>
          {/* v1.10.37 — Auto-save status pill. Reported: prior plain
              grey text next to Back button looked unstyled. Now it's a
              proper chip with a coloured dot indicator that matches
              state (blue-pulse saving, green saved, amber draft) and
              CLICKS to focus the first missing field on the draft
              state so users can fix what's blocking auto-save. */}
          {(() => {
            const saving = autoSaveStatus === 'saving';
            const saved = autoSaveStatus === 'saved';
            const isDraft = autoSaveStatus === 'idle' && !isMeaningfulInvoice();
            const color = saving ? '#3b82f6' : saved ? '#059669' : isDraft ? '#d97706' : '#94a3b8';
            const bg = saving ? 'rgba(59, 130, 246, 0.12)'
              : saved ? 'rgba(5, 150, 105, 0.12)'
              : isDraft ? 'rgba(217, 119, 6, 0.12)'
              : 'var(--bg-secondary)';
            const label = saving ? 'Saving…'
              : saved ? 'All changes saved'
              : isDraft ? 'Draft — click to complete'
              : ((!editingBill || editingBill._isDuplicate) && !hasBeenSaved.current) ? 'Not saved yet'
              : 'Ready';
            const onClick = () => {
              if (!isDraft) return;
              // Focus the first missing input to accelerate the "make
              // it saveable" path. Client name first (most common
              // missing field), then the first line item description.
              if (!client?.name?.trim()) {
                clientNameRef.current?.focus();
                clientNameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
              }
              const emptyRow = document.querySelector('.line-item-row input.form-input:placeholder-shown, .line-item-row input.form-input[value=""]');
              if (emptyRow) {
                emptyRow.focus();
                emptyRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            };
            return (
              <button type="button" onClick={onClick} disabled={!isDraft}
                title={isDraft ? 'Click to focus the first missing field' : label}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: '0.75rem', fontWeight: 600,
                  padding: '0.35rem 0.7rem',
                  borderRadius: 999,
                  background: bg,
                  border: `1px solid ${color}55`,
                  color: color,
                  cursor: isDraft ? 'pointer' : 'default',
                }}>
                {saving && <Loader size={12} className="spin" />}
                {saved && <Check size={12} />}
                {!saving && !saved && (
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: color,
                    boxShadow: isDraft ? `0 0 0 3px ${color}33` : 'none',
                  }} />
                )}
                {label}
              </button>
            );
          })()}
        </div>
        <div className="flex gap-2">
          {/* v1.10.37 — Explicit Save button. Reported: "invoice page
              needs a Save button". Previously only Download PDF was
              the primary action, forcing users who wanted to save
              without downloading to know Ctrl+S. Now: Save is the
              PRIMARY action, Download PDF is secondary. Save-only
              also fires the same "save to Saved Invoices/ folder"
              + auto-print + Drive sync side effects that generatePDF
              does — minus the PDF file. */}
          <button className="btn btn-primary" onClick={async () => {
            // v1.10.58 (#47) — refuse a blank invoice. Saving reserves an
            // invoice number, so an empty save leaves a permanent gap in a
            // sequence GST expects to be gapless.
            const problem = validateForSave();
            if (problem) { toast(problem, 'warning'); return; }
            try {
              setSaving(true);
              const no = await saveInvoiceToDB();
              if (!no) return;
              clearDraft();
              toast('Invoice saved', 'success');
              await refreshSavedPdf(no);
            } catch (err) {
              if (err?.status !== 409) {  // 409 already handled by retry inside saveInvoiceToDB
                console.error('Save failed', err);
                toast('Save failed — try again', 'error');
              }
            } finally {
              setSaving(false);
            }
          }} disabled={saving}
          title="Save the invoice without downloading (Ctrl+S)">
            <Check size={18} /> {saving ? 'Saving…' : 'Save'}
          </button>
          <button className="btn btn-secondary" onClick={generatePDF} disabled={saving}
            title="Save + download the PDF">
            <Download size={18} /> {saving ? 'Generating...' : 'Save & Download'}
          </button>
          <button className="btn btn-secondary" onClick={directPrint} disabled={saving}
            title={
              isThermalPaper()
                ? 'Send directly to your thermal printer'
                : 'Open browser print dialog (skip the PDF download)'
            }>
            <Printer size={18} /> Print
          </button>
          <button className="btn btn-secondary" onClick={shareWhatsApp} disabled={saving} style={{ background: '#25d366', color: '#fff', borderColor: '#25d366' }}>
            <MessageCircle size={18} /> WhatsApp
          </button>
          {(invoiceType === 'tax-invoice' || invoiceType === 'delivery-challan') && (
            <button className="btn btn-secondary" onClick={exportEWayBill} disabled={saving} title="Download E-Way Bill JSON for NIC portal upload">
              <Truck size={18} /> E-Way Bill
            </button>
          )}
          {/* v1.10.65 — requested (#58 item 2, @sangwanmail-eng): "to access
              show preview and hide preview button once you are at the bottom
              of the page, you have to scroll all page."
              Moved here beside E-Way Bill, and this whole toolbar is now
              sticky (see .generator-toolbar), so it — and Save, Print and the
              rest — stay reachable from anywhere on a long invoice. */}
          {/* v1.10.69 - requested (#71 item 1, @sangwanmail-eng): "Can we move
              the Customize button so that it appears before the Show Preview
              button?"
              It used to sit in the Invoice Type card, which scrolls away. Here
              it is in the sticky toolbar, next to the preview toggle it pairs
              with - both change how the invoice looks, so both are reachable
              from anywhere on a long invoice. The options panel it opens has
              not moved. */}
          <button className="btn btn-secondary" type="button"
            onClick={() => setShowOptions(!showOptions)}
            title={showOptions ? 'Hide the layout and column options' : 'Choose columns, sections, paper size and PDF style'}>
            <Settings size={18} /> {showOptions ? 'Hide Options' : 'Customize'}
          </button>
          <button className="btn btn-secondary" type="button"
            onClick={() => setPreviewCollapsed(v => !v)}
            title={previewCollapsed ? 'Show the live preview' : 'Hide the preview and use the full width for entry'}>
            {previewCollapsed ? <><Eye size={18} /> Show Preview</> : <><EyeOff size={18} /> Hide Preview</>}
          </button>
        </div>
      </div>

      <div className={`split-view ${previewCollapsed ? 'split-view-focus' : ''}`}>
        <div className="editor-pane">
          {/* v1.10.67 (#66 item 6) — the "Billing From (Business Profile)"
              card was removed. The company picker at the top of the sidebar
              already sets which business an invoice belongs to; a second
              picker here only made it possible to issue the invoice from a
              company other than the one on screen. */}
          {/* Invoice Type */}
          <InvoiceTypePanel
            details={details}
            handleTypeChange={handleTypeChange}
            invoiceOptions={invoiceOptions}
            invoiceType={invoiceType}
            isIssuedInvoice={isIssuedInvoice}
            profile={profile}
            setInvoiceOptions={setInvoiceOptions}
            showOptions={showOptions}
            toggleOption={toggleOption}
            typeConfig={typeConfig}
          />

          {/* Client Modal */}
          <ClientModal show={showClientModal} onClose={() => setShowClientModal(false)} onSave={handleClientModalSave} client={modalClient} isEditing={isEditingClient} defaultCountry={profile?.country} />

          {/* Client Details */}
          <PartyPicker
            client={client}
            clientCredit={clientCredit}
            clientNameRef={clientNameRef}
            clientPickerIdx={clientPickerIdx}
            clientSuggestionsRef={clientSuggestionsRef}
            creditToApply={creditToApply}
            editingBill={editingBill}
            filteredClients={filteredClients}
            gstinHint={gstinHint}
            handleClientGstinBlur={handleClientGstinBlur}
            invoiceOptions={invoiceOptions}
            openAddClientModal={openAddClientModal}
            openEditClientModal={openEditClientModal}
            profile={profile}
            savedClients={savedClients}
            selectSavedClient={selectSavedClient}
            selectedClientId={selectedClientId}
            setClient={setClient}
            setClientPickerIdx={setClientPickerIdx}
            setCreditToApply={setCreditToApply}
            setGstinHint={setGstinHint}
            setInvoiceOptions={setInvoiceOptions}
            setSelectedClientId={setSelectedClientId}
            setShowClientSuggestions={setShowClientSuggestions}
            showClientSuggestions={showClientSuggestions}
            totals={totals}
          />

          {/* Invoice Details */}
          <InvoiceDetailsPanel
            details={details}
            invoiceOptions={invoiceOptions}
            invoiceType={invoiceType}
            profile={profile}
            setDetails={setDetails}
          />

          {/* Line Items */}
          <LineItemsGrid
            addDeliveryCharge={addDeliveryCharge}
            addItem={addItem}
            clampNonNeg={clampNonNeg}
            countryTaxRates={countryTaxRates}
            getProductSuggestions={getProductSuggestions}
            handleAddCustomUnit={handleAddCustomUnit}
            handleItemChange={handleItemChange}
            handleRemoveCustomUnit={handleRemoveCustomUnit}
            hasDeliveryCharge={hasDeliveryCharge}
            invoiceOptions={invoiceOptions}
            items={items}
            profile={profile}
            removeItem={removeItem}
            selectProduct={selectProduct}
            setInvoiceOptions={setInvoiceOptions}
            setProductSearch={setProductSearch}
            setTaxInclusive={setTaxInclusive}
            showGST={showGST}
            taxInclusive={taxInclusive}
            taxLabel={taxLabel}
            units={units}
          />

          {/* Terms */}
          <TermsPanel
            _psPrintForRates={_psPrintForRates}
            customNotes={customNotes}
            customTerms={customTerms}
            handleTermsSelect={handleTermsSelect}
            internalNote={internalNote}
            invoiceOptions={invoiceOptions}
            selectedTermsId={selectedTermsId}
            setCustomNotes={setCustomNotes}
            setCustomTerms={setCustomTerms}
            setInternalNote={setInternalNote}
            setInvoiceOptions={setInvoiceOptions}
            setSelectedTermsId={setSelectedTermsId}
            termsTemplates={termsTemplates}
          />

          {/* Extra Sections */}
          <ExtraSectionsPanel
            extraSections={extraSections}
            setExtraSections={setExtraSections}
          />
        </div>

        {/* Live Preview — visually hidden in focus mode (v1.10.22) but
            kept in the DOM so printRef stays live for PDF generation.
            v1.10.26 — reported: "in this mode print not working" for focus
            mode. Root cause: `display: none` removes the element from
            layout entirely, so html2canvas renders a 0×0 canvas → blank
            PDF and blank print. Fix: move the pane off-screen (position:
            absolute, left: -99999px) instead. The element keeps real
            dimensions so html2canvas can snapshot it, but it's invisible
            to the user and out of the flex flow (so the editor still
            takes the full viewport width in focus mode). */}
        <div ref={previewPaneRef} className="preview-pane" style={previewCollapsed
          ? { position: 'absolute', left: '-99999px', top: 0, width: '794px', pointerEvents: 'none', opacity: 0 }
          : undefined}>
          {/* v1.10.37 — Preview label + zoom control bar redesign.
              Reported: prior label was a plain span with tiny black
              zoom buttons squeezed on the right — visually unfinished.
              Now: single-line pill bar with a preview icon + short
              label, a proper segmented zoom cluster (− / % / +) and
              a dedicated Fit button, all styled consistently with
              the rest of the panel's design language. */}
          <div className="preview-pane-label" style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '0.55rem 0.85rem',
            background: 'var(--card-bg)',
            border: '1px solid var(--border)',
            borderRadius: 999,
            marginBottom: '0.5rem',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.03)',
            gap: '0.75rem',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: '0.85rem' }}>👁</span>
              Live preview
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              {/* Segmented zoom cluster — three cells welded into one pill */}
              <div style={{
                display: 'inline-flex', alignItems: 'center',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 999,
                overflow: 'hidden',
              }}>
                <button type="button" title="Zoom out"
                  onClick={() => setPreviewZoom(z => Math.max(50, z - 10))}
                  style={{ padding: '0.25rem 0.7rem', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>−</button>
                <span style={{ padding: '0.25rem 0.55rem', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text)', minWidth: 42, textAlign: 'center', borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>{previewZoom}%</span>
                <button type="button" title="Zoom in"
                  onClick={() => setPreviewZoom(z => Math.min(200, z + 10))}
                  style={{ padding: '0.25rem 0.7rem', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>+</button>
              </div>
              {/* v1.10.33 — REAL fit-to-width. Prior code was
                  setPreviewZoom(100), which just set 100%, not "fit". */}
              <button type="button" title="Fit preview to the pane width"
                onClick={handleFitToWidth}
                style={{
                  padding: '0.28rem 0.75rem',
                  border: '1px solid var(--primary)',
                  background: 'var(--primary-light, rgba(30,64,175,0.08))',
                  color: 'var(--primary)',
                  cursor: 'pointer',
                  fontSize: '0.72rem', fontWeight: 700,
                  borderRadius: 999,
                  letterSpacing: '0.02em',
                }}>Fit</button>
            </span>
          </div>
          {/* v1.10.48 — The frame reserves the SCALED size (natural × zoom)
              so the pane's layout matches what is painted. See the
              previewNatural measurement above for why.

              This also subsumes the v1.10.46 thermal-centering hack: that
              used `transform-origin: top center` to stop a 58/80mm receipt
              hugging the left edge, which worked visually but left the
              layout box at full sheet width. Now the frame is exactly the
              receipt's scaled width and .preview-pane centres it, so
              thermal and sheet both land correctly with one origin. */}
          <div className="preview-scaler-frame" style={previewNatural.w ? {
            width: previewNatural.w * (previewZoom / 100),
            height: previewNatural.h * (previewZoom / 100),
          } : undefined}>
            <div className="preview-scaler" style={{
              transform: `scale(${previewZoom / 100})`,
              transformOrigin: 'top left',
            }}>
              <InvoicePreview ref={printRef} profile={profile} client={client} details={details}
                items={items} totals={totals} invoiceType={invoiceType} customTerms={customTerms}
                customNotes={customNotes} extraSections={extraSections} options={invoiceOptions}
                cancelled={editingBill?.status === 'cancelled'} />
            </div>
          </div>
        </div>
      </div>

      {/* v1.10.36 — Portal print preview modal for thermal invoices.
          Renders the SAME <InvoicePreview> component with the SAME
          props as the on-screen preview → identical output. The Print
          button calls executePrint which uses the parent's printRef
          (the on-screen preview), so what the user sees IS what the
          printer receives. See PrintPreviewModal.jsx for the "why not
          re-serialize" rationale. */}
      <PrintPreviewModal
        isOpen={showPrintPreview}
        onClose={() => setShowPrintPreview(false)}
        onPrint={executePrint}
        onDownloadPdf={generatePDF}
        cancelled={editingBill?.status === 'cancelled'}
        profile={profile}
        client={client}
        details={details}
        items={items}
        totals={totals}
        invoiceType={invoiceType}
        customTerms={customTerms}
        customNotes={customNotes}
        extraSections={extraSections}
        invoiceOptions={invoiceOptions}
      />

      {/* P2 #32 — 3-option leave modal. Replaces the previous confusing
          browser confirm() where OK=save was counterintuitive. */}
      {leaveModal && (
        <div className="modal-overlay" onClick={leaveActions.cancel}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '460px' }}>
            <h3 style={{ marginTop: 0 }}>Unsaved changes</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              This invoice has changes that haven't been saved yet. What do you want to do?
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={leaveActions.cancel}>
                Keep editing
              </button>
              <button className="btn btn-secondary" style={{ color: '#dc2626', borderColor: '#fca5a5' }} onClick={leaveActions.discardAndExit}>
                Discard &amp; leave
              </button>
              <button className="btn btn-primary" onClick={leaveActions.saveAndExit}>
                Save &amp; leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
