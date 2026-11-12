import { afterAll, describe, expect, it } from 'vitest';
import { makeHarness } from './helpers.ts';

// Batch and serial tracking in the typed API and at the POS counter.
const h = makeHarness();
afterAll(() => h.close());

async function setup() {
  const t = await h.newTenant();
  await t.call('PATCH', '/v1/settings', {
    businessId: t.businessId,
    values: { 'item.batch': true, 'item.serial': true },
  });
  const syrup = (
    await t.call('POST', '/v1/items', {
      name: 'Syrup',
      salePrice: 50,
      taxPercent: 12,
      openingStock: 10,
      extra: {
        batches: [
          { batchNo: 'B1', expDate: '2027-06-30', qty: 6 },
          { batchNo: 'OLD', expDate: '2026-01-31', qty: 4 },
        ],
      },
    })
  ).body;
  const phone = (
    await t.call('POST', '/v1/items', {
      name: 'Phone',
      salePrice: 9000,
      taxPercent: 18,
      openingStock: 2,
      extra: { serials: ['IM1', 'IM2'] },
    })
  ).body;
  return { t, syrup, phone };
}
const sale = (t: any, items: any[], date = '2026-11-10') =>
  t.call('POST', '/v1/invoices', { businessId: t.businessId, invoiceDate: date, items });

describe('lots', () => {
  it('lists batches first-expiring first and serials in stock', async () => {
    const { t, syrup, phone } = await setup();
    const l = (await t.call('GET', `/v1/items/${syrup.id}/lots`)).body;
    expect(l.tracksBatches).toBe(true);
    expect(l.batches.map((b: any) => b.batchNo)).toEqual(['OLD', 'B1']);
    expect((await t.call('GET', `/v1/items/${phone.id}/lots`)).body.serials).toEqual([
      'IM1',
      'IM2',
    ]);
  });

  it('a sale must name a batch that exists and has not expired; serials must match the quantity and be in stock', async () => {
    const { t, syrup, phone } = await setup();
    const line = (o: any) => ({
      itemId: syrup.id,
      name: 'Syrup',
      quantity: 1,
      rate: 50,
      taxPercent: 12,
      ...o,
    });
    expect((await sale(t, [line({})])).body.error.message).toMatch(/pick a batch/);
    expect((await sale(t, [line({ batchNo: 'NOPE' })])).body.error.message).toMatch(
      /no batch NOPE/,
    );
    expect((await sale(t, [line({ batchNo: 'OLD' })])).body.error.message).toMatch(/expired/);
    expect((await sale(t, [line({ batchNo: 'b1', quantity: 2 })])).status).toBe(201);
    expect(
      (await t.call('GET', `/v1/items/${syrup.id}/lots`)).body.batches.find(
        (b: any) => b.batchNo === 'B1',
      ).qty,
    ).toBe(4);
    const p = (o: any) => ({
      itemId: phone.id,
      name: 'Phone',
      quantity: 1,
      rate: 9000,
      taxPercent: 18,
      ...o,
    });
    expect((await sale(t, [p({ serials: [] })])).status).toBe(422);
    expect((await sale(t, [p({ serials: ['ZZZ'] })])).body.error.message).toMatch(/not in stock/);
    expect((await sale(t, [p({ serials: ['IM1'] })])).status).toBe(201);
    expect((await sale(t, [p({ serials: ['IM1'] })])).body.error.message).toMatch(/not in stock/); // sold already
    expect((await t.call('GET', `/v1/items/${phone.id}/lots`)).body.serials).toEqual(['IM2']);
  });

  it('a purchase brings a batch in; with tracking off nothing is checked', async () => {
    const { t, syrup } = await setup();
    const sup = (await t.call('POST', '/v1/parties', { name: 'Pharma Co', kind: 'supplier' })).body;
    const bill = await t.call('POST', '/v1/purchases', {
      businessId: t.businessId,
      partyId: sup.id,
      purchaseDate: '2026-11-01',
      supplierInvoiceNo: 'S-1',
      items: [
        {
          itemId: syrup.id,
          name: 'Syrup',
          quantity: 5,
          rate: 30,
          taxPercent: 12,
          batchNo: 'B9',
          expDate: '2028-01-31',
        },
      ],
    });
    expect(bill.status, bill.text).toBe(201);
    expect(
      (await t.call('GET', `/v1/items/${syrup.id}/lots`)).body.batches.map((b: any) => b.batchNo),
    ).toContain('B9');
    await t.call('PATCH', '/v1/settings', {
      businessId: t.businessId,
      values: { 'item.batch': false, 'item.serial': false },
    });
    expect(
      (await sale(t, [{ itemId: syrup.id, name: 'Syrup', quantity: 1, rate: 50, taxPercent: 12 }]))
        .status,
    ).toBe(201);
  });
});

describe('lots at the POS counter', () => {
  it('the counter bill carries the batch and serials, and the same checks apply', async () => {
    const { t, syrup, phone } = await setup();
    const sell = (lines: any[]) =>
      t.call('POST', '/v1/pos/sales', {
        businessId: t.businessId,
        invoiceDate: '2026-11-10',
        lines,
        tenders: [{ mode: 'cash', amount: 100000 }],
      });
    const bad = await sell([
      { itemId: syrup.id, name: 'Syrup', quantity: 1, rate: 56, taxPercent: 12 },
    ]);
    expect(bad.status).toBe(422);
    expect(bad.body.error.message).toMatch(/pick a batch/);
    const ok = await sell([
      { itemId: syrup.id, name: 'Syrup', quantity: 1, rate: 56, taxPercent: 12, batchNo: 'B1' },
      {
        itemId: phone.id,
        name: 'Phone',
        quantity: 1,
        rate: 10620,
        taxPercent: 18,
        serials: ['IM2'],
      },
    ]);
    expect(ok.status, ok.text).toBeLessThan(300);
    expect((await t.call('GET', `/v1/items/${phone.id}/lots`)).body.serials).toEqual(['IM1']);
    expect(
      (await t.call('GET', `/v1/items/${syrup.id}/lots`)).body.batches.find(
        (b: any) => b.batchNo === 'B1',
      ).qty,
    ).toBe(5);
  });
});
