import { describe, expect, it } from 'vitest';
import { LIVE_IN_APP, SETTINGS } from '@ledgora/contracts';
import { discountRules, estimatedProfit, optionDefaultsFrom, printOverlayFrom, termsHtmlFrom, visibleOrderFields } from '../src/features/invoices/editor/settingsDefaults';
import { itemFieldVisibility, lowStockLimit, newItemDefaults } from '../src/features/items/itemFields';
import { customPartyFields, duplicatePhone } from '../src/features/parties/partyFields';
import { ORDER_DETAIL_FIELDS } from '../src/utils';

// The settings that screens obey: what a new bill, product or party starts with, and what is shown.

describe('live-in-app list', () => {
  it('names only real keys, each marked live with no phase badge left', () => {
    for (const k of LIVE_IN_APP) {
      expect(SETTINGS[k], k).toBeDefined();
      expect(SETTINGS[k].live, k).toBe(true);
      expect(SETTINGS[k].phase, k).toBeUndefined();
    }
  });
});

describe('new bill options from settings', () => {
  it('adds nothing for a business that never changed a setting', () => {
    expect(optionDefaultsFrom({})).toEqual({});
    const defaults = Object.fromEntries(Object.entries(SETTINGS).map(([k, d]) => [k, d.default]));
    expect(optionDefaultsFrom(defaults)).toEqual({});
  });
  it('maps print choices to bill options', () => {
    const o = optionDefaultsFrom({ 'print.show.hsn': false, 'print.show.upiQr': false, 'print.show.signature': false, 'print.template': 'modern', 'print.paper': 'thermal3' });
    expect(o).toMatchObject({ showHSN: false, showUPI: false, showSignature: false, pdfStyle: 'modern', paperSize: 'thermal80' });
  });
  it('turns A4 and A5 sideways for landscape, and ignores landscape on a roll', () => {
    expect(optionDefaultsFrom({ 'print.orientation': 'landscape' }).paperSize).toBe('a4Landscape');
    expect(optionDefaultsFrom({ 'print.paper': 'a5', 'print.orientation': 'landscape' }).paperSize).toBe('a5Landscape');
    expect(optionDefaultsFrom({ 'print.paper': 'thermal2', 'print.orientation': 'landscape' }).paperSize).toBe('thermal58');
  });
  it('starts without GST when GST is off, without a round-off line when rounding is off', () => {
    expect(optionDefaultsFrom({ 'gst.enabled': false }).showGST).toBe(false);
    expect(optionDefaultsFrom({ 'txn.roundOff': 'off' }).showRoundOff).toBe(false);
    expect(optionDefaultsFrom({ 'gst.tcs': true }).showTCS).toBe(true);
  });
  it('hides the line-discount column when discounts are whole-bill only', () => {
    expect(optionDefaultsFrom({ 'txn.discountMode': 'transaction' }).showDiscount).toBe(false);
    expect(optionDefaultsFrom({ 'txn.discountMode': 'line' }).showDiscount).toBeUndefined();
  });
});

describe('discount rules', () => {
  it('follows mode and unit', () => {
    expect(discountRules({})).toEqual({ line: true, bill: true, percent: true, amount: true });
    expect(discountRules({ 'txn.discountMode': 'line' })).toMatchObject({ line: true, bill: false });
    expect(discountRules({ 'txn.discountMode': 'transaction' })).toMatchObject({ line: false, bill: true });
    expect(discountRules({ 'txn.discountUnit': 'percent' })).toMatchObject({ percent: true, amount: false });
    expect(discountRules({ 'txn.discountUnit': 'amount' })).toMatchObject({ percent: false, amount: true });
  });
});

describe('print overlay', () => {
  it('adds copies and the footer only when chosen', () => {
    expect(printOverlayFrom({})).toEqual({});
    expect(printOverlayFrom({ 'print.copies': 'original' })).toEqual({});
    expect(printOverlayFrom({ 'print.copies': 'triplicate' })).toEqual({ multiCopyEnabled: true, multiCopyCount: 3 });
    expect(printOverlayFrom({ 'print.footer': '  Thank you  ' })).toEqual({ footerMessage: 'Thank you' });
  });
});

describe('default terms', () => {
  it('becomes escaped paragraphs, one per line', () => {
    expect(termsHtmlFrom('Pay in 7 days\n\n<b>No returns</b> & no refunds')).toBe('<p>Pay in 7 days</p><p>&lt;b&gt;No returns&lt;/b&gt; &amp; no refunds</p>');
    expect(termsHtmlFrom('')).toBe('');
  });
});

describe('order and dispatch boxes', () => {
  const keys = (s, d) => visibleOrderFields(ORDER_DETAIL_FIELDS, s, d).map((f) => f.key);
  it('shows everything by default, as before', () => {
    expect(keys({}, {})).toHaveLength(ORDER_DETAIL_FIELDS.length);
  });
  it('hides PO boxes and transport boxes with their switches, but never a box that holds text', () => {
    expect(keys({ 'txn.poDetails': false }, {})).not.toContain('buyerOrderNo');
    expect(keys({ 'txn.transport': false }, {})).not.toContain('vehicleNo');
    expect(keys({ 'txn.transport': false }, {})).toContain('buyerOrderNo');
    expect(keys({ 'txn.poDetails': false }, { buyerOrderNo: 'PO-9' })).toContain('buyerOrderNo');
    expect(keys({ 'txn.poDetails': false, 'txn.transport': false }, {})).toContain('workDetails');
  });
});

describe('estimated profit', () => {
  const products = [{ id: 'a', purchasePrice: 60 }, { id: 'b', purchasePrice: 0 }];
  it('adds selling less buying over lines with a purchase price', () => {
    expect(estimatedProfit([{ productId: 'a', quantity: 3, rate: 100 }], products)).toBe(120);
    expect(estimatedProfit([{ productId: 'a', quantity: 1, rate: 50 }], products)).toBe(-10);
  });
  it('is null when no line has a purchase price, so no misleading zero', () => {
    expect(estimatedProfit([{ productId: 'b', quantity: 3, rate: 100 }, { name: 'x', quantity: 1, rate: 5 }], products)).toBeNull();
  });
});

describe('product form', () => {
  it('starts as it always did unless the owner chose defaults', () => {
    expect(newItemDefaults({})).toMatchObject({ unit: 'Pcs', taxPercent: '', itemType: 'product' });
    expect(newItemDefaults({ 'item.defaultUnit': 'KGS', 'item.defaultGst': 12 })).toMatchObject({ unit: 'KGS', taxPercent: '12' });
    expect(newItemDefaults({ 'tax.defaultItemRate': 5 }).taxPercent).toBe('5');
  });
  it('shows or hides boxes with their switches', () => {
    expect(itemFieldVisibility({})).toMatchObject({ hsn: true, stock: true, minStock: true, tax: true, description: true });
    expect(itemFieldVisibility({ 'item.hsn': false, 'item.stock': false })).toMatchObject({ hsn: false, stock: false, minStock: false });
    expect(itemFieldVisibility({ 'item.custom': [{ label: 'Colour', printOnInvoice: false }] }).custom).toHaveLength(1);
  });
  it('uses a product minimum only when the alert is on and the minimum is set', () => {
    expect(lowStockLimit({ minStock: 20 }, {}, 5)).toBe(20);
    expect(lowStockLimit({ minStock: 0 }, {}, 5)).toBe(5);
    expect(lowStockLimit({}, {}, 5)).toBe(5);
    expect(lowStockLimit({ minStock: 20 }, { 'item.minStock': false }, 5)).toBe(5);
  });
});

describe('party form', () => {
  const clients = [{ id: '1', name: 'Asha', phone: '+91 98765 43210' }, { id: '2', name: 'Ravi', phone: '9000000000' }];
  it('finds a duplicate phone whatever its formatting, ignoring the party being edited', () => {
    expect(duplicatePhone(clients, '9876543210')?.name).toBe('Asha');
    expect(duplicatePhone(clients, '098765-43210')?.name).toBe('Asha');
    expect(duplicatePhone(clients, '9876543210', '1')).toBeNull();
    expect(duplicatePhone(clients, '12345')).toBeNull();
    expect(duplicatePhone(clients, '')).toBeNull();
  });
  it('lists only named custom fields', () => {
    expect(customPartyFields({ 'party.custom': [{ label: 'Route' }, { label: '  ' }] })).toEqual([{ label: 'Route' }]);
    expect(customPartyFields({})).toEqual([]);
  });
});
