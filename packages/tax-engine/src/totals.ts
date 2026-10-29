// Moved verbatim from apps/web/src/utils.js (Phase 0, change 0.7/0.8/0.9).
// Types are deliberately loose until the Zod contracts land in Phase 1 (change 1.13).

import type { Rec, Numeric } from './types.ts';
import { finiteNonNeg, r2, sum } from './money.ts';
import { resolveLineDiscount } from './lineTax.ts';
import { getStateCode, isUnionTerritoryWithoutLegislature } from './gstin.ts';
import { INVOICE_TYPES } from './invoiceTypes.ts';

// ============================================================================
// v1.10.1 — Pure invoice totals computation.
//
// Prior to this release, the totals math lived inside a giant `useEffect`
// in InvoiceGenerator.jsx (~120 lines). That made it impossible to
// unit-test and let several bugs go unnoticed for months:
//
//   • UTGST bucket never existed (audit C6). Intra-Chandigarh supplies
//     went into SGST instead of UTGST, breaking GSTR-1 filings.
//   • Interstate detection short-circuited to intra-state when the
//     business profile had no state saved (C5). Users on a fresh install
//     shipped invoices with wrong tax splits.
//   • RCM + tax-inclusive charged the buyer twice — once for the
//     embedded tax in the MRP, once for the RCM remittance (M5).
//   • TCS 206C(1H) computed on the pre-GST base, not the receipt
//     including GST as CBDT Circular 17/2020 requires (H6).
//   • ₹50 lakh annual per-counterparty threshold for TDS/TCS never
//     enforced — flat-rate applied from rupee one (H7).
//   • `totalTaxAmount` in saved bills omitted cess (M8).
//   • Non-numeric `rate` from CSV import produced `NaN` totals (M10).
//
// Extracting to a pure function fixes each of those. The React effect
// now just calls this and stores the result in state.
//
// @param opts {{
//   items: Array,            // line items with quantity, rate, discount, taxPercent, cessPercent
//   profile: object,         // { country, state, gstin, ... }
//   client: object,          // { state, isSEZ, gstin, ... }
//   details: object,         // { placeOfSupply, ... }
//   showGST: boolean,
//   taxInclusive?: boolean,
//   invoiceOptions?: {
//     reverseCharge?: boolean,
//     showRoundOff?: boolean,
//     showTDS?: boolean, tdsRate?: number, tdsCumulativeThisYear?: number,
//     showTCS?: boolean, tcsRate?: number, tcsCumulativeThisYear?: number,
//   },
// }}
// @returns totals object with { subtotal, totalDiscount, taxableAmount,
//   cgst, sgst, utgst, igst, cess, tcsAmount, tdsAmount, roundOff,
//   total, netReceivable, totalTaxAmount, warnings, needsProfileFix,
//   isInterstate, isUnionTerritory, taxInclusive }
// ============================================================================

// Section 194Q / 206C(1H) counterparty annual threshold — currently ₹50L.
// Both sections apply only to receipts above this cumulative amount per
// buyer / seller in a financial year.
export const TDS_TCS_THRESHOLD = 5_000_000;

export function computeInvoiceTotals(opts: Rec) {
  // v1.10.33 — Destructure defaults only fire on `undefined`, not `null`.
  // Callers that pass `profile: null` (e.g. InvoiceGenerator mounted
  // before the /api/profile fetch resolves) bypassed the `= {}` default
  // and blew up on `profile.country` reading null. Explicit `|| {}`
  // normalises both cases so the totals calc never crashes on cold load.
  const rawOpts = opts || {};
  const items = rawOpts.items || [];
  const profile = rawOpts.profile || {};
  const client = rawOpts.client || {};
  const details = rawOpts.details || {};
  const showGST = rawOpts.showGST !== false;
  const taxInclusive = !!rawOpts.taxInclusive;
  const invoiceOptions = rawOpts.invoiceOptions || {};

  const warnings = [];
  const isIndia = (profile.country || 'India') === 'India';

  // Per-line rounded values feed BOTH the invoice PDF and the GSTR-1
  // export so their totals agree. Prior code summed raw floats for one
  // and rounded per-line for the other → GSTN "amount_mismatch".
  const lines = items.map((item: Rec) => {
    const qty = finiteNonNeg(item.quantity);
    const rate = finiteNonNeg(item.rate);
    // v1.10.22 — read discount through resolveLineDiscount so percent-mode
    // items are computed correctly. Fixed-mode items behave identically.
    const disc = resolveLineDiscount(item, !showGST || taxInclusive);
    const taxPct = finiteNonNeg(item.taxPercent);
    const cessPct = finiteNonNeg(item.cessPercent);
    const gross = qty * rate;
    const afterDisc = Math.max(0, gross - disc);
    // v1.10.39 — Reported: clicking "Bill of Supply (No GST)" doesn't
    // remove GST from the total. Root cause: prior code computed
    // `taxable = afterDisc / (1 + taxPct / 100)` when tax-inclusive
    // AND `tax = taxable * taxPct / 100` UNCONDITIONALLY. Only `cess`
    // was gated on showGST. Result: switching to Bill of Supply left
    // line-level tax computed → summed into taxTotal → added to
    // igst/cgst/sgst → grand total inflated by the tax the invoice
    // type says isn't applicable. Now: showGST=false zeros the tax
    // AND treats the invoice as always tax-exclusive (taxable = full
    // afterDisc value), which is what a Bill of Supply / Delivery
    // Challan actually is.
    const applyTax = !!showGST;
    const taxable =
      applyTax && taxInclusive && taxPct > 0 ? afterDisc / (1 + taxPct / 100) : afterDisc;
    const tax = applyTax ? r2((taxable * taxPct) / 100) : 0;
    const cess = applyTax ? r2((taxable * cessPct) / 100) : 0;
    return { qty, rate, disc, taxPct, cessPct, gross, afterDisc, taxable: r2(taxable), tax, cess };
  });

  const subtotal = r2(sum(lines.map((l: Rec) => l.gross)));
  const totalDiscount = r2(sum(lines.map((l: Rec) => l.disc)));
  const taxableAmount = r2(sum(lines.map((l: Rec) => l.taxable)));
  const taxTotal = r2(sum(lines.map((l: Rec) => l.tax)));
  const cessTotal = r2(sum(lines.map((l: Rec) => l.cess)));

  // Place of supply / interstate detection.
  const businessState = (profile.state || '').trim();
  const clientState = (client.state || '').trim();
  const placeOfSupplyRaw = (details.placeOfSupply || clientState || '').trim();
  const businessCode = getStateCode(businessState || profile.gstin);
  const posCode = getStateCode(placeOfSupplyRaw || client.gstin);
  const isSEZ = !!client.isSEZ;

  // v1.10.1 — Explicit blank-business-state guard. Prior code let this
  // silently fall through to intra-state (undefined !== 'X' is true but
  // then compared against clientState.toLowerCase() which for blank
  // gives false → isInterstate=false wrongly). Now surface a warning
  // and set a needsProfileFix flag so the UI can block save.
  let needsProfileFix = false;
  if (isIndia && showGST && !businessState) {
    warnings.push(
      'Your business state is not set. Interstate/intra-state detection cannot be trusted. Set it in Settings → Company Details before issuing GST invoices.',
    );
    needsProfileFix = true;
  }
  // v1.10.66 (#61) — a client outside India makes this an export, and an
  // export's place of supply is outside India, so any tax charged is IGST —
  // never CGST + SGST. The CLIENT'S COUNTRY decides it, not the currency: an
  // Indian client can be billed in USD without the supply leaving the state.
  // An explicit Indian place of supply (goods delivered here for a foreign
  // buyer) still wins, so that case follows the normal state comparison.
  const clientCountry = (client.country || '').trim();
  const isExportClient =
    isIndia &&
    !!clientCountry &&
    clientCountry !== 'India' &&
    !getStateCode((details.placeOfSupply || '').trim());

  if (isIndia && showGST && !placeOfSupplyRaw && !isExportClient) {
    warnings.push('Place of supply is not set. Falling back to client state.');
  }

  const isInterstate =
    isIndia &&
    (isSEZ || isExportClient || (!!businessCode && !!posCode && businessCode !== posCode));

  // UTGST for intra-UT supplies. When supplier & recipient are BOTH in
  // one of the 5 UTs without legislature, and it's intra-state (same
  // code), CGST + UTGST applies. Otherwise → CGST + SGST or IGST.
  const isIntraUT =
    isIndia &&
    !isInterstate &&
    !!businessCode &&
    businessCode === posCode &&
    isUnionTerritoryWithoutLegislature(businessCode);

  const half = r2(taxTotal / 2);
  const cgst = isIndia && !isInterstate ? half : 0;
  const sgst = isIndia && !isInterstate && !isIntraUT ? half : 0;
  const utgst = isIndia && isIntraUT ? half : 0;
  const igst = isIndia ? (isInterstate ? taxTotal : 0) : taxTotal;

  // RCM handling. Under Section 9(3)/9(4), the SUPPLIER doesn't collect
  // tax — the buyer remits it directly. Invoice total should be
  // taxable value only (or MRP-taxable for inclusive mode).
  const isReverseCharge = !!invoiceOptions.reverseCharge && !!showGST;

  // v1.10.1 — RCM + tax-inclusive fix. Prior code used
  // `subtotal - totalDiscount` for baseTotal, which for tax-inclusive
  // rates is the MRP (includes tax) → buyer paid MRP to seller AND paid
  // tax to govt under RCM = double tax. Now: back out embedded tax so
  // baseTotal = taxable value only.
  const baseTotal = isReverseCharge
    ? taxableAmount
    : taxInclusive && showGST
      ? subtotal - totalDiscount
      : taxableAmount + taxTotal;

  // v1.10.1 — TDS 194Q / TCS 206C(1H): correct BASE and enforce the
  // ₹50L threshold.
  //
  // Section 206C(1H) requires TCS on the *receipt including GST* per
  // CBDT Circular 17/2020. Prior code used pre-GST subtotal.
  // Section 194Q is the buyer-side mirror (deducted by buyer) — the
  // seller shouldn't collect it, so we treat it as INFORMATION-ONLY on
  // the invoice (doesn't change total).
  //
  // Threshold: neither section applies until the running annual
  // cumulative for this counterparty exceeds ₹50L. Caller passes
  // `tcsCumulativeThisYear` / `tdsCumulativeThisYear` (from a per-
  // client running total maintained in the Clients module).
  //
  // The ₹50L threshold belongs to 194Q and 206C(1H) only. Other sections
  // (194C, 194J, 194I, 194H, 194O, 195, CGST 52, 206C(1)) have their own small
  // thresholds or none, and the user ticks TDS/TCS when it applies, so they
  // are worked out from rupee one. Applying ₹50L to them made TDS 0 on every
  // ordinary 194J invoice. No section given = the threshold sections (their
  // defaults), which keeps older saved invoices computing as before.
  const tcsThresholded = !invoiceOptions.tcsSection || invoiceOptions.tcsSection === '206C(1H)';
  const tdsThresholded = !invoiceOptions.tdsSection || invoiceOptions.tdsSection === '194Q';
  const tcsCumBefore = tcsThresholded
    ? Number(invoiceOptions.tcsCumulativeThisYear) || 0
    : Infinity;
  const tdsCumBefore = tdsThresholded
    ? Number(invoiceOptions.tdsCumulativeThisYear) || 0
    : Infinity;

  // The base at portal-facing gross (including GST).
  const receiptIncludingGst = r2(taxableAmount + taxTotal + cessTotal);
  // Which amount each section is worked out on:
  //   • TCS 206C(1H) / 206C(1): the amount received, GST included
  //     (CBDT Circular 17/2020).
  //   • TCS under CGST section 52: the net taxable value, without GST.
  //   • TDS (194C, 194J, 194I, 194H, 194O, 194Q...): the value WITHOUT GST
  //     when the invoice shows GST separately (CBDT Circular 23/2017; for
  //     194Q, Circular 13/2021). It used to be worked out on the amount with
  //     GST, overstating TDS by the GST rate (₹11,800 instead of ₹10,000 on a
  //     ₹1,00,000 + 18% invoice at 10%).
  const tcsBase = invoiceOptions.tcsSection === '52' ? taxableAmount : receiptIncludingGst;
  const tdsBase = taxableAmount;

  // Portion of THIS invoice that sits above the ₹50L threshold. If the
  // cumulative was already ≥ threshold, whole invoice is taxable. If
  // it was below, only the excess portion attracts TCS.
  const marginalTcsBase =
    tcsCumBefore >= TDS_TCS_THRESHOLD
      ? tcsBase
      : Math.max(0, tcsCumBefore + tcsBase - TDS_TCS_THRESHOLD);
  const marginalTdsBase =
    tdsCumBefore >= TDS_TCS_THRESHOLD
      ? tdsBase
      : Math.max(0, tdsCumBefore + tdsBase - TDS_TCS_THRESHOLD);

  const tcsRate = Number(invoiceOptions.tcsRate) || 0;
  const tdsRate = Number(invoiceOptions.tdsRate) || 0;
  const tcsAmount =
    invoiceOptions.showTCS && tcsRate > 0 ? r2((marginalTcsBase * tcsRate) / 100) : 0;
  const tdsAmount =
    invoiceOptions.showTDS && tdsRate > 0 ? r2((marginalTdsBase * tdsRate) / 100) : 0;

  // v1.10.22 — invoice-level (whole-bill) discount. Treated as a cash
  // discount / trade allowance: subtracted from the post-tax total.
  // Doesn't affect taxable value or the GSTR-1 payload. Users who need
  // pre-tax GST-compliant discount should use per-line discount instead.
  const invDiscValue = finiteNonNeg(invoiceOptions.invoiceDiscountValue);
  const invDiscType = invoiceOptions.invoiceDiscountType === 'percent' ? 'percent' : 'fixed';
  // v1.10.31 — GST-C4: cess is also subject to RCM under §8(2) of the GST
  // Compensation Cess Act. Buyer remits it, so the seller must not collect
  // it on-invoice. Previously left in the total → buyer paid supplier's cess
  // AND remitted own → double payment.
  const cessOnInvoice = isReverseCharge ? 0 : cessTotal;
  const preInvDiscTotal = baseTotal + tcsAmount + cessOnInvoice;
  const invoiceDiscountAmount =
    invDiscType === 'percent'
      ? Math.min(preInvDiscTotal, r2((preInvDiscTotal * Math.min(invDiscValue, 100)) / 100))
      : Math.min(preInvDiscTotal, r2(invDiscValue));

  const totalBeforeRound = preInvDiscTotal - invoiceDiscountAmount;
  const roundOff = invoiceOptions.showRoundOff
    ? r2(Math.round(totalBeforeRound) - totalBeforeRound)
    : 0;
  const total = r2(totalBeforeRound + roundOff);

  // Under RCM, portal-facing tax breakdown still shows on the PDF
  // (buyer needs to know what to remit) but zeros are stored in the
  // payable total's cgst/sgst/igst.
  const zeroTaxOnTotals = isReverseCharge;

  // v1.10.1 — totalTaxAmount now includes cess AND UTGST. Prior calc
  // `cgst + sgst + igst` excluded both. Reports over-counted revenue
  // for tobacco/auto/coal sellers.
  // v1.10.31 — GST-C4: under RCM, cess is also zeroed for reporting.
  const totalTaxAmount = r2(
    (zeroTaxOnTotals ? 0 : cgst) +
      (zeroTaxOnTotals ? 0 : sgst) +
      (zeroTaxOnTotals ? 0 : utgst) +
      (zeroTaxOnTotals ? 0 : igst) +
      (zeroTaxOnTotals ? 0 : cessTotal),
  );

  const result: Rec = {
    // Base composition
    subtotal,
    totalDiscount,
    taxableAmount,
    // Tax breakdown
    cgst: zeroTaxOnTotals ? 0 : cgst,
    sgst: zeroTaxOnTotals ? 0 : sgst,
    utgst: zeroTaxOnTotals ? 0 : utgst,
    igst: zeroTaxOnTotals ? 0 : igst,
    cess: cessTotal,
    // Additions on top
    tcsAmount,
    tdsAmount,
    roundOff,
    // v1.10.22 — invoice-level (post-tax) discount amount + type + raw
    // value carried through so the preview / PDF can show its own line.
    invoiceDiscountAmount,
    invoiceDiscountType: invDiscType,
    invoiceDiscountValue: invDiscValue,
    // Grand
    total,
    netReceivable: r2(total - tdsAmount),
    totalTaxAmount,
    // Meta flags for the UI
    isInterstate,
    isIntraUT,
    isUnionTerritory: isIntraUT,
    taxInclusive: !!(taxInclusive && showGST),
    warnings,
    needsProfileFix,
    // Per-line rounded values (for GSTR-1 / E-Way Bill agreement)
    lines,
  };

  if (isReverseCharge) {
    result.rcmTaxCgst = cgst;
    result.rcmTaxSgst = sgst;
    result.rcmTaxUtgst = utgst;
    result.rcmTaxIgst = igst;
    result.rcmTaxTotal = r2(cgst + sgst + utgst + igst);
  }

  return result;
}

// The totals of an invoice made from a recurring template. Shared by the
// server (which makes the invoices) and the Recurring screen (which shows
// their amount), so both always agree. GST follows the template's own
// showGST when it has one, else its type (as the printed invoice does): a
// template made on the Recurring screen has no invoiceOptions.showGST, and
// the server used to charge GST on its bills of supply and challans.
export const templateTotals = (tpl: Rec, profile: Rec, extraOptions: Rec = {}) => {
  const t = tpl || {};
  const invoiceOptions = { ...(t.invoiceOptions || {}), ...extraOptions };
  const typeShowsGst = (
    INVOICE_TYPES[t.invoiceType || 'tax-invoice'] || INVOICE_TYPES['tax-invoice']
  ).showGST;
  return computeInvoiceTotals({
    items: t.items || [],
    profile,
    client: {
      name: t.clientName,
      state: t.clientState,
      gstin: t.clientGstin,
      country: t.clientCountry,
      isSEZ: !!t.isSEZ,
    },
    details: { placeOfSupply: t.placeOfSupply || '' },
    showGST: typeof invoiceOptions.showGST === 'boolean' ? invoiceOptions.showGST : typeShowsGst,
    taxInclusive: !!t.taxInclusive,
    invoiceOptions,
  });
};

// v1.10.76 (#81) - GSTR-3B Table 6: input tax credit set off against output
// tax in the order the law requires (Section 49(5), 49A, Rule 88A). Each head
// used to be reduced only by its own credit, so CGST/SGST credit was stranded
// against an IGST liability and the cash payable was overstated.
//   1. IGST credit pays IGST, then CGST and SGST (it must be used up first;
//      the law allows any order between those two, so it goes first to
//      whatever their own credit cannot cover - otherwise CGST credit could be
//      left stranded while SGST is paid in cash)
//   2. CGST credit pays CGST, then IGST - never SGST
//   3. SGST credit pays SGST, then IGST - never CGST
// liability, credit: { igst, cgst, sgst }. Returns payable (cash), used (credit
// applied, by liability head) and carry (credit left over, by credit head).
export const setOffITC = (liability: Rec | null | undefined, credit: Rec | null | undefined) => {
  const r = (n: Numeric) => Math.round((Number(n) || 0) * 100) / 100;
  const due: Record<string, number> = {
    igst: r(liability?.igst),
    cgst: r(liability?.cgst),
    sgst: r(liability?.sgst),
  };
  const left: Record<string, number> = {
    igst: r(credit?.igst),
    cgst: r(credit?.cgst),
    sgst: r(credit?.sgst),
  };
  const used: Record<string, number> = { igst: 0, cgst: 0, sgst: 0 };
  const pay = (from: string, to: string, cap = Infinity) => {
    const amt = Math.min(left[from], due[to], cap);
    if (amt <= 0) return;
    left[from] = r(left[from] - amt);
    due[to] = r(due[to] - amt);
    used[to] = r(used[to] + amt);
  };
  pay('igst', 'igst');
  pay('igst', 'cgst', Math.max(0, due.cgst - left.cgst));
  pay('igst', 'sgst', Math.max(0, due.sgst - left.sgst));
  pay('igst', 'cgst');
  pay('igst', 'sgst');
  pay('cgst', 'cgst');
  pay('cgst', 'igst');
  pay('sgst', 'sgst');
  pay('sgst', 'igst');
  return { payable: due, used, carry: left };
};

// v1.10.76 (#83) - the Subtotal an invoice prints. With "Prices include tax"
// totals.subtotal is the tax-INCLUSIVE gross, so printing it above the CGST/SGST
// rows added the tax twice on paper (Subtotal 2,400 + tax 320 "=" Total 2,400).
// Printed instead: taxable value before discount, so that
// Subtotal - Discount + taxes = Total, the same as for exclusive prices.
export const printedSubtotal = (t: Rec | null | undefined) =>
  t?.taxInclusive
    ? Math.round(((Number(t.taxableAmount) || 0) + (Number(t.totalDiscount) || 0)) * 100) / 100
    : Number(t?.subtotal) || 0;
