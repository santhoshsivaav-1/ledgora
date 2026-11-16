// GSTR-1 and GSTR-3B from the business's documents, for one period: every table the GST Returns screen shows and the
// two portal JSON files. Moved out of apps/web GSTReturns.jsx (X1, docs/FEATURE_GAPS_2026-11.md) so the screen and the
// server build the same files. The logic is the screen's, line for line; test/gstReturnsGolden.test.js holds it to the
// files the screen downloaded before the move. Inputs are the workspace documents exactly as the screen loads them.

import { splitLineTax } from './lineTax.ts';
import { getStateCode, gstinChecksumOk } from './gstin.ts';
import { b2clThreshold, GST_PORTAL_RATES } from './rates.ts';
import { formatDateGST, getFilingPeriod, parseLocalDate } from './dates.ts';
import { countsAsSales, isCancelledBill } from './invoiceTypes.ts';
import { hsnUqc as engineHsnUqc } from './units.ts';
import { roundQty } from './money.ts';
import { setOffITC } from './totals.ts';
import { table11, table11Json, withAdvanceTax } from './advances.ts';
import { exemptInward, interStateUnregistered, moveSezToZeroRated } from './gstr3b.ts';
import { rcmItcForPeriod } from './rcm.ts';
import {
  DOC_ISSUE_NATURE,
  DOC_NATURE_LABEL,
  GST_TYPES,
  QUARTERS,
  advanceReceiptsOf,
  belongsToProfile,
  billIsInterstate,
  exportSection,
  getTaxableAmount,
  incomeAsBills,
  isDebitNote,
  isPurchaseBill,
  itc180ForPeriod,
  itcTable4,
  nilExemptSummary,
  periodBounds,
  rcmBillsOf,
  sezSupplies,
  unregisteredInterRows,
  withChargeLines,
  withoutNonTaxable,
} from './gstReturnTables.js';

const computeItemTaxSplit = splitLineTax;
const round2 = (n) => Math.round(n * 100) / 100;
const INUM_REGEX = /^[A-Za-z0-9\-/]{1,16}$/;

/**
 * The period: `{ mode: 'month', year, month }` (month 0-11), `{ mode: 'quarter', year, quarter: 'Q1'..'Q4' }` or
 * `{ mode: 'fy', fy: { value, from, to } }`.
 */
export function returnPeriodOf(period) {
  if (period.mode === 'month') return String(parseInt(period.month) + 1).padStart(2, '0') + period.year;
  if (period.mode === 'quarter') {
    const q = QUARTERS.find((x) => x.id === period.quarter);
    const lastMonth = q ? q.months[q.months.length - 1] : 2;
    return String(lastMonth + 1).padStart(2, '0') + period.year;
  }
  return period.fy ? `03${period.fy.to.slice(0, 4)}` : getFilingPeriod(new Date().toISOString());
}

/** A period from a portal return period: monthly, or the quarter ending in that month (QRMP). */
export function periodOfReturn(retPeriod, quarterly = false) {
  const month = Number(retPeriod.slice(0, 2)) - 1;
  const year = Number(retPeriod.slice(2));
  if (!quarterly) return { mode: 'month', year, month };
  const q = QUARTERS.find((x) => x.months[x.months.length - 1] === month);
  return { mode: 'quarter', year, quarter: q ? q.id : 'Q1' };
}

/**
 * Every GST table of the period. `docs` = { profile, bills, purchases, expenses, receipts, otherIncome } as the
 * workspace stores them (all of the business's records; this keeps the ones of `profile`); `customUnits` are the
 * business's own units (for the HSN table's UQC).
 */
export function gstReturnsModel(docs, period, { customUnits = [] } = {}) {
  const profile = docs.profile || {};
  // loadData: one GSTIN's documents, cancelled invoices apart, charges as lines, other income that is a supply as bills.
  const income = (docs.otherIncome || []).filter((r) => belongsToProfile(r, profile));
  const bills = [
    ...(docs.bills || []).filter((bill) => belongsToProfile(bill, profile) && !isCancelledBill(bill)).map(withChargeLines),
    ...incomeAsBills(income, profile || {}),
  ];
  const cancelledBills = (docs.bills || []).filter((bill) => belongsToProfile(bill, profile) && isCancelledBill(bill));
  const expenses = (docs.expenses || []).filter((r) => belongsToProfile(r, profile));
  const purchaseDocs = (docs.purchases || []).filter((r) => belongsToProfile(r, profile));
  const purchases = purchaseDocs.filter(isPurchaseBill);
  const debitNotes = purchaseDocs.filter(isDebitNote);
  const receipts = (docs.receipts || []).filter((r) => belongsToProfile(r, profile));
  const advanceReceipts = advanceReceiptsOf(receipts);
  const hsnUqc = (item) => engineHsnUqc(item, customUnits);

  // ========== Period filtering ==========
  const filterByPeriod = (date) => {
    if (!date) return false;
    if (period.mode === 'fy') {
      const fy = period.fy;
      return fy ? date >= fy.from && date <= fy.to : true;
    } else if (period.mode === 'quarter') {
      const d = parseLocalDate(date);
      const q = QUARTERS.find((x) => x.id === period.quarter);
      if (!q) return false;
      return q.months.includes(d.getMonth()) && d.getFullYear() === parseInt(period.year);
    }
    const d = parseLocalDate(date);
    return d.getFullYear() === parseInt(period.year) && d.getMonth() === parseInt(period.month);
  };
  const getReturnPeriod = () => returnPeriodOf(period);

  const filteredBills = bills
    .filter((bill) => {
      const type = bill.invoiceType || 'tax-invoice';
      if (!GST_TYPES.includes(type)) return false;
      if (!bill.data) return false;
      return filterByPeriod(bill.invoiceDate);
    })
    .map((bill) => withoutNonTaxable(bill, (item, b) => computeItemTaxSplit(item, billIsInterstate(b), !!b.data?.taxInclusive, false)));
  const allFilteredBills = bills.filter((bill) => bill.data && filterByPeriod(bill.invoiceDate));
  const cancelledInPeriod = cancelledBills.filter((bill) => bill.data && filterByPeriod(bill.invoiceDate));
  const filteredExpenses = expenses.filter((exp) => filterByPeriod(exp.date));

  // ========== Classification ==========
  const creditNotes = filteredBills.filter((b) => (b.invoiceType || 'tax-invoice') === 'credit-note');
  const regularBills = filteredBills.filter((b) => (b.invoiceType || 'tax-invoice') !== 'credit-note');
  const hsnSign = (bill) => ((bill.invoiceType || 'tax-invoice') === 'credit-note' ? -1 : 1);
  // Exports: kept out of B2B / B2C and 3.1(a), counted in 3.1(b), and flagged for Table 6A.
  const isExportBill = (bill) => {
    const country = String(bill.data?.client?.country || '').trim();
    return (bill.data?.profile?.country || 'India') === 'India'
      && !!country && country !== 'India'
      && !getStateCode(String(bill.data?.details?.placeOfSupply || '').trim())
      && bill.data?.totals?.isInterstate !== false;
  };
  const exportBills = regularBills.filter(isExportBill);
  const b2bRegular = regularBills.filter((b) => b.data?.client?.gstin && !isExportBill(b) && !b._kindOnly);
  const b2cRegular = regularBills.filter((b) => !b.data?.client?.gstin && !isExportBill(b) && !b._kindOnly);
  const b2cLarge = b2cRegular.filter((b) => billIsInterstate(b) && (b.totalAmount || 0) > b2clThreshold(b.invoiceDate));
  const b2cSmall = b2cRegular.filter((b) => !(billIsInterstate(b) && (b.totalAmount || 0) > b2clThreshold(b.invoiceDate)));
  const billIsIntraUT = (bill) => !!bill?.data?.totals?.isIntraUT;

  // ========== B2B Rows ==========
  const b2bRows = b2bRegular.map((bill) => {
    const { client, totals, details } = bill.data;
    const isInterState = billIsInterstate(bill);
    const pos = getStateCode(details?.placeOfSupply || client?.state || '');
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
  const b2cBills = b2cRegular;
  b2cBills.forEach((bill) => {
    const { items } = bill.data;
    const isInterState = billIsInterstate(bill);
    const isIntraUT = billIsIntraUT(bill);
    (items || []).forEach((item) => {
      const rate = item.taxPercent || 0;
      if (!b2cByRate[rate]) b2cByRate[rate] = { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 };
      const split = computeItemTaxSplit(item, isInterState, !!bill.data?.taxInclusive, isIntraUT);
      b2cByRate[rate].taxable += split.taxable;
      b2cByRate[rate].cgst += split.cgst;
      b2cByRate[rate].sgst += split.sgst + split.utgst;
      b2cByRate[rate].igst += split.igst;
      b2cByRate[rate].cess += split.cess;
      b2cByRate[rate].total += split.taxable + split.cgst + split.sgst + split.utgst + split.igst + split.cess;
    });
  });
  const b2cRates = Object.keys(b2cByRate).map(Number).sort((a, b) => a - b);
  const b2cPos = (bill) => getStateCode(bill.data?.details?.placeOfSupply || bill.data?.client?.state || bill.data?.profile?.state || '');
  const b2cTable7 = (() => {
    const rows = {};
    b2cSmall.forEach((bill) => {
      const isInter = billIsInterstate(bill);
      const isIntraUT = billIsIntraUT(bill);
      const pos = b2cPos(bill);
      (bill.data.items || []).forEach((item) => {
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
  const hsnMap = {};
  filteredBills.forEach((bill) => {
    const { items } = bill.data;
    const isInterState = billIsInterstate(bill);
    const isIntraUT = billIsIntraUT(bill);
    (items || []).forEach((item) => {
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
    total: b2bTotals.total + b2cTotals.total - cnTotals.total,
    cnTotals,
  };

  // ========== GSTR-3B ==========
  const exportTotals = exportBills.reduce((acc, b) => {
    const t = b.data?.totals || {};
    return { taxable: acc.taxable + getTaxableAmount(t), igst: acc.igst + (t.igst || 0), cess: acc.cess + (t.cess || 0) };
  }, { taxable: 0, igst: 0, cess: 0 });
  const nilExempt = nilExemptSummary(allFilteredBills, {
    isInter: billIsInterstate,
    split: (item, bill) => computeItemTaxSplit(item, billIsInterstate(bill), !!bill.data?.taxInclusive, false),
  });
  const filteredPurchases = purchases.filter((p) => filterByPeriod(p.date));
  const filteredDebitNotes = debitNotes.filter((p) => filterByPeriod(p.date));
  const currentPeriod = (() => {
    if (period.mode === 'fy') return period.fy ? periodBounds('fy', period.fy) : null;
    if (period.mode === 'quarter') {
      const q = QUARTERS.find((x) => x.id === period.quarter);
      return q ? periodBounds('quarter', { year: parseInt(period.year), months: q.months }) : null;
    }
    return period.year && period.month !== '' && period.month !== undefined
      ? periodBounds('month', { year: parseInt(period.year), month: parseInt(period.month) })
      : null;
  })();
  const bizStateCode = getStateCode(profile.gstin || '') || getStateCode(profile.state || '');
  const itc180 = itc180ForPeriod(purchases, filterByPeriod);
  const rcm = currentPeriod ? rcmItcForPeriod(rcmBillsOf(purchases), currentPeriod) : null;
  const table4 = itcTable4({
    purchases: [...filteredPurchases, ...filteredDebitNotes],
    expenses: filteredExpenses,
    itc180: itc180.reversals.length || itc180.reclaims.length ? itc180 : null,
    rcm,
  });
  const itcCessFromPurchases = table4.avl.oth.cess;
  const itcFromExpenses = { cgst: table4.net.cgst, sgst: table4.net.sgst, igst: table4.net.igst };
  const itcAvailable4A = {
    igst: table4.avl.impg.igst + table4.avl.imps.igst + table4.avl.isrc.igst + table4.avl.oth.igst,
    cgst: table4.avl.isrc.cgst + table4.avl.oth.cgst,
    sgst: table4.avl.isrc.sgst + table4.avl.oth.sgst,
  };
  const advances = currentPeriod
    ? table11({ receipts: advanceReceipts, ...currentPeriod, bizState: bizStateCode })
    : { at: [], txpd: [], net: { taxable: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 } };
  const sez31 = moveSezToZeroRated(withAdvanceTax(grandTotals, advances), exportTotals, sezSupplies([...regularBills, ...creditNotes]));
  const supplies31a = sez31.a;
  const zeroRated31b = sez31.b;
  const unreg32 = interStateUnregistered(unregisteredInterRows([...regularBills, ...creditNotes]));
  const inward5 = exemptInward(filteredPurchases.filter(isPurchaseBill));
  const exempt31c = nilExempt.nilExempt;
  const nonGst31e = nilExempt.nonGst;
  const outputTax = { cgst: supplies31a.cgst, sgst: supplies31a.sgst, igst: supplies31a.igst + zeroRated31b.igst };
  const setOff = setOffITC(outputTax, itcFromExpenses);
  const netTax = setOff.payable;
  const itcCarry = setOff.carry;
  const hasCarry = itcCarry.igst + itcCarry.cgst + itcCarry.sgst > 0;

  // ========== Document Summary (Table 13) ==========
  const docSummary = {};
  const trailingNo = (n) => Number((String(n).match(/(\d+)\s*$/) || [])[1] || 0);
  [...allFilteredBills, ...cancelledInPeriod].forEach((bill) => {
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

  // ========== Validation Warnings (shown on the screen) ==========
  const warnings = [];
  filteredBills.forEach((bill) => {
    const { client, items } = bill.data;
    if (client?.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][A-Z\d]$/.test(client.gstin)) {
      warnings.push({ type: 'error', msg: `Invoice ${bill.invoiceNumber}: Invalid client GSTIN format — ${client.gstin}` });
    }
    (items || []).forEach((item) => {
      if (!item.hsn || item.hsn === 'N/A') {
        warnings.push({ type: 'warning', msg: `Invoice ${bill.invoiceNumber}: Item "${item.name || 'Unnamed'}" has no HSN/SAC code` });
      }
    });
    if (client?.gstin && !client?.state) {
      warnings.push({ type: 'warning', msg: `Invoice ${bill.invoiceNumber}: Client ${client.name} has GSTIN but no State — Place of Supply may be wrong` });
    }
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
  if (exportBills.length > 0) {
    const listed = exportBills.slice(0, 3).map((b) => b.invoiceNumber).join(', ') + (exportBills.length > 3 ? ', …' : '');
    warnings.unshift({ type: 'error', msg: `${exportBills.length} export invoice(s) (${listed}) are not in the GSTR-1 file. Add them in Table 6A on the GST portal with the shipping bill details — their value is in GSTR-3B 3.1(b).` });
  }

  // ========== GSTR-1 pre-flight ==========
  const validateGSTR1 = (list) => {
    const blocked = [];
    const preflight = [];
    if (!profile.gstin) blocked.push('Your business has no GSTIN. Add it in Settings → Business.');
    else if (!gstinChecksumOk(profile.gstin)) blocked.push(`Your business GSTIN ${profile.gstin} is not valid (check digit fails).`);
    const badClientGstin = [...new Set(list.filter((b) => b.data?.client?.gstin && !gstinChecksumOk(b.data.client.gstin)).map((b) => `${b.data.client.name || b.clientName} (${b.data.client.gstin})`))];
    if (badClientGstin.length > 0) blocked.push(`${badClientGstin.length} client GSTIN(s) are not valid: ${badClientGstin.slice(0, 3).join(', ')}`);
    const aatoAbove5Cr = !!profile.aatoAbove5Cr;
    const minHsnDigits = aatoAbove5Cr ? 6 : 4;
    const badInums = list.filter((b) => !INUM_REGEX.test(b.invoiceNumber || ''));
    if (badInums.length > 0) {
      blocked.push(`${badInums.length} invoice number(s) violate portal rules (≤16 chars, only letters, digits, "-" or "/"). First: ${badInums.slice(0, 3).map((b) => b.invoiceNumber).join(', ')}`);
    }
    const badRates = new Set();
    let badRateItemCount = 0;
    list.forEach((bill) => {
      (bill.data?.items || []).forEach((item) => {
        const rate = Number(item.taxPercent) || 0;
        if (!GST_PORTAL_RATES.includes(rate)) {
          badRates.add(rate);
          badRateItemCount += 1;
        }
      });
    });
    if (badRateItemCount > 0) {
      blocked.push(`${badRateItemCount} item(s) use non-standard tax rate(s) [${Array.from(badRates).sort().join(', ')}%]. Portal accepts only ${GST_PORTAL_RATES.join(', ')}%.`);
    }
    let missingHsnItemCount = 0;
    let shortHsnItemCount = 0;
    list.forEach((bill) => {
      (bill.data?.items || []).forEach((item) => {
        const hsn = String(item.hsn || '').trim();
        if (!hsn || hsn === 'N/A') missingHsnItemCount += 1;
        else if (hsn.replace(/\D/g, '').length < minHsnDigits) shortHsnItemCount += 1;
      });
    });
    if (missingHsnItemCount > 0) {
      preflight.push(`${missingHsnItemCount} item(s) have no HSN — dropped from HSN summary. GSTR-1 Table 12 requires an HSN per item.`);
    }
    if (shortHsnItemCount > 0) {
      preflight.push(`${shortHsnItemCount} item(s) have HSN shorter than ${minHsnDigits} digits (required for ${aatoAbove5Cr ? '>' : '≤'}₹5 Cr AATO). Portal may reject.`);
    }
    return { blocked, warnings: preflight };
  };

  // ========== GSTR-1 JSON (GSTN offline-tool format) ==========
  /** { empty } when there is nothing to report, { blocked } when the portal would refuse the file, else { json, warnings }. */
  const buildGstr1 = () => {
    if (filteredBills.length === 0 && nilExempt.total === 0) return { empty: true, blocked: [], warnings: [], json: null };
    const { blocked, warnings: preflight } = validateGSTR1(filteredBills);
    if (blocked.length > 0) return { blocked, warnings: preflight, json: null };
    const gstin = profile.gstin || '';
    const fp = getReturnPeriod();

    const b2bMap = {};
    b2bRegular.forEach((bill) => {
      const { client, totals, items, details } = bill.data;
      const ctin = client.gstin;
      if (!b2bMap[ctin]) b2bMap[ctin] = { ctin, inv: [] };
      const isInter = billIsInterstate(bill);
      const isIntraUT = billIsIntraUT(bill);
      const isRcm = !!bill.data?.invoiceOptions?.reverseCharge;
      const pos = getStateCode(details?.placeOfSupply || client?.state || '');
      const rateMap = {};
      (items || []).forEach((item) => {
        const rate = item.taxPercent || 0;
        if (!rateMap[rate]) rateMap[rate] = { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
        const split = computeItemTaxSplit(item, isInter, !!bill.data?.taxInclusive, isIntraUT);
        rateMap[rate].txval += split.taxable;
        rateMap[rate].iamt += split.igst;
        rateMap[rate].camt += split.cgst;
        rateMap[rate].samt += split.sgst + split.utgst;
        rateMap[rate].csamt += split.cess;
      });
      const rchrg = isRcm ? 'Y' : 'N';
      const isSEZ = !!client?.isSEZ;
      const isLUT = !!bill.data?.invoiceOptions?.isLUT
        || /\bLUT\b|Letter of Undertaking/i.test(bill.data?.customTerms || '');
      const invType = isRcm ? 'R' : (isSEZ ? (isLUT ? 'SEWOP' : 'SEWP') : 'R');
      const rateTotal = Object.values(rateMap).reduce((s, d) => s + d.txval + d.iamt + d.camt + d.samt + d.csamt, 0);
      const val = isRcm ? round2(rateTotal) : round2((totals?.total || 0) - (totals?.roundOff || 0));
      b2bMap[ctin].inv.push({
        inum: bill.invoiceNumber, idt: formatDateGST(bill.invoiceDate), val, pos, rchrg, inv_typ: invType,
        itms: Object.entries(rateMap).map(([rt, d], i) => ({ num: i + 1, itm_det: { rt: Number(rt), txval: round2(d.txval), iamt: round2(d.iamt), camt: round2(d.camt), samt: round2(d.samt), csamt: round2(d.csamt) } })),
      });
    });

    const b2csMap = {};
    b2cSmall.forEach((bill) => {
      const { profile: prof, client, items, details } = bill.data;
      const isInter = billIsInterstate(bill);
      const isIntraUT = billIsIntraUT(bill);
      const pos = getStateCode(details?.placeOfSupply || client?.state || prof?.state || '');
      const splyTy = isInter ? 'INTER' : 'INTRA';
      (items || []).forEach((item) => {
        const rate = item.taxPercent || 0; const key = `${splyTy}_${pos}_${rate}`;
        if (!b2csMap[key]) b2csMap[key] = { sply_ty: splyTy, pos, rt: rate, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
        const split = computeItemTaxSplit(item, isInter, !!bill.data?.taxInclusive, isIntraUT);
        b2csMap[key].txval += split.taxable;
        b2csMap[key].iamt += split.igst;
        b2csMap[key].camt += split.cgst;
        b2csMap[key].samt += split.sgst + split.utgst;
        b2csMap[key].csamt += split.cess;
      });
    });
    const b2csArr = Object.values(b2csMap).map((d) => ({ ...d, txval: round2(d.txval), iamt: round2(d.iamt), camt: round2(d.camt), samt: round2(d.samt), csamt: round2(d.csamt) }));

    const b2clMap = {};
    b2cLarge.forEach((bill) => {
      const { client, totals, items, details } = bill.data;
      const pos = getStateCode(details?.placeOfSupply || client?.state || '');
      if (!b2clMap[pos]) b2clMap[pos] = { pos, inv: [] };
      const rateMap = {};
      (items || []).forEach((item) => {
        const rate = item.taxPercent || 0; if (!rateMap[rate]) rateMap[rate] = { txval: 0, iamt: 0, csamt: 0 };
        const split = computeItemTaxSplit(item, true, !!bill.data?.taxInclusive);
        rateMap[rate].txval += split.taxable; rateMap[rate].iamt += split.igst;
        rateMap[rate].csamt += split.cess;
      });
      b2clMap[pos].inv.push({ inum: bill.invoiceNumber, idt: formatDateGST(bill.invoiceDate), val: round2(totals?.total || 0), itms: Object.entries(rateMap).map(([rt, d], i) => ({ num: i + 1, itm_det: { rt: Number(rt), txval: round2(d.txval), iamt: round2(d.iamt), csamt: round2(d.csamt) } })) });
    });

    const cdnrMap = {};
    creditNotes.filter((b) => b.data?.client?.gstin).forEach((bill) => {
      const { client, totals, items, details } = bill.data;
      const ctin = client.gstin; if (!cdnrMap[ctin]) cdnrMap[ctin] = { ctin, nt: [] };
      const isInter = billIsInterstate(bill);
      const pos = getStateCode(details?.placeOfSupply || client?.state || '');
      const rateMap = {};
      (items || []).forEach((item) => {
        const rate = item.taxPercent || 0; if (!rateMap[rate]) rateMap[rate] = { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
        const split = computeItemTaxSplit(item, isInter, !!bill.data?.taxInclusive, billIsIntraUT(bill));
        rateMap[rate].txval += split.taxable; rateMap[rate].iamt += split.igst; rateMap[rate].camt += split.cgst; rateMap[rate].samt += split.sgst + split.utgst;
        rateMap[rate].csamt += split.cess;
      });
      const rchrg = bill.data?.invoiceOptions?.reverseCharge ? 'Y' : 'N';
      const isSEZ = !!client?.isSEZ;
      const isLUT = /LUT|Letter of Undertaking|zero.?rated/i.test(bill.data?.customTerms || '') || !!bill.data?.invoiceOptions?.isLUT;
      const invType = isSEZ ? (isLUT ? 'SEWOP' : 'SEWP') : 'R';
      cdnrMap[ctin].nt.push({ ntty: 'C', nt_num: bill.invoiceNumber, nt_dt: formatDateGST(bill.invoiceDate), val: round2(totals?.total || 0), pos, rchrg, inv_typ: invType,
        itms: Object.entries(rateMap).map(([rt, d], i) => ({ num: i + 1, itm_det: { rt: Number(rt), txval: round2(d.txval), iamt: round2(d.iamt), camt: round2(d.camt), samt: round2(d.samt), csamt: round2(d.csamt) } })) });
    });

    const hsnJsonMap = {};
    let unknownUnitCount = 0;
    filteredBills.forEach((bill) => {
      const { items } = bill.data;
      const isInter = billIsInterstate(bill);
      const isIntraUT = billIsIntraUT(bill);
      (items || []).forEach((item) => {
        const hsnRaw = String(item.hsn || '').trim();
        if (!hsnRaw || hsnRaw === 'N/A') return;
        const hsn = hsnRaw;
        const uqc = hsnUqc(item);
        const rate = item.taxPercent || 0; const key = `${hsn}_${rate}_${uqc}`;
        if (uqc === 'OTH' && item.unit) unknownUnitCount += 1;
        if (!hsnJsonMap[key]) hsnJsonMap[key] = { hsn_sc: hsn, desc: item.name || '', uqc, qty: 0, rt: rate, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
        const split = computeItemTaxSplit(item, isInter, !!bill.data?.taxInclusive, isIntraUT);
        const sign = hsnSign(bill);
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
    const gt = Number(profile?.prevFYTurnover) || 0;
    const cur_gt = Number(profile?.currentFYTurnover) || 0;
    const gstr1 = {
      gstin, fp, gt, cur_gt,
      version: 'GST3.1.6',
      hash: 'hash',
      b2b: Object.values(b2bMap), b2cs: b2csArr,
      ...(Object.keys(b2clMap).length > 0 ? { b2cl: Object.values(b2clMap) } : {}),
      ...(Object.keys(cdnrMap).length > 0 ? { cdnr: Object.values(cdnrMap) } : {}),
      ...(exportBills.length > 0 ? { exp: exportSection(exportBills, { split: (item, bill) => computeItemTaxSplit(item, true, !!bill.data?.taxInclusive), fmtDate: formatDateGST }) } : {}),
      ...(nilExempt.inv.length > 0 ? { nil: { inv: nilExempt.inv } } : {}),
      hsn: { data: Object.values(hsnJsonMap).map((r, i) => ({ num: i + 1, ...r, qty: roundQty(r.qty, 2), txval: round2(r.txval), iamt: round2(r.iamt), camt: round2(r.camt), samt: round2(r.samt), csamt: round2(r.csamt) })) },
      doc_issue: { doc_det: docDet },
      ...table11Json(advances),
    };
    const postWarnings = [...preflight];
    if (unknownUnitCount > 0) postWarnings.push(`${unknownUnitCount} item(s) used a custom unit and were exported as UQC 'OTH'.`);
    return { json: gstr1, blocked: [], warnings: postWarnings };
  };

  // ========== GSTR-3B JSON (GSTN offline-tool format) ==========
  /** null when the period has nothing to report. */
  const buildGstr3b = () => {
    if (filteredBills.length === 0 && filteredExpenses.length === 0 && nilExempt.total === 0 && exempt31c === 0 && supplies31a.taxable === 0) return null;
    const gstin = profile.gstin || '';
    const ret_period = getReturnPeriod();
    const sup_details = {
      osup_det: {
        txval: round2(supplies31a.taxable),
        iamt: round2(supplies31a.igst),
        camt: round2(supplies31a.cgst),
        samt: round2(supplies31a.sgst),
        csamt: round2(supplies31a.cess),
      },
      osup_zero: { txval: round2(zeroRated31b.taxable), iamt: round2(zeroRated31b.igst), csamt: round2(zeroRated31b.cess) },
      osup_nil_exmp: { txval: exempt31c },
      isup_rev: (() => {
        const rcmPurchases = filteredPurchases.filter((p) => !!p.reverseCharge);
        if (rcmPurchases.length === 0) return { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
        const t = rcmPurchases.reduce((acc, p) => ({
          txval: acc.txval + (Number(p.taxableAmount) || 0),
          iamt: acc.iamt + (p.interstate ? (Number(p.totalTax) || 0) : 0),
          camt: acc.camt + (p.interstate ? 0 : (Number(p.totalTax) || 0) / 2),
          samt: acc.samt + (p.interstate ? 0 : (Number(p.totalTax) || 0) / 2),
          csamt: acc.csamt + (Number(p.totalCess) || purchaseBookTotalsCess(p)),
        }), { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
        return { txval: round2(t.txval), iamt: round2(t.iamt), camt: round2(t.camt), samt: round2(t.samt), csamt: round2(t.csamt) };
      })(),
      osup_nongst: { txval: round2(nonGst31e) },
    };
    const itc_elg = {
      itc_avl: [
        { ty: 'IMPG', iamt: round2(table4.avl.impg.igst), camt: 0, samt: 0, csamt: round2(table4.avl.impg.cess) },
        { ty: 'IMPS', iamt: round2(table4.avl.imps.igst), camt: 0, samt: 0, csamt: round2(table4.avl.imps.cess) },
        { ty: 'ISRC', iamt: round2(table4.avl.isrc.igst), camt: round2(table4.avl.isrc.cgst), samt: round2(table4.avl.isrc.sgst), csamt: round2(table4.avl.isrc.cess) },
        { ty: 'ISD', iamt: 0, camt: 0, samt: 0, csamt: 0 },
        { ty: 'OTH',
          iamt: round2(table4.avl.oth.igst),
          camt: round2(table4.avl.oth.cgst),
          samt: round2(table4.avl.oth.sgst),
          csamt: round2(itcCessFromPurchases),
        },
      ],
      ...(table4.reversed ? {
        itc_rev: [
          { ty: 'RUL', iamt: round2(table4.rev.rul.igst), camt: round2(table4.rev.rul.cgst), samt: round2(table4.rev.rul.sgst), csamt: round2(table4.rev.rul.cess) },
          { ty: 'OTH', iamt: round2(table4.rev.oth.igst), camt: round2(table4.rev.oth.cgst), samt: round2(table4.rev.oth.sgst), csamt: round2(table4.rev.oth.cess) },
        ],
        itc_net: { iamt: round2(table4.net.igst), camt: round2(table4.net.cgst), samt: round2(table4.net.sgst), csamt: round2(table4.net.cess) },
      } : {}),
      itc_inelg: [
        { ty: 'RUL', iamt: 0, camt: 0, samt: 0, csamt: 0 },
        { ty: 'OTH', iamt: 0, camt: 0, samt: 0, csamt: 0 },
      ],
    };
    const inward_sup = {
      isup_details: [
        { ty: 'GST', inter: round2(inward5.gst.inter), intra: round2(inward5.gst.intra) },
        { ty: 'NONGST', inter: round2(inward5.nongst.inter), intra: round2(inward5.nongst.intra) },
      ],
    };
    const inter_sup = unreg32.length ? { inter_sup: { unreg_details: unreg32, comp_details: [], uin_details: [] } } : {};
    return {
      gstin, ret_period,
      version: 'GST3.0.4',
      hash: 'hash',
      sup_details, ...inter_sup, itc_elg, inward_sup,
    };
  };

  return {
    profile, bills, cancelledBills, expenses, purchases, debitNotes, receipts, advanceReceipts,
    filterByPeriod, getReturnPeriod,
    filteredBills, allFilteredBills, cancelledInPeriod, filteredExpenses,
    creditNotes, regularBills, exportBills, b2bRegular, b2cRegular, b2cLarge, b2cSmall, isExportBill, billIsIntraUT, hsnSign, b2cPos,
    b2bRows, b2cByRate, b2cBills, b2cRates, b2cTable7, hsnRows, b2bTotals, b2cTotals, cnTotals, grandTotals,
    exportTotals, nilExempt, filteredPurchases, filteredDebitNotes, currentPeriod, bizStateCode, itc180, rcm, table4,
    itcCessFromPurchases, itcFromExpenses, itcAvailable4A, advances, supplies31a, zeroRated31b, unreg32, inward5,
    exempt31c, nonGst31e, outputTax, setOff, netTax, itcCarry, hasCarry, docSummary, warnings,
    validateGSTR1, buildGstr1, buildGstr3b,
  };
}

// The cess on a purchase from its lines, for a reverse-charge bill saved without totalCess (purchaseBookTotals.cess).
function purchaseBookTotalsCess(p) {
  return (p?.items || []).reduce((s, it) => s + ((Number(it.quantity) || 0) * (Number(it.rate) || 0) * (Number(it.cessPercent) || 0)) / 100, 0);
}

/** The period's GSTR-1 and GSTR-3B files from the documents: what the server and the screen both build. */
export function buildGstReturnFiles(docs, period, opts = {}) {
  const m = gstReturnsModel(docs, period, opts);
  return { gstr1: m.buildGstr1(), gstr3b: m.buildGstr3b(), warnings: m.warnings };
}
