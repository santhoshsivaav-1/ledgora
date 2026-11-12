import { getStateCode, getUnitUQC, isCancelledBill } from '../../utils';

// Vyapar parity P10-S7, offline (D-15): a saved bill of the billing screens in the shape tax-engine's buildEinvoice
// reads. The IRN details the IRP returns are kept on the bill at data.invoiceOptions.einvoice, which the print reads too.

const DOC = { 'tax-invoice': 'INV', 'credit-note': 'CRN', 'debit-note': 'DBN' };

/** E-invoicing covers B2B (and SEZ / export) tax invoices, credit notes and debit notes; not B2C, drafts or quotations. */
export function einvoiceEligible(bill) {
  if (!bill || isCancelledBill(bill) || !DOC[bill.invoiceType || 'tax-invoice']) return false;
  const c = bill.data?.client || {};
  const exportSale = !!c.country && c.country !== 'India';
  return !!String(c.gstin || '').trim() || exportSale;
}

export const einvoiceOf = (bill) => bill?.data?.invoiceOptions?.einvoice || null;
/** A bill with a live IRN can not be edited: the IRP holds the registered copy. */
export const einvoiceLocked = (bill) => einvoiceOf(bill)?.status === 'generated' && !!einvoiceOf(bill)?.irn;
/** The IRP lets an IRN be cancelled within 24 hours of its acknowledgement; after that a credit note is the way. */
export function einvoiceCancellable(bill, now = new Date()) {
  const e = einvoiceOf(bill);
  if (!einvoiceLocked(bill) || !e.ackDt) return false;
  const ack = new Date(`${String(e.ackDt).trim().replace(' ', 'T')}+05:30`);
  return !Number.isNaN(ack.getTime()) && now.getTime() - ack.getTime() <= 24 * 3_600_000;
}

export function einvoiceDocFromBill(bill) {
  const { profile = {}, client = {}, details = {}, items = [], totals = {}, invoiceOptions = {} } = bill.data || {};
  const exportSale = !!client.country && client.country !== 'India';
  const anyTax = items.some((it) => Number(it.taxPercent) > 0);
  const supplyType = exportSale ? (anyTax ? 'EXPWP' : 'EXPWOP') : client.isSEZ ? (anyTax ? 'SEZWP' : 'SEZWOP') : 'B2B';
  const sellerState = getStateCode(profile.gstin || '') || getStateCode(profile.state || '');
  const buyerState = getStateCode(client.gstin || '') || getStateCode(client.state || '');
  return {
    docType: DOC[bill.invoiceType || 'tax-invoice'],
    number: bill.invoiceNumber,
    date: bill.invoiceDate,
    supplyType,
    reverseCharge: !!invoiceOptions.reverseCharge,
    interState: totals.isInterstate === true || !!client.isSEZ || exportSale,
    taxInclusive: !!bill.data?.taxInclusive,
    seller: { gstin: profile.gstin || '', name: profile.legalName || profile.businessName || '', address: profile.address || '', city: profile.city || '', pin: profile.pin || '', stateCode: sellerState },
    buyer: {
      gstin: client.gstin || '', name: client.legalName || client.name || '', address: client.address || '', city: client.city || '', pin: client.pin || '',
      stateCode: buyerState, pos: getStateCode(details.placeOfSupply || '') || buyerState,
    },
    items: items
      .filter((it) => String(it.name || '').trim())
      .map((it) => ({ ...it, unit: /^99/.test(String(it.hsn || '').trim()) ? undefined : getUnitUQC(it.unit) })),
    otherCharges: 0,
    discount: totals.invoiceDiscountAmount || 0,
    roundOff: totals.roundOff || 0,
  };
}
