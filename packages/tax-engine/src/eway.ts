// Moved verbatim from apps/web/src/utils.js (Phase 0, change 0.7/0.8/0.9).
// Types are deliberately loose until the Zod contracts land in Phase 1 (change 1.13).

import { getStateCode } from './gstin.ts';
import { resolveLineDiscount } from './lineTax.ts';
import type { Rec, Numeric } from './types.ts';
import { getUnitUQC, type Unit } from './units.ts';

export interface EWayBillOptions {
  taxInclusive?: boolean;
  /** The business's own units of measure (browser storage in the web app). */
  customUnits?: readonly Unit[];
  distance?: Numeric;
  [key: string]: unknown;
}
import { formatDateGST } from './dates.ts';

// Generate E-Way Bill JSON (NIC portal format).
// Throws a friendly error if the seller isn't registered in India — E-Way Bill is an Indian
// GST-portal artifact and the JSON schema (state codes, CGST/SGST/IGST split) is meaningless
// for foreign invoices.
//
// Per the NIC schema, supplyType is the *direction* of the supply (O=Outward, I=Inward),
// NOT inter/intra-state. Seller-issued bills are always 'O'. The intra/inter-state
// distinction is captured by comparing fromStateCode and toStateCode.
//
// v1.10.1 — added `opts.taxInclusive` so the per-line taxable and header
// totalValue back-calculate correctly when the invoice is MRP-inclusive.
// Prior code hard-coded `taxable = qty*rate - discount` which reported
// the MRP (post-tax) value as taxable → the portal's own tax-consistency
// check (`taxableValue + tax ≈ totInvValue`) failed → E-Way Bill rejected.
export const generateEWayBillJSON = (
  profile: Rec,
  client: Rec,
  details: Rec,
  items: Rec[],
  totals: Rec,
  invoiceType: string,
  opts: EWayBillOptions = {},
) => {
  if (profile?.country && profile.country !== 'India') {
    throw new Error(
      'E-Way Bill is an Indian GST portal feature. Set business country to "India" in Settings to enable it.',
    );
  }
  const taxInclusive = !!opts.taxInclusive;
  const fromStateCode = getStateCode(profile.state || profile.gstin);
  const toStateCode = getStateCode(client.state || client.gstin);
  // The invoice's own split (computeInvoiceTotals, which follows place of
  // supply, SEZ and exports) decides the per-item rates. Comparing the client's
  // state here could disagree with it - IGST rates on items whose header
  // carried CGST + SGST - and the portal rejects such a bill.
  const isInterstate =
    typeof totals?.isInterstate === 'boolean'
      ? totals.isInterstate
      : !!(fromStateCode && toStateCode && fromStateCode !== toStateCode);

  // Pincodes are mandatory (the portal rejects 0). Try profile.pin / client.pin first,
  // then fall back to extracting digits from address. If still missing, throw — the user
  // must fill the field rather than submit a guaranteed-rejected payload.
  const extractPin = (obj: Rec) => {
    const direct = String(obj?.pin || obj?.pincode || '').replace(/\D/g, '');
    if (direct.length === 6) return Number(direct);
    const fromAddr = String(obj?.address || '').match(/\b(\d{6})\b/);
    return fromAddr ? Number(fromAddr[1]) : 0;
  };
  const fromPincode = extractPin(profile);
  const toPincode = extractPin(client);
  if (!fromPincode)
    throw new Error(
      'Your business PIN code is required for the E-Way Bill. Set it in Settings → Company Details.',
    );
  if (!toPincode)
    throw new Error(
      "Client PIN code is required for the E-Way Bill. Add it in the client's address.",
    );

  const itemList = items.map((item: Rec, idx: number) => {
    // v1.10.1 — back-calculate taxable when the invoice is MRP-inclusive.
    // v1.10.22 — honour discountType (percent | fixed).
    // v1.10.31 — GST-C5: cess rate now populated per item (was 0).
    const gross =
      (Number(item.quantity) || 0) * (Number(item.rate) || 0) -
      resolveLineDiscount(item, taxInclusive);
    const taxRate = Number(item.taxPercent) || 0;
    const cessRate = Number(item.cessPercent) || 0;
    const taxable = taxInclusive && taxRate > 0 ? gross / (1 + taxRate / 100) : gross;
    return {
      itemNo: idx + 1,
      productName: item.name || '',
      productDesc: item.name || '',
      hsnCode: Number(item.hsn) || 0,
      quantity: item.quantity || 0,
      qtyUnit: getUnitUQC(item.unit, opts.customUnits),
      taxableAmount: Math.round(taxable * 100) / 100,
      cgstRate: isInterstate ? 0 : taxRate / 2,
      sgstRate: isInterstate ? 0 : taxRate / 2,
      igstRate: isInterstate ? taxRate : 0,
      cessRate,
    };
  });

  return {
    version: '1.0.1221',
    billLists: [
      {
        userGstin: profile.gstin || '',
        supplyType: 'O', // Outward — seller-issued. Always O regardless of intra/inter-state.
        subSupplyType: 1, // 1=Supply
        docType: invoiceType === 'delivery-challan' ? 'CHL' : 'INV',
        docNo: details.invoiceNumber || '',
        docDate: formatDateGST(details.invoiceDate),
        fromGstin: profile.gstin || '',
        fromAddr1: (profile.address || '').substring(0, 120),
        fromPlace: profile.city || profile.state || '',
        fromPincode: fromPincode,
        fromStateCode: Number(fromStateCode) || 0,
        toGstin: client.gstin || 'URP',
        toAddr1: (client.address || '').substring(0, 120),
        toPlace: client.city || client.state || '',
        toPincode: toPincode,
        toStateCode: Number(toStateCode) || 0,
        // v1.10.1 — When tax-inclusive, subtotal is MRP-inclusive; the
        // pre-tax totalValue must back out the embedded tax. Prefer
        // totals.taxableAmount which computeInvoiceTotals fills correctly
        // for both modes; fall back to the old calc for legacy callers.
        totalValue:
          Math.round(
            (totals.taxableAmount != null
              ? totals.taxableAmount
              : totals.subtotal - totals.totalDiscount) * 100,
          ) / 100,
        cgstValue: Math.round((totals.cgst || 0) * 100) / 100,
        // v1.10.31 — GST-H7: UTGST folded into sgstValue bucket (NIC portal
        // has no separate UTGST field; sum must reconcile with totInvValue).
        sgstValue: Math.round(((totals.sgst || 0) + (totals.utgst || 0)) * 100) / 100,
        igstValue: Math.round((totals.igst || 0) * 100) / 100,
        // v1.10.31 — GST-C5: cess populated (was hardcoded 0 → NIC portal
        // rejected any invoice with cess for total-consistency mismatch).
        cessValue: Math.round((totals.cess || 0) * 100) / 100,
        totInvValue: Math.round(totals.total * 100) / 100,
        transMode: 1, // 1=Road
        // v1.10.31 — GST-C5: distance must be >= 1 (portal rejects 0). Caller
        // can pass `opts.distance`. If unset we default to 1 (minimum valid).
        transDistance: Math.max(1, Number(opts.distance) || 1),
        transporterName: '',
        transporterId: '',
        transDocNo: '',
        transDocDate: '',
        vehicleNo: '',
        vehicleType: 'R', // R=Regular
        itemList: itemList,
      },
    ],
  };
};
