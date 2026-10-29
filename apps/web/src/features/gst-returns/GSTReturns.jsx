import { useState, useEffect, useRef, useMemo } from 'react';
import { FileText, Download, Upload, ExternalLink, CheckCircle, ChevronDown, ChevronRight, AlertTriangle, BookOpen, BarChart3 } from 'lucide-react';
import { getAllBills, getAllExpenses, getAllPurchases, getProfile } from '../../lib/data';
import { formatCurrency, INVOICE_TYPES, getStateCode, formatDateGST, getFilingPeriod, hsnUqc, getFYOptions, belongsToProfile, isCancelledBill, b2clThreshold, GST_PORTAL_RATES, setOffITC, roundQty, placeOfSupplyLabel, countsAsSales, parseLocalDate } from '../../utils';
import { toast } from '../../components/ui/Toast';
import HelpButton from '../../components/ui/HelpButton';
import { GST_TYPES, DOC_ISSUE_NATURE, DOC_NATURE_LABEL, MONTHS, QUARTERS, downloadCSV, round2, readFilingStatus, computeItemTaxSplit, getTaxableAmount, purchaseBookTotals, billIsInterstate, GSTR1_STEPS, GSTR3B_STEPS, NIL_GSTR1_STEPS, NIL_GSTR3B_STEPS, StepList } from './gstHelpers';
import Gstr1Page from './Gstr1Page';
import Gstr3bPage from './Gstr3bPage';
import Gstr2bPage from './Gstr2bPage';
import TdsPage from './TdsPage';
import FilingGuidePage from './FilingGuidePage';

// ========== Main Component ==========
// `tab` is the page (change 3.17): /gst-returns/gstr1, /gstr3b, /gstr2b, /tds and /guide each have their own address.
export default function GSTReturns({ tab = 'gstr1', onTab = () => {} }) {
  const [bills, setBills] = useState([]);
  // v1.10.74 - cancelled invoices, kept apart so they reach only the Table 13
  // document count (the portal wants them in "Cancelled"), never the tax tables.
  const [cancelledBills, setCancelledBills] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [profile, setProfile] = useState({});
  const [filterMode, setFilterMode] = useState('month');
  const [fyFilter, setFyFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [quarterFilter, setQuarterFilter] = useState('Q1');
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

  const fyOptions = getFYOptions();
  const currentYear = new Date().getFullYear();
  const yearOptions = [];
  for (let y = currentYear; y >= currentYear - 5; y--) yearOptions.push(y);

  const loadData = async () => {
    try {
      const [b, e, p] = await Promise.all([getAllBills(), getAllExpenses(), getProfile()]);
      // v1.10.64 (#55) — a GST return must cover ONE GSTIN. Showing another
      // business's invoices here would misstate the return being filed.
      // v1.10.67 (#66 item 12) — a cancelled invoice is not reported.
      setBills((b || []).filter(bill => belongsToProfile(bill, p) && !isCancelledBill(bill)));
      setCancelledBills((b || []).filter(bill => belongsToProfile(bill, p) && isCancelledBill(bill)));
      // v1.10.66 (#64) — and only its own expenses and purchases. Left
      // unfiltered, GSTR-3B Table 4 claimed input tax credit on purchases made
      // by a different GSTIN.
      setExpenses((e || []).filter(r => belongsToProfile(r, p))); setProfile(p || {});
      // Purchases endpoint may not exist on older server versions
      try { const pur = await getAllPurchases(); setPurchases((pur || []).filter(r => belongsToProfile(r, p))); } catch { /* ignore — older servers don't have this endpoint */ }
    } catch { toast('Failed to load data', 'error'); }
  };

  useEffect(() => {
    const now = new Date();
    const fy = fyOptions[0];
    if (fy) setFyFilter(fy.value);
    setYearFilter(String(now.getFullYear()));
    setMonthFilter(String(now.getMonth()));
    // Auto-detect current quarter
    const m = now.getMonth();
    const q = QUARTERS.find(q => q.months.includes(m));
    if (q) setQuarterFilter(q.id);
    loadData();
  }, []);

  // ========== Period filtering ==========
  const filterByPeriod = (date) => {
    if (!date) return false;
    if (filterMode === 'fy') {
      const fy = fyOptions.find(f => f.value === fyFilter);
      return fy ? date >= fy.from && date <= fy.to : true;
    } else if (filterMode === 'quarter') {
      // Local date: new Date('2026-04-01') is UTC midnight, which west of
      // Greenwich is 31 March - the previous month, quarter and year.
      const d = parseLocalDate(date);
      const q = QUARTERS.find(q => q.id === quarterFilter);
      if (!q) return false;
      // Determine the year for the quarter based on FY context
      const yr = parseInt(yearFilter);
      return q.months.includes(d.getMonth()) && d.getFullYear() === yr;
    } else {
      const d = parseLocalDate(date);
      return d.getFullYear() === parseInt(yearFilter) && d.getMonth() === parseInt(monthFilter);
    }
  };

  // v1.10.4 — audit H13. Prior code rebuilt these arrays every render
  // (clicking any of ~10 tab pills with 500 bills × 5 items ran
  // ~20k operations per interaction). Now memoized on the same
  // input deps used by filterByPeriod. The downstream computations
  // (b2bRows, hsnMap, warnings, etc.) still run per render but consume
  // stable arrays — subsequent memoizations can layer on later without
  // touching this file's export helpers.
  const filteredBills = useMemo(() => bills.filter(bill => {
    const type = bill.invoiceType || 'tax-invoice';
    if (!GST_TYPES.includes(type)) return false;
    if (!bill.data) return false;
    return filterByPeriod(bill.invoiceDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [bills, filterMode, fyFilter, quarterFilter, monthFilter, yearFilter]);
  const allFilteredBills = useMemo(() => bills.filter(bill => bill.data && filterByPeriod(bill.invoiceDate)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bills, filterMode, fyFilter, quarterFilter, monthFilter, yearFilter]);
  const cancelledInPeriod = useMemo(() => cancelledBills.filter(bill => bill.data && filterByPeriod(bill.invoiceDate)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cancelledBills, filterMode, fyFilter, quarterFilter, monthFilter, yearFilter]);
  const filteredExpenses = useMemo(() => expenses.filter(exp => filterByPeriod(exp.date)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expenses, filterMode, fyFilter, quarterFilter, monthFilter, yearFilter]);

  // ========== Classification ==========
  const creditNotes = filteredBills.filter(b => (b.invoiceType || 'tax-invoice') === 'credit-note');
  const regularBills = filteredBills.filter(b => (b.invoiceType || 'tax-invoice') !== 'credit-note');
  // v1.10.74 - the HSN summary (Table 12) is net of credit notes: a credit
  // note's quantity, value and tax reduce its HSN row instead of adding to it.
  const hsnSign = (bill) => ((bill.invoiceType || 'tax-invoice') === 'credit-note' ? -1 : 1);
  // v1.10.66 (#61) — exports. The tax engine now charges a client outside India
  // IGST, so such an invoice can no longer sit in B2C with your own state as
  // place of supply: the portal rejects an inter-state row for the home state.
  // Exports belong in GSTR-1 Table 6A — which needs shipping-bill and port
  // details this app does not record — and in GSTR-3B 3.1(b). They are kept
  // out of B2B / B2C and 3.1(a), counted in 3.1(b), and flagged so they are
  // entered in Table 6A on the portal. They stay in regularBills, so the HSN
  // and document summaries still include them. An older invoice whose saved
  // totals charged CGST + SGST stays exactly where it was, so tax it collected
  // can never drop out of 3.1(a).
  const isExportBill = (bill) => {
    const country = String(bill.data?.client?.country || '').trim();
    return (bill.data?.profile?.country || 'India') === 'India'
      && !!country && country !== 'India'
      && !getStateCode(String(bill.data?.details?.placeOfSupply || '').trim())
      && bill.data?.totals?.isInterstate !== false;
  };
  const exportBills = regularBills.filter(isExportBill);
  const b2bRegular = regularBills.filter(b => b.data?.client?.gstin && !isExportBill(b));
  const b2cRegular = regularBills.filter(b => !b.data?.client?.gstin && !isExportBill(b));
  const b2cLarge = b2cRegular.filter(b => {
    const isInter = billIsInterstate(b);
    return isInter && (b.totalAmount || 0) > b2clThreshold(b.invoiceDate);
  });
  const b2cSmall = b2cRegular.filter(b => {
    const isInter = billIsInterstate(b);
    return !(isInter && (b.totalAmount || 0) > b2clThreshold(b.invoiceDate));
  });

  // v1.10.31 — Helper: is this bill intra-UT (business + client in same Union
  // Territory without legislature)? Value comes from computeInvoiceTotals'
  // `totals.isIntraUT` when available; falls back to state-code inspection
  // for legacy bills computed before that flag existed.
  const billIsIntraUT = (bill) => {
    if (bill?.data?.totals?.isIntraUT) return true;
    return false; // Legacy bills default to false — will treat as SGST which is safe
  };

  // ========== B2B Rows ==========
  // v1.10.31 — GST-C2 fix: also read totals.utgst (was ignored → intra-UT
  // bills lost 50% of tax in the CSV export). And GST-C3: expose cess so
  // GSTR-3B and every summary row includes it.
  const b2bRows = b2bRegular.map(bill => {
    const { client, totals, details } = bill.data;
    const isInterState = billIsInterstate(bill);
    const pos = getStateCode(details?.placeOfSupply || client?.state || '');
    // For GSTR-1 payload compat, UTGST goes into the SGST bucket (GSTN
    // schema has no separate utgst field; `samt` covers both).
    const sgstBucket = isInterState ? 0 : ((totals?.sgst || 0) + (totals?.utgst || 0));
    return {
      gstin: client.gstin, clientName: client.name || bill.clientName || '',
      invoiceNo: bill.invoiceNumber || '', date: bill.invoiceDate || '', pos,
      supplyType: isInterState ? 'Inter' : 'Intra',
      taxable: getTaxableAmount(totals),
      cgst: isInterState ? 0 : (totals?.cgst || 0),
      sgst: sgstBucket,
      igst: isInterState ? (totals?.igst || 0) : 0,
      cess: totals?.cess || 0,
      total: totals?.total || 0,
    };
  });

  // ========== B2C by Rate ==========
  const b2cByRate = {};
  // v1.10.74 - B2C is sales invoices only. Exports are reported once, in
  // 3.1(b), and credit notes are subtracted once through cnTotals below; both
  // used to land here too (an unregistered credit note was added here and then
  // subtracted, so it never reduced the tax).
  const b2cBills = b2cRegular;
  b2cBills.forEach(bill => {
    const { items } = bill.data;
    const isInterState = billIsInterstate(bill);
    const isIntraUT = billIsIntraUT(bill);
    (items || []).forEach(item => {
      const rate = item.taxPercent || 0;
      if (!b2cByRate[rate]) b2cByRate[rate] = { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 };
      const split = computeItemTaxSplit(item, isInterState, !!bill.data?.taxInclusive, isIntraUT);
      b2cByRate[rate].taxable += split.taxable;
      b2cByRate[rate].cgst += split.cgst;
      // GST-C2: UTGST folded into SGST bucket for GSTR-1 payload compatibility.
      b2cByRate[rate].sgst += split.sgst + split.utgst;
      b2cByRate[rate].igst += split.igst;
      b2cByRate[rate].cess += split.cess;
      b2cByRate[rate].total += split.taxable + split.cgst + split.sgst + split.utgst + split.igst + split.cess;
    });
  });
  const b2cRates = Object.keys(b2cByRate).map(Number).sort((a, b) => a - b);

  // v1.10.79 (#95) - the screen shows Table 7 the way the portal takes it: one
  // row per supply type, place of supply and rate. It used to add every state
  // into one row per rate, so inter-state sales to Bihar, Punjab... could not
  // be read off it. B2C Large (Table 5) invoices are listed under it.
  const b2cPos = (bill) => getStateCode(bill.data?.details?.placeOfSupply || bill.data?.client?.state || bill.data?.profile?.state || '');
  const b2cTable7 = (() => {
    const rows = {};
    b2cSmall.forEach(bill => {
      const isInter = billIsInterstate(bill);
      const isIntraUT = billIsIntraUT(bill);
      const pos = b2cPos(bill);
      (bill.data.items || []).forEach(item => {
        const rate = item.taxPercent || 0;
        const key = `${isInter ? 'INTER' : 'INTRA'}_${pos}_${rate}`;
        if (!rows[key]) rows[key] = { inter: isInter, pos, rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 };
        const split = computeItemTaxSplit(item, isInter, !!bill.data?.taxInclusive, isIntraUT);
        rows[key].taxable += split.taxable; rows[key].cgst += split.cgst; rows[key].sgst += split.sgst + split.utgst;
        rows[key].igst += split.igst; rows[key].cess += split.cess;
      });
    });
    return Object.values(rows).sort((a, b) => (a.inter - b.inter) || a.pos.localeCompare(b.pos) || a.rate - b.rate);
  })();

  // ========== HSN Summary ==========
  // v1.10.31 — GST-H3 fix: key by hsn+rate+uqc so items with the same HSN
  // but different UQCs (KGS vs NOS vs PCS) don't get their quantities
  // summed nonsensically. Also GST-C3 + C2: include cess + UTGST in totals.
  const hsnMap = {};
  filteredBills.forEach(bill => {
    const { items } = bill.data;
    const isInterState = billIsInterstate(bill);
    const isIntraUT = billIsIntraUT(bill);
    (items || []).forEach(item => {
      const hsn = item.hsn || 'N/A';
      const rate = item.taxPercent || 0;
      const uqc = item.unit || 'OTH';
      const key = `${hsn}|${rate}|${uqc}`;
      if (!hsnMap[key]) hsnMap[key] = { hsn, rate, uqc, description: item.name || '', quantity: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, totalTax: 0 };
      const split = computeItemTaxSplit(item, isInterState, !!bill.data?.taxInclusive, isIntraUT);
      const sign = hsnSign(bill);
      hsnMap[key].quantity += sign * (item.quantity || 0);
      hsnMap[key].taxable += sign * split.taxable;
      hsnMap[key].cgst += sign * split.cgst;
      hsnMap[key].sgst += sign * (split.sgst + split.utgst);
      hsnMap[key].igst += sign * split.igst;
      hsnMap[key].cess += sign * split.cess;
      hsnMap[key].totalTax += sign * (split.cgst + split.sgst + split.utgst + split.igst + split.cess);
    });
  });
  const hsnRows = Object.values(hsnMap).map((r) => ({ ...r, quantity: roundQty(r.quantity) }))
    .sort((a, b) => (a.hsn || '').localeCompare(b.hsn || ''));

  // ========== Totals ==========
  // v1.10.31 — GST-C3: sumRows now carries cess. GST-H2: credit notes
  // netted from grandTotals so GSTR-3B outward supply table reflects
  // the actual liability (was over-stated by full CN amount).
  const sumRows = (rows) => rows.reduce((acc, r) => ({
    taxable: acc.taxable + r.taxable, cgst: acc.cgst + r.cgst, sgst: acc.sgst + r.sgst,
    igst: acc.igst + r.igst, cess: acc.cess + (r.cess || 0), total: acc.total + r.total,
  }), { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 });
  const b2bTotals = sumRows(b2bRows);
  const b2cTotals = b2cRates.reduce((acc, rate) => {
    const d = b2cByRate[rate];
    return {
      taxable: acc.taxable + d.taxable, cgst: acc.cgst + d.cgst, sgst: acc.sgst + d.sgst,
      igst: acc.igst + d.igst, cess: acc.cess + (d.cess || 0), total: acc.total + d.total,
    };
  }, { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 });
  // v1.10.31 — GST-H2: subtract credit note totals from outward supply.
  const cnTotals = (creditNotes || []).reduce((acc, b) => {
    const t = b.data?.totals || {};
    const isInter = billIsInterstate(b);
    return {
      taxable: acc.taxable + (getTaxableAmount(t) || 0),
      cgst: acc.cgst + (isInter ? 0 : (t.cgst || 0)),
      sgst: acc.sgst + (isInter ? 0 : ((t.sgst || 0) + (t.utgst || 0))),
      igst: acc.igst + (isInter ? (t.igst || 0) : 0),
      cess: acc.cess + (t.cess || 0),
      total: acc.total + (t.total || 0),
    };
  }, { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 });
  const grandTotals = {
    taxable: Math.max(0, b2bTotals.taxable + b2cTotals.taxable - cnTotals.taxable),
    cgst: Math.max(0, b2bTotals.cgst + b2cTotals.cgst - cnTotals.cgst),
    sgst: Math.max(0, b2bTotals.sgst + b2cTotals.sgst - cnTotals.sgst),
    igst: Math.max(0, b2bTotals.igst + b2cTotals.igst - cnTotals.igst),
    cess: Math.max(0, b2bTotals.cess + b2cTotals.cess - cnTotals.cess),
    total: b2bTotals.total + b2cTotals.total - cnTotals.total, // signed — CN nets down
    cnTotals, // exposed for UI reconciliation display
  };

  // ========== GSTR-3B ==========
  // v1.10.66 (#61) — exports are zero-rated supplies, GSTR-3B 3.1(b). IGST paid
  // on an export is still tax payable, so it joins the output tax below even
  // though the export itself is reported outside 3.1(a).
  const exportTotals = exportBills.reduce((acc, b) => {
    const t = b.data?.totals || {};
    return { taxable: acc.taxable + getTaxableAmount(t), igst: acc.igst + (t.igst || 0), cess: acc.cess + (t.cess || 0) };
  }, { taxable: 0, igst: 0, cess: 0 });
  const outputTax = { cgst: grandTotals.cgst, sgst: grandTotals.sgst, igst: grandTotals.igst + exportTotals.igst };
  // ITC from expenses — P1 #15 fix: route to IGST when the expense is
  // interstate (vendor charged IGST, e.g. AWS / Google / Adobe from an
  // out-of-state office). Was unconditionally splitting 50/50 into
  // CGST/SGST → mis-routed ITC in GSTR-3B Table 4(A). Legacy expense
  // records without the field default to intrastate (safest — preserves
  // pre-v1.6.8 behaviour so no book values shift silently).
  const itcFromExpensesOnly = filteredExpenses.reduce((acc, e) => {
    const gst = e.gstAmount || 0;
    if (e.interstate) {
      return { cgst: acc.cgst, sgst: acc.sgst, igst: acc.igst + gst };
    }
    const half = Math.round((gst / 2) * 100) / 100;
    return { cgst: acc.cgst + half, sgst: acc.sgst + (gst - half), igst: acc.igst };
  }, { cgst: 0, sgst: 0, igst: 0 });
  // ITC from purchase bills
  const filteredPurchases = purchases.filter(p => filterByPeriod(p.date));
  // ITC from purchases — route to IGST when the purchase is interstate (supplier charged IGST),
  // otherwise split CGST/SGST. Without this, an interstate purchase incorrectly added its tax
  // to CGST+SGST in the GSTR-3B Table 4(A).
  const itcFromPurchases = filteredPurchases.reduce((acc, p) => {
    const tax = p.totalTax || purchaseBookTotals(p).tax;
    if (p.interstate) {
      return { cgst: acc.cgst, sgst: acc.sgst, igst: acc.igst + tax };
    }
    const half = Math.round((tax / 2) * 100) / 100;
    return { cgst: acc.cgst + half, sgst: acc.sgst + (tax - half), igst: acc.igst };
  }, { cgst: 0, sgst: 0, igst: 0 });
  // Compensation cess paid on purchases is input tax credit too (GSTR-3B
  // Table 4(A) csamt); it was always reported as 0.
  const itcCessFromPurchases = filteredPurchases.reduce((s, p) => s + purchaseBookTotals(p).cess, 0);
  // Combined ITC
  const itcFromExpenses = {
    cgst: itcFromExpensesOnly.cgst + itcFromPurchases.cgst,
    sgst: itcFromExpensesOnly.sgst + itcFromPurchases.sgst,
    igst: itcFromExpensesOnly.igst + itcFromPurchases.igst,
  };
  // v1.10.76 (#81) - credit set off across heads in the legal order (see setOffITC).
  const setOff = setOffITC(outputTax, itcFromExpenses);
  const netTax = setOff.payable;
  const itcCarry = setOff.carry;
  const hasCarry = itcCarry.igst + itcCarry.cgst + itcCarry.sgst > 0;

  // ========== Document Summary ==========
  // v1.10.74 - Table 13 counts cancelled documents too: "Total" is every
  // number issued in the series, "Cancelled" the ones cancelled, and the
  // portal's net issued is the difference.
  // v1.10.79 - one row per number series, under the portal's document
  // nature (1 invoices, 5 credit notes, 12 delivery challans). It was one row
  // per type, so two series (a changed prefix, a business's own numbering)
  // made a from/to that spanned both; quotations and proformas, which are not
  // reported, were listed; and the file numbered natures by list position.
  const docSummary = {};
  const trailingNo = (n) => Number((String(n).match(/(\d+)\s*$/) || [])[1] || 0);
  [...allFilteredBills, ...cancelledInPeriod].forEach(bill => {
    const type = bill.invoiceType || 'tax-invoice';
    const nature = DOC_ISSUE_NATURE[type];
    if (!nature || !bill.invoiceNumber) return;
    const series = String(bill.invoiceNumber).replace(/\d+\s*$/, '');
    const key = `${nature}|${series}`;
    if (!docSummary[key]) docSummary[key] = { nature, type: DOC_NATURE_LABEL[nature], series, from: bill.invoiceNumber, to: bill.invoiceNumber, total: 0, cancelled: 0 };
    const d = docSummary[key];
    d.total++;
    if (isCancelledBill(bill)) d.cancelled++;
    if (trailingNo(bill.invoiceNumber) < trailingNo(d.from)) d.from = bill.invoiceNumber;
    if (trailingNo(bill.invoiceNumber) > trailingNo(d.to)) d.to = bill.invoiceNumber;
  });

  // ========== Validation Warnings ==========
  const warnings = [];
  filteredBills.forEach(bill => {
    const { client, items } = bill.data;
    // Official GSTIN format: 2 digits state code, 5 letters PAN holder, 4 digits PAN number,
    // 1 letter PAN entity, 1 digit, 1 letter (Z by default), 1 alphanumeric checksum.
    // The last char can be a letter or digit, so the final group is [A-Z\d], not \d.
    if (client?.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][A-Z\d]$/.test(client.gstin)) {
      warnings.push({ type: 'error', msg: `Invoice ${bill.invoiceNumber}: Invalid client GSTIN format — ${client.gstin}` });
    }
    (items || []).forEach(item => {
      if (!item.hsn || item.hsn === 'N/A') {
        warnings.push({ type: 'warning', msg: `Invoice ${bill.invoiceNumber}: Item "${item.name || 'Unnamed'}" has no HSN/SAC code` });
      }
    });
    if (client?.gstin && !client?.state) {
      warnings.push({ type: 'warning', msg: `Invoice ${bill.invoiceNumber}: Client ${client.name} has GSTIN but no State — Place of Supply may be wrong` });
    }
    // v1.10.79 (#95) - an inter-state sale needs the buyer's state as place of
    // supply; the portal refuses an inter-state row whose state is your own.
    if (!client?.gstin && billIsInterstate(bill) && !isExportBill(bill) && countsAsSales(bill)) {
      const pos = getStateCode(bill.data?.details?.placeOfSupply || client?.state || '');
      if (!pos || pos === (getStateCode(profile.gstin || '') || getStateCode(profile.state || ''))) {
        warnings.push({ type: 'error', msg: `Invoice ${bill.invoiceNumber}: inter-state sale to ${client?.name || 'an unregistered buyer'} without the buyer's state as Place of Supply. Open the invoice and set Place of Supply.` });
      }
    }
  });
  if (!profile.gstin) {
    warnings.push({ type: 'error', msg: 'Your business GSTIN is not set. Go to Settings → Company Details to add it.' });
  }
  // v1.10.66 (#61) — exports are left out of the GSTR-1 file (see isExportBill).
  // Put first, so the three-message limit on the banner can never hide it.
  if (exportBills.length > 0) {
    const listed = exportBills.slice(0, 3).map(b => b.invoiceNumber).join(', ') + (exportBills.length > 3 ? ', …' : '');
    warnings.unshift({ type: 'error', msg: `${exportBills.length} export invoice(s) (${listed}) are not in the GSTR-1 file. Add them in Table 6A on the GST portal with the shipping bill details — their value is in GSTR-3B 3.1(b).` });
  }

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
  const getReturnPeriod = () => {
    if (filterMode === 'month') return String(parseInt(monthFilter) + 1).padStart(2, '0') + yearFilter;
    if (filterMode === 'quarter') {
      const q = QUARTERS.find(x => x.id === quarterFilter);
      const lastMonth = q ? q.months[q.months.length - 1] : 2;
      return String(lastMonth + 1).padStart(2, '0') + yearFilter;
    }
    const fy = fyOptions.find(f => f.value === fyFilter);
    return fy ? `03${fy.to.slice(0, 4)}` : getFilingPeriod(new Date().toISOString());
  };
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
      ['3.1(a) Outward taxable supplies', grandTotals.taxable.toFixed(2), grandTotals.igst.toFixed(2), grandTotals.cgst.toFixed(2), grandTotals.sgst.toFixed(2), (grandTotals.igst + grandTotals.cgst + grandTotals.sgst).toFixed(2)],
      ['4(A) ITC Available', '', itcFromExpenses.igst.toFixed(2), itcFromExpenses.cgst.toFixed(2), itcFromExpenses.sgst.toFixed(2), (itcFromExpenses.igst + itcFromExpenses.cgst + itcFromExpenses.sgst).toFixed(2)],
      ['6.1 ITC utilised', '', setOff.used.igst.toFixed(2), setOff.used.cgst.toFixed(2), setOff.used.sgst.toFixed(2), (setOff.used.igst + setOff.used.cgst + setOff.used.sgst).toFixed(2)],
      ['6.1 Tax Payable in cash', '', netTax.igst.toFixed(2), netTax.cgst.toFixed(2), netTax.sgst.toFixed(2), (netTax.igst + netTax.cgst + netTax.sgst).toFixed(2)],
      ['ITC carried forward', '', itcCarry.igst.toFixed(2), itcCarry.cgst.toFixed(2), itcCarry.sgst.toFixed(2), (itcCarry.igst + itcCarry.cgst + itcCarry.sgst).toFixed(2)],
    ]);
    toast('GSTR-3B summary CSV downloaded', 'success');
  };

  // ========== GSTR-3B JSON Export (GSTN offline tool format, schema v1.7) ==========
  // Matches the schema accepted by https://services.gst.gov.in/services/auth/dashboard
  // Upload via: GST portal → Returns → GSTR-3B → Prepare Offline → Upload JSON
  const exportGSTR3BJSON = () => {
    if (filteredBills.length === 0 && filteredExpenses.length === 0) {
      toast('No data to export for this period', 'warning');
      return;
    }
    const gstin = profile.gstin || '';
    const ret_period = getReturnPeriod();

    // Outward supplies — currently we only emit Table 3.1(a). Zero-rated / nil / exempt
    // require invoice-level categorization which is on the v1.5 roadmap; for now those
    // rows are zero-filled rather than omitted (the portal expects the structure even
    // if values are 0).
    const sup_details = {
      osup_det: {
        // v1.10.31 — GST-C3: cess populated (was hardcoded 0 → GSTR-1 emitted
        // cess but GSTR-3B did not → Section 61 mismatch notice for
        // tobacco / coal / aerated / motor-vehicle sellers).
        txval: round2(grandTotals.taxable),
        iamt: round2(grandTotals.igst),
        camt: round2(grandTotals.cgst),
        samt: round2(grandTotals.sgst),
        csamt: round2(grandTotals.cess),
      },
      // v1.10.66 (#61) — exports, kept out of osup_det above.
      osup_zero: { txval: round2(exportTotals.taxable), iamt: round2(exportTotals.igst), csamt: round2(exportTotals.cess) },
      osup_nil_exmp: { txval: 0 },
      // v1.10.31 — GST-M10: RCM inward supplies populated from purchases
      // flagged as reverse-charge (was hardcoded 0 → self-remit RCM liability
      // never reported → interest u/s 50).
      isup_rev: (() => {
        // v1.10.74 - only this return period's purchases; was every purchase ever
        // recorded, so past reverse-charge tax was declared again each period.
        const rcmPurchases = filteredPurchases.filter(p => !!p.reverseCharge);
        if (rcmPurchases.length === 0) return { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
        const t = rcmPurchases.reduce((acc, p) => ({
          txval: acc.txval + (Number(p.taxableAmount) || 0),
          iamt: acc.iamt + (p.interstate ? (Number(p.totalTax) || 0) : 0),
          camt: acc.camt + (p.interstate ? 0 : (Number(p.totalTax) || 0) / 2),
          samt: acc.samt + (p.interstate ? 0 : (Number(p.totalTax) || 0) / 2),
          csamt: acc.csamt + (Number(p.totalCess) || purchaseBookTotals(p).cess),
        }), { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
        return {
          txval: round2(t.txval), iamt: round2(t.iamt),
          camt: round2(t.camt), samt: round2(t.samt), csamt: round2(t.csamt),
        };
      })(),
      osup_nongst: { txval: 0 },
    };

    const itc_elg = {
      itc_avl: [
        { ty: 'IMPG', iamt: 0, camt: 0, samt: 0, csamt: 0 },
        { ty: 'IMPS', iamt: 0, camt: 0, samt: 0, csamt: 0 },
        { ty: 'ISRC', iamt: 0, camt: 0, samt: 0, csamt: 0 },
        { ty: 'ISD',  iamt: 0, camt: 0, samt: 0, csamt: 0 },
        { ty: 'OTH',
          iamt: round2(itcFromExpenses.igst),
          camt: round2(itcFromExpenses.cgst),
          samt: round2(itcFromExpenses.sgst),
          csamt: round2(itcCessFromPurchases),
        },
      ],
      itc_inelg: [
        { ty: 'RUL', iamt: 0, camt: 0, samt: 0, csamt: 0 },
        { ty: 'OTH', iamt: 0, camt: 0, samt: 0, csamt: 0 },
      ],
    };

    const inward_sup = {
      isup_details: [
        { ty: 'GST',    inter: 0, intra: 0 },
        { ty: 'NONGST', inter: 0, intra: 0 },
      ],
    };

    // v1.10.43 — GSTR-3B root schema fields required by the offline
    // utility. Same fix pattern as GSTR-1 above: version + hash gate
    // the entire file, and were previously missing → portal rejected
    // with "Error in JSON structure validation" before any per-section
    // check ran. `"hash": "hash"` is the reference placeholder; the
    // portal computes the real hash on receipt.
    const gstr3b = {
      gstin, ret_period,
      version: 'GST3.0.4',
      hash: 'hash',
      sup_details, itc_elg, inward_sup,
    };
    const blob = new Blob([JSON.stringify(gstr3b, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `GSTR3B_${gstin || 'export'}_${ret_period}.json`; a.click();
    URL.revokeObjectURL(url);
    toast('GSTR-3B JSON exported — upload to GST portal offline tool', 'success');
  };

  // v1.10.43 — GSTR portal validation pre-flight. Reported: users
  // uploading our JSON to gst.gov.in were hitting "Error in JSON
  // structure validation" and per-invoice RET191xxx codes with no
  // in-app warning. Root causes traced against the offline utility
  // schema + published error-code list (RET191106 / RET191113 / …):
  //   - Missing root fields `version` / `hash` / `gt` / `cur_gt`
  //     (portal rejects the whole file before per-row checks)
  //   - Invoice number rules (RET191115): ≤16 chars, only [A-Za-z0-9-/]
  //   - Non-standard tax rate (RET191175): allowed {0, 0.25, 3, 5, 12,
  //     18, 28} only — the app permits customTaxRates for internal use
  //     but portal rejects them
  //   - HSN summary rules (Jan-2025 Table 12 mandatory):
  //       * items with no HSN cannot appear in hsn.data (was 'N/A' →
  //         regex fail on portal)
  //       * min HSN digit length gated by AATO (≤5Cr → 4-digit, >5Cr
  //         → 6-digit), user-selectable in profile (`aatoBand`).
  //
  // This function returns { blocked, warnings } so callers can decide
  // whether to abort (`blocked` non-empty) or just toast (`warnings`).
  const GST_STANDARD_RATES = GST_PORTAL_RATES;
  const INUM_REGEX = /^[A-Za-z0-9\-/]{1,16}$/;
  const validateGSTR1 = (bills) => {
    const blocked = [];
    const warnings = [];
    const aatoAbove5Cr = !!profile.aatoAbove5Cr;
    const minHsnDigits = aatoAbove5Cr ? 6 : 4;

    // Invoice number rules (RET191115) — portal rejects the whole file
    // if any inum is >16 chars or has disallowed chars. Collect the
    // offenders so the user can fix them in the source invoice.
    const badInums = bills.filter(b => !INUM_REGEX.test(b.invoiceNumber || ''));
    if (badInums.length > 0) {
      blocked.push(`${badInums.length} invoice number(s) violate portal rules (≤16 chars, only letters, digits, "-" or "/"). First: ${badInums.slice(0, 3).map(b => b.invoiceNumber).join(', ')}`);
    }

    // Tax rate rules (RET191175). Custom rates set in Print Settings →
    // customTaxRates work in-app but the portal has a fixed slab list.
    const badRates = new Set();
    let badRateItemCount = 0;
    bills.forEach(bill => {
      (bill.data?.items || []).forEach(item => {
        const rate = Number(item.taxPercent) || 0;
        if (!GST_STANDARD_RATES.includes(rate)) {
          badRates.add(rate);
          badRateItemCount += 1;
        }
      });
    });
    if (badRateItemCount > 0) {
      blocked.push(`${badRateItemCount} item(s) use non-standard tax rate(s) [${Array.from(badRates).sort().join(', ')}%]. Portal accepts only ${GST_STANDARD_RATES.join(', ')}%.`);
    }

    // HSN min-digit gate (Table 12 mandatory since Jan-2025). We only
    // WARN here — we still filter the offenders out of hsn.data below
    // so the file uploads. This lets users move forward while nudging
    // them to fix the source products.
    let missingHsnItemCount = 0;
    let shortHsnItemCount = 0;
    bills.forEach(bill => {
      (bill.data?.items || []).forEach(item => {
        const hsn = String(item.hsn || '').trim();
        if (!hsn || hsn === 'N/A') missingHsnItemCount += 1;
        else if (hsn.replace(/\D/g, '').length < minHsnDigits) shortHsnItemCount += 1;
      });
    });
    if (missingHsnItemCount > 0) {
      warnings.push(`${missingHsnItemCount} item(s) have no HSN — dropped from HSN summary. GSTR-1 Table 12 requires an HSN per item.`);
    }
    if (shortHsnItemCount > 0) {
      warnings.push(`${shortHsnItemCount} item(s) have HSN shorter than ${minHsnDigits} digits (required for ${aatoAbove5Cr ? '>' : '≤'}₹5 Cr AATO). Portal may reject.`);
    }

    return { blocked, warnings };
  };

  // ========== GSTR-1 JSON Export ==========
  const exportGSTR1JSON = () => {
    if (filteredBills.length === 0) { toast('No invoices to export', 'warning'); return; }

    // v1.10.43 — Pre-flight validation. Abort with a clear message if
    // any BLOCKING rule is broken (bad invoice number, non-standard
    // rate). Show warnings but proceed for merely lossy issues
    // (missing HSN → dropped from summary).
    const { blocked, warnings } = validateGSTR1(filteredBills);
    if (blocked.length > 0) {
      toast(`GSTR-1 export blocked — fix these first: ${blocked.join(' · ')}`, 'error', 12000);
      return;
    }

    const gstin = profile.gstin || '';
    const fp = getReturnPeriod();

    const b2bMap = {};
    b2bRegular.forEach(bill => {
      const { client, totals, items, details } = bill.data;
      const ctin = client.gstin;
      if (!b2bMap[ctin]) b2bMap[ctin] = { ctin, inv: [] };
      const isInter = billIsInterstate(bill);
      const isIntraUT = billIsIntraUT(bill);
      const isRcm = !!bill.data?.invoiceOptions?.reverseCharge;
      const pos = getStateCode(details?.placeOfSupply || client?.state || '');
      const rateMap = {};
      (items || []).forEach(item => {
        const rate = item.taxPercent || 0;
        if (!rateMap[rate]) rateMap[rate] = { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
        // v1.10.31 — GST-C2/H7: pass isIntraUT so UTGST folds into SGST bucket.
        const split = computeItemTaxSplit(item, isInter, !!bill.data?.taxInclusive, isIntraUT);
        rateMap[rate].txval += split.taxable;
        rateMap[rate].iamt += split.igst;
        rateMap[rate].camt += split.cgst;
        rateMap[rate].samt += split.sgst + split.utgst;
        rateMap[rate].csamt += split.cess;
      });
      const rchrg = isRcm ? 'Y' : 'N';
      const isSEZ = !!client?.isSEZ;
      // v1.10.31 — GST-M3 + L5: `isLUT` now uses explicit flag first, term-
      // scanning fallback for legacy bills (was false-positive on "no LUT
      // applicable" text). Also GST-M9: SEZ + RCM combination — GSTN rejects
      // SEWP/SEWOP with rchrg='Y'. Coerce inv_typ to 'R' if rchrg='Y'.
      const isLUT = !!bill.data?.invoiceOptions?.isLUT
        || /\bLUT\b|Letter of Undertaking/i.test(bill.data?.customTerms || '');
      const invType = isRcm
        ? 'R'
        : (isSEZ ? (isLUT ? 'SEWOP' : 'SEWP') : 'R');
      // v1.10.31 — GST-C1: `val` per-invoice for RCM must reconcile with
      // per-rate iamt/camt/samt/csamt. When RCM, computeInvoiceTotals excludes
      // tax from `total`, but the per-rate map STILL emits the notional tax.
      // Portal validation requires `val ≈ txval + iamt + camt + samt + csamt`.
      // For RCM, we emit val inclusive of notional tax so both sides balance.
      // Also GST-H5: subtract round-off from val so per-rate sum matches.
      const rateTotal = Object.values(rateMap).reduce((s, d) => s + d.txval + d.iamt + d.camt + d.samt + d.csamt, 0);
      const val = isRcm ? round2(rateTotal) : round2((totals?.total || 0) - (totals?.roundOff || 0));
      b2bMap[ctin].inv.push({
        inum: bill.invoiceNumber, idt: formatDateGST(bill.invoiceDate), val, pos, rchrg, inv_typ: invType,
        itms: Object.entries(rateMap).map(([rt, d], i) => ({ num: i + 1, itm_det: { rt: Number(rt), txval: round2(d.txval), iamt: round2(d.iamt), camt: round2(d.camt), samt: round2(d.samt), csamt: round2(d.csamt) } })),
      });
    });

    const b2csMap = {};
    b2cSmall.forEach(bill => {
      const { profile: prof, client, items, details } = bill.data;
      const isInter = billIsInterstate(bill);
      const isIntraUT = billIsIntraUT(bill);
      const pos = getStateCode(details?.placeOfSupply || client?.state || prof?.state || '');
      const splyTy = isInter ? 'INTER' : 'INTRA';
      (items || []).forEach(item => {
        const rate = item.taxPercent || 0; const key = `${splyTy}_${pos}_${rate}`;
        if (!b2csMap[key]) b2csMap[key] = { sply_ty: splyTy, pos, rt: rate, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
        const split = computeItemTaxSplit(item, isInter, !!bill.data?.taxInclusive, isIntraUT);
        b2csMap[key].txval += split.taxable;
        b2csMap[key].iamt += split.igst;
        b2csMap[key].camt += split.cgst;
        b2csMap[key].samt += split.sgst + split.utgst; // v1.10.31 — UTGST folded
        b2csMap[key].csamt += split.cess; // v1.10.31 — cess from split
      });
    });
    const b2csArr = Object.values(b2csMap).map(d => ({ ...d, txval: round2(d.txval), iamt: round2(d.iamt), camt: round2(d.camt), samt: round2(d.samt), csamt: round2(d.csamt) }));

    const b2clMap = {};
    b2cLarge.forEach(bill => {
      const { client, totals, items, details } = bill.data;
      const pos = getStateCode(details?.placeOfSupply || client?.state || '');
      if (!b2clMap[pos]) b2clMap[pos] = { pos, inv: [] };
      const rateMap = {};
      (items || []).forEach(item => {
        const rate = item.taxPercent || 0; if (!rateMap[rate]) rateMap[rate] = { txval: 0, iamt: 0, csamt: 0 };
        // P1 #23: pass taxInclusive as 3rd arg. Pre-v1.6.8 this was omitted
        // so tax-inclusive B2CL bills inflated taxable + IGST values.
        const split = computeItemTaxSplit(item, true, !!bill.data?.taxInclusive);
        rateMap[rate].txval += split.taxable; rateMap[rate].iamt += split.igst;
        rateMap[rate].csamt += split.cess; // rounded per line, as on the invoice
      });
      b2clMap[pos].inv.push({ inum: bill.invoiceNumber, idt: formatDateGST(bill.invoiceDate), val: round2(totals?.total || 0), itms: Object.entries(rateMap).map(([rt, d], i) => ({ num: i + 1, itm_det: { rt: Number(rt), txval: round2(d.txval), iamt: round2(d.iamt), csamt: round2(d.csamt) } })) });
    });

    const cdnrMap = {};
    creditNotes.filter(b => b.data?.client?.gstin).forEach(bill => {
      const { client, totals, items, details } = bill.data;
      const ctin = client.gstin; if (!cdnrMap[ctin]) cdnrMap[ctin] = { ctin, nt: [] };
      const isInter = billIsInterstate(bill);
      const pos = getStateCode(details?.placeOfSupply || client?.state || '');
      const rateMap = {};
      (items || []).forEach(item => {
        const rate = item.taxPercent || 0; if (!rateMap[rate]) rateMap[rate] = { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
        // UTGST goes in samt, as for B2B (it was dropped for intra-UT notes).
        const split = computeItemTaxSplit(item, isInter, !!bill.data?.taxInclusive, billIsIntraUT(bill));
        rateMap[rate].txval += split.taxable; rateMap[rate].iamt += split.igst; rateMap[rate].camt += split.cgst; rateMap[rate].samt += split.sgst + split.utgst;
        rateMap[rate].csamt += split.cess;
      });
      // Same rchrg / inv_typ derivation as B2B — credit notes carry the same
      // classification as the original supply (P1 #11, #12, #13).
      const rchrg = bill.data?.invoiceOptions?.reverseCharge ? 'Y' : 'N';
      const isSEZ = !!client?.isSEZ;
      const isLUT = /LUT|Letter of Undertaking|zero.?rated/i.test(bill.data?.customTerms || '') || !!bill.data?.invoiceOptions?.isLUT;
      const invType = isSEZ ? (isLUT ? 'SEWOP' : 'SEWP') : 'R';
      cdnrMap[ctin].nt.push({ ntty: 'C', nt_num: bill.invoiceNumber, nt_dt: formatDateGST(bill.invoiceDate), val: round2(totals?.total || 0), pos, rchrg, inv_typ: invType,
        itms: Object.entries(rateMap).map(([rt, d], i) => ({ num: i + 1, itm_det: { rt: Number(rt), txval: round2(d.txval), iamt: round2(d.iamt), camt: round2(d.camt), samt: round2(d.samt), csamt: round2(d.csamt) } })) });
    });

    const hsnJsonMap = {};
    let unknownUnitCount = 0;
    filteredBills.forEach(bill => {
      const { items } = bill.data;
      const isInter = billIsInterstate(bill);
      const isIntraUT = billIsIntraUT(bill);
      (items || []).forEach(item => {
        // v1.10.43 — HSN Table 12 rule: portal rejects `hsn_sc: 'N/A'`
        // or empty. Silently DROP items with no HSN so the file uploads;
        // the pre-flight warning already told the user how many were
        // dropped and to fix the source products.
        const hsnRaw = String(item.hsn || '').trim();
        if (!hsnRaw || hsnRaw === 'N/A') return;
        const hsn = hsnRaw;
        // One row per HSN, rate AND unit, as in the CSV: two units under one
        // HSN used to add kilograms to pieces under the first row's unit.
        const uqc = hsnUqc(item);
        const rate = item.taxPercent || 0; const key = `${hsn}_${rate}_${uqc}`;
        if (uqc === 'OTH' && item.unit) unknownUnitCount += 1;
        if (!hsnJsonMap[key]) hsnJsonMap[key] = { hsn_sc: hsn, desc: item.name || '', uqc, qty: 0, rt: rate, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
        // UTGST goes in samt (it was dropped for intra-UT invoices, so the
        // JSON's HSN table disagreed with B2B and with the CSV).
        const split = computeItemTaxSplit(item, isInter, !!bill.data?.taxInclusive, isIntraUT);
        const sign = hsnSign(bill); // v1.10.74 - credit notes reduce the row
        hsnJsonMap[key].qty += uqc === 'NA' ? 0 : sign * (item.quantity || 0); hsnJsonMap[key].txval += sign * split.taxable; hsnJsonMap[key].iamt += sign * split.igst; hsnJsonMap[key].camt += sign * split.cgst; hsnJsonMap[key].samt += sign * (split.sgst + split.utgst);
        hsnJsonMap[key].csamt += sign * split.cess;
      });
    });

    const byNature = {};
    Object.values(docSummary).forEach((d) => { (byNature[d.nature] = byNature[d.nature] || []).push(d); });
    const docDet = Object.entries(byNature).map(([nature, list]) => ({
      doc_num: Number(nature),
      docs: list.map((d, i) => ({ num: i + 1, from: d.from, to: d.to, totnum: d.total, cancel: d.cancelled, net_issue: d.total - d.cancelled })),
    }));

    // v1.10.43 — Aggregate turnover fields required by portal.
    // `gt`     = aggregate turnover of the PREVIOUS FY (typically
    //            entered on the portal, but the JSON must carry the
    //            field even if 0 — omission trips schema validation).
    // `cur_gt` = turnover in the CURRENT FY up to the previous month.
    // Both accept `0` and can be overridden inline on the portal
    // during filing, so we ship them zero-filled to satisfy the
    // schema without asking the user for numbers they'd re-enter
    // anyway. Users on aggregate turnover > 5 Cr can flip
    // profile.aatoAbove5Cr (also drives HSN digit-length gate).
    const gt = Number(profile?.prevFYTurnover) || 0;
    const cur_gt = Number(profile?.currentFYTurnover) || 0;

    const gstr1 = {
      // v1.10.43 — Root schema fields the offline utility validates
      // BEFORE any per-row check. Omission was our #1 cause of "Error
      // in JSON structure validation" (RET191106) reports.
      //   version: current GSTR-1 offline utility (v3.x series).
      //   hash:    placeholder string; the portal computes the real
      //            hash on receipt. `"hash"` is the reference value
      //            every published sample uses.
      gstin, fp, gt, cur_gt,
      version: 'GST3.1.6',
      hash: 'hash',
      b2b: Object.values(b2bMap), b2cs: b2csArr,
      ...(Object.keys(b2clMap).length > 0 ? { b2cl: Object.values(b2clMap) } : {}),
      ...(Object.keys(cdnrMap).length > 0 ? { cdnr: Object.values(cdnrMap) } : {}),
      hsn: { data: Object.values(hsnJsonMap).map((r, i) => ({ num: i + 1, ...r, qty: roundQty(r.qty, 2), txval: round2(r.txval), iamt: round2(r.iamt), camt: round2(r.camt), samt: round2(r.samt), csamt: round2(r.csamt) })) },
      doc_issue: { doc_det: docDet },
    };

    const blob = new Blob([JSON.stringify(gstr1, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `GSTR1_${gstin || 'export'}_${fp}.json`; a.click();
    URL.revokeObjectURL(url);

    // Collect any lossy warnings (from pre-flight + UQC fallback) into
    // a single toast so the user knows what to fix at source without
    // hitting the portal.
    const postWarnings = [...warnings];
    if (unknownUnitCount > 0) {
      postWarnings.push(`${unknownUnitCount} item(s) used a custom unit and were exported as UQC 'OTH'.`);
    }
    if (postWarnings.length > 0) {
      toast(`GSTR-1 JSON exported. ⚠ ${postWarnings.join(' · ')}`, 'warning', 10000);
    } else {
      toast('GSTR-1 JSON exported — upload to GST portal offline tool', 'success');
    }
  };

  // ========== RENDER ==========
  const totalTax = grandTotals.cgst + grandTotals.sgst + grandTotals.igst;
  const netPayable = netTax.igst + netTax.cgst + netTax.sgst;

  return (
    <div className="dashboard-container">
      {/* Header row: title + period selector + portal link */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <h1 className="page-title" style={{ margin: 0 }}>GST Returns</h1>
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
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1, flexWrap: 'wrap' }}>
          <select className="form-input" value={filterMode} onChange={e => setFilterMode(e.target.value)} style={{ width: 'auto', minWidth: '120px' }}>
            <option value="month">Monthly</option>
            <option value="quarter">Quarterly (QRMP)</option>
            <option value="fy">Full Year</option>
          </select>
          {filterMode === 'fy' ? (
            <select className="form-input" value={fyFilter} onChange={e => setFyFilter(e.target.value)} style={{ width: 'auto' }}>
              {fyOptions.map(fy => <option key={fy.value} value={fy.value}>{fy.label}</option>)}
            </select>
          ) : filterMode === 'quarter' ? (
            <>
              <select className="form-input" value={quarterFilter} onChange={e => setQuarterFilter(e.target.value)} style={{ width: 'auto' }}>
                {QUARTERS.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}
              </select>
              <select className="form-input" value={yearFilter} onChange={e => setYearFilter(e.target.value)} style={{ width: 'auto', minWidth: '80px' }}>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </>
          ) : (
            <>
              <select className="form-input" value={monthFilter} onChange={e => setMonthFilter(e.target.value)} style={{ width: 'auto' }}>
                {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
              </select>
              <select className="form-input" value={yearFilter} onChange={e => setYearFilter(e.target.value)} style={{ width: 'auto', minWidth: '80px' }}>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </>
          )}
          {/* Filing status — v1.10.18: clickable to toggle. Reported: "in
              every option give option to change or edit because by mistake
              if click happens user can change that". */}
          <button type="button" onClick={() => toggleFiled('gstr1')}
            title={periodFiling.gstr1 ? 'Click to mark as pending' : 'Click to mark as filed'}
            style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '10px', border: 'none', cursor: 'pointer', background: periodFiling.gstr1 ? '#ecfdf5' : '#fef2f2', color: periodFiling.gstr1 ? '#059669' : '#dc2626', fontWeight: 600 }}>
            R1 {periodFiling.gstr1 ? 'Filed' : 'Pending'}
          </button>
          <button type="button" onClick={() => toggleFiled('gstr3b')}
            title={periodFiling.gstr3b ? 'Click to mark as pending' : 'Click to mark as filed'}
            style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '10px', border: 'none', cursor: 'pointer', background: periodFiling.gstr3b ? '#ecfdf5' : '#fef2f2', color: periodFiling.gstr3b ? '#059669' : '#dc2626', fontWeight: 600 }}>
            3B {periodFiling.gstr3b ? 'Filed' : 'Pending'}
          </button>
        </div>
        <a href="https://gst.gov.in" target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
          <ExternalLink size={14} /> GST Portal
        </a>
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
      <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {[
          { id: 'gstr1', label: 'GSTR-1', icon: BarChart3 },
          { id: 'gstr3b', label: 'GSTR-3B', icon: FileText },
          { id: 'gstr2b', label: 'GSTR-2B Reconciliation', icon: CheckCircle },
          { id: 'tds', label: 'TDS / TCS Report', icon: FileText },
          { id: 'guide', label: 'Filing Guide', icon: BookOpen },
        ].map(tab => (
          <button key={tab.id} className={`btn ${activeTab === tab.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab(tab.id)} style={{ fontSize: '0.82rem', padding: '0.4rem 0.75rem' }}>
            <tab.icon size={14} /> {tab.label}
          </button>
        ))}
      </div>

      {/* ===================== GSTR-1 TAB ===================== */}
      <Gstr1Page
        activeTab={activeTab}
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
        exportHSN={exportHSN}
        grandTotals={grandTotals}
        hsnRows={hsnRows}
        markFiled={markFiled}
        periodFiling={periodFiling}
      />

      {/* ===================== GSTR-3B TAB ===================== */}
      <Gstr3bPage
        activeTab={activeTab}
        b2cBills={b2cBills}
        exportGSTR3B={exportGSTR3B}
        exportGSTR3BJSON={exportGSTR3BJSON}
        exportTotals={exportTotals}
        grandTotals={grandTotals}
        hasCarry={hasCarry}
        itcCarry={itcCarry}
        itcFromExpenses={itcFromExpenses}
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
      />

      {/* ===================== TDS / TCS REPORT TAB ===================== */}
      <TdsPage
        activeTab={activeTab}
        filteredBills={filteredBills}
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
