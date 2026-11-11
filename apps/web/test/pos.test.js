// Vyapar parity P12: the POS keyboard map, the held-bill tabs and the receipt.
import { describe, expect, it } from 'vitest';
import { POS_SHORTCUTS, actionForKey } from '../src/features/pos/posKeys';
import { blankBill, closeTab, parseDiscount, tabLabel } from '../src/features/pos/posBills';
import { receiptHtml } from '../src/features/pos/receipt';

const key = (k, o = {}) => actionForKey({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...o });

describe('shortcuts', () => {
  it('every key in the Vyapar screen maps to its action', () => {
    expect(key('F2')?.action).toBe('qty');
    expect(key('F3')?.action).toBe('itemDiscount');
    expect(key('F4')?.action).toBe('removeItem');
    expect(key('F6')?.action).toBe('unit');
    expect(key('F8')?.action).toBe('charges');
    expect(key('F9')?.action).toBe('billDiscount');
    expect(key('F10')?.action).toBe('loyalty');
    expect(key('F11')?.action).toBe('customer');
    expect(key('F12')?.action).toBe('remarks');
    expect(key('t', { ctrlKey: true })?.action).toBe('newBill');
    expect(key('w', { ctrlKey: true })?.action).toBe('closeBill');
    expect(key('f', { ctrlKey: true })?.action).toBe('breakup');
    expect(key('p', { ctrlKey: true })?.action).toBe('save');
    expect(key('m', { ctrlKey: true })?.action).toBe('payments');
    expect(key('Enter', { ctrlKey: true })?.action).toBe('saveNew');
  });
  it('Alt twins work where the browser keeps Ctrl+T / Ctrl+W', () => {
    expect(key('n', { altKey: true })?.action).toBe('newBill');
    expect(key('w', { altKey: true })?.action).toBe('closeBill');
  });
  it('Mac Cmd works like Ctrl', () => {
    expect(key('p', { metaKey: true })?.action).toBe('save');
  });
  it('Ctrl+3 goes to the third tab', () => {
    expect(key('3', { ctrlKey: true })).toEqual({ action: 'gotoBill', index: 2 });
  });
  it('plain letters and arrows belong to a text box while typing', () => {
    expect(actionForKey({ key: '/', ctrlKey: false, metaKey: false, altKey: false }, { typing: true })).toBeNull();
    expect(actionForKey({ key: 'ArrowDown', ctrlKey: false, metaKey: false, altKey: false }, { typing: true })).toBeNull();
    expect(actionForKey({ key: 'F2', ctrlKey: false, metaKey: false, altKey: false }, { typing: true })?.action).toBe('qty');
    expect(actionForKey({ key: 'ArrowDown', ctrlKey: false, metaKey: false, altKey: false })).toEqual({ action: 'moveLine', delta: 1 });
  });
  it('the help list names every action the map can return', () => {
    const named = new Set(POS_SHORTCUTS.map((s) => s.action));
    for (const a of ['newBill', 'closeBill', 'qty', 'itemDiscount', 'removeItem', 'unit', 'charges', 'billDiscount', 'loyalty', 'customer', 'remarks', 'breakup', 'save', 'saveNew', 'payments', 'focusSearch', 'help'])
      expect(named.has(a), a).toBe(true);
  });
});

describe('held bills', () => {
  it('closing the last tab leaves one blank bill', () => {
    const r = closeTab([blankBill()], 0, 0);
    expect(r.bills).toHaveLength(1);
    expect(r.bills[0].lines).toEqual([]);
  });
  it('the active tab follows the bill it was on', () => {
    const [a, b, c] = [blankBill(), blankBill(), blankBill()];
    expect(closeTab([a, b, c], 2, 0)).toMatchObject({ active: 1 });
    expect(closeTab([a, b, c], 2, 2)).toMatchObject({ active: 1 });
    expect(closeTab([a, b, c], 0, 1)).toMatchObject({ active: 0 });
  });
  it('each bill has its own retry key', () => {
    expect(blankBill().clientKey).not.toBe(blankBill().clientKey);
  });
  it('labels a tab by customer, else item count', () => {
    expect(tabLabel({ customer: { name: 'Asha' }, lines: [] }, 2)).toBe('#2 Asha');
    expect(tabLabel({ customer: null, lines: [1, 2] }, 3)).toBe('#3 · 2 items');
    expect(tabLabel({ customer: null, lines: [] }, 1)).toBe('#1');
  });
  it('parses a typed discount', () => {
    expect(parseDiscount('50')).toEqual({ type: 'amount', value: 50 });
    expect(parseDiscount(' 12.5 % ')).toEqual({ type: 'percent', value: 12.5 });
    expect(parseDiscount('ten')).toBeNull();
    expect(parseDiscount('-5')).toBeNull();
  });
});

describe('receipt', () => {
  const invoice = {
    number: 'INV-7', invoiceDate: '2026-11-11', total: 236, taxableAmount: 200, cgst: 18, sgst: 18, igst: 0, cess: 0, paidAmount: 236, notes: '',
    data: { totals: { roundOff: 0 } },
    lines: [{ name: 'Soap <b>', quantity: 2, unit: 'PCS', rate: 100, taxPercent: 18, lineTotal: 236, description: '' }],
    payments: [{ mode: 'cash', amount: 236 }],
  };
  it('shows the books: lines, GST split, tender and change', () => {
    const h = receiptHtml({ business: { name: 'Shop', gstin: '33AAAAA0000A1Z5' }, invoice, change: 264, settings: { paper: '58mm', receiptFooter: 'Thanks' } });
    expect(h).toContain('INV-7');
    expect(h).toContain('CGST');
    expect(h).toContain('236.00');
    expect(h).toContain('Change returned');
    expect(h).toContain('58mm');
    expect(h).toContain('Thanks');
    expect(h).not.toContain('Balance due');
  });
  it('escapes names so an item can not inject markup', () => {
    expect(receiptHtml({ invoice })).toContain('Soap &lt;b&gt;');
  });
  it('shows a balance for a credit sale', () => {
    expect(receiptHtml({ invoice: { ...invoice, paidAmount: 100 } })).toContain('Balance due');
  });
});
