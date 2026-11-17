import { useState, useEffect, useRef, useMemo } from 'react';
import { FileText, Download, Upload, ExternalLink, CheckCircle, ChevronDown, ChevronRight, AlertTriangle, BookOpen, BarChart3 } from 'lucide-react';
import { listBillsPage, isIncome, getProfile, savePurchase } from '../../lib/data';
import { promptAction } from '../../components/ui/ConfirmModal';
import { useAppSettings } from '../../lib/appSettings';
import { compositionTax, gstReturnsModel, imsActions, imsPack } from '@ledgora/tax-engine';
import { formatCurrency, INVOICE_TYPES, getStateCode, formatDateGST, hsnUqc, getFYOptions, getCustomUnits, GST_PORTAL_RATES, roundQty, placeOfSupplyLabel } from '../../utils';
import { toast } from '../../components/ui/Toast';
import HelpButton from '../../components/ui/HelpButton';
import { MONTHS, QUARTERS, downloadCSV, round2, readFilingStatus, computeItemTaxSplit, getTaxableAmount, billIsInterstate, buildReconciliation, collectPages, fetchCollectionPages, periodDateRange, GSTR1_STEPS, GSTR3B_STEPS, NIL_GSTR1_STEPS, NIL_GSTR3B_STEPS, StepList } from './gstHelpers';
import './gstReturns.css';
import Gstr1Page from './Gstr1Page';
import Gstr3bPage from './Gstr3bPage';
import Gstr2bPage from './Gstr2bPage';
import TdsPage from './TdsPage';
import FilingGuidePage from './FilingGuidePage';
import { Link, useNavigate } from 'react-router';
import { listBusinesses } from '../../lib/data/accounting';
import { buildGstr1a, savePack } from '../../lib/data/filing';
import { useEntitlements } from '../billing/useEntitlements';

// ========== Main Component ==========
// `tab` is the page (change 3.17): /gst-returns/gstr1, /gstr3b, /gstr2b, /tds and /guide each have their own address.
export default function GSTReturns({ tab = 'gstr1', onTab = () => {} }) {
  const navigate = useNavigate();
  const { can } = useEntitlements();
  const [savingPack, setSavingPack] = useState(false);
  // X1: the business's documents as the workspace stores them. Every table and both JSON files come from the engine's
  // gstReturnsModel (packages/tax-engine), the same code the server builds filing packs with.
  const [docs, setDocs] = useState({ profile: {}, bills: [], purchases: [], expenses: [], receipts: [], otherIncome: [] });
  const profile = docs.profile || {};
  // FY options first: the period state below initialises from them (Phase 3 —
  // the period is fetched from the server, so it must be correct on the first
  // render instead of being filled in by an effect after a whole-collection load).
  const fyOptions = getFYOptions(5, new Date(), 4);
  const currentYear = new Date().getFullYear();
  const yearOptions = [];
  for (let y = currentYear; y >= currentYear - 5; y--) yearOptions.push(y);
  const nowMonth = new Date().getMonth();
  const [filterMode, setFilterMode] = useState('month');
  const [fyFilter, setFyFilter] = useState(() => fyOptions[0]?.value || '');
  const [monthFilter, setMonthFilter] = useState(() => String(nowMonth));
  const [yearFilter, setYearFilter] = useState(() => String(currentYear));
  const [quarterFilter, setQuarterFilter] = useState(() => (QUARTERS.find(q => q.months.includes(nowMonth))?.id || 'Q1'));
  const activeTab = tab;
  const setActiveTab = onTab;
  const [gstr2bData, setGstr2bData] = useState(null); // imported 2B JSON
  const [gstr2bFilter, setGstr2bFilter] = useState('all'); // all | matched | mismatch | bookOnly | twoBOnly
  const gstr2bInputRef = useRef(null);

  const handleImport2B = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      // Accept both wrapped {data: ...} and bare formats
      const root = json?.data || json;
      if (!root?.docdata && !root?.b2b) {
        toast('That doesn\'t look like a GSTR-2B JSON. Expected docdata.b2b array.', 'error');
        return;
      }
      setGstr2bData(root);
      const supplierCount = (root.docdata?.b2b || root.b2b || []).length;
      toast(`Imported GSTR-2B for ${root.gstin || '?'} — ${supplierCount} suppliers`, 'success');
    } catch (err) {
      console.error(err);
      toast('Failed to parse GSTR-2B JSON', 'error');
    }
    if (gstr2bInputRef.current) gstr2bInputRef.current.value = '';
  };
  const [guideTab, setGuideTab] = useState('regular');
  // v1.10.74 - filed marks are kept per business GSTIN: each GSTIN files its
  // own returns, so one business's "Filed" must not show on another's. Marks
  // saved before this under the shared key are still read until the business
  // saves its own.
  const filingKey = profile.gstin ? `gst_filing_status_${String(profile.gstin).trim().toUpperCase()}` : 'gst_filing_status';
  const [filingState, setFilingState] = useState(() => ({ key: filingKey, data: readFilingStatus(filingKey) }));
  // Re-read when the business (and so the key) changes once the profile loads.
  if (filingState.key !== filingKey) setFilingState({ key: filingKey, data: readFilingStatus(filingKey) });
  const filingStatus = filingState.data;
  const setFilingStatus = (data) => setFilingState({ key: filingKey, data });

  // Phase 3 (audit): the whole bills collection is no longer loaded so a
  // period can be filtered in the browser (section-12 leftover). The bills
  // and the expense/other-income records (one shared `expenses` collection,
  // split by `kind` here exactly as getAllExpenses/getAllOtherIncome did)
  // come back already scoped to the return period, 200 docs a page until the
  // cursor runs out. Purchases and receipts deliberately stay WHOLE-collection
  // loads — 180-day ITC reversals (3B 4B), RCM credit paid this period for an
  // older bill (4A(3)), Table 11B adjustments of an earlier advance receipt
  // and the GSTR-2B matching all read documents dated outside the period — so
  // scoping them to the period would understate those tables. They are still
  // fetched page by page instead of one unbounded request.
  const loadStaticDocs = async () => {
    try {
      const p = await getProfile();
      let purchaseDocs = [];
      let receiptDocs = [];
      try { purchaseDocs = (await fetchCollectionPages('purchases')) || []; } catch { /* older servers */ }
      try { receiptDocs = (await fetchCollectionPages('receipts')) || []; } catch { /* older servers */ }
      setDocs((prev) => ({ ...prev, profile: p || prev.profile || {}, purchases: purchaseDocs, receipts: receiptDocs }));
    } catch { toast('Failed to load data', 'error'); }
  };

  const periodLoadRef = useRef(0);
  const loadPeriodDocs = async (range) => {
    const loadId = ++periodLoadRef.current;
    const { from, to } = range || {};
    try {
      const [bills, expenseRows] = await Promise.all([
        collectPages(({ limit, cursor }) => listBillsPage({ limit, cursor, from, to })),
        fetchCollectionPages('expenses', { from, to }),
      ]);
      if (loadId !== periodLoadRef.current) return; // the picked period changed meanwhile
      const rows = Array.isArray(expenseRows) ? expenseRows : [];
      setDocs((prev) => ({
        ...prev,
        bills: bills || [],
        expenses: rows.filter((e) => !isIncome(e)),
        otherIncome: rows.filter(isIncome),
      }));
    } catch { toast('Failed to load data', 'error'); }
  };

  // After a write (RCM payment): profile and purchases are re-read whole, the
  // period's documents with the period still in force.
  const loadData = () => {
    loadStaticDocs();
    loadPeriodDocs(periodDateRange(period));
  };

  useEffect(() => {
    loadStaticDocs();
  }, []);

  // ========== The period's returns (engine: gstReturnsModel) ==========
  // One GSTIN's documents, cancelled invoices apart (Table 13 only), charges as lines, other income that is a supply as
  // bills, marked nil / exempt / non-GST lines out of the taxable tables; then B2B, B2C, HSN, exports, Table 8, 3B, ITC.
  const period = useMemo(() => (filterMode === 'fy'
    ? { mode: 'fy', fy: fyOptions.find((f) => f.value === fyFilter) }
    : filterMode === 'quarter'
      ? { mode: 'quarter', year: yearFilter, quarter: quarterFilter }
      : { mode: 'month', year: yearFilter, month: monthFilter }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterMode, fyFilter, quarterFilter, monthFilter, yearFilter]);
  // Phase 3: the return period is fetched from the server (`from`/`to`), so
  // the period's documents reload whenever the picked period changes. This
  // also makes the first load, so nothing fetches the whole collection on
  // mount. Keying on the resolved bounds means month/quarter/fy modes that
  // cover the same dates share one fetch.
  const periodRange = periodDateRange(period);
  const periodRangeKey = periodRange ? `${periodRange.from}..${periodRange.to}` : '';
  useEffect(() => {
    loadPeriodDocs(periodRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodRangeKey]);
  const model = useMemo(() => gstReturnsModel(docs, period, { customUnits: getCustomUnits() }), [docs, period]);
  const {
    purchases, receipts, filterByPeriod, getReturnPeriod,
    filteredBills, filteredExpenses, creditNotes, exportBills, b2bRegular, b2cLarge, b2cSmall, billIsIntraUT, hsnSign, b2cPos,
    b2bRows, b2cBills, b2cRates, b2cTable7, hsnRows, b2bTotals, b2cTotals, grandTotals,
    nilExempt, filteredPurchases, itc180, rcm, table4, itcFromExpenses, itcAvailable4A, advances, supplies31a, zeroRated31b, unreg32,
    inward5, exempt31c, nonGst31e, outputTax, setOff, netTax, itcCarry, hasCarry, docSummary, warnings,
  } = model;

  // ========== Filing Period Key ==========
  const getPeriodKey = () => {
    if (filterMode === 'month') return `${monthFilter}_${yearFilter}`;
    if (filterMode === 'quarter') return `${quarterFilter}_${yearFilter}`;
    return fyFilter;
  };
  const periodKey = getPeriodKey();

  // v1.10.74 - the return period (MMYYYY) in the JSON files. A quarterly
  // (QRMP) return is filed for the quarter's last month, and a full year is
  // shown as March of the year it ends. It used to be the month of the first
  // bill in the list, which could be any month of the quarter or year.
  const periodFiling = filingStatus[periodKey] || {};

  // v1.10.18 — reported: "in every option give option to change or edit
  // because by mistake if click happens user can change that". Now the R1
  // and 3B status pills at the top toggle on click (Pending → Filed → Pending)
  // so a mistaken Mark Filed can be reverted without hunting through
  // settings. `markFiled` remains a set-only helper for the explicit
  // Mark-Filed button; toggling uses `toggleFiled` below.
  const toggleFiled = (returnType) => {
    const next = !periodFiling[returnType];
    const updated = {
      ...filingStatus,
      [periodKey]: {
        ...periodFiling,
        [returnType]: next,
        [`${returnType}Date`]: next ? new Date().toISOString() : null,
      },
    };
    setFilingStatus(updated);
    try { localStorage.setItem(filingKey, JSON.stringify(updated)); } catch { /* localStorage full */ }
    toast(`${returnType.toUpperCase()} marked as ${next ? 'filed' : 'pending'} for this period`, 'success');
  };

  const markFiled = (returnType) => {
    const updated = { ...filingStatus, [periodKey]: { ...periodFiling, [returnType]: true, [`${returnType}Date`]: new Date().toISOString() } };
    setFilingStatus(updated);
    try { localStorage.setItem(filingKey, JSON.stringify(updated)); } catch { /* localStorage full */ }
    toast(`${returnType.toUpperCase()} marked as filed for this period`, 'success');
  };

  const settings = useAppSettings();
  const compositionOn = settings['gst.regType'] === 'composition';
  const compRate = settings['gst.compRate'];
  const composition = compositionTax(grandTotals.taxable, compRate);
  const isNilReturn = filteredBills.length === 0 && filteredExpenses.length === 0;

  // ========== CSV Exports ==========
  const exportB2B = () => {
    if (b2bRows.length === 0) { toast('No B2B data to export', 'warning'); return; }
    downloadCSV('GSTR1_B2B_Invoices.csv',
      ['GSTIN/UIN', 'Receiver Name', 'Invoice Number', 'Invoice Date', 'Invoice Value', 'Place of Supply', 'Reverse Charge', 'Invoice Type', 'Supply Type', 'Taxable Value', 'CGST Amount', 'SGST Amount', 'IGST Amount'],
      b2bRegular.map(bill => {
        const { client, totals, details } = bill.data;
        const isInter = billIsInterstate(bill);
        const pos = getStateCode(details?.placeOfSupply || client?.state || '');
        return [client.gstin, client.name || bill.clientName || '', bill.invoiceNumber || '', formatDateGST(bill.invoiceDate), (totals?.total || 0).toFixed(2), placeOfSupplyLabel(pos), 'N', 'Regular', isInter ? 'Inter State' : 'Intra State', getTaxableAmount(totals).toFixed(2), isInter ? 0 : (totals?.cgst || 0).toFixed(2), isInter ? 0 : ((totals?.sgst || 0) + (totals?.utgst || 0)).toFixed(2), isInter ? (totals?.igst || 0).toFixed(2) : 0];
      }));
    toast('B2B CSV downloaded — matches GSTR-1 Table 4A format', 'success');
  };

  const exportB2C = () => {
    if (b2cRates.length === 0 && b2cLarge.length === 0) { toast('No B2C data to export', 'warning'); return; }
    const b2csData = {};
    b2cSmall.forEach(bill => {
      const { profile: prof, client, items, details } = bill.data;
      const isInter = billIsInterstate(bill);
      const pos = getStateCode(details?.placeOfSupply || client?.state || prof?.state || '');
      const splyType = isInter ? 'INTER' : 'INTRA';
      (items || []).forEach(item => {
        const rate = item.taxPercent || 0;
        const key = `${splyType}_${pos}_${rate}`;
        if (!b2csData[key]) b2csData[key] = { splyType, pos, rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        const split = computeItemTaxSplit(item, isInter, !!bill.data?.taxInclusive, billIsIntraUT(bill));
        b2csData[key].taxable += split.taxable; b2csData[key].cgst += split.cgst; b2csData[key].sgst += split.sgst + split.utgst; b2csData[key].igst += split.igst;
        b2csData[key].cess = (b2csData[key].cess || 0) + split.cess;
      });
    });
    downloadCSV('GSTR1_B2C_Small.csv', ['Type', 'Place of Supply', 'Rate', 'Taxable Value', 'CGST Amount', 'SGST Amount', 'IGST Amount', 'Cess Amount'],
      Object.values(b2csData).map(d => [d.splyType === 'INTER' ? 'Inter State' : 'Intra State', placeOfSupplyLabel(d.pos), d.rate + '%', d.taxable.toFixed(2), d.cgst.toFixed(2), d.sgst.toFixed(2), d.igst.toFixed(2), (d.cess || 0).toFixed(2)]));
    if (b2cLarge.length > 0) {
      downloadCSV('GSTR1_B2C_Large.csv', ['Invoice Number', 'Invoice Date', 'Invoice Value', 'Place of Supply', 'Taxable Value', 'IGST Amount', 'Cess Amount'],
        b2cLarge.map(bill => { const { client, totals, details } = bill.data; const pos = getStateCode(details?.placeOfSupply || client?.state || ''); return [bill.invoiceNumber, formatDateGST(bill.invoiceDate), (totals?.total || 0).toFixed(2), placeOfSupplyLabel(pos), getTaxableAmount(totals).toFixed(2), (totals?.igst || 0).toFixed(2), (totals?.cess || 0).toFixed(2)]; }));
    }
    toast('B2C CSV downloaded', 'success');
  };

  const exportHSN = () => {
    if (hsnRows.length === 0) { toast('No HSN data', 'warning'); return; }
    // v1.10.31 — GST-H3: key by hsn+rate+uqc so mixed-UQC items don't
    // aggregate nonsensically. GST-C3: cess included. GST-C2: UTGST folded.
    const hsnDetailed = {};
    filteredBills.forEach(bill => {
      const { items } = bill.data;
      const isInter = billIsInterstate(bill);
      const isIntraUT = billIsIntraUT(bill);
      (items || []).forEach(item => {
        const hsn = item.hsn || 'N/A';
        const rate = item.taxPercent || 0;
        const uqc = hsnUqc(item) || 'NOS';
        const key = `${hsn}|${rate}|${uqc}`;
        if (!hsnDetailed[key]) hsnDetailed[key] = { hsn, desc: item.name || '', uqc, qty: 0, rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, totalValue: 0 };
        const split = computeItemTaxSplit(item, isInter, !!bill.data?.taxInclusive, isIntraUT);
        const sign = hsnSign(bill); // v1.10.74 - credit notes reduce the row
        hsnDetailed[key].qty += uqc === 'NA' ? 0 : sign * (item.quantity || 0);
        hsnDetailed[key].taxable += sign * split.taxable;
        hsnDetailed[key].cgst += sign * split.cgst;
        hsnDetailed[key].sgst += sign * (split.sgst + split.utgst);
        hsnDetailed[key].igst += sign * split.igst;
        hsnDetailed[key].cess += sign * split.cess;
        hsnDetailed[key].totalValue += sign * (split.taxable + split.cgst + split.sgst + split.utgst + split.igst + split.cess);
      });
    });
    // v1.10.31 — Column order + header labels now match the GSTR-1
    // offline utility's Table 12 CSV template (v3.1.6+). The prior order
    // put "Total Value" LAST and used "Rate %" — the portal importer
    // rejects those with "Invalid file format". Correct order (portal):
    //   HSN, Description, UQC, Total Quantity, Total Value, Rate,
    //   Taxable Value, Integrated Tax Amount, Central Tax Amount,
    //   State/UT Tax Amount, Cess Amount
    downloadCSV(
      'GSTR1_HSN_Summary.csv',
      ['HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Rate', 'Taxable Value', 'Integrated Tax Amount', 'Central Tax Amount', 'State/UT Tax Amount', 'Cess Amount'],
      Object.values(hsnDetailed).map(r => [
        r.hsn,
        r.desc,
        r.uqc,
        roundQty(r.qty, 2),
        r.totalValue.toFixed(2),
        r.rate,
        r.taxable.toFixed(2),
        r.igst.toFixed(2),
        r.cgst.toFixed(2),
        r.sgst.toFixed(2),
        r.cess.toFixed(2),
      ])
    );
    toast('HSN CSV downloaded — GSTR-1 Table 12 format', 'success');
  };

  const exportCDNR = () => {
    const cdnrBills = creditNotes.filter(b => b.data?.client?.gstin);
    const cdnurBills = creditNotes.filter(b => !b.data?.client?.gstin);
    if (cdnrBills.length === 0 && cdnurBills.length === 0) { toast('No Credit Notes', 'warning'); return; }
    if (cdnrBills.length > 0) {
      downloadCSV('GSTR1_CDNR.csv', ['GSTIN/UIN', 'Receiver Name', 'Note Number', 'Note Date', 'Note Type', 'Place of Supply', 'Reverse Charge', 'Note Value', 'Taxable Value', 'IGST Amount', 'CGST Amount', 'SGST Amount'],
        cdnrBills.map(bill => { const { client, totals } = bill.data; const isInter = billIsInterstate(bill); const pos = getStateCode(bill.data.details?.placeOfSupply || client?.state || ''); return [client.gstin, client.name || bill.clientName, bill.invoiceNumber, formatDateGST(bill.invoiceDate), 'C', pos, 'N', (totals?.total || 0).toFixed(2), getTaxableAmount(totals).toFixed(2), isInter ? (totals?.igst || 0).toFixed(2) : '0.00', isInter ? '0.00' : (totals?.cgst || 0).toFixed(2), isInter ? '0.00' : ((totals?.sgst || 0) + (totals?.utgst || 0)).toFixed(2)]; }));
    }
    if (cdnurBills.length > 0) {
      downloadCSV('GSTR1_CDNUR.csv', ['Note Number', 'Note Date', 'Note Type', 'Place of Supply', 'Note Value', 'Taxable Value', 'IGST Amount', 'Cess Amount'],
        cdnurBills.map(bill => { const { client, totals } = bill.data; const pos = getStateCode(bill.data.details?.placeOfSupply || client?.state || ''); return [bill.invoiceNumber, formatDateGST(bill.invoiceDate), 'C', pos, (totals?.total || 0).toFixed(2), getTaxableAmount(totals).toFixed(2), (totals?.igst || 0).toFixed(2), (totals?.cess || 0).toFixed(2)]; }));
    }
    toast('Credit Notes exported', 'success');
  };

  const exportDocSummary = () => {
    if (Object.keys(docSummary).length === 0) { toast('No documents', 'warning'); return; }
    downloadCSV('GSTR1_Doc_Summary.csv', ['Document Type', 'Sr. No. From', 'Sr. No. To', 'Total Number', 'Cancelled'],
      Object.entries(docSummary).map(([, d]) => [d.type, d.from, d.to, d.total, d.cancelled]));
    toast('Document Summary CSV downloaded', 'success');
  };

  const exportGSTR3B = () => {
    downloadCSV('GSTR3B_Summary.csv', ['Description', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Total'], [
      ['3.1(a) Outward taxable supplies', supplies31a.taxable.toFixed(2), supplies31a.igst.toFixed(2), supplies31a.cgst.toFixed(2), supplies31a.sgst.toFixed(2), (supplies31a.igst + supplies31a.cgst + supplies31a.sgst).toFixed(2)],
      ['4(A) ITC Available', '', itcAvailable4A.igst.toFixed(2), itcAvailable4A.cgst.toFixed(2), itcAvailable4A.sgst.toFixed(2), (itcAvailable4A.igst + itcAvailable4A.cgst + itcAvailable4A.sgst).toFixed(2)],
      // Phase 3: reversals and the net, only when there are any, so a return without them exports as before.
      ...(table4.reversed ? [
        ['4(B)(1) ITC Reversed - rules 38/42/43, section 17(5)', '', table4.rev.rul.igst.toFixed(2), table4.rev.rul.cgst.toFixed(2), table4.rev.rul.sgst.toFixed(2), (table4.rev.rul.igst + table4.rev.rul.cgst + table4.rev.rul.sgst).toFixed(2)],
        ['4(A)(5) Re-claimed ITC (180-day rule)', '', table4.avl.reclaim.igst.toFixed(2), table4.avl.reclaim.cgst.toFixed(2), table4.avl.reclaim.sgst.toFixed(2), (table4.avl.reclaim.igst + table4.avl.reclaim.cgst + table4.avl.reclaim.sgst).toFixed(2)],
        ['4(B)(2) ITC Reversed - others (debit notes, 180-day rule)', '', table4.rev.oth.igst.toFixed(2), table4.rev.oth.cgst.toFixed(2), table4.rev.oth.sgst.toFixed(2), (table4.rev.oth.igst + table4.rev.oth.cgst + table4.rev.oth.sgst).toFixed(2)],
        ['4(C) Net ITC Available', '', itcFromExpenses.igst.toFixed(2), itcFromExpenses.cgst.toFixed(2), itcFromExpenses.sgst.toFixed(2), (itcFromExpenses.igst + itcFromExpenses.cgst + itcFromExpenses.sgst).toFixed(2)],
      ] : []),
      ['6.1 ITC utilised', '', setOff.used.igst.toFixed(2), setOff.used.cgst.toFixed(2), setOff.used.sgst.toFixed(2), (setOff.used.igst + setOff.used.cgst + setOff.used.sgst).toFixed(2)],
      ['6.1 Tax Payable in cash', '', netTax.igst.toFixed(2), netTax.cgst.toFixed(2), netTax.sgst.toFixed(2), (netTax.igst + netTax.cgst + netTax.sgst).toFixed(2)],
      ['ITC carried forward', '', itcCarry.igst.toFixed(2), itcCarry.cgst.toFixed(2), itcCarry.sgst.toFixed(2), (itcCarry.igst + itcCarry.cgst + itcCarry.sgst).toFixed(2)],
    ]);
    toast('GSTR-3B summary CSV downloaded', 'success');
  };

  // P10-S2: "Record RCM payment": the RCM tax of a bill paid to the government in cash. Its credit is claimed in 4(A)(3)
  // of the period of this date.
  const recordRcmPayment = async (bill) => {
    const doc = purchases.find(p => p.id === bill.id);
    if (!doc) return;
    const amount = round2(bill.heads.igst + bill.heads.cgst + bill.heads.sgst + bill.heads.cess);
    const date = await promptAction({ title: `Record RCM payment for ${bill.number || 'bill'}`, message: `Date you paid ${formatCurrency(amount)} of reverse-charge tax through the electronic cash ledger (YYYY-MM-DD)`, defaultValue: new Date().toISOString().slice(0, 10), confirmLabel: 'Record' });
    if (!date) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date).trim()) || String(date).trim() < (doc.date || '')) { toast('Enter a date on or after the bill date, as YYYY-MM-DD', 'warning'); return; }
    try {
      await savePurchase({ ...doc, rcmPayment: { date: String(date).trim(), amount } });
      toast('RCM payment recorded', 'success');
      loadData();
    } catch { toast('Failed to save', 'error'); }
  };

  // ========== GSTR-3B JSON Export (GSTN offline tool format, schema v1.7) ==========
  // Matches the schema accepted by https://services.gst.gov.in/services/auth/dashboard
  // Upload via: GST portal → Returns → GSTR-3B → Prepare Offline → Upload JSON
  // File-ready returns: with { asPack: true } the builder's file is returned instead of downloaded, so a filing pack
  // holds byte-for-byte what the JSON buttons give (and what the server builds: the same engine function).
  const downloadJson = (obj, name) => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  // ========== GSTR-3B JSON Export (GSTN offline tool format) ==========
  // Upload via: GST portal → Returns → GSTR-3B → Prepare Offline → Upload JSON
  const exportGSTR3BJSON = (opts = {}) => {
    const gstr3b = model.buildGstr3b();
    if (!gstr3b) { toast('No data to export for this period', 'warning'); return; }
    if (opts.asPack) return gstr3b;
    downloadJson(gstr3b, `GSTR3B_${gstr3b.gstin || 'export'}_${gstr3b.ret_period}.json`);
    toast('GSTR-3B JSON exported — upload to GST portal offline tool', 'success');
  };

  // ========== GSTR-1 JSON Export ==========
  // The engine refuses the file for what the portal rejects whole (bad GSTINs, invoice numbers, rates) and warns about
  // what it drops (items without HSN, custom units exported as OTH).
  const exportGSTR1JSON = (opts = {}) => {
    const r = model.buildGstr1();
    if (r.empty) { toast('No invoices to export', 'warning'); return; }
    if (r.blocked.length > 0) {
      toast(`GSTR-1 export blocked — fix these first: ${r.blocked.join(' · ')}`, 'error', 12000);
      return;
    }
    if (opts.asPack) return r.json;
    downloadJson(r.json, `GSTR1_${profile.gstin || 'export'}_${r.json.fp}.json`);
    if (r.warnings.length > 0) toast(`GSTR-1 JSON exported. ⚠ ${r.warnings.join(' · ')}`, 'warning', 10000);
    else toast('GSTR-1 JSON exported — upload to GST portal offline tool', 'success');
  };

  // ========== FILING PACKS (file-ready returns) ==========
  // Saves the period's return as a filing pack: the server checks it again, keeps it versioned, and it can go to a
  // CA for review before someone uploads it on the portal and records the ARN (Return Register).
  const canPack = can('filing:prepare') && (filterMode === 'month' || filterMode === 'quarter');
  const saveFilingPack = async (kind) => {
    if (!canPack) { toast('Pick a month or a quarter: a return is filed for one period', 'warning'); return; }
    let payload = null;
    let itc2b = null;
    if (kind === 'gstr1' || kind === 'gstr1a') payload = exportGSTR1JSON({ asPack: true });
    else if (kind === 'gstr3b') {
      payload = exportGSTR3BJSON({ asPack: true });
      if (gstr2bData) {
        // What 2B makes available, for the "ITC claimed above 2B" check.
        const rows = buildReconciliation(gstr2bData, purchases, filteredPurchases).filter((r) => r.status !== 'book_only' && r.itcAvailable);
        itc2b = rows.reduce((a, r) => ({ iamt: a.iamt + r.twoBIgst, camt: a.camt + r.twoBCgst, samt: a.samt + r.twoBSgst }), { iamt: 0, camt: 0, samt: 0 });
      }
    } else if (kind === 'ims') {
      if (!gstr2bData) { toast('Import the GSTR-2B JSON first', 'warning'); return; }
      const rows = imsActions(buildReconciliation(gstr2bData, purchases, filteredPurchases));
      payload = imsPack(profile.gstin || '', getReturnPeriod(), rows);
    }
    if (!payload) return;
    setSavingPack(true);
    try {
      const list = await listBusinesses();
      const biz = list.find((b) => b.gstin && profile.gstin && b.gstin.toUpperCase() === String(profile.gstin).toUpperCase()) || list.find((b) => b.isDefault) || list[0];
      if (!biz) throw new Error('No business found');
      // GSTR-1A: the server compares today's GSTR-1 with the filed one (and refuses outside the 1A window).
      if (kind === 'gstr1a') payload = (await buildGstr1a(biz.id, getReturnPeriod(), payload)).payload;
      const pack = await savePack({ businessId: biz.id, kind, period: getReturnPeriod(), quarterly: filterMode === 'quarter', payload, itc2b });
      toast(pack.unchanged ? 'Same file as the saved pack; nothing changed' : `Saved as version ${pack.version}`, 'success');
      navigate(`/filing/${pack.id}`);
    } catch (e) {
      toast(e?.message || 'Could not save the filing pack', 'error');
    } finally {
      setSavingPack(false);
    }
  };

  // ========== RENDER ==========
  const TAB_TITLES = { gstr1: 'GSTR-1', gstr3b: 'GSTR-3B', gstr2b: 'GSTR-2B Reconciliation', tds: 'TDS / TCS Report', guide: 'Filing Guide' };
  const totalTax = grandTotals.cgst + grandTotals.sgst + grandTotals.igst;
  const netPayable = netTax.igst + netTax.cgst + netTax.sgst;

  return (
    <div className="dashboard-container">
      {/* Header: the page's own title, then what it is for (period, filing status), then the actions, wrapping as units */}
      <div className="gr-head">
        <div className="gr-title">
          <h1 className="page-title" style={{ margin: 0 }}>{TAB_TITLES[activeTab] || 'GST Returns'}</h1>
          <p className="page-subtitle" style={{ margin: 0 }}>GST Returns</p>
        </div>
        <HelpButton title="GST Returns — how to use" doc="gst-returns">
          <ul style={{ paddingLeft: '1.1rem', margin: 0 }}>
            <li><strong>Pick a period</strong> — Monthly / Quarterly (QRMP) / Full Year, then the specific month + year.</li>
            <li><strong>R1 Filed / 3B Pending pills</strong> — click to toggle Filed ↔ Pending in case of misclick. Colour changes reflect the current state.</li>
            <li><strong>GSTR-1</strong> tab shows B2B / B2C / HSN Summary / Docs Issued as the portal expects. "JSON Export" gives you the file to upload at gst.gov.in.</li>
            <li><strong>GSTR-3B</strong> — the portal fills it from your GSTR-1 (from July 2025). Check the portal's figures against this tab before filing.</li>
            <li><strong>GSTR-2B</strong> — upload the JSON you download from the portal; app matches ITC against your Purchase Bills to flag mismatches.</li>
            <li><strong>Mark Filed</strong> — after filing on the portal, click Mark Filed to keep the app's status in sync.</li>
          </ul>
        </HelpButton>
        <div className="gr-controls" role="group" aria-label="Return period">
          <select className="form-input" value={filterMode} onChange={e => setFilterMode(e.target.value)}>
            <option value="month">Monthly</option>
            <option value="quarter">Quarterly (QRMP)</option>
            <option value="fy">Full Year</option>
          </select>
          {filterMode === 'fy' ? (
            <select className="form-input" value={fyFilter} onChange={e => setFyFilter(e.target.value)}>
              {fyOptions.map(fy => <option key={fy.value} value={fy.value}>{fy.label}</option>)}
            </select>
          ) : filterMode === 'quarter' ? (
            <>
              <select className="form-input" value={quarterFilter} onChange={e => setQuarterFilter(e.target.value)}>
                {QUARTERS.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}
              </select>
              <select className="form-input" value={yearFilter} onChange={e => setYearFilter(e.target.value)}>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </>
          ) : (
            <>
              <select className="form-input" value={monthFilter} onChange={e => setMonthFilter(e.target.value)}>
                {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
              </select>
              <select className="form-input" value={yearFilter} onChange={e => setYearFilter(e.target.value)}>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </>
          )}
        </div>
        <div className="gr-status" role="group" aria-label="Filing status">
          {/* Filing status — v1.10.18: clickable to toggle. Reported: "in
              every option give option to change or edit because by mistake
              if click happens user can change that". */}
          <button type="button" onClick={() => toggleFiled('gstr1')}
            title={periodFiling.gstr1 ? 'Click to mark as pending' : 'Click to mark as filed'}
            className={`gr-pill ${periodFiling.gstr1 ? 'gr-pill-ok' : 'gr-pill-pending'}`}>
            R1 {periodFiling.gstr1 ? 'Filed' : 'Pending'}
          </button>
          <button type="button" onClick={() => toggleFiled('gstr3b')}
            title={periodFiling.gstr3b ? 'Click to mark as pending' : 'Click to mark as filed'}
            className={`gr-pill ${periodFiling.gstr3b ? 'gr-pill-ok' : 'gr-pill-pending'}`}>
            3B {periodFiling.gstr3b ? 'Filed' : 'Pending'}
          </button>
        </div>
        <div className="gr-actions">
          {can('filing:read') && (
            <Link className="btn btn-secondary btn-sm" to="/filing" title="Every return of the year: packs, CA review, ARNs">
              Return Register
            </Link>
          )}
          <a href="https://gst.gov.in" target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">
            <ExternalLink size={14} /> GST Portal
          </a>
        </div>
      </div>

      {/* Warnings — collapsed by default, only errors show */}
      {warnings.filter(w => w.type === 'error').length > 0 && (
        <div style={{ padding: '0.5rem 0.75rem', marginBottom: '0.75rem', borderRadius: '8px', background: 'var(--danger-light, #fef2f2)', fontSize: '0.8rem', color: '#dc2626' }}>
          <AlertTriangle size={13} style={{ verticalAlign: '-2px', marginRight: '0.35rem' }} />
          {warnings.filter(w => w.type === 'error').slice(0, 3).map(w => w.msg).join(' | ')}
        </div>
      )}
      {/* v1.10.74 - warnings (missing HSN, GSTIN without a state) were worked
          out but never shown; a missing HSN drops the item from Table 12. */}
      {warnings.filter(w => w.type === 'warning').length > 0 && (() => {
        const list = warnings.filter(w => w.type === 'warning');
        return (
          <div style={{ padding: '0.5rem 0.75rem', marginBottom: '0.75rem', borderRadius: '8px', background: 'var(--warn-bg)', color: 'var(--warn-text)', fontSize: '0.8rem' }}>
            <AlertTriangle size={13} style={{ verticalAlign: '-2px', marginRight: '0.35rem' }} />
            {list.slice(0, 3).map(w => w.msg).join(' | ')}
            {list.length > 3 && ` | +${list.length - 3} more`}
          </div>
        );
      })()}

      {/* Settings > GST: a composition dealer pays tax at the composition rate on turnover (CMP-08), not on each invoice */}
      {compositionOn && (
        <div style={{ padding: '0.5rem 0.75rem', marginBottom: '0.75rem', borderRadius: '8px', background: 'var(--info-bg, #eff6ff)', fontSize: '0.8rem' }}>
          Composition scheme at {compRate}%: tax payable for this period is {formatCurrency(composition.total)} ({formatCurrency(composition.central)} central + {formatCurrency(composition.state)} state), paid with CMP-08. File GSTR-4 once a year.
        </div>
      )}

      {/* NIL Return notice */}
      {isNilReturn && (
        <div style={{ padding: '0.5rem 0.75rem', marginBottom: '0.75rem', borderRadius: '8px', background: 'var(--warn-bg)', color: 'var(--warn-text)', fontSize: '0.8rem' }}>
          No invoices or expenses found — file a NIL return on the GST portal. NIL returns are mandatory.
        </div>
      )}

      {/* Compact summary + tabs in one row */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'stretch', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div className="glass-panel" style={{ padding: '0.75rem 1rem', flex: 1, minWidth: '200px', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div><p className="stat-label" style={{ margin: 0, fontSize: '0.7rem' }}>Invoices</p><strong style={{ fontSize: '1.25rem' }}>{filteredBills.length}</strong></div>
          <div style={{ width: '1px', height: '2rem', background: 'var(--border)' }} />
          <div><p className="stat-label" style={{ margin: 0, fontSize: '0.7rem' }}>Taxable</p><strong style={{ fontSize: '1rem' }}>{formatCurrency(grandTotals.taxable)}</strong></div>
          <div style={{ width: '1px', height: '2rem', background: 'var(--border)' }} />
          <div><p className="stat-label" style={{ margin: 0, fontSize: '0.7rem' }}>Tax</p><strong style={{ fontSize: '1rem' }}>{formatCurrency(totalTax)}</strong></div>
          <div style={{ width: '1px', height: '2rem', background: 'var(--border)' }} />
          <div><p className="stat-label" style={{ margin: 0, fontSize: '0.7rem' }}>Net Payable</p><strong style={{ fontSize: '1rem', color: 'var(--primary)' }}>{formatCurrency(netPayable)}</strong></div>
        </div>
      </div>

      {/* Tabs */}
      <div className="gr-tabs" role="tablist" aria-label="Returns">
        {[
          { id: 'gstr1', label: 'GSTR-1', icon: BarChart3 },
          { id: 'gstr3b', label: 'GSTR-3B', icon: FileText },
          { id: 'gstr2b', label: 'GSTR-2B Reconciliation', icon: CheckCircle },
          { id: 'tds', label: 'TDS / TCS Report', icon: FileText },
          { id: 'guide', label: 'Filing Guide', icon: BookOpen },
        ].map(tab => (
          <button key={tab.id} role="tab" aria-selected={activeTab === tab.id} className={`btn btn-sm ${activeTab === tab.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab(tab.id)}>
            <tab.icon size={14} /> {tab.label}
          </button>
        ))}
      </div>

      {/* ===================== GSTR-1 TAB ===================== */}
      <Gstr1Page
        activeTab={activeTab}
        advances={advances}
        b2bRows={b2bRows}
        b2bTotals={b2bTotals}
        b2cBills={b2cBills}
        b2cLarge={b2cLarge}
        b2cPos={b2cPos}
        b2cRates={b2cRates}
        b2cTable7={b2cTable7}
        b2cTotals={b2cTotals}
        creditNotes={creditNotes}
        docSummary={docSummary}
        exportB2B={exportB2B}
        exportB2C={exportB2C}
        exportCDNR={exportCDNR}
        exportDocSummary={exportDocSummary}
        exportGSTR1JSON={exportGSTR1JSON}
        onSavePack={canPack ? () => saveFilingPack('gstr1') : null}
        onSaveAmend={canPack ? () => saveFilingPack('gstr1a') : null}
        savingPack={savingPack}
        exportHSN={exportHSN}
        grandTotals={grandTotals}
        hsnRows={hsnRows}
        nilExempt={nilExempt}
        exportBills={exportBills}
        markFiled={markFiled}
        periodFiling={periodFiling}
      />

      {/* ===================== GSTR-3B TAB ===================== */}
      <Gstr3bPage
        activeTab={activeTab}
        b2cBills={b2cBills}
        exportGSTR3B={exportGSTR3B}
        exportGSTR3BJSON={exportGSTR3BJSON}
        onSavePack={canPack ? () => saveFilingPack('gstr3b') : null}
        savingPack={savingPack}
        exportTotals={zeroRated31b}
        unreg32={unreg32}
        inward5={inward5}
        nilExempt={nilExempt}
        grandTotals={grandTotals}
        hasCarry={hasCarry}
        itcCarry={itcCarry}
        itcFromExpenses={itcFromExpenses}
        table4={table4}
        itc180={itc180}
        supplies31a={supplies31a}
        rcm={rcm}
        onRecordRcm={recordRcmPayment}
        exempt31c={exempt31c}
        nonGst31e={nonGst31e}
        markFiled={markFiled}
        netPayable={netPayable}
        netTax={netTax}
        outputTax={outputTax}
        periodFiling={periodFiling}
        setOff={setOff}
      />

      {/* ===================== GSTR-2B RECONCILIATION TAB ===================== */}
      <Gstr2bPage
        activeTab={activeTab}
        filteredPurchases={filteredPurchases}
        gstr2bData={gstr2bData}
        gstr2bFilter={gstr2bFilter}
        gstr2bInputRef={gstr2bInputRef}
        handleImport2B={handleImport2B}
        purchases={purchases}
        setGstr2bData={setGstr2bData}
        setGstr2bFilter={setGstr2bFilter}
        onSaveIms={canPack ? () => saveFilingPack('ims') : null}
        savingPack={savingPack}
      />

      {/* ===================== TDS / TCS REPORT TAB ===================== */}
      <TdsPage
        activeTab={activeTab}
        filteredBills={filteredBills}
        periodReceipts={receipts.filter(r => filterByPeriod(r.date))}
      />

      {/* ===================== FILING GUIDE TAB ===================== */}
      <FilingGuidePage
        activeTab={activeTab}
        guideTab={guideTab}
        setGuideTab={setGuideTab}
      />
    </div>
  );
}
