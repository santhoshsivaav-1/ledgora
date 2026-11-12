import { describe, expect, it } from 'vitest';
import {
  altUnitLabel, barcodeTaken, batchStock, defaultItcEligible, expiryState, findByBarcode, hsnDigitsProblem, isAltUnit,
  itemDiscountFor, itemExtraVisibility, lineRateFor, parseSerials, serialProblems, serialsInStock, suggestBatch,
  unitChoicesFor, unitFactorFor,
} from '../src/features/items/itemExtras';

// Settings > Item / Party extras: price choice, units, barcodes, batches, serial numbers and GST checks.

const P = { id: 'p1', name: 'Paracetamol', unit: 'BOX', sellingPrice: 120, wholesalePrice: 100, wholesaleMinQty: 10, altUnit: 'STRIP', altFactor: 10 };

describe('visibility', () => {
  it('everything is off by default except the item-wise discount', () => {
    expect(itemExtraVisibility({})).toEqual({
      mrp: false, wholesale: false, altUnit: false, image: false, barcode: false, batch: false, serial: false, discount: true, regional: false,
    });
    expect(itemExtraVisibility({ 'txn.barcodeScan': true }).barcode).toBe(true);
    expect(itemExtraVisibility({ 'item.batch': true, 'item.mrp': true }).batch).toBe(true);
  });
});

describe('line rate', () => {
  const s = { 'item.wholesale': true, 'party.itemRates': true };
  it('selling price by default, and when the settings are off', () => {
    expect(lineRateFor(P, { qty: 50 })).toEqual({ rate: 120, source: 'sale' });
    expect(lineRateFor({ id: 'x', rate: 9 })).toEqual({ rate: 9, source: 'sale' });
  });
  it('wholesale at or above the minimum quantity', () => {
    expect(lineRateFor(P, { qty: 9, s })).toEqual({ rate: 120, source: 'sale' });
    expect(lineRateFor(P, { qty: 10, s })).toEqual({ rate: 100, source: 'wholesale' });
    expect(lineRateFor({ ...P, wholesaleMinQty: '' }, { qty: 100, s }).source).toBe('sale');
  });
  it('the party rate wins over wholesale', () => {
    expect(lineRateFor(P, { qty: 50, s, partyRates: { p1: 95 } })).toEqual({ rate: 95, source: 'party' });
    expect(lineRateFor(P, { qty: 50, s: { 'item.wholesale': true }, partyRates: { p1: 95 } }).source).toBe('wholesale');
  });
  it('the secondary unit divides the rate and counts quantity in primary units for wholesale', () => {
    expect(lineRateFor(P, { qty: 5, unit: 'STRIP' })).toEqual({ rate: 12, source: 'sale' });
    expect(lineRateFor(P, { qty: 100, unit: 'strip', s })).toEqual({ rate: 10, source: 'wholesale' }); // 100 strips = 10 boxes
  });
});

describe('units', () => {
  it('choices, factor and label', () => {
    expect(unitChoicesFor(P)).toEqual(['BOX', 'STRIP']);
    expect(unitChoicesFor({ unit: 'PCS' })).toEqual(['PCS']);
    expect(isAltUnit(P, 'BOX')).toBe(false);
    expect(unitFactorFor(P, 'STRIP')).toBe(0.1);
    expect(unitFactorFor(P, 'BOX')).toBeUndefined();
    expect(altUnitLabel(P)).toBe('1 BOX = 10 STRIP');
    expect(isAltUnit({ ...P, altFactor: 0 }, 'STRIP')).toBe(false);
  });
});

describe('barcode', () => {
  const list = [{ id: 'a', barcode: '8901234567890' }, { id: 'b', barcode: 'ABC-1' }];
  it('finds by code, any case', () => {
    expect(findByBarcode(list, ' abc-1 ').id).toBe('b');
    expect(findByBarcode(list, '')).toBeNull();
    expect(findByBarcode(list, 'zzz')).toBeNull();
  });
  it('flags a code another product uses', () => {
    expect(barcodeTaken(list, 'ABC-1', 'a').id).toBe('b');
    expect(barcodeTaken(list, 'ABC-1', 'b')).toBeNull();
  });
});

describe('item-wise discount', () => {
  it('applies the product discount only when switched on and sensible', () => {
    expect(itemDiscountFor({ discountPercent: 5 })).toBe(5);
    expect(itemDiscountFor({ discountPercent: 5 }, { 'item.discount': false })).toBe(0);
    expect(itemDiscountFor({ discountPercent: 150 })).toBe(0);
  });
});

describe('batches', () => {
  const prod = { id: 'p1', name: 'Syrup', batches: [{ batchNo: 'B1', expDate: '2027-01-31', qty: 10 }] };
  const purchases = [
    { id: 'u1', items: [{ productId: 'p1', batchNo: 'B2', expDate: '2026-12-31', quantity: 5 }] },
    { id: 'u2', docType: 'order', items: [{ productId: 'p1', batchNo: 'B9', quantity: 50 }] },
    { id: 'u3', docType: 'debit-note', reason: 'damaged', items: [{ productId: 'p1', batchNo: 'B2', quantity: 1 }] },
    { id: 'u4', docType: 'debit-note', reason: 'rate-difference', items: [{ productId: 'p1', batchNo: 'B2', quantity: 4 }] },
  ];
  const bills = [
    { id: 's1', invoiceType: 'tax-invoice', data: { items: [{ productId: 'p1', batchNo: 'b1', quantity: 3 }] } },
    { id: 's2', invoiceType: 'credit-note', data: { items: [{ productId: 'p1', batchNo: 'B1', quantity: 1 }] } },
    { id: 's3', invoiceType: 'quotation', data: { items: [{ productId: 'p1', batchNo: 'B1', quantity: 100 }] } },
    { id: 's4', status: 'cancelled', invoiceType: 'tax-invoice', data: { items: [{ productId: 'p1', batchNo: 'B1', quantity: 100 }] } },
  ];
  it('opening + bought − returned to supplier − sold + credit notes, first expiring first', () => {
    expect(batchStock(prod, { bills, purchases })).toEqual([
      { batchNo: 'B2', mfgDate: '', expDate: '2026-12-31', qty: 4 },
      { batchNo: 'B1', mfgDate: '', expDate: '2027-01-31', qty: 8 },
    ]);
  });
  it('leaves out the bill being edited', () => {
    expect(batchStock(prod, { bills, purchases, excludeBillId: 's1' })[1].qty).toBe(11);
  });
  it('suggests the first unexpired batch with stock', () => {
    const list = batchStock(prod, { bills, purchases });
    expect(suggestBatch(list, '2026-11-12').batchNo).toBe('B2');
    expect(suggestBatch(list, '2027-01-05').batchNo).toBe('B1');
    expect(suggestBatch([], '2027-01-05')).toBeNull();
  });
  it('expiry state', () => {
    expect(expiryState('2026-11-01', '2026-11-12')).toBe('expired');
    expect(expiryState('2026-12-01', '2026-11-12')).toBe('soon');
    expect(expiryState('2027-06-01', '2026-11-12')).toBeNull();
    expect(expiryState('', '2026-11-12')).toBeNull();
  });
});

describe('serial numbers', () => {
  it('parses a typed list', () => {
    expect(parseSerials('SN1, sn1  SN2\nSN3;')).toEqual(['SN1', 'SN2', 'SN3']);
    expect(parseSerials(['a', ' a ', 'b'])).toEqual(['a', 'b']);
  });
  it('in stock = opening + bought − sold', () => {
    const prod = { id: 'p', name: 'Phone', serials: ['IM1', 'IM2'] };
    const purchases = [{ items: [{ productId: 'p', serials: ['IM3'] }] }];
    const bills = [{ id: 'b', invoiceType: 'tax-invoice', data: { items: [{ productId: 'p', serials: ['im1'] }] } }];
    expect(serialsInStock(prod, { bills, purchases })).toEqual(['IM2', 'IM3']);
    expect(serialsInStock(prod, { bills, purchases, excludeBillId: 'b' })).toEqual(['IM1', 'IM2', 'IM3']);
  });
  it('problems: count and stock', () => {
    expect(serialProblems({ quantity: 2, serials: ['A'] }, ['A', 'B'])).toEqual(['2 units need 2 serial numbers; 1 entered']);
    expect(serialProblems({ quantity: 1, serials: ['Z'] }, ['A'])).toEqual(['Not in stock: Z']);
    expect(serialProblems({ quantity: 1, serials: ['a'] }, ['A'])).toEqual([]);
  });
});

describe('GST checks', () => {
  it('HSN digits', () => {
    expect(hsnDigitsProblem('1234', 4)).toBeNull();
    expect(hsnDigitsProblem('1234', 6)).toMatch(/6 digits/);
    expect(hsnDigitsProblem('', 8)).toBeNull();
    expect(hsnDigitsProblem('12AB', 4)).toMatch(/digits only/);
  });
  it('ITC default', () => {
    expect(defaultItcEligible({})).toBe(true);
    expect(defaultItcEligible({ 'gst.itcDefault': 'ineligible' })).toBe(false);
  });
});
