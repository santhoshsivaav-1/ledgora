import { useState, useEffect, useRef, useMemo } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { getNextInvoiceNumber } from '../../../lib/data';
import { INVOICE_TYPES, businessKeyOf, appliedStock, amountDue, countsAsSales, getCountryConfig, localToday } from '../../../utils';
import { getPrintSettings } from '../../print/printSettingsStore';
import PrintPreviewModal from '../../print/PrintPreviewModal';
import InvoicePreview from '../../print/InvoicePreview';
import { getClientCredit, syncInlinePayments } from '@ledgora/tax-engine';
import HelpButton from '../../../components/ui/HelpButton';
import ClientModal from '../../parties/ClientModal';
import { toast } from '../../../components/ui/Toast';
import InvoiceTypePanel from './InvoiceTypePanel';
import PartyPicker from './PartyPicker';
import InvoiceDetailsPanel from './InvoiceDetailsPanel';
import LineItemsGrid from './LineItemsGrid';
import TermsPanel from './TermsPanel';
import ExtraSectionsPanel from './ExtraSectionsPanel';
import { termsHtmlFrom, estimatedProfit } from './settingsDefaults';
import { useEntitlements } from '../../billing/useEntitlements';
import { einvoiceLocked } from '../einvoice';
import { getAppSetting, useAppSettings } from '../../../lib/appSettings';
import { paymentInfo, itemExtraVisibility, batchStock, serialsInStock } from '../../items/itemExtras';
import { useInvoiceTotals } from './hooks/useInvoiceTotals';
import { useInvoiceDraft, loadDraft, clearDraft } from './hooks/useInvoiceDraft';
import { copyFor } from '../../sales/salesFlow';
import { FEATURES } from '../../../config/featureFlags';
import PaymentBlock from './PaymentBlock';
import ChargeRows from './ChargeRows';
import { takesPayment } from './saleExtras';
import { numberPrefixFor } from './invoiceNumbering';
import { useInvoiceOptions } from './useInvoiceOptions';
import { usePreviewDrawer } from './usePreviewDrawer';
import { useInvoiceClients } from './useInvoiceClients';
import { useInvoiceItems } from './useInvoiceItems';
import { useInvoiceBootstrap } from './useInvoiceBootstrap';
import { useInvoiceSave } from './useInvoiceSave';
import { useInvoiceOutput } from './useInvoiceOutput';
import InvoiceRail, { EditorStatusChip } from './InvoiceRail';
import { SaleDetailsExtra, OrderProgressPanel } from './SaleExtraPanels';
import { listGodowns, godownLineOptions } from '../../../lib/data/godowns';

// Vyapar parity Phase 2 (flag sale.inlinePayments): payments with the sale, additional charges, salesman, save checks,
// credit-note / sale-order fields, single page by default with Save & New. Off = everything below behaves as before.
// The page itself is the sheet: state, the section hooks beside it (options, preview drawer, clients, items,
// bootstrap, save, output) and the JSX. Phase-2 detail panels live in SaleExtraPanels, the rail in InvoiceRail.
const PHASE2 = FEATURES.saleInlinePayments;


// Settings > GST > Registration type: a composition dealer issues a Bill of Supply for composition, an unregistered one a
// Bill of Supply; only a regular dealer starts on a Tax Invoice.
const defaultSaleType = () => {
  const reg = getAppSetting('gst.regType');
  return reg === 'composition' ? 'composition' : reg === 'unregistered' ? 'bill-of-supply' : 'tax-invoice';
};

export default function InvoiceEditorPage({ onBack, profile: profileProp, editingBill, initialType = null }) {
  const draft = loadDraft();
  const [allProfiles, setAllProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState(profileProp);
  const profile = activeProfile || profileProp;
  const [invoiceType, setInvoiceType] = useState(draft?.invoiceType || (INVOICE_TYPES[initialType] && !editingBill ? initialType : defaultSaleType()));
  // email/phone/isSEZ must be part of initial state — otherwise the SEZ flag
  // set inside ClientModal is silently discarded on save, and reopening the
  // bill can never restore contact fields even if the saved client has them.
  const [client, setClient] = useState(draft?.client || { name: '', address: '', city: '', pin: '', state: '', gstin: '', country: '', email: '', phone: '', isSEZ: false });
  const printRef = useRef(null);
  // Zoom, fit-to-width, the open/closed drawer state and the natural-size measurement (usePreviewDrawer).
  const { previewPaneRef, previewZoom, setPreviewZoom, previewCollapsed, setPreviewCollapsed, previewNatural, handleFitToWidth } = usePreviewDrawer({ printRef });
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
  const allBillsRef = useRef([]);
  allBillsRef.current = allBillsForCredit;
  const editingBillIdRef = useRef(editingBill && !editingBill._isDuplicate ? editingBill.id : null);
  const [creditToApply, setCreditToApply] = useState(0);
  const [taxInclusive, setTaxInclusive] = useState(draft?.taxInclusive ?? getAppSetting('tax.priceInclusive'));
  const [termsTemplates, setTermsTemplates] = useState([]);
  const [selectedTermsId, setSelectedTermsId] = useState(draft?.selectedTermsId || '');
  const [customTerms, setCustomTerms] = useState(draft?.customTerms || termsHtmlFrom(getAppSetting('txn.terms.text')));
  const [customNotes, setCustomNotes] = useState(draft?.customNotes || '');
  const [internalNote, setInternalNote] = useState(draft?.internalNote || '');
  const [extraSections, setExtraSections] = useState(draft?.extraSections || []);
  // Phase 2 state (only read when PHASE2 is on).
  const [charges, setCharges] = useState(draft?.charges || []);
  const [paymentRows, setPaymentRows] = useState(draft?.paymentRows || []);
  // Settings > Transaction > Cash sale by default: a new bill starts as a cash sale.
  const [saleType, setSaleType] = useState(draft?.saleType || (getAppSetting('txn.cashDefault') ? 'cash' : 'credit'));
  const [salesman, setSalesman] = useState(draft?.salesman || { salesmanId: '', salesmanName: '' });
  const [returnInfo, setReturnInfo] = useState(draft?.returnInfo || { returnReason: 'sales-return', restock: true, refundMode: 'adjust' });
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(draft?.expectedDeliveryDate || '');
  // Godowns (Phase 3): a line can name the godown it sells from (empty = the default godown). The select shows
  // only when the business has more than one godown; the choice rides on the line and is sent as its godownId.
  const [godowns, setGodowns] = useState(null);
  useEffect(() => { listGodowns().then(setGodowns).catch(() => {}); }, []);
  // The invoice total for checks declared above the totals hook (validateForSave).
  const totalRef = useRef(0);
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
  // Whether we've already atomically reserved a counter number for this form.
  // Peek-on-mount + reserve-on-save (P0 #9) avoids burning counter values on
  // cancelled/abandoned forms.
  const numberReserved = useRef(!!editingBill);
  // Skip stock deduction when EDITING an existing bill — but NOT when
   // duplicating one (P1 #21: `_isDuplicate` marks a new sale that must
   // decrement stock). Same logic applies to convert-to-tax-invoice which
   // sets _convertToType — that's also a new bill in a new type.
  // v1.10.76 (#80) - what this bill has done to stock before it is first saved
  // from this editor: an issued bill, its own record; a conversion takes over
  // the original's record (so a challan's or an old quotation's stock is
  // counted once, not again); a duplicate or a new bill, nothing. Once the
  // bill is on the server, every save works from the server's record instead.
  const stockStart = useRef(editingBill && (!editingBill._isDuplicate || editingBill._convertToType) && !editingBill._linkOnly ? appliedStock(editingBill) : {});
  // v1.10.76 (#83) - has this invoice been downloaded or printed? Then a plain
  // Save refreshes its PDF in Saved Invoices too.
  const hasOutput = useRef(!!editingBill && !editingBill._isDuplicate && !editingBill._convertToType && (Number(editingBill.printedCount) || 0) > 0);
  const hasInitialized = useRef(false); // prevent auto-save during initial load
  // v1.10.77 (#86) - a cancelled document, or one already converted into an
  // invoice, opens read-only: nothing is saved (no auto-save, Save explains
  // why); Download and Print still work. Duplicate it to make a new one.
  // P10-S7: an invoice with a live e-invoice IRN is read-only too (the IRP holds the registered copy).
  const [readOnlyDoc] = useState(() => !!editingBill && !editingBill._isDuplicate && !editingBill._convertToType
    && (editingBill.status === 'cancelled' || !!editingBill.convertedTo || einvoiceLocked(editingBill)));
  const appSettings = useAppSettings();
  const { role: entRole, restrictions } = useEntitlements();

  // Customize options (columns, paper, currency, TDS/TCS, recurring...): state, persistence and the toggle.
  const { invoiceOptions, setInvoiceOptions, showOptions, setShowOptions, toggleOption } = useInvoiceOptions({ draft, editingBill, hasInitialized });

  const typeConfig = INVOICE_TYPES[invoiceType];
  // A new document started from a sales page (New quotation, New delivery challan...) opens as that type, with the
  // GST columns that type shows; switching type in the editor does the same in handleTypeChange.
  // The same applies to the type Settings > GST > Registration type starts a new bill with (a Bill of Supply for an
  // unregistered or composition business): without this it opened as a Bill of Supply that still charged GST.
  useEffect(() => {
    if (draft || editingBill) return;
    const start = INVOICE_TYPES[initialType] ? initialType : invoiceType;
    if (!start || start === 'tax-invoice') return;
    const config = INVOICE_TYPES[start];
    if (config) setInvoiceOptions(prev => ({ ...prev, showGST: config.showGST, showPlaceOfSupply: config.showGST }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  // Settings > Taxes > GST rates offered (India); other countries keep their own list.
  const ownGstRates = appSettings['tax.gstRates'];
  const baseCountryRates = sellerCountryConfig.code === 'IN' && Array.isArray(ownGstRates) && ownGstRates.length
    ? ownGstRates
    : sellerCountryConfig.taxRates && sellerCountryConfig.taxRates.length
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

  // The party's own item rates (Settings > Party > Party-wise item rate), kept on the saved party.
  // Filled below once the clients hook has loaded the saved parties.
  const partyRatesRef = useRef(null);

  // Line items: product picking, row editing, barcode scan, custom units, delivery charge.
  const {
    products, setProducts, productSearch, setProductSearch, units, productsRef, purchasesRef,
    clampNonNeg, handleItemChange, selectProduct, getProductSuggestions,
    hasDeliveryCharge, addDeliveryCharge, scanBarcode, addItem,
    handleAddCustomUnit, handleRemoveCustomUnit, removeItem,
  } = useInvoiceItems({ showGST, defaultTaxRate, countryTaxRates, invoiceOptions, items, setItems, editingBillIdRef, allBillsRef, partyRatesRef });

  // The Billed To side: autocomplete, client modal, GSTIN check, per-client print preferences.
  const {
    savedClients, setSavedClients,
    showClientSuggestions, setShowClientSuggestions,
    clientPickerIdx, setClientPickerIdx,
    selectedClientId, setSelectedClientId,
    showClientModal, modalClient, isEditingClient,
    clientNameRef, clientSuggestionsRef,
    gstinHint, setGstinHint,
    handleClientGstinBlur,
    selectSavedClient,
    openAddClientModal, openEditClientModal, handleClientModalSave,
    filteredClients,
  } = useInvoiceClients({ client, setClient, profile, editingBill, setInvoiceOptions });

  partyRatesRef.current = savedClients.find((c) => c.id === selectedClientId)?.itemRates || null;

  // Bootstrapping: profile/terms/client/product/bill loads, hydration from the edited bill or duplicate,
  // the per-business number peek and the payment-account seeding.
  useInvoiceBootstrap({
    draft, editingBill, profile, profileProp, activeProfile, setActiveProfile,
    bizKey: businessKeyOf(profile), invoiceType, invoiceOptions, details, client, allProfiles,
    setAllProfiles, setTermsTemplates, selectedTermsId, setSelectedTermsId, setCustomTerms,
    setSavedClients, setSelectedClientId, setProducts, purchasesRef, setAllBillsForCredit,
    setClient, setItems, setCharges, setPaymentRows, setSalesman, setReturnInfo, setExpectedDeliveryDate,
    setInvoiceType, setCustomNotes, setInternalNote, setExtraSections, setTaxInclusive,
    setInvoiceOptions, setDetails, peekSeq, peekedNumber, numberReserved, hasBeenSaved,
  });

  // Debounced draft save (see hooks/useInvoiceDraft).
  useInvoiceDraft({ invoiceType, client, details, items, customTerms, customNotes, internalNote, extraSections, selectedTermsId, invoiceOptions, taxInclusive,
    ...(PHASE2 ? { charges, paymentRows, saleType, salesman, returnInfo, expectedDeliveryDate } : {}) });

  // Mark initialized after first render cycle so auto-save doesn't trigger on load
  useEffect(() => {
    const t = setTimeout(() => { hasInitialized.current = true; }, 1500);
    return () => clearTimeout(t);
  }, []);

  const { totals } = useInvoiceTotals({ allBillsForCredit, client, details, editingBill, items, profile, showGST, taxInclusive, invoiceOptions, charges: PHASE2 ? charges : undefined });
  totalRef.current = totals.total;

  // Saving: validation, auto-save, leave guard, saveInvoiceToDB, save checks.
  const {
    saving, setSaving, autoSaveStatus, leaveModal, setLeaveModal,
    handleBack, leaveActions, isMeaningfulInvoice, validateForSave, passSaveChecks, saveInvoiceToDB,
  } = useInvoiceSave({
    onBack, editingBill, invoiceType, client, details, setDetails, items, totals, totalRef, profile,
    invoiceOptions, taxInclusive, showGST,
    charges, paymentRows, salesman, returnInfo, expectedDeliveryDate,
    customTerms, customNotes, internalNote, extraSections,
    creditToApply, setCreditToApply, allBillsForCredit, setAllBillsForCredit,
    savedClients, setSavedClients, selectedClientId,
    productsRef, allBillsRef, purchasesRef, editingBillIdRef, setProducts,
    stockStart, numberReserved, peekedNumber, savedId, hasBeenSaved,
    readOnlyDoc, hasInitialized,
  });

  // Outputs: PDF build + download, print (sheet and thermal), WhatsApp, E-Way Bill, keyboard shortcuts.
  const {
    showPrintPreview, setShowPrintPreview,
    executePrint, generatePDF, directPrint,
    shareWhatsApp, exportEWayBill,
    isThermalPaper, refreshSavedPdf,
  } = useInvoiceOutput({
    printRef, previewCollapsed, setPreviewCollapsed,
    invoiceOptions, profile, editingBill, details, client, items, setItems,
    totals, invoiceType, typeConfig, taxInclusive,
    saving, setSaving, readOnlyDoc, hasOutput,
    validateForSave, saveInvoiceToDB, isMeaningfulInvoice, leaveModal, setLeaveModal,
    addItem, onBack,
  });

  // Settings > Transaction > Auto-fill received amount: until the person edits the Payment block, the received amount
  // follows the bill total (a cash sale always does, as before).
  const paymentsTouched = useRef(!!draft?.paymentRows?.length);
  useEffect(() => {
    if (!PHASE2 || editingBill || paymentsTouched.current || !takesPayment(invoiceType) || invoiceType === 'sales-order') return;
    const auto = getAppSetting('txn.autofillReceived');
    if (saleType !== 'cash' && !auto) return;
    if (!(totals.total > 0)) return;
    setPaymentRows((rows) => syncInlinePayments(rows.length || saleType === 'cash' ? rows : [{ mode: 'cash', amount: 0, reference: '', accountId: null, chequeDate: null }], { saleType: 'cash', total: totals.total, autofill: true }));
  }, [totals.total, saleType, invoiceType, editingBill]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleTypeChange = async (type) => {
    const isIssuedInvoice = !!editingBill && !editingBill._isDuplicate && !editingBill._convertToType;
    if (isIssuedInvoice) return;
    setInvoiceType(type);
    const config = INVOICE_TYPES[type];
    // v1.10.14 — honour the per-type prefix override when switching invoice type.
    const { prefix, overridePrefix } = numberPrefixFor(getPrintSettings(), type);
    // Peek — actual reservation happens on save.
    const seq = ++peekSeq.current;
    const num = await getNextInvoiceNumber(prefix, { peek: true, explicitPrefix: overridePrefix, invoiceType: type, businessKey: businessKeyOf(profile) });
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

  const handleTermsSelect = (templateId) => {
    setSelectedTermsId(templateId);
    const tpl = termsTemplates.find(t => t.id === templateId);
    if (tpl) setCustomTerms(tpl.content);
  };

  // Settings > Item (batch, serial) and Settings > GST (HSN digits) visibility flags, and Settings > Print:
  // payment mode, party balance and the PAID stamp are worked out here and handed to the printed bill.
  const extras = itemExtraVisibility(appSettings);
  const printOptions = (() => {
    if (!appSettings['print.show.paymentMode'] && !appSettings['print.show.partyBalance'] && !appSettings['print.show.paidStamp']) return invoiceOptions;
    const others = allBillsForCredit
      .filter((b) => b.id !== editingBill?.id && b.clientName === client.name && countsAsSales(b) && b.status !== 'cancelled')
      .map((b) => ({ due: amountDue(b) - (Number(b.paidAmount) || 0) }));
    const own = PHASE2 && takesPayment(invoiceType) ? paymentRows : (editingBill?.payments || []);
    return { ...invoiceOptions, payInfo: paymentInfo({ total: totals.total, payments: own, others }) };
  })();

  const stepDone = [
    !!client?.name?.trim(),
    !!(details.invoiceNumber && details.invoiceDate),
    items.some((item) => (item.name || '').trim() && (item.quantity || 0) * (item.rate || 0) > 0),
    false,
  ];
  const jumpTo = (key) => document.getElementById(`doc-step-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // A document opened from a sales page (or an existing one) keeps its type; only a plain "New invoice" can choose.
  const lockedType = !!initialType || !!editingBill;
  const partyLabel = copyFor(invoiceType).party;

  // P2-S7 Save & New: save, then open a blank document of the same type.
  const saveAndNew = async () => {
    const no = await saveOnly();
    if (!no) return;
    clearDraft();
    window.location.assign(`${window.location.pathname.replace(/\/[^/]*$/, '/new')}?type=${encodeURIComponent(invoiceType)}`);
  };

  // Save without downloading: the toolbar's Save button and the last step's button.
  const saveOnly = async () => {
      // v1.10.58 (#47) — refuse a blank invoice. Saving reserves an
      // invoice number, so an empty save leaves a permanent gap in a
      // sequence GST expects to be gapless.
      const problem = validateForSave();
      if (problem) { toast(problem, 'warning'); return; }
      if (PHASE2 && !(await passSaveChecks())) return;
      try {
        setSaving(true);
        const no = await saveInvoiceToDB();
        if (!no) return;
        clearDraft();
        toast(`${typeConfig?.label || 'Invoice'} saved`, 'success');
        await refreshSavedPdf(no);
        return no;
      } catch (err) {
        if (err?.status !== 409) {  // 409 already handled by retry inside saveInvoiceToDB
          console.error('Save failed', err);
          toast('Save failed — try again', 'error');
        }
      } finally {
        setSaving(false);
      }
  };

  const cur = invoiceOptions.currency || 'INR';
  const taxTotal = (totals.cgst || 0) + (totals.sgst || 0) + (totals.utgst || 0) + (totals.igst || 0);
  const discountTotal = (totals.totalDiscount || 0) + (totals.invoiceDiscountAmount || 0);
  const filledLines = items.filter((item) => (item.name || '').trim()).length;
  const isExisting = !!editingBill && !editingBill._isDuplicate;
  // Settings > Transaction > Show profit while billing (owner only)
  const profitNow = appSettings['txn.showProfit'] && entRole === 'owner' && !restrictions.hideCost ? estimatedProfit(items, products) : null;

  return (
    <div className="generator-container doc-canvas">
      <header className="canvas-head">
        <button type="button" className="canvas-back" onClick={handleBack} title="Back" aria-label="Back"><ArrowLeft size={18} /></button>
        <div className="canvas-title">
          <span className="canvas-eyebrow">
            {readOnlyDoc ? 'Viewing' : isExisting ? 'Editing' : 'New'}{profile?.businessName ? ` · ${profile.businessName}` : ''}
          </span>
          <h1>
            {typeConfig?.label || 'Invoice'}
            <span className="canvas-docno">{details.invoiceNumber || '—'}</span>
          </h1>
        </div>
        <EditorStatusChip
          autoSaveStatus={autoSaveStatus}
          readOnlyDoc={readOnlyDoc}
          isExisting={isExisting}
          savedYet={hasBeenSaved.current}
          isMeaningful={isMeaningfulInvoice()}
          clientName={client?.name}
          clientNameRef={clientNameRef}
        />
        <span className="canvas-head-spacer" />
        <HelpButton title="Invoice Generator — how to use" doc="invoices">
          <ul style={{ paddingLeft: '1.1rem', margin: 0 }}>
            <li><strong>The sheet</strong> — the form is laid out like the printed document: who it is for and its number and dates at the top, then the items, then terms and notes. The panel on the right keeps the total and every action in reach.</li>
            <li><strong>Line items</strong> — start typing to auto-complete from your Products list. HSN autofills the GST rate for common codes. Click "+ Add description" for a detailed note under the item name.</li>
            <li><strong>Discount</strong> — per line: pick ₹ (fixed) or % of the line. Below the items: whole-bill discount, applied after tax.</li>
            <li><strong>Customize</strong> — toggle columns and sections on/off, pick paper size, currency, TDS / TCS, recurring, the invoice title and PDF style. Changes are remembered for your next invoice.</li>
            <li><strong>Preview</strong> — opens the printed document in a drawer over the sheet. Esc or the scrim closes it.</li>
            <li><strong>Keyboard</strong> — Ctrl+S save · Ctrl+P PDF · Ctrl+Enter add row · Ctrl+Shift+D duplicate last row · Esc close.</li>
            <li><strong>Saving</strong> — a new invoice is stored when you first click Save, Save &amp; Download or Print. After that, changes save automatically. Leaving with unsaved changes asks first.</li>
          </ul>
        </HelpButton>
      </header>

      {readOnlyDoc && (
        <div className="notice notice-info canvas-notice" role="status">
          {editingBill.convertedTo
            ? `Converted to ${editingBill.convertedTo}. This copy is read-only; you can still download or print it.`
            : einvoiceLocked(editingBill)
              ? 'This invoice is registered on the IRP (e-invoice IRN), so it is read-only; you can still download or print it.'
              : 'This invoice is cancelled and read-only; you can still download or print it. Undo the cancel on the Dashboard to change it.'}
        </div>
      )}

      <div className="canvas-body">
        <main className="canvas-desk">
          <ClientModal show={showClientModal} onClose={() => setShowClientModal(false)} onSave={handleClientModalSave} client={modalClient} isEditing={isEditingClient} defaultCountry={profile?.country} />

          <article className="canvas-sheet" aria-label={`${typeConfig?.label || 'Invoice'} sheet`}>
            <div className="sheet-masthead">
              <InvoiceTypePanel
                details={details}
                handleTypeChange={handleTypeChange}
                invoiceOptions={invoiceOptions}
                invoiceType={invoiceType}
                isIssuedInvoice={!!editingBill && !editingBill._isDuplicate && !editingBill._convertToType}
                profile={profile}
                setInvoiceOptions={setInvoiceOptions}
                showOptions={showOptions}
                toggleOption={toggleOption}
                typeConfig={typeConfig}
                lockedType={lockedType}
                sourceDoc={editingBill?._convertToType ? { number: editingBill.invoiceNumber, type: editingBill.invoiceType || 'tax-invoice' } : editingBill?.data?.sourceDoc}
              />
            </div>

            <div className="sheet-parties">
              <section id="doc-step-customer" className="sheet-sec">
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
                  partyLabel={partyLabel}
                />
              </section>
              <section id="doc-step-details" className="sheet-sec">
                <InvoiceDetailsPanel
                  details={details}
                  invoiceOptions={invoiceOptions}
                  invoiceType={invoiceType}
                  profile={profile}
                  setDetails={setDetails}
                />
                {PHASE2 && (
                  <SaleDetailsExtra
                    salesman={salesman}
                    setSalesman={setSalesman}
                    invoiceType={invoiceType}
                    expectedDeliveryDate={expectedDeliveryDate}
                    setExpectedDeliveryDate={setExpectedDeliveryDate}
                    returnInfo={returnInfo}
                    setReturnInfo={setReturnInfo}
                  />
                )}
              </section>
            </div>

            <section id="doc-step-items" className="sheet-sec sheet-items">
              <LineItemsGrid
                addDeliveryCharge={addDeliveryCharge}
                billTotal={(Number(totals.total) || 0) + (Number(totals.invoiceDiscountAmount) || 0)}
                billDate={details.invoiceDate}
                scanBarcode={extras.barcode && appSettings['txn.barcodeScan'] ? scanBarcode : null}
                batchOptionsFor={(item) => { const p = productsRef.current.find((x) => x.id === item.productId); return p ? batchStock(p, { bills: allBillsRef.current, purchases: purchasesRef.current, excludeBillId: editingBillIdRef.current }) : []; }}
                serialStockFor={(item) => { const p = productsRef.current.find((x) => x.id === item.productId); return p ? serialsInStock(p, { bills: allBillsRef.current, purchases: purchasesRef.current, excludeBillId: editingBillIdRef.current }) : []; }}
                productOf={(item) => productsRef.current.find((x) => x.id === item.productId) || null}
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
                godownOptions={godowns && godowns.data.length > 1 ? godownLineOptions(godowns.data, godowns.defaultId) : null}
              />
              {PHASE2 && (
                <ChargeRows charges={charges} onChange={setCharges} totals={totals} currency={cur} showGST={showGST} />
              )}
              {PHASE2 && invoiceType === 'sales-order' && isExisting && (
                <OrderProgressPanel editingBill={editingBill} allBillsForCredit={allBillsForCredit} />
              )}
              {PHASE2 && takesPayment(invoiceType) && (
                <PaymentBlock
                  rows={paymentRows}
                  onRowsChange={(r) => { paymentsTouched.current = true; setPaymentRows(r); }}
                  saleType={saleType}
                  onSaleTypeChange={setSaleType}
                  total={totals.total}
                  payments={isExisting ? editingBill.payments : []}
                  currency={cur}
                  isOrder={invoiceType === 'sales-order'}
                />
              )}
            </section>

            <section id="doc-step-terms" className="sheet-sec sheet-foot">
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
              <ExtraSectionsPanel
                extraSections={extraSections}
                setExtraSections={setExtraSections}
              />
            </section>
            <div className="sheet-tear" aria-hidden="true" />
          </article>
        </main>

        <InvoiceRail
          invoiceType={invoiceType}
          totals={totals}
          currency={cur}
          filledLines={filledLines}
          clientName={client?.name}
          discountTotal={discountTotal}
          taxTotal={taxTotal}
          taxLabel={taxLabel}
          showGST={showGST}
          profitNow={profitNow}
          saving={saving}
          readOnlyDoc={readOnlyDoc}
          typeLabel={typeConfig?.label}
          showSaveAndNew={PHASE2}
          thermal={isThermalPaper()}
          isMeaningful={isMeaningfulInvoice()}
          isExisting={isExisting}
          savedYet={hasBeenSaved.current}
          autoSaveStatus={autoSaveStatus}
          clientNameRef={clientNameRef}
          stepDone={stepDone}
          partyLabel={partyLabel}
          jumpTo={jumpTo}
          saveOnly={saveOnly}
          saveAndNew={saveAndNew}
          generatePDF={generatePDF}
          directPrint={directPrint}
          shareWhatsApp={shareWhatsApp}
          exportEWayBill={exportEWayBill}
          previewCollapsed={previewCollapsed}
          setPreviewCollapsed={setPreviewCollapsed}
          showOptions={showOptions}
          setShowOptions={setShowOptions}
        />
      </div>

      {/* The preview drawer. Closed, it stays mounted off-screen (not display:none) so printRef keeps real dimensions
          and html2canvas can still snapshot it for PDF and print. */}
      {!previewCollapsed && <div className="canvas-scrim" onClick={() => setPreviewCollapsed(true)} />}
      <div ref={previewPaneRef} className={`preview-pane canvas-drawer${previewCollapsed ? '' : ' open'}`}
        role={previewCollapsed ? undefined : 'dialog'} aria-label="Document preview"
        style={previewCollapsed
          ? { position: 'absolute', left: '-99999px', top: 0, width: '794px', pointerEvents: 'none', opacity: 0 }
          : undefined}>
        <div className="canvas-drawer-head">
          <span className="canvas-drawer-title">Preview</span>
          <div className="canvas-zoom">
            <button type="button" title="Zoom out" onClick={() => setPreviewZoom(z => Math.max(50, z - 10))}>−</button>
            <span>{previewZoom}%</span>
            <button type="button" title="Zoom in" onClick={() => setPreviewZoom(z => Math.min(200, z + 10))}>+</button>
          </div>
          <button type="button" className="canvas-fit" title="Fit preview to the drawer width" onClick={handleFitToWidth}>Fit</button>
          <button type="button" className="canvas-drawer-close" title="Close preview (Esc)" aria-label="Close preview" onClick={() => setPreviewCollapsed(true)}>
            <X size={18} />
          </button>
        </div>
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
              customNotes={customNotes} extraSections={extraSections} options={printOptions}
              cancelled={editingBill?.status === 'cancelled'} />
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
        invoiceOptions={printOptions}
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
