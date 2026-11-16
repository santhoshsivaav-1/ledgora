import { afterAll, describe, expect, it } from 'vitest';
import { makeHarness, type Tenant } from './helpers.ts';

// R4.1 the fixed-asset register, through a real database with row-level security: add, correct, sell, remove, openings, and
// the schedule the depreciation screens and ITR-3 read.
const h = makeHarness();
afterAll(() => h.close());
const FY = '2025-26';

const asset = (t: Tenant, over: Record<string, unknown> = {}) =>
  t.call('POST', '/v1/fixed-assets', {
    businessId: t.businessId,
    name: 'Laptop',
    block: 'PM40',
    cost: 60000,
    putToUse: '2025-06-01',
    ...over,
  });
const schedule = async (t: Tenant, fy = FY) =>
  (await t.call('GET', `/v1/asset-schedule?businessId=${t.businessId}&fy=${fy}`)).body;

describe('fixed-asset register', () => {
  it('adds, lists with the block and life tables, corrects and removes', async () => {
    const t = await h.newTenant();
    const a = await asset(t);
    expect(a.status, a.text).toBe(201);
    expect(a.body).toMatchObject({
      name: 'Laptop',
      block: 'PM40',
      cost: 60000,
      putToUse: '2025-06-01',
      disposal: null,
    });
    const list = (await t.call('GET', `/v1/fixed-assets?businessId=${t.businessId}`)).body;
    expect(list.data).toHaveLength(1);
    expect(list.blocks.find((b: any) => b.code === 'PM40').rate).toBe(40);
    expect(list.lives.PM40.life).toBe(3);

    const p = await t.call('PATCH', `/v1/fixed-assets/${a.body.id}`, {
      cost: 70000,
      name: 'Laptop 2',
    });
    expect(p.body).toMatchObject({ cost: 70000, name: 'Laptop 2' });
    expect((await t.call('DELETE', `/v1/fixed-assets/${a.body.id}`)).status).toBe(200);
    expect(
      (await t.call('GET', `/v1/fixed-assets?businessId=${t.businessId}`)).body.data,
    ).toHaveLength(0);
    expect((await t.call('DELETE', `/v1/fixed-assets/${a.body.id}`)).status).toBe(404);
  });

  it('refuses a bad block, cost, a future use date and a sale before use', async () => {
    const t = await h.newTenant();
    expect((await asset(t, { block: 'XX' })).status).toBe(400);
    expect((await asset(t, { cost: 0 })).status).toBe(400);
    expect((await asset(t, { putToUse: '2099-01-01' })).status).toBe(422);
    expect((await asset(t, { disposal: { date: '2025-01-01', proceeds: 1 } })).status).toBe(422);
  });

  it('the schedule: full rate for 180+ days, half below, WDV rolls to the next year', async () => {
    const t = await h.newTenant();
    await asset(t, { cost: 50000, putToUse: '2025-10-03' }); // 180 days: full rate
    await asset(t, { name: 'Phone', cost: 20000, putToUse: '2026-01-10' }); // under 180: half rate
    const s = await schedule(t);
    const pm40 = s.blocks.find((b: any) => b.block === 'PM40');
    expect(pm40.FullRateDeprAmt).toBe(50000);
    expect(pm40.HalfRateDeprAmt).toBe(20000);
    expect(pm40.TotalDepreciation).toBe(20000 + 4000); // 40% of 50,000 + 20% of 20,000
    expect(pm40.WDVLastDay).toBe(70000 - 24000);
    expect(s.taxDepreciation).toBe(24000);
    expect(s.book.depreciation).toBeGreaterThan(0);
    const next = await schedule(t, '2026-27');
    expect(next.blocks.find((b: any) => b.block === 'PM40').WDVFirstDay).toBe(46000);
  });

  it('a sale is taken off the block; a block opening starts one', async () => {
    const t = await h.newTenant();
    const put = await t.call('PUT', '/v1/asset-block-openings', {
      businessId: t.businessId,
      fy: FY,
      block: 'PM15',
      wdv: 300000,
    });
    expect(put.status, put.text).toBe(200);
    const again = await t.call('PUT', '/v1/asset-block-openings', {
      businessId: t.businessId,
      fy: FY,
      block: 'PM15',
      wdv: 280000,
    });
    expect(again.body.wdv).toBe(280000);
    expect(
      (await t.call('GET', `/v1/asset-block-openings?businessId=${t.businessId}`)).body.data,
    ).toHaveLength(1); // replaced
    const m = await asset(t, {
      name: 'Old press',
      block: 'PM15',
      cost: 90000,
      putToUse: '2020-01-01',
    });
    await t.call('PATCH', `/v1/fixed-assets/${m.body.id}`, {
      disposal: { date: '2025-12-15', proceeds: 60000 },
    });
    const pm15 = (await schedule(t)).blocks.find((b: any) => b.block === 'PM15');
    expect(pm15.WDVFirstDay).toBe(280000);
    expect(pm15.RealizationTotalPeriod).toBe(60000);
    expect(pm15.TotalDepreciation).toBe(33000); // 15% of 2,20,000
    // clearing the sale puts it back
    await t.call('PATCH', `/v1/fixed-assets/${m.body.id}`, { disposal: null });
    expect(
      (await schedule(t)).blocks.find((b: any) => b.block === 'PM15').RealizationTotalPeriod,
    ).toBe(0);
  });

  it('refuses a year the engine can not read, and is invisible to another business', async () => {
    const t = await h.newTenant();
    const o = await h.newTenant();
    await asset(t);
    expect(
      (await t.call('GET', `/v1/asset-schedule?businessId=${t.businessId}&fy=2025-27`)).status,
    ).toBe(422);
    expect(
      (await o.call('GET', `/v1/fixed-assets?businessId=${o.businessId}`)).body.data,
    ).toHaveLength(0);
    expect(
      (await o.call('GET', `/v1/fixed-assets?businessId=${t.businessId}`)).status,
    ).toBeGreaterThanOrEqual(400);
  });
});

describe("posting the register's depreciation to the books", () => {
  it('is one journal per year, replaced when asked again, and the ITR-3 then carries it', async () => {
    const t = await h.newTenant();
    await t.call('POST', '/v1/accounting/backfill', { businessId: t.businessId, dryRun: false });
    // Computers bought for 60,000 on 1 June 2025, opened in the books at cost.
    const acct = await t.call('POST', '/v1/accounts', {
      businessId: t.businessId,
      name: 'Computers',
      group: 'Fixed assets',
      opening: { amount: 60000, side: 'Dr', date: '2025-06-01' },
    });
    expect(acct.status, acct.text).toBe(201);
    expect((await asset(t, { cost: 60000, putToUse: '2025-06-01' })).status).toBe(201);
    // 60,000 x 95% / (3 x 365) x 304 days (1 June to 31 March) = 15,824.66, posted to the rupee.
    const first = await t.call('POST', '/v1/fixed-assets/post-depreciation', {
      businessId: t.businessId,
      fy: FY,
    });
    expect(first.status, first.text).toBe(200);
    expect(first.body).toMatchObject({ amount: 15825, posted: true, date: '2026-03-31' });
    expect(first.body.number).toMatch(/^JV-\d+$/);
    const again = await t.call('POST', '/v1/fixed-assets/post-depreciation', {
      businessId: t.businessId,
      fy: FY,
    });
    expect(again.body).toMatchObject({ amount: 15825, number: first.body.number });
    const tb = (await t.call('GET', `/v1/ledger/trial-balance?businessId=${t.businessId}`)).body;
    expect(tb.balanced).toBe(true);
    const dep = tb.lines.find((l: any) => l.name === 'Depreciation');
    const acc = tb.lines.find((l: any) => l.name === 'Accumulated Depreciation');
    expect(dep).toMatchObject({ debit: 15825 }); // once, not twice
    expect(acc).toMatchObject({ credit: 15825 });
    // The journal shows with the others and can be seen in the books.
    const js = (await t.call('GET', `/v1/journals?businessId=${t.businessId}`)).body.data;
    expect(js.some((j: any) => /Depreciation for FY 2025-26/.test(j.narration))).toBe(true);
  });

  it('refuses when the ledger is off, a bad year, and takes the journal back when there is nothing to charge', async () => {
    const t = await h.newTenant();
    expect(
      (
        await t.call('POST', '/v1/fixed-assets/post-depreciation', {
          businessId: t.businessId,
          fy: FY,
        })
      ).status,
    ).toBe(409);
    await t.call('POST', '/v1/accounting/backfill', { businessId: t.businessId, dryRun: false });
    expect(
      (
        await t.call('POST', '/v1/fixed-assets/post-depreciation', {
          businessId: t.businessId,
          fy: '2025-27',
        })
      ).status,
    ).toBe(422);
    const a = await asset(t, { cost: 60000, putToUse: '2025-06-01' });
    expect(
      (
        await t.call('POST', '/v1/fixed-assets/post-depreciation', {
          businessId: t.businessId,
          fy: FY,
        })
      ).body.posted,
    ).toBe(true);
    // The asset is removed: the next posting for the year finds nothing to charge and reverses the journal.
    await t.call('DELETE', `/v1/fixed-assets/${a.body.id}`);
    expect(
      (
        await t.call('POST', '/v1/fixed-assets/post-depreciation', {
          businessId: t.businessId,
          fy: FY,
        })
      ).body,
    ).toMatchObject({ amount: 0, posted: false });
    const tb = (await t.call('GET', `/v1/ledger/trial-balance?businessId=${t.businessId}`)).body;
    const dep = tb.lines.find((l: any) => l.name === 'Depreciation');
    expect((dep?.debit ?? 0) - (dep?.credit ?? 0)).toBe(0);
  });
});
