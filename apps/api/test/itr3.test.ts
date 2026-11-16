import { afterAll, describe, expect, it } from 'vitest';
import { makeHarness, type Tenant } from './helpers.ts';

// R2.5 ITR-3 from the books: the ledger and the asset register through to a built, rule-checked, schema-checked return that
// is saved as a pack and recorded as filed, through a real database with row-level security.
const h = makeHarness();
afterAll(() => h.close());
const FY = '2025-26';

const profile = (t: Tenant, over: Record<string, unknown> = {}) => ({
  businessId: t.businessId,
  pan: 'ABCPK1234F',
  firstName: 'Ravi',
  surname: 'Kumar',
  fatherName: 'Suresh Kumar',
  dob: '1985-06-15',
  residenceNo: '12',
  locality: 'Adyar',
  city: 'Chennai',
  stateCode: '33',
  pinCode: '600020',
  mobile: '9876543210',
  email: 'ravi@example.com',
  employerCategory: 'NA',
  place: 'Chennai',
  bankAccounts: [
    {
      ifsc: 'HDFC0000123',
      bankName: 'HDFC Bank',
      accountNo: '50100123456789',
      accountType: 'SB',
      useForRefund: true,
    },
  ],
  ...over,
});
const itr3 = (over: Record<string, unknown> = {}) => ({
  business: { name: 'Kumar Stores', code: '09001', description: 'Retail', method: 'MERC' },
  ...over,
});
const putDraft = (t: Tenant, itr3Data: unknown, extra: Record<string, unknown> = {}, fy = FY) =>
  t.call('PUT', '/v1/itr-drafts', {
    businessId: t.businessId,
    fy,
    data: { form: 'itr3', regime: 'new', itr3: itr3Data, ...extra },
  });
const build = (t: Tenant, filedOn = '2026-07-20', who: { call: Tenant['call'] } = t) =>
  who.call('POST', '/v1/filing-packs/build/itr3', { businessId: t.businessId, fy: FY, filedOn });

/** A tenant whose ledger has a year of trading: sales, a purchase and rent. */
async function trader() {
  const t = await h.newTenant();
  await t.call('POST', '/v1/accounting/backfill', { businessId: t.businessId, dryRun: false });
  await t.call('PUT', '/v1/taxpayer-profile', profile(t));
  const bill = (id: string, date: string, taxable: number) => ({
    id,
    invoiceNumber: id,
    invoiceDate: date,
    invoiceType: 'tax-invoice',
    status: 'paid',
    clientName: 'Asha',
    totalAmount: taxable * 1.18,
    data: {
      totals: {
        total: taxable * 1.18,
        cgst: taxable * 0.09,
        sgst: taxable * 0.09,
        igst: 0,
        cess: 0,
        roundOff: 0,
      },
      items: [],
    },
  });
  await t.call('POST', '/v1/workspace/collections/bills', bill('INV-1', '2025-09-10', 1_000_000));
  await t.call('POST', '/v1/workspace/collections/purchases', {
    docType: 'bill',
    date: '2025-08-02',
    invoiceNumber: 'P-1',
    taxableAmount: 600_000,
    totalTax: 108_000,
    totalAmount: 708_000,
    interstate: false,
    items: [{ name: 'Goods', quantity: 1, rate: 600_000, taxPercent: 18 }],
  });
  await t.call('POST', '/v1/workspace/collections/expenses', {
    date: '2025-10-08',
    amount: 120_000,
    gstAmount: 0,
    paymentMode: 'cash',
    category: 'Rent',
  });
  return t;
}

const codes = (r: { body: { issues?: { code: string }[] } }) =>
  (r.body.issues ?? []).map((i) => i.code);
const errorsOf = (r: { body: { issues?: { code: string; severity: string }[] } }) =>
  (r.body.issues ?? []).filter((i) => i.severity === 'error').map((i) => i.code);

describe('ITR-3: from the ledger to a filed return', () => {
  it('asks for the taxpayer details, then for the ITR-3 details', async () => {
    const t = await h.newTenant();
    expect(codes(await build(t))).toEqual(['PROFILE_MISSING']);
    await t.call('PUT', '/v1/taxpayer-profile', profile(t));
    const r = await build(t);
    expect(r.body).toMatchObject({ ok: false, payload: null });
    expect(codes(r)).toEqual(['ITR3_DRAFT']);
  });

  it('builds a return from the books: the figures are the ledger’s, the tax is worked out, every check passes', async () => {
    const t = await trader();
    expect((await putDraft(t, itr3())).status).toBe(200);
    const r = await build(t);
    expect(r.status, r.text).toBe(200);
    expect(errorsOf(r)).toEqual([]);
    expect(r.body).toMatchObject({ ok: true, kind: 'itr3', period: '032026' });
    const k = r.body.statements.calc;
    // Sales 10,00,000, purchases 6,00,000, rent 1,20,000: gross profit 4,00,000, profit before tax 2,80,000.
    expect(k).toMatchObject({
      revenue: 1_000_000,
      grossProfit: 400_000,
      profitBeforeTax: 280_000,
      businessIncome: 280_000,
    });
    expect(r.body.statements.books).toMatchObject({ saleOfGoods: 1_000_000, purchases: 600_000 });
    // Input GST (1,08,000) is with the revenue authorities; the balance sheet balances.
    expect(r.body.statements.balanceSheet).toMatchObject({
      balanceWithRevenueAuthorities: 108_000,
      sundryDebtors: 1_180_000,
      sundryCreditors: 708_000,
    });
    expect(k.fundsSource).toBe(k.fundsApplied);
    // 2,80,000 is under the 4 lakh nil slab of the new regime.
    expect(r.body.computation).toMatchObject({ totalIncome: 280_000, netTaxLiability: 0 });
    const f = r.body.payload.ITR.ITR3;
    expect(f.Form_ITR3.FormName).toBe('ITR-3');
    expect(f.PartA_GEN1.PersonalInfo.PAN).toBe('ABCPK1234F');
    expect(f.PARTA_BS.FundSrc.TotFundSrc).toBe(f.PARTA_BS.FundApply.TotFundApply);
    expect(codes(r)).toContain('SW_CODE_UNREGISTERED'); // honest about the unregistered software id
  });

  it('the asset register: tax depreciation lowers the income; assets and depreciation not in the books are reported, not hidden', async () => {
    const t = await trader();
    await putDraft(t, itr3());
    const add = await t.call('POST', '/v1/fixed-assets', {
      businessId: t.businessId,
      name: 'Laptop',
      block: 'PM40',
      cost: 60_000,
      putToUse: '2025-06-01',
    });
    expect(add.status, add.text).toBe(201);
    const r = await build(t);
    expect(errorsOf(r)).toEqual([]);
    // 40% of 60,000 = 24,000 tax depreciation (a laptop in use for 180+ days).
    expect(r.body.statements.calc).toMatchObject({
      taxDepreciation: 24_000,
      businessIncome: 280_000 - 24_000,
    });
    expect(codes(r)).toEqual(expect.arrayContaining(['ITR3_ASSETS_DIFFER', 'ITR3_DEP_NOT_POSTED']));
    const dpm = r.body.payload.ITR.ITR3.ScheduleDPM.PlantMachinery.Rate40.DepreciationDetail;
    expect(dpm).toMatchObject({
      AdditionsGrThan180Days: 60_000,
      DepreciationAtFullRate: 24_000,
      WDVLastDay: 36_000,
    });
  });

  it('a draft split of services from goods, adjustments and a tax audit go into the file', async () => {
    const t = await trader();
    await putDraft(
      t,
      itr3({
        servicesTurnover: 300_000,
        adjustments: {
          personalExpenses: 10_000,
          cashPaymentsUs40A3: 5_000,
          unpaid43B: { pfEsiContribution: 4_000 },
        },
      }),
    );
    const r = await build(t);
    expect(errorsOf(r)).toEqual([]);
    expect(r.body.statements.books).toMatchObject({
      saleOfGoods: 700_000,
      saleOfServices: 300_000,
    });
    // Business income: 2,80,000 + 10,000 (s.37) + 5,000 (s.40A(3)) + 4,000 (s.43B).
    expect(r.body.statements.calc.businessIncome).toBe(299_000);
    const bp = r.body.payload.ITR.ITR3.ITR3ScheduleBP.BusinessIncOthThanSpec;
    expect(bp).toMatchObject({
      AmtDebPLDisallowUs37: 10_000,
      AmtDebPLDisallowUs40A: 5_000,
      AmtDebPLDisallowUs43B: 4_000,
    });
  });

  it('refuses what ITR-3 can not take yet, and a bad nature-of-business code', async () => {
    const t = await trader();
    await putDraft(t, itr3({ declarations: { capitalGains: true } }));
    expect(errorsOf(await build(t))).toContain('ITR3_CG');
    await putDraft(t, itr3({ business: { name: 'X', code: '', method: 'MERC' } }));
    expect(errorsOf(await build(t))).toContain('ITR3_NATURE');
    const t2 = await trader();
    await putDraft(t2, itr3(), {}, '2026-27');
    const next = await t2.call('POST', '/v1/filing-packs/build/itr3', {
      businessId: t2.businessId,
      fy: '2026-27',
      filedOn: '2027-07-01',
    });
    expect(codes(next)).toContain('ITR3_NO_SCHEMA');
  });

  it('saved as a pack it is checked again by the server (rules and schema), reviewed and filed with its acknowledgement number', async () => {
    const t = await trader();
    await putDraft(t, itr3());
    const built = (await build(t, '2026-11-16')).body;
    expect(built.ok).toBe(true);
    const save = (payload: unknown) =>
      t.call('POST', '/v1/filing-packs', {
        businessId: t.businessId,
        kind: 'itr3',
        period: built.period,
        payload,
      });
    // Tampered: the server catches it though the build was fine.
    const bad = structuredClone(built.payload);
    bad.ITR.ITR3.PARTA_PL.CreditsToPL.TotCreditsToPL += 5000;
    const caught = await save(bad);
    expect(caught.status).toBe(201);
    expect(caught.body).toMatchObject({ status: 'draft', ready: false });
    const issues = (await t.call('GET', `/v1/filing-packs/${caught.body.id}`)).body.issues.map(
      (i: { code: string }) => i.code,
    );
    expect(issues).toContain('ITR3_RULE_82');
    // The honest file is ready.
    const pack = await save(built.payload);
    expect(pack.body).toMatchObject({
      kind: 'itr3',
      kindLabel: 'ITR-3',
      status: 'ready',
      periodFrom: '2025-04-01',
      periodTo: '2026-03-31',
      errors: 0,
    });
    const ca = await h.addMember(t, 'ca');
    expect(
      (await t.call('POST', `/v1/filing-packs/${pack.body.id}/submit-review`, {})).body.status,
    ).toBe('in_review');
    expect(
      (await ca.call('POST', `/v1/filing-packs/${pack.body.id}/approve`, {})).body.status,
    ).toBe('approved');
    const filed = (ack: string, filedOn: string) =>
      ca.call('POST', `/v1/filing-packs/${pack.body.id}/record-filed`, { arn: ack, filedOn });
    expect((await filed('12345', '2026-11-16')).status).toBe(422);
    // Built as a belated return (16 November) but recorded as filed by the due date: build it again.
    expect((await filed('123456789012345', '2026-08-20')).status).toBe(422);
    const done = await filed('123456789012345', '2026-11-16');
    expect(done.status, done.text).toBe(200);
    expect(done.body).toMatchObject({ status: 'filed', arn: '123456789012345' });
  });

  it('the register shows ITR-3 when that is the return being prepared', async () => {
    const t = await trader();
    await putDraft(t, itr3());
    const c = (await t.call('GET', `/v1/income-tax-calendar?businessId=${t.businessId}&fy=${FY}`))
      .body;
    expect(c.itr).toMatchObject({ form: 'ITR-3', status: 'not_started', schemaAvailable: true });
  });

  it('only people who prepare returns can build one; another organization can not', async () => {
    const t = await trader();
    await putDraft(t, itr3());
    const other = await h.newTenant();
    expect(
      (
        await other.call('POST', '/v1/filing-packs/build/itr3', {
          businessId: t.businessId,
          fy: FY,
          filedOn: '2026-07-20',
        })
      ).status,
    ).toBe(404);
    const viewer = await h.addMember(t, 'viewer');
    expect((await build(t, '2026-07-20', viewer)).status).toBe(403);
  });
});
