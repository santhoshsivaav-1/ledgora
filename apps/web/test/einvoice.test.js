import { describe, expect, it } from 'vitest';
import { buildEinvoice, validateEinvoice } from '@ledgora/tax-engine';
import { einvoiceDocFromBill, einvoiceEligible, einvoiceLocked, einvoiceCancellable } from '../src/features/invoices/einvoice';

// P10-S7 offline (D-15): a saved invoice of the billing screens as the IRP's INV-1 JSON.
const bill = (o = {}) => ({
  invoiceType: 'tax-invoice', invoiceNumber: 'INV/0042', invoiceDate: '2026-11-12', status: 'unpaid',
  data: {
    profile: { businessName: 'Ledgora Traders', gstin: '33ABCDE1234F1Z5', address: '12 Main Road', city: 'Chennai', pin: '600001', state: 'Tamil Nadu' },
    client: { name: 'Acme Stores', gstin: '29PQRSX6789K1Z2', address: '4 Market St', city: 'Bengaluru', pin: '560001', state: 'Karnataka' },
    details: { placeOfSupply: 'Karnataka' },
    items: [{ name: 'Steel rod', hsn: '72142090', quantity: 10, unit: 'Kg', rate: 100, taxPercent: 18 }],
    totals: { isInterstate: true, roundOff: 0, total: 1180 },
    invoiceOptions: {},
  },
  ...o,
});

describe('e-invoice from a saved bill', () => {
  it('is offered for B2B tax invoices, credit and debit notes, not for B2C or drafts', () => {
    expect(einvoiceEligible(bill())).toBe(true);
    expect(einvoiceEligible(bill({ invoiceType: 'credit-note' }))).toBe(true);
    expect(einvoiceEligible(bill({ data: { ...bill().data, client: { name: 'Walk-in' } } }))).toBe(false);
    expect(einvoiceEligible(bill({ invoiceType: 'quotation' }))).toBe(false);
    expect(einvoiceEligible(bill({ status: 'cancelled' }))).toBe(false);
  });
  it('maps parties, place of supply and inter-state lines; the JSON passes the IRP field rules', () => {
    const doc = einvoiceDocFromBill(bill());
    expect(doc).toMatchObject({ docType: 'INV', number: 'INV/0042', supplyType: 'B2B', interState: true });
    expect(doc.seller).toMatchObject({ stateCode: '33', pin: '600001' });
    expect(doc.buyer).toMatchObject({ stateCode: '29', pos: '29' });
    const j = buildEinvoice(doc);
    expect(j.ItemList[0]).toMatchObject({ Unit: 'KGS', IgstAmt: 180, TotItemVal: 1180 });
    expect(j.ValDtls.TotInvVal).toBe(1180);
    expect(validateEinvoice(j)).toEqual([]);
  });
  it('an SEZ buyer is SEZWP (with tax) or SEZWOP (under LUT)', () => {
    const sez = (rate) => einvoiceDocFromBill(bill({ data: { ...bill().data, client: { ...bill().data.client, isSEZ: true }, items: [{ ...bill().data.items[0], taxPercent: rate }] } }));
    expect(sez(18).supplyType).toBe('SEZWP');
    expect(sez(0).supplyType).toBe('SEZWOP');
  });
  it('locks the bill once an IRN is stored; cancelling is possible only within 24 hours', () => {
    const withIrn = bill({ data: { ...bill().data, invoiceOptions: { einvoice: { irn: 'a'.repeat(64), ackDt: '2026-11-12 10:00:00', status: 'generated' } } } });
    expect(einvoiceLocked(withIrn)).toBe(true);
    expect(einvoiceLocked(bill())).toBe(false);
    expect(einvoiceCancellable(withIrn, new Date('2026-11-13T04:00:00+05:30'))).toBe(true);
    expect(einvoiceCancellable(withIrn, new Date('2026-11-13T10:01:00+05:30'))).toBe(false);
  });
});
