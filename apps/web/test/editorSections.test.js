import { describe, expect, it } from 'vitest';
import { numberPrefixFor, pdfFileName } from '../src/features/invoices/editor/invoiceNumbering';
import { clampNonNeg } from '../src/features/invoices/editor/useInvoiceItems';
import { railRows } from '../src/features/invoices/editor/InvoiceRail';
import { RETURN_REASON_OPTIONS, REFUND_OPTIONS } from '../src/features/invoices/editor/SaleExtraPanels';

// Audit Phase 3: the invoice editor was split into sibling sections. This file covers the pure
// logic that moved out of InvoiceEditorPage.jsx — number prefixes, PDF names, the quantity/rate
// clamp, the rail's breakdown rows and the credit-note option lists — without mounting the editor.

describe('invoiceNumbering', () => {
  it('uses the per-type override from Print Settings and flags it', () => {
    const settings = { customPrefixes: { 'tax-invoice': ' MYS ' } };
    expect(numberPrefixFor(settings, 'tax-invoice')).toEqual({ prefix: 'MYS', overridePrefix: true });
  });

  it('falls back to the type prefix, then INV, and clears the override flag', () => {
    expect(numberPrefixFor({}, 'quotation')).toEqual({ prefix: 'QUO', overridePrefix: false });
    expect(numberPrefixFor({ customPrefixes: {} }, 'tax-invoice')).toEqual({ prefix: 'INV', overridePrefix: false });
    expect(numberPrefixFor({ customPrefixes: { 'tax-invoice': '   ' } }, 'tax-invoice')).toEqual({
      prefix: 'INV',
      overridePrefix: false,
    });
  });

  it('names the PDF after the prefix and number, dashes for slashes', () => {
    expect(pdfFileName('INV', 'INV/2026-27/001')).toBe('INV_INV-2026-27-001.pdf');
    expect(pdfFileName('QUO', '12')).toBe('QUO_12.pdf');
  });
});

describe('clampNonNeg', () => {
  it('keeps valid numbers as numbers', () => {
    expect(clampNonNeg('3.5')).toBe(3.5);
    expect(clampNonNeg(0)).toBe(0);
    expect(clampNonNeg('18')).toBe(18);
  });

  it('clamps negatives, junk and blanks to 0', () => {
    expect(clampNonNeg('-5')).toBe(0);
    expect(clampNonNeg(Infinity)).toBe(0);
    expect(clampNonNeg(NaN)).toBe(0);
    expect(clampNonNeg('')).toBe(0);
    expect(clampNonNeg('abc')).toBe(0);
  });
});

describe('railRows', () => {
  const totals = { subtotal: 1000, total: 1180, chargesTotal: 0, cess: 0, tcsAmount: 0, roundOff: 0, tdsAmount: 0, totalDiscount: 0 };

  it('shows the two rows a plain GST bill has', () => {
    const rows = railRows({ totals, discountTotal: 0, taxTotal: 180, taxLabel: 'GST', showGST: true, profitNow: null });
    expect(rows).toEqual([
      ['Subtotal', 1000, true],
      ['GST', 180, true],
    ]);
  });

  it('adds discount and profit rows only when they exist', () => {
    const rows = railRows({ totals, discountTotal: 50, taxTotal: 180, taxLabel: 'GST', showGST: true, profitNow: 120 });
    expect(rows.map(([label]) => label)).toEqual(['Subtotal', 'Discount', 'GST', 'Estimated profit']);
    expect(rows.find(([l]) => l === 'Discount')[1]).toBe(-50);
    expect(rows.find(([l]) => l === 'Estimated profit')[1]).toBe(120);
  });

  it('hides the tax row for a Bill of Supply and shows TDS when present', () => {
    const rows = railRows({ totals, discountTotal: 0, taxTotal: 0, taxLabel: 'GST', showGST: false, profitNow: null });
    expect(rows.map(([label]) => label)).toEqual(['Subtotal']);
    const tdsRows = railRows({
      totals: { ...totals, tdsAmount: 10 },
      discountTotal: 0, taxTotal: 0, taxLabel: 'GST', showGST: false, profitNow: null,
    });
    expect(tdsRows.map(([label]) => label)).toEqual(['Subtotal', 'Less TDS']);
    expect(tdsRows[1][1]).toBe(-10);
  });
});

describe('credit-note options', () => {
  it('lists the GSTR-1 CDNR reasons', () => {
    expect(RETURN_REASON_OPTIONS.map((o) => o.value)).toEqual(
      ['sales-return', 'post-sale-discount', 'deficiency-in-service', 'correction', 'others'],
    );
  });

  it('offers adjust, cash and bank refunds', () => {
    expect(REFUND_OPTIONS.map((o) => o.value)).toEqual(['adjust', 'cash', 'bank']);
  });
});
