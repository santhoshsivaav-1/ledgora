import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '@ledgora/tax-engine';
import { makeHarness, type Tenant } from './helpers.ts';

// Vyapar parity P10-S6: the Cash Watch report beyond §269ST. The rules' boundaries are tested in the tax engine
// (cashlimits.test.js); this checks the report reads the right documents.
const h = makeHarness();
let t: Tenant;
beforeAll(async () => {
  t = await h.newTenant();
});
afterAll(() => h.close());

const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const party = async (body: Record<string, unknown>) => {
  const r = await t.call('POST', '/v1/parties', { state: 'Tamil Nadu', ...body });
  expect(r.status, r.text).toBe(201);
  return r.body;
};
const run = (q: Record<string, string> = {}) =>
  t.call(
    'GET',
    `/v1/reports/cash-watch?${new URLSearchParams({ businessId: t.businessId, from: addDays(today, -120), to: today, ...q })}`,
  );

describe('Cash Watch (P10-S6)', () => {
  it('keeps the MSME flag and agreed days on a party, and refuses more than 45 days', async () => {
    const p = await party({ name: 'Micro Co', msme: true, msmeAgreedDays: 30 });
    expect(p).toMatchObject({ msme: true, msmeAgreedDays: 30 });
    const bad = await t.call('POST', '/v1/parties', {
      name: 'Too long',
      msme: true,
      msmeAgreedDays: 60,
    });
    expect(bad.status).toBe(400);
  });

  it('lists §40A(3) cash payments and §43B(h) MSME dues, and filters by rule', async () => {
    const msme = await party({ name: 'Small Works', msme: true });
    const plain = await party({ name: 'Big Corp' });
    for (const [supplierId, n] of [
      [msme.id, 'M-1'],
      [plain.id, 'B-1'],
    ] as const) {
      const r = await t.call('POST', '/v1/purchases', {
        businessId: t.businessId,
        supplierId,
        purchaseDate: addDays(today, -50),
        invoiceNumber: n,
        items: [{ name: 'Part', quantity: 1, rate: 5000, taxPercent: 0 }],
      });
      expect(r.status, r.text).toBe(201);
    }
    const cashOut = (amount: number) =>
      t.call('POST', '/v1/payments', {
        businessId: t.businessId,
        direction: 'out',
        partyId: plain.id,
        paymentDate: today,
        mode: 'cash',
        amount,
      });
    expect((await cashOut(6000)).status).toBe(201);
    expect((await cashOut(4500)).status).toBe(201);

    const all = await run();
    expect(all.status, all.text).toBe(200);
    expect(all.body.rows.map((r: any) => [r.rule, r.party])).toEqual([
      ['40A(3)', 'Big Corp'],
      ['43B(h)', 'Small Works'],
    ]);
    expect(all.body.rows[0]).toMatchObject({ total: 10500, over: 500 });
    expect(all.body.rows[1]).toMatchObject({ total: 5000, over: 50 });
    expect((await run({ rule: '43Bh' })).body.rows).toHaveLength(1);
    expect((await run({ rule: '269ST' })).body.rows).toHaveLength(0);
  });
});
