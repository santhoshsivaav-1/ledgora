import { afterAll, describe, expect, it } from 'vitest';
import { makeHarness, type Tenant } from './helpers.ts';

// R3: the deductor's quarterly register and the "what should I deduct" helper, on top of the TDS ledger.
const h = makeHarness();
afterAll(() => h.close());

const party = async (t: Tenant, name: string, extra: Record<string, unknown> = {}) =>
  (
    await t.call('POST', '/v1/parties', {
      businessId: t.businessId,
      name,
      kind: 'supplier',
      ...extra,
    })
  ).body.id as string;
const payOut = (
  t: Tenant,
  partyId: string,
  amount: number,
  tds: number,
  date: string,
  section = '194C',
) =>
  t.call('POST', '/v1/payments', {
    businessId: t.businessId,
    partyId,
    direction: 'out',
    amount,
    tdsAmount: tds,
    tdsSection: section,
    paymentDate: date,
    mode: 'bank',
  });

describe('the quarter register', () => {
  it('lists the quarter, groups it, flags a missing PAN and the late statement, and gives a CSV', async () => {
    const t = await h.newTenant();
    const noPan = await party(t, 'Landlord');
    const withPan = await party(t, 'Contractor Co', { gstin: '29ABCPK1234F1Z5' });
    const a = await payOut(t, noPan, 4950, 50, '2026-10-15');
    expect(a.status, a.text).toBeLessThan(300);
    await payOut(t, withPan, 9900, 100, '2026-11-20');
    await payOut(t, withPan, 9900, 100, '2027-02-10'); // Q4, not in Q3
    const q3 = await t.call(
      'GET',
      `/v1/tds/statement?businessId=${t.businessId}&fy=2026&quarter=Q3`,
    );
    expect(q3.status, q3.text).toBe(200);
    expect(q3.body.rows).toHaveLength(2);
    expect(q3.body).toMatchObject({ from: '2026-10-01', to: '2026-12-31', dueDate: '2027-01-31' });
    expect(q3.body.totals).toMatchObject({ tds: 150, undeposited: 150 });
    expect(q3.body.deductees).toHaveLength(2);
    expect(q3.body.issues.join(' ')).toMatch(/without a valid PAN/);
    expect(q3.body.rows.find((r: any) => r.partyName === 'Landlord').flags).toContain(
      'PAN missing or invalid',
    );
    expect(q3.body.csv).toContain('"Contractor Co"');
    expect(q3.body.notice).toMatch(/not the department's FVU file/);
    // deposit one entry, then the challan shows up
    const entry = (await t.call('GET', `/v1/tds?businessId=${t.businessId}`)).body.data.find(
      (e: any) => e.partyName === 'Contractor Co' && e.date === '2026-11-20',
    );
    const dep = await t.call('POST', `/v1/tds/${entry.id}/deposit`, {
      challanNo: '00123',
      bsrCode: '0510308',
      challanDate: '2026-12-05',
    });
    expect(dep.status, dep.text).toBe(200);
    const after = await t.call(
      'GET',
      `/v1/tds/statement?businessId=${t.businessId}&fy=2026&quarter=Q3`,
    );
    expect(after.body.challans).toEqual([
      { challanNo: '00123', bsrCode: '0510308', challanDate: '2026-12-05', tds: 100, entries: 1 },
    ]);
    expect(after.body.totals).toMatchObject({ deposited: 100, undeposited: 50 });
  });
  it('another organization sees none of it', async () => {
    const t = await h.newTenant();
    const other = await h.newTenant();
    await payOut(t, await party(t, 'X', { gstin: '29ABCPK1234F1Z5' }), 9900, 100, '2026-11-20');
    const res = await other.call(
      'GET',
      `/v1/tds/statement?businessId=${t.businessId}&fy=2026&quarter=Q3`,
    );
    expect(res.status).toBe(404);
  });
});

describe('what to deduct', () => {
  it('tracks the year to date for the same payee and section', async () => {
    const t = await h.newTenant();
    const p = await party(t, 'Fee Taker', { gstin: '29ABCPK1234F1Z5' });
    const first = await t.call(
      'GET',
      `/v1/tds/compute?businessId=${t.businessId}&section=194J&amount=30000&date=2026-08-01&partyId=${p}`,
    );
    expect(first.body).toMatchObject({ deduct: false, pan: 'ABCPK1234F', paidBefore: 0 });
    // 30,000 paid earlier in the year, with no TDS because it was under the limit
    await payOut(t, p, 30000, 0, '2026-08-01', '194J');
    const second = await t.call(
      'GET',
      `/v1/tds/compute?businessId=${t.businessId}&section=194J&amount=30000&date=2026-09-01&partyId=${p}`,
    );
    expect(second.body).toMatchObject({ deduct: true, tds: 6000, paidBefore: 30000 });
    expect(second.body.sections.length).toBeGreaterThan(5);
  });
  it('uses 20% when the payee has no PAN, and a typed PAN when there is no party', async () => {
    const t = await h.newTenant();
    const noPan = await t.call(
      'GET',
      `/v1/tds/compute?businessId=${t.businessId}&section=194C&amount=50000&date=2026-08-01`,
    );
    expect(noPan.body).toMatchObject({ rate: 20, tds: 10000, panMissing: true });
    const typed = await t.call(
      'GET',
      `/v1/tds/compute?businessId=${t.businessId}&section=194C&amount=50000&date=2026-08-01&pan=ABCCK1234F`,
    );
    expect(typed.body).toMatchObject({ rate: 2, tds: 1000 });
  });
});
