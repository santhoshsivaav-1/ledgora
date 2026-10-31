import { describe, expect, it } from 'vitest';
import { viewFromPath } from '../src/app/router';
import { INVOICE_TYPES, SALES_INVOICE_TYPES, stockEffect, salesSign } from '../src/utils';
import { NEXT_STEPS, SALES_PAGES, nextStepsFor, salesPageForType } from '../src/features/sales/salesFlow';

describe('sales flow', () => {
  it('every sales page has its own route and lists only real document types', () => {
    for (const page of SALES_PAGES) {
      expect(viewFromPath(page.path)).toBe(page.id);
      for (const t of page.types) expect(INVOICE_TYPES[t]).toBeTruthy();
      expect(page.types).toContain(page.newType);
    }
  });

  it('every document type belongs to exactly one page', () => {
    for (const type of Object.keys(INVOICE_TYPES)) {
      expect(SALES_PAGES.filter((p) => p.types.includes(type))).toHaveLength(1);
    }
    expect(salesPageForType('sales-order').id).toBe('sales-orders');
  });

  it('only ever steps forward to a known document type', () => {
    for (const [from, steps] of Object.entries(NEXT_STEPS)) {
      expect(INVOICE_TYPES[from]).toBeTruthy();
      for (const st of steps) expect(INVOICE_TYPES[st.to]).toBeTruthy();
    }
    expect(nextStepsFor({ invoiceType: 'quotation' }).map((s) => s.to)).toEqual(['sales-order', 'tax-invoice']);
    // an invoice stays open when a credit note is raised from it
    expect(nextStepsFor({ invoiceType: 'tax-invoice' })).toEqual([expect.objectContaining({ to: 'credit-note', linkOnly: true })]);
    expect(nextStepsFor({ invoiceType: 'credit-note' })).toEqual([]);
  });

  it('a sales order is not a sale: no turnover, no stock', () => {
    const bill = { invoiceType: 'sales-order', status: 'unpaid' };
    expect(SALES_INVOICE_TYPES).not.toContain('sales-order');
    expect(salesSign(bill)).toBe(0);
    expect(stockEffect([{ productId: 'p1', quantity: 5 }], 'sales-order', 'unpaid')).toEqual({});
    expect(INVOICE_TYPES['sales-order'].prefix).toBe('SO');
  });
});
