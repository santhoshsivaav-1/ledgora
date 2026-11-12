import { afterAll, describe, expect, it } from 'vitest';
import { makeHarness } from './helpers.ts';

// The billing screens' documents in the books: saved, edited, trashed and restored bills; receipts, purchases and
// expenses; and "Post history again" for documents saved before the ledger was on.
const h = makeHarness();
afterAll(() => h.close());

const tb = async (t: any) =>
  (await t.call('GET', `/v1/ledger/trial-balance?businessId=${t.businessId}`)).body;
const line = (b: any, code: string) => b.lines.find((r: any) => r.code === code);
const bill = (id: string, total = 118, extra: any = {}) => ({
  id,
  invoiceNumber: id,
  invoiceDate: '2026-10-05',
  invoiceType: 'tax-invoice',
  status: 'unpaid',
  clientName: 'Asha',
  totalAmount: total,
  data: { totals: { total, cgst: 9, sgst: 9, igst: 0, cess: 0, roundOff: 0 }, items: [] },
  ...extra,
});

describe('workspace documents in the ledger', () => {
  it('documents saved before the ledger was on are posted when it is switched on, and the books balance', async () => {
    const t = await h.newTenant();
    await t.call('POST', '/v1/workspace/collections/bills', bill('INV-1'));
    await t.call('POST', '/v1/workspace/collections/receipts', {
      receiptNo: 'R-1',
      date: '2026-10-06',
      amount: 118,
      paymentMode: 'Cash',
    });
    await t.call('POST', '/v1/workspace/collections/purchases', {
      docType: 'bill',
      date: '2026-10-02',
      invoiceNumber: 'S-1',
      taxableAmount: 500,
      totalTax: 90,
      totalAmount: 590,
      interstate: false,
      items: [{ name: 'A', quantity: 1, rate: 500, taxPercent: 18 }],
    });
    await t.call('POST', '/v1/workspace/collections/expenses', {
      date: '2026-10-08',
      amount: 236,
      gstAmount: 36,
      paymentMode: 'cash',
      category: 'Rent',
    });
    const on = await t.call('POST', '/v1/accounting/backfill', {
      businessId: t.businessId,
      dryRun: false,
    });
    expect(on.status, on.text).toBe(200);
    expect(on.body.problems).toEqual([]);
    expect(on.body.enabled).toBe(true);
    const b = await tb(t);
    expect(b.balanced).toBe(true);
    expect(line(b, '4000')).toMatchObject({ credit: 100 }); // sales
    expect(line(b, '5000')).toMatchObject({ debit: 500 }); // purchases
    expect(line(b, '1000').debit - line(b, '1000').credit).toBe(118 - 236); // cash: receipt in, expense out
  });

  it('with the ledger on, a save posts, an edit reposts, trash unposts and restore posts again', async () => {
    const t = await h.newTenant();
    await t.call('POST', '/v1/accounting/backfill', { businessId: t.businessId, dryRun: false });
    await t.call('POST', '/v1/workspace/collections/bills', bill('INV-9'));
    expect(line(await tb(t), '4000')).toMatchObject({ credit: 100 });
    await t.call(
      'POST',
      '/v1/workspace/collections/bills?overwrite=1',
      bill('INV-9', 236, {
        data: {
          totals: { total: 236, cgst: 18, sgst: 18, igst: 0, cess: 0, roundOff: 0 },
          items: [],
        },
      }),
    );
    expect(line(await tb(t), '4000')).toMatchObject({ credit: 200 });
    await t.call('DELETE', '/v1/workspace/collections/bills/INV-9');
    expect(line(await tb(t), '4000')).toBeUndefined();
    expect((await t.call('POST', '/v1/workspace/trash/INV-9/restore')).status).toBe(200);
    const b = await tb(t);
    expect(line(b, '4000')).toMatchObject({ credit: 200 });
    expect(b.balanced).toBe(true);
  });
});
