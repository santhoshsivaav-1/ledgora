import { useMemo } from 'react';
import { clientYearToDate, computeInvoiceTotals } from '../../../../utils';

// The invoice's totals (change 3.9): GST split, rounding, TDS and TCS. Pure maths lives in the tax engine
// (computeInvoiceTotals); this hook decides what to feed it and when to recompute.
export function useInvoiceTotals({ allBillsForCredit, client, details, editingBill, items, profile, showGST, taxInclusive, invoiceOptions }) {
  // v1.10.4 — useMemo replaces the prior useEffect+setTotals pair. Same
  // math (extracted to pure `computeInvoiceTotals` in v1.10.1), but
  // computed inline during render so React doesn't double-render on
  // every keystroke.
  // v1.10.66 (#61) — client.country now decides exports, and client.gstin /
  // profile.gstin stand in for a missing state. All three must be listed:
  // switching only the country left the old CGST + SGST split on screen, and
  // that stale split is what Save stored.
  // This client's sales so far this financial year, for the ₹50L threshold of
  // 194Q / 206C(1H). Not stored in invoiceOptions (it changes with every
  // invoice); fed to the calculation only.
  const clientYtd = useMemo(
    () => clientYearToDate(allBillsForCredit, client?.name, details?.invoiceDate, editingBill?.id),
    [allBillsForCredit, client?.name, details?.invoiceDate, editingBill?.id],
  );
  const totals = useMemo(() => computeInvoiceTotals({
    items, profile, client, details, showGST, taxInclusive,
    invoiceOptions: { ...invoiceOptions, tcsCumulativeThisYear: clientYtd, tdsCumulativeThisYear: clientYtd },
  }), [clientYtd, invoiceOptions.tcsSection, invoiceOptions.tdsSection, items, client.state, client?.country, client?.gstin, client?.isSEZ, profile?.state, profile?.country, profile?.gstin, showGST, taxInclusive, invoiceOptions.showRoundOff, invoiceOptions.showTDS, invoiceOptions.tdsRate, invoiceOptions.tdsCumulativeThisYear, invoiceOptions.showTCS, invoiceOptions.tcsRate, invoiceOptions.tcsCumulativeThisYear, invoiceOptions.reverseCharge, invoiceOptions.invoiceDiscountValue, invoiceOptions.invoiceDiscountType, details?.placeOfSupply]);
  return { clientYtd, totals };
}
