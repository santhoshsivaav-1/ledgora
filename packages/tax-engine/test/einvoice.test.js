// Vyapar parity P10-S7, offline (D-15): the IRP's INV-1 JSON (schema 1.1) built from an invoice, checked against the
// IRP's published field rules, and the IRN details pasted back. No provider, no credentials.
import { describe, expect, it } from 'vitest';
import { buildEinvoice, checkIrnDetails, validateEinvoice } from '../src/index.ts';

const doc = (o = {}) => ({
  docType: 'INV',
  number: 'INV/26-27/0042',
  date: '2026-11-12',
  supplyType: 'B2B',
  reverseCharge: false,
  interState: false,
  seller: { gstin: '33ABCDE1234F1Z5', name: 'Ledgora Traders', address: '12 Main Road', city: 'Chennai', pin: '600001', stateCode: '33' },
  buyer: { gstin: '33PQRSX6789K1Z2', name: 'Acme Stores', address: '4 Market St', city: 'Madurai', pin: '625001', stateCode: '33', pos: '33' },
  items: [
    { name: 'Steel rod', hsn: '72142090', quantity: 10, unit: 'KGS', rate: 100, discount: 0, taxPercent: 18 },
    { name: 'Installation', hsn: '995461', quantity: 1, unit: 'NA', rate: 500, discount: 50, taxPercent: 18 },
  ],
  otherCharges: 0,
  roundOff: -0.1,
  ...o,
});

describe('buildEinvoice', () => {
  it('fills the schema 1.1 header, parties and dates in the IRP format', () => {
    const j = buildEinvoice(doc());
    expect(j.Version).toBe('1.1');
    expect(j.TranDtls).toEqual({ TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' });
    expect(j.DocDtls).toEqual({ Typ: 'INV', No: 'INV/26-27/0042', Dt: '12/11/2026' });
    expect(j.SellerDtls).toEqual({ Gstin: '33ABCDE1234F1Z5', LglNm: 'Ledgora Traders', Addr1: '12 Main Road', Loc: 'Chennai', Pin: 600001, Stcd: '33' });
    expect(j.BuyerDtls).toMatchObject({ Gstin: '33PQRSX6789K1Z2', Pos: '33', Pin: 625001, Stcd: '33' });
  });
  it('computes each line and the value details (intra-state: CGST + SGST)', () => {
    const j = buildEinvoice(doc());
    expect(j.ItemList[0]).toEqual({
      SlNo: '1', PrdDesc: 'Steel rod', IsServc: 'N', HsnCd: '72142090', Qty: 10, Unit: 'KGS', UnitPrice: 100,
      TotAmt: 1000, Discount: 0, AssAmt: 1000, GstRt: 18, IgstAmt: 0, CgstAmt: 90, SgstAmt: 90, CesRt: 0, CesAmt: 0, TotItemVal: 1180,
    });
    expect(j.ItemList[1]).toMatchObject({ IsServc: 'Y', TotAmt: 500, Discount: 50, AssAmt: 450, CgstAmt: 40.5, SgstAmt: 40.5, TotItemVal: 531 });
    expect(j.ValDtls).toEqual({ AssVal: 1450, CgstVal: 130.5, SgstVal: 130.5, IgstVal: 0, CesVal: 0, Discount: 0, OthChrg: 0, RndOffAmt: -0.1, TotInvVal: 1710.9 });
  });
  it('charges IGST between states and marks reverse charge', () => {
    const j = buildEinvoice(doc({ interState: true, reverseCharge: true, buyer: { ...doc().buyer, gstin: '29PQRSX6789K1Z2', stateCode: '29', pos: '29' } }));
    expect(j.TranDtls.RegRev).toBe('Y');
    expect(j.ItemList[0]).toMatchObject({ IgstAmt: 180, CgstAmt: 0, SgstAmt: 0 });
    expect(j.ValDtls.IgstVal).toBe(261);
  });
  it('credit notes are CRN', () => {
    expect(buildEinvoice(doc({ docType: 'CRN' })).DocDtls.Typ).toBe('CRN');
  });
});

describe('validateEinvoice', () => {
  it('passes a well-formed invoice', () => {
    expect(validateEinvoice(buildEinvoice(doc()))).toEqual([]);
  });
  it('names each broken field', () => {
    const j = buildEinvoice(doc({
      number: '0INV',
      seller: { ...doc().seller, gstin: 'BAD', pin: '12' },
      buyer: { ...doc().buyer, gstin: '' },
      items: [{ name: '', hsn: '12', quantity: 1, unit: 'NOS', rate: 10, taxPercent: 7 }],
      roundOff: 150,
    }));
    const fields = validateEinvoice(j).map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining([
      'DocDtls.No', 'SellerDtls.Gstin', 'SellerDtls.Pin', 'BuyerDtls.Gstin',
      'ItemList[0].PrdDesc', 'ItemList[0].HsnCd', 'ItemList[0].GstRt', 'ValDtls.RndOffAmt',
    ]));
  });
  it('refuses a document number over 16 characters and an empty item list', () => {
    const j = buildEinvoice(doc({ number: 'INV/2026-27/00000042', items: [] }));
    expect(validateEinvoice(j).map((e) => e.field)).toEqual(expect.arrayContaining(['DocDtls.No', 'ItemList']));
  });
});

describe('checkIrnDetails', () => {
  const ok = { irn: 'a'.repeat(64), ackNo: '112410012345678', ackDt: '2026-11-12 10:15:00', signedQr: 'eyJhbGciOiJSUzI1NiJ9.eyJkYXRhIjoiMSJ9.c2ln' };
  it('accepts what the IRP returns', () => {
    expect(checkIrnDetails(ok)).toEqual([]);
  });
  it('rejects a wrong IRN, ack number, date or QR', () => {
    expect(checkIrnDetails({ irn: 'xyz', ackNo: 'A1', ackDt: 'yesterday', signedQr: 'not-a-token' }).map((e) => e.field))
      .toEqual(['irn', 'ackNo', 'ackDt', 'signedQr']);
  });
});
