import { describe, expect, it } from 'vitest';
import { parseBankStatement } from '@ledgora/tax-engine';
import {
  BANK_STATEMENT_TEMPLATE,
  CLIENT_TEMPLATE,
  PRODUCT_COLUMNS,
  PRODUCT_TEMPLATE,
  PURCHASE_TEMPLATE,
  SALES_TEMPLATE,
  clientCsvToRecords,
  parseCsv,
  productCsvToRecords,
  purchaseCsvToRecords,
  salesCsvToBills,
} from '../src/features/import-export/bulkCsv.js';
import { buildReconciliation } from '../src/features/gst-returns/gstHelpers.jsx';
import { GSTR2B_SAMPLE } from '../src/features/gst-returns/gstr2bSample.js';

// Every import screen has a "Template" / "Sample" download. Each one must go through its own importer without an
// error, so the sample never drifts from what the import actually reads.

describe('import templates', () => {
  it('clients', () => {
    const { clients, errors } = clientCsvToRecords(CLIENT_TEMPLATE);
    expect(errors).toEqual([]);
    expect(clients).toHaveLength(2);
  });

  it('products', () => {
    expect(parseCsv(PRODUCT_TEMPLATE)[0]).toEqual(PRODUCT_COLUMNS);
    const { products, errors } = productCsvToRecords(PRODUCT_TEMPLATE);
    expect(errors).toEqual([]);
    expect(products[0]).toEqual({
      name: 'Steel rod 8mm',
      hsn: '7214',
      purchasePrice: 60,
      sellingPrice: 72,
      rate: 72,
      taxPercent: 18,
      unit: 'Kg',
      stock: 500,
      description: 'TMT Fe500',
    });
  });

  it('sales and purchases', () => {
    const sales = salesCsvToBills(SALES_TEMPLATE);
    expect(sales.errors ?? []).toEqual([]);
    const purchases = purchaseCsvToRecords(PURCHASE_TEMPLATE);
    expect(purchases.errors ?? []).toEqual([]);
  });

  it('bank statement: debits, credits and balances land in the right columns', () => {
    const { transactions } = parseBankStatement(BANK_STATEMENT_TEMPLATE);
    expect(transactions).toHaveLength(4);
    expect(transactions.map((t) => [t.description, t.debit, t.credit, t.balance])).toEqual([
      ['Opening balance', 0, 0, 50000],
      ['NEFT-SHARMA TRADERS-INV 0101', 0, 8260, 58260],
      ['UPI-ELECTRICITY BILL', 1450, 0, 56810],
      ['INT.PD SAVINGS', 0, 125, 56935],
    ]);
  });

  it('GSTR-2B sample has the shape Import 2B JSON accepts and reconciles', () => {
    const root = GSTR2B_SAMPLE.data;
    expect(root.docdata.b2b.length).toBeGreaterThan(0);
    const rows = buildReconciliation(root, []);
    expect(rows.map((r) => [r.status, r.invoiceNumber, r.twoBTaxable])).toEqual([
      ['twob_only', 'SUP/552', 6000],
      ['twob_only', 'KP-1043', 2000],
    ]);
  });
});

describe('productCsvToRecords', () => {
  it('still reads the old name, hsn, rate, gst%, unit, stock files', () => {
    const { products } = productCsvToRecords(
      'name,hsn,rate,gst%,unit,stock\nPen,9608,10,12,Pcs,40',
    );
    expect(products[0]).toMatchObject({
      name: 'Pen',
      hsn: '9608',
      sellingPrice: 10,
      rate: 10,
      taxPercent: 12,
      unit: 'Pcs',
      stock: 40,
    });
  });
  it('defaults the unit, treats unreadable numbers as 0, skips repeats and reports nameless rows', () => {
    const csv = 'Name,Rate,Stock\nPen,abc,\npen,5,1\n,3,1\nInk,"1,250.50",2';
    const res = productCsvToRecords(csv, { existing: [{ name: 'INK' }] });
    expect(res.products).toEqual([
      expect.objectContaining({ name: 'Pen', sellingPrice: 0, unit: 'Nos', stock: 0 }),
    ]);
    expect(res.skipped).toEqual(['pen', 'Ink']);
    expect(res.errors).toEqual([{ line: 4, message: 'Name is required' }]);
  });
});
