import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.ts';
import { openField, sealField } from '../src/crypto.ts';
import { computeInvoiceTotals } from '@ledgora/tax-engine';
import { sql } from 'drizzle-orm';
import { withTenant } from '@ledgora/db';
import { makeHarness, type Tenant } from './helpers.ts';

// R2 income tax: taxpayer details (sealed at rest), challans, advance tax, AIS / TIS, the books' figures, and the ITR-4
// file from build to filing, through a real database with row-level security.
const h = makeHarness();
afterAll(() => h.close());
const FY = '2025-26';
/** Rows as the database holds them, read inside the tenant (the policies apply to the test too). */
const rowsOf = (t: { orgId: string }, q: ReturnType<typeof sql>) =>
  withTenant(h.db, t.orgId, async (tx) => [...(await tx.execute(q))] as Record<string, any>[]);
const ACCOUNT = '50100123456789';
const AADHAAR = '987654321098';

const profile = (t: { businessId: string }, over: Record<string, unknown> = {}) => ({
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
  aadhaar: AADHAAR,
  employerCategory: 'NA',
  place: 'Chennai',
  bankAccounts: [
    {
      ifsc: 'HDFC0000123',
      bankName: 'HDFC Bank',
      accountNo: ACCOUNT,
      accountType: 'SB',
      useForRefund: true,
    },
  ],
  ...over,
});
const particulars = {
  sundryCreditors: 200000,
  inventories: 500000,
  sundryDebtors: 300000,
  balWithBanks: 150000,
  cashInHand: 50000,
  partnerMemberOwnCapital: 700000,
};
const professionalDraft = (over: Record<string, unknown> = {}) => ({
  regime: 'new',
  business: {
    section: '44ADA',
    code: '16001',
    name: 'Kumar & Associates',
    description: '',
    digitalReceipts: 4_000_000,
    cashReceipts: 0,
    particulars,
  },
  ...over,
});
const putDraft = (t: Tenant, data: Record<string, unknown>, fy = FY) =>
  t.call('PUT', '/v1/itr-drafts', { businessId: t.businessId, fy, data });
const challan = (t: Tenant, over: Record<string, unknown> = {}) =>
  t.call('POST', '/v1/tax-challans', {
    businessId: t.businessId,
    fy: FY,
    bsr: '0510308',
    date: '2026-03-14',
    serial: 12345,
    amount: 100_000,
    ...over,
  });

describe('sealing sensitive values', () => {
  const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x:y@localhost:5432/z' });
  const org = '11111111-1111-4111-8111-111111111111';
  it('round-trips, never stores the plain text, and can not be opened for another organization', () => {
    const sealed = sealField(env, org, AADHAAR);
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain(AADHAAR);
    expect(openField(env, org, sealed)).toBe(AADHAAR);
    expect(openField(env, '22222222-2222-4222-8222-222222222222', sealed)).toBeNull();
    expect(sealField(env, org, AADHAAR)).not.toBe(sealed); // a fresh IV every time
    expect(openField(env, org, `${sealed.slice(0, -4)}AAAA`)).toBeNull(); // tampering is noticed
    expect(openField(env, org, '')).toBe('');
    expect(sealField(env, org, '')).toBe('');
  });
});

describe('taxpayer profile', () => {
  it('saves, masks what is secret on the way out, and keeps it sealed in the database', async () => {
    const t = await h.newTenant();
    expect(
      (await t.call('GET', `/v1/taxpayer-profile?businessId=${t.businessId}`)).body.profile,
    ).toBeNull();
    const put = await t.call('PUT', '/v1/taxpayer-profile', profile(t));
    expect(put.status, put.text).toBe(200);
    const p = put.body.profile;
    expect(p).toMatchObject({
      pan: 'ABCPK1234F',
      hasAadhaar: true,
      aadhaarMasked: '•••• •••• 1098',
    });
    expect(p.bankAccounts[0]).toMatchObject({
      accountNoMasked: '•••• 6789',
      ifsc: 'HDFC0000123',
      useForRefund: true,
    });
    expect(put.text).not.toContain(ACCOUNT);
    expect(put.text).not.toContain(AADHAAR);
    // In the database: sealed, not plain.
    const [row] = await rowsOf(
      t,
      sql`select aadhaar_sealed, bank_accounts from taxpayer_profiles where business_id = ${t.businessId}`,
    );
    expect(String(row!.aadhaar_sealed)).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toContain(AADHAAR);
    expect(JSON.stringify(row)).not.toContain(ACCOUNT);
    // The audit row says it happened, not what was in it.
    const audit = (await t.call('GET', '/v1/audit?q=taxpayer&limit=10')).body.data;
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain('ABCPK1234F');
  });

  it('a blank Aadhaar or account number keeps what was saved; clearAadhaar removes it', async () => {
    const t = await h.newTenant();
    const first = (await t.call('PUT', '/v1/taxpayer-profile', profile(t))).body.profile;
    const again = await t.call(
      'PUT',
      '/v1/taxpayer-profile',
      profile(t, {
        aadhaar: '',
        surname: 'Kumar Jr',
        bankAccounts: [
          {
            id: first.bankAccounts[0].id,
            ifsc: 'HDFC0000123',
            bankName: 'HDFC Bank',
            accountNo: '',
            accountType: 'SB',
            useForRefund: true,
          },
        ],
      }),
    );
    expect(again.body.profile).toMatchObject({
      surname: 'Kumar Jr',
      hasAadhaar: true,
      aadhaarMasked: '•••• •••• 1098',
    });
    expect(again.body.profile.bankAccounts[0].accountNoMasked).toBe('•••• 6789');
    const cleared = await t.call(
      'PUT',
      '/v1/taxpayer-profile',
      profile(t, {
        aadhaar: '',
        clearAadhaar: true,
        bankAccounts: again.body.profile.bankAccounts.map((b: any) => ({ ...b, accountNo: '' })),
      }),
    );
    expect(cleared.body.profile).toMatchObject({ hasAadhaar: false, aadhaarMasked: '' });
  });

  it('refuses bad input: PAN, two refund accounts, a new account with no number, an account of another profile', async () => {
    const t = await h.newTenant();
    expect(
      (await t.call('PUT', '/v1/taxpayer-profile', profile(t, { pan: 'ABCDE12345' }))).status,
    ).toBe(400);
    expect(
      (await t.call('PUT', '/v1/taxpayer-profile', profile(t, { aadhaar: '12345' }))).status,
    ).toBe(400);
    const two = [
      {
        ifsc: 'HDFC0000123',
        bankName: 'A',
        accountNo: '111',
        accountType: 'SB',
        useForRefund: true,
      },
      {
        ifsc: 'ICIC0000123',
        bankName: 'B',
        accountNo: '222',
        accountType: 'SB',
        useForRefund: true,
      },
    ];
    expect(
      (await t.call('PUT', '/v1/taxpayer-profile', profile(t, { bankAccounts: two }))).status,
    ).toBe(422);
    expect(
      (
        await t.call(
          'PUT',
          '/v1/taxpayer-profile',
          profile(t, {
            bankAccounts: [
              {
                ifsc: 'HDFC0000123',
                bankName: 'A',
                accountNo: '',
                accountType: 'SB',
                useForRefund: true,
              },
            ],
          }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await t.call(
          'PUT',
          '/v1/taxpayer-profile',
          profile(t, {
            bankAccounts: [
              {
                ifsc: 'HDFC0000123',
                bankName: 'A',
                accountNo: 'a b',
                accountType: 'SB',
                useForRefund: true,
              },
            ],
          }),
        )
      ).status,
    ).toBe(422);
  });

  it('warns when the PAN differs from the one inside the GSTIN', async () => {
    const t = await h.newTenant();
    await t.call('PATCH', `/v1/businesses/${t.businessId}`, { gstin: '33AAPFU0939F1ZV' });
    const r = await t.call('PUT', '/v1/taxpayer-profile', profile(t));
    expect(r.body.warnings[0]).toMatch(/AAPFU0939F/);
  });

  it('is private to the organization and to roles that prepare returns', async () => {
    const a = await h.newTenant();
    const b = await h.newTenant();
    await a.call('PUT', '/v1/taxpayer-profile', profile(a));
    // Another organization can not even find the business.
    expect((await b.call('GET', `/v1/taxpayer-profile?businessId=${a.businessId}`)).status).toBe(
      404,
    );
    expect((await b.call('PUT', '/v1/taxpayer-profile', profile(a))).status).toBe(404);
    for (const role of ['viewer', 'biller', 'salesman']) {
      const m = await h.addMember(a, role);
      expect(
        (await m.call('GET', `/v1/taxpayer-profile?businessId=${a.businessId}`)).status,
        role,
      ).toBe(403);
    }
    for (const role of ['accountant', 'ca', 'admin']) {
      const m = await h.addMember(a, role);
      expect(
        (await m.call('GET', `/v1/taxpayer-profile?businessId=${a.businessId}`)).status,
        role,
      ).toBe(200);
    }
  });
});

describe('challans', () => {
  it('records, lists by year with each challan’s kind, refuses repeats, wrong dates and bad codes', async () => {
    const t = await h.newTenant();
    const c = await challan(t);
    expect(c.status, c.text).toBe(201);
    expect(c.body).toMatchObject({
      bsr: '0510308',
      serial: 12345,
      amount: 100_000,
      kind: 'advance',
      fy: FY,
    });
    expect((await challan(t)).status).toBe(409); // same BSR, date and serial
    expect((await challan(t, { serial: 12346 })).status).toBe(201);
    expect((await challan(t, { date: '2026-04-20', serial: 1 })).body.kind).toBe('self_assessment');
    expect((await challan(t, { date: '2025-03-31', serial: 2 })).status).toBe(422); // before the year began
    expect((await challan(t, { date: '2099-01-01', serial: 3 })).status).toBe(422); // the future
    expect((await challan(t, { bsr: '12', serial: 4 })).status).toBe(400);
    expect((await challan(t, { amount: 0, serial: 5 })).status).toBe(400);
    expect((await challan(t, { fy: '2027-28', date: '2026-04-20', serial: 6 })).status).toBe(422); // no rules for that year
    const list = (await t.call('GET', `/v1/tax-challans?businessId=${t.businessId}&fy=${FY}`)).body
      .data;
    expect(list.map((x: any) => [x.serial, x.kind])).toEqual([
      [1, 'self_assessment'],
      [12346, 'advance'],
      [12345, 'advance'],
    ]);
    expect(
      (await t.call('GET', `/v1/tax-challans?businessId=${t.businessId}&fy=2024-25`)).body.data,
    ).toEqual([]);
  });

  it('can be corrected and removed; the edit log keeps what they were', async () => {
    const t = await h.newTenant();
    const id = (await challan(t)).body.id;
    expect((await t.call('PATCH', `/v1/tax-challans/${id}`, { amount: 90_000 })).body.amount).toBe(
      90_000,
    );
    expect((await t.call('PATCH', `/v1/tax-challans/${id}`, { date: '2025-01-01' })).status).toBe(
      422,
    );
    expect((await t.call('DELETE', `/v1/tax-challans/${id}`)).status).toBe(200);
    expect((await t.call('GET', `/v1/tax-challans?businessId=${t.businessId}`)).body.data).toEqual(
      [],
    );
    expect((await t.call('DELETE', `/v1/tax-challans/${id}`)).status).toBe(404);
    // The same challan can be entered again after a delete.
    expect((await challan(t)).status).toBe(201);
    const log = (await t.call('GET', `/v1/edit-log?table=tax_challans&rowId=${id}`)).body.data;
    expect(log.map((r: any) => r.action)).toEqual(expect.arrayContaining(['INSERT', 'UPDATE']));
    expect(log.find((r: any) => r.changed.includes('amount')).before.amount).toBe(100_000);
  });

  it('only people who prepare returns can change them; another organization sees none', async () => {
    const a = await h.newTenant();
    const b = await h.newTenant();
    const id = (await challan(a)).body.id;
    expect((await b.call('GET', `/v1/tax-challans?businessId=${a.businessId}`)).status).toBe(404);
    expect((await b.call('PATCH', `/v1/tax-challans/${id}`, { amount: 1 })).status).toBe(404);
    const viewer = await h.addMember(a, 'viewer');
    expect((await viewer.call('GET', `/v1/tax-challans?businessId=${a.businessId}`)).status).toBe(
      200,
    );
    expect(
      (
        await viewer.call('POST', '/v1/tax-challans', {
          businessId: a.businessId,
          fy: FY,
          bsr: '0510308',
          date: '2026-03-14',
          serial: 9,
          amount: 5,
        })
      ).status,
    ).toBe(403);
  });
});

describe('drafts', () => {
  it('start from defaults, save, and refuse a year with no rules', async () => {
    const t = await h.newTenant();
    const first = (await t.call('GET', `/v1/itr-drafts?businessId=${t.businessId}&fy=${FY}`)).body;
    expect(first.savedAt).toBeNull();
    expect(first.data).toMatchObject({ regime: 'new', business: null, salary: null });
    expect(first.data.declarations.houseProperty).toBe(false);
    expect((await putDraft(t, professionalDraft())).status).toBe(200);
    const again = (await t.call('GET', `/v1/itr-drafts?businessId=${t.businessId}&fy=${FY}`)).body;
    expect(again.savedAt).not.toBeNull();
    expect(again.data.business).toMatchObject({ section: '44ADA', digitalReceipts: 4_000_000 });
    expect((await putDraft(t, professionalDraft({ regime: 'older' }))).status).toBe(400);
    expect((await putDraft(t, professionalDraft(), '2019-20')).status).toBeLessThan(500);
    expect(
      (await t.call('GET', `/v1/itr-drafts?businessId=${t.businessId}&fy=2019-20`)).status,
    ).toBe(422);
  });
});

/** A sale as the billing screens save it, with its totals worked out by the same engine. */
function sale(
  profileDoc: Record<string, unknown>,
  no: string,
  date: string,
  rate: number,
  payments: { amount?: number; mode: string }[] = [],
) {
  const client = { name: 'Customer', state: 'Tamil Nadu', gstin: '', country: 'India' };
  const items = [{ name: 'Goods', hsn: '8471', quantity: 1, rate, taxPercent: 18, unit: 'NOS' }];
  const details = { invoiceNumber: no, invoiceDate: date, placeOfSupply: 'Tamil Nadu' };
  const totals = computeInvoiceTotals({
    items,
    profile: profileDoc,
    client,
    details,
    showGST: true,
    taxInclusive: false,
    invoiceOptions: {},
  });
  return {
    id: no,
    clientName: client.name,
    invoiceNumber: no,
    invoiceDate: date,
    invoiceType: 'tax-invoice',
    currency: 'INR',
    totalAmount: totals.total,
    totalTaxAmount: totals.totalTaxAmount ?? 0,
    status: 'unpaid',
    paidAmount: 0,
    payments: payments.map((p) => ({ ...p, amount: p.amount ?? totals.total })),
    data: {
      profile: profileDoc,
      client,
      details,
      items,
      totals,
      invoiceType: 'tax-invoice',
      taxInclusive: false,
      invoiceOptions: {},
    },
  };
}

describe('the books, for a return', () => {
  it('turnover without GST, and how it was received (what is not yet received counts with cash)', async () => {
    const t = await h.newTenant();
    const prof = (await t.call('GET', '/v1/workspace/profile')).body;
    // ₹1,00,000 paid by UPI, ₹1,00,000 paid in cash, ₹1,00,000 not yet paid; each plus 18% GST.
    for (const b of [
      sale(prof, 'S1', '2025-06-10', 100_000, [{ mode: 'upi' }]),
      sale(prof, 'S2', '2025-07-10', 100_000, [{ mode: 'cash' }]),
      sale(prof, 'S3', '2025-08-10', 100_000),
      sale(prof, 'S4', '2026-04-10', 999_999),
    ])
      expect((await t.call('POST', '/v1/workspace/collections/bills', b)).status).toBeLessThan(300);
    const books = (await t.call('GET', `/v1/itr-books?businessId=${t.businessId}&fy=${FY}`)).body;
    expect(books.turnover).toBe(300_000); // S4 is next year's
    expect(books.digitalShare).toBe(33.3);
    expect(books).toMatchObject({ digitalReceipts: 100_000, cashReceipts: 200_000, fy: FY });
  });
  it('is the same for a business with no GSTIN, with no GST turnover to report', async () => {
    const t = await h.newTenant();
    expect(
      (await t.call('GET', `/v1/itr-books?businessId=${t.businessId}&fy=${FY}`)).body,
    ).toMatchObject({ turnover: 0, gstTurnover: [] });
  });
});

describe('advance tax', () => {
  it('plans the year from the return’s entries and the challans paid', async () => {
    const t = await h.newTenant();
    await t.call('PUT', '/v1/taxpayer-profile', profile(t));
    await putDraft(t, professionalDraft());
    const q = (asOf: string) =>
      t.call('GET', `/v1/advance-tax?businessId=${t.businessId}&fy=${FY}&asOf=${asOf}`);
    const before = (await q('2025-10-01')).body;
    expect(before).toMatchObject({
      applies: true,
      mode: 'presumptive',
      projectedTax: 208_000,
      payNow: 0,
    });
    expect(before.rows).toHaveLength(1);
    expect(before.basis).toMatchObject({
      receiptsFrom: 'return',
      section: '44ADA',
      regime: 'new',
      profileMissing: false,
    });
    await challan(t, { date: '2026-03-10', serial: 1, amount: 104_050 });
    const after = (await q('2026-03-20')).body;
    expect(after.rows[0]).toMatchObject({
      status: 'overdue',
      shortfall: 103_950,
      paidByDate: 104_050,
    });
    expect(after.payNow).toBe(103_950);
    expect(after.interest234C).toBe(1_039);
    expect(after.dueDates).toHaveLength(4);
  });
  it('without a return entered it uses the books, annualised while the year runs, and says the profile is missing', async () => {
    const t = await h.newTenant();
    const prof = (await t.call('GET', '/v1/workspace/profile')).body;
    await t.call(
      'POST',
      '/v1/workspace/collections/bills',
      sale(prof, 'A1', '2025-04-20', 1_000_000, [{ mode: 'upi' }]),
    );
    const r = (
      await t.call('GET', `/v1/advance-tax?businessId=${t.businessId}&fy=${FY}&asOf=2025-06-29`)
    ).body;
    expect(r.basis).toMatchObject({
      receiptsFrom: 'books',
      annualised: true,
      profileMissing: true,
    });
    expect(r.basis.digitalReceipts).toBeGreaterThan(1_000_000); // 70 days of the year, scaled to 365
  });
});

describe('AIS / TIS', () => {
  const CSV = `Information Category,Information Source,TAN/PAN,Reported Value,Tax Deducted,Section
Interest from savings bank,HDFC BANK,CHEH12345A,12500,0,
TDS - payment to contractors,ACME CONTRACTORS PVT LTD,CHEA12345B,500000,10000,194C
`;
  it('previews a file without saving, saves the confirmed rows, replaces a file of the same kind, and reconciles', async () => {
    const t = await h.newTenant();
    const pre = await t.call('POST', '/v1/ais-imports/preview', { text: CSV });
    expect(pre.body.errors).toEqual([]);
    expect(pre.body.rows.map((r: any) => r.category)).toEqual(['interest_savings', 'tds']);
    expect(
      (await t.call('GET', `/v1/ais-imports?businessId=${t.businessId}&fy=${FY}`)).body.data,
    ).toEqual([]); // nothing saved by a preview
    expect(
      (await t.call('GET', `/v1/ais-imports/reconcile?businessId=${t.businessId}&fy=${FY}`)).body,
    ).toEqual({ imported: false });
    const save = (rows: unknown[]) =>
      t.call('POST', '/v1/ais-imports', {
        businessId: t.businessId,
        fy: FY,
        kind: 'ais',
        fileName: 'ais.csv',
        rows,
      });
    expect((await save(pre.body.rows)).status).toBe(201);
    expect((await save(pre.body.rows)).status).toBe(201); // the same kind again replaces
    const listed = (await t.call('GET', `/v1/ais-imports?businessId=${t.businessId}&fy=${FY}`)).body
      .data;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ kind: 'ais', fileName: 'ais.csv', rows: 2 });
    const rec = (
      await t.call('GET', `/v1/ais-imports/reconcile?businessId=${t.businessId}&fy=${FY}`)
    ).body;
    expect(rec.imported).toBe(true);
    // Nothing in the books or the return yet: the interest is only in AIS, and the TDS is credit not recorded.
    const codes = rec.issues.map((i: any) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['AIS_INTEREST_SAVINGS', 'AIS_TDS_UNRECORDED']));
    expect((await t.call('DELETE', `/v1/ais-imports/${listed[0].id}`)).status).toBe(200);
    expect(
      (await t.call('GET', `/v1/ais-imports/reconcile?businessId=${t.businessId}&fy=${FY}`)).body
        .imported,
    ).toBe(false);
  });
  it('a file it can not read is an error, and a bad row is refused', async () => {
    const t = await h.newTenant();
    expect(
      (await t.call('POST', '/v1/ais-imports/preview', { text: 'a,b\n1,2' })).body.errors[0],
    ).toMatch(/Could not find the columns/);
    expect(
      (
        await t.call('POST', '/v1/ais-imports', {
          businessId: t.businessId,
          fy: FY,
          kind: 'ais',
          rows: [],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await t.call('POST', '/v1/ais-imports', {
          businessId: t.businessId,
          fy: FY,
          kind: 'ais',
          rows: [{ category: 'nonsense', description: 'x', reported: 1 }],
        })
      ).status,
    ).toBe(400);
  });
  it('the return’s own entries are what AIS is compared with', async () => {
    const t = await h.newTenant();
    await putDraft(
      t,
      professionalDraft({
        otherSources: {
          savingsInterest: 12_500,
          depositInterest: 0,
          refundInterest: 0,
          dividend: [0, 0, 0, 0, 0],
          other: [],
        },
        tds: [
          {
            tan: 'CHEA12345B',
            name: 'Acme Contractors Pvt Ltd',
            section: '94C',
            gross: 500_000,
            tdsDeducted: 10_000,
            tdsClaimed: 10_000,
            headOfIncome: 'BP',
          },
        ],
      }),
    );
    const rows = (await t.call('POST', '/v1/ais-imports/preview', { text: CSV })).body.rows;
    await t.call('POST', '/v1/ais-imports', {
      businessId: t.businessId,
      fy: FY,
      kind: 'ais',
      rows,
    });
    const rec = (
      await t.call('GET', `/v1/ais-imports/reconcile?businessId=${t.businessId}&fy=${FY}`)
    ).body;
    expect(rec.issues.filter((i: any) => /INTEREST|TDS/.test(i.code))).toEqual([]);
    expect(rec.tds.rows[0].status).toBe('matched');
  });
});

describe('ITR-4: from the inputs to a filed return', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await h.newTenant();
  });
  const build = (filedOn = '2026-11-16', who: { call: Tenant['call'] } = t) =>
    who.call('POST', '/v1/filing-packs/build/itr4', { businessId: t.businessId, fy: FY, filedOn });

  it('asks for the taxpayer details first, then says what is missing, in the department’s terms', async () => {
    const r = await build();
    expect(r.body).toMatchObject({ ok: false, payload: null });
    expect(r.body.issues[0].code).toBe('PROFILE_MISSING');
    await t.call('PUT', '/v1/taxpayer-profile', profile(t));
    const noBusiness = await build();
    expect(noBusiness.body.ok).toBe(false);
    expect(noBusiness.body.issues.map((i: any) => i.code)).toContain('ITR4_NO_BUSINESS');
  });

  it('refuses what ITR-4 can not take, and a year with no schema', async () => {
    await putDraft(t, professionalDraft({ declarations: { houseProperty: true } }));
    const r = await build();
    expect(r.body.ok).toBe(false);
    expect(
      r.body.issues.some(
        (i: any) => i.code === 'ITR4_NOT_ELIGIBLE' && /house property/i.test(i.message),
      ),
    ).toBe(true);
    const next = await t.call('POST', '/v1/filing-packs/build/itr4', {
      businessId: t.businessId,
      fy: '2026-27',
      filedOn: '2027-07-01',
    });
    expect(next.body.ok).toBe(false);
    expect(next.body.issues.map((i: any) => i.code)).toContain('ITR4_NO_SCHEMA');
  });

  it('builds the return, works out the tax and passes every check', async () => {
    await putDraft(t, professionalDraft());
    expect((await challan(t, { date: '2026-03-14', serial: 12345, amount: 100_000 })).status).toBe(
      201,
    );
    const r = await build('2026-11-16');
    expect(r.status, r.text).toBe(200);
    expect(r.body.issues.filter((i: any) => i.severity === 'error')).toEqual([]);
    expect(r.body.ok).toBe(true);
    expect(r.body).toMatchObject({ kind: 'itr4', period: '032026' });
    const c = r.body.computation;
    // ₹40 lakh of receipts at 50% is ₹20 lakh: tax ₹2,00,000 + 4% cess = ₹2,08,000, a late return with ₹1 lakh paid in advance.
    expect(c).toMatchObject({
      businessIncome: 2_000_000,
      totalIncome: 2_000_000,
      taxOnTotalIncome: 200_000,
      cess: 8_000,
      netTaxLiability: 208_000,
      advanceTaxPaid: 100_000,
      fee234F: 5_000,
      returnFileSection: 12,
    });
    const d = r.body.payload.ITR.ITR4;
    expect(d.PersonalInfo.PAN).toBe('ABCPK1234F');
    expect(d.PersonalInfo.AadhaarCardNo).toBe(AADHAAR); // unsealed for the file
    expect(d.Refund.BankAccountDtls.AddtnlBankDetails[0].BankAccountNo).toBe(ACCOUNT);
    expect(d.ScheduleIT.TaxPayment).toEqual([
      { BSRCode: '0510308', DateDep: '2026-03-14', SrlNoOfChaln: 12345, Amt: 100_000 },
    ]);
    expect(r.body.issues.map((i: any) => i.code)).toContain('SW_CODE_UNREGISTERED'); // honest about the unregistered software id
  });

  it('uses the software id when one is configured, and the books when no receipts were entered', async () => {
    const t2 = await h.newTenant();
    await t2.call('PUT', '/v1/taxpayer-profile', profile(t2));
    const prof = (await t2.call('GET', '/v1/workspace/profile')).body;
    await t2.call(
      'POST',
      '/v1/workspace/collections/bills',
      sale(prof, 'B1', '2025-09-10', 500_000, [{ mode: 'upi' }]),
    );
    await putDraft(t2, {
      regime: 'new',
      business: {
        section: '44AD',
        code: '09002',
        name: 'Traders',
        digitalReceipts: 0,
        cashReceipts: 0,
        particulars,
      },
    });
    const r = await t2.call('POST', '/v1/filing-packs/build/itr4', {
      businessId: t2.businessId,
      fy: FY,
      filedOn: '2026-08-10',
    });
    expect(r.body.ok, JSON.stringify(r.body.issues)).toBe(true);
    // ₹5,00,000 by UPI: 6% = ₹30,000, from the books.
    expect(r.body.computation.businessIncome).toBe(30_000);
  });

  it('saved as a pack it is checked again by the server (rules and schema), reviewed and filed with its acknowledgement number', async () => {
    const built = (await build('2026-11-16')).body;
    const save = (payload: unknown) =>
      t.call('POST', '/v1/filing-packs', {
        businessId: t.businessId,
        kind: 'itr4',
        period: built.period,
        payload,
      });
    // Tampered: the server catches it even though the build was fine.
    const bad = structuredClone(built.payload);
    bad.ITR.ITR4.TaxComputation.TaxPayableOnRebate += 5;
    const caught = await save(bad);
    expect(caught.status).toBe(201);
    expect(caught.body).toMatchObject({ status: 'draft', ready: false });
    const issues = (await t.call('GET', `/v1/filing-packs/${caught.body.id}`)).body.issues.map(
      (i: any) => i.code,
    );
    expect(issues).toContain('R52');
    // The honest file is ready.
    const pack = await save(built.payload);
    expect(pack.body).toMatchObject({
      kind: 'itr4',
      kindLabel: 'ITR-4',
      status: 'ready',
      periodFrom: '2025-04-01',
      periodTo: '2026-03-31',
      errors: 0,
    });
    // Not a GST return: it locks no month.
    const ca = await h.addMember(t, 'ca');
    expect(
      (await t.call('POST', `/v1/filing-packs/${pack.body.id}/submit-review`, {})).body.status,
    ).toBe('in_review');
    expect(
      (await ca.call('POST', `/v1/filing-packs/${pack.body.id}/approve`, {})).body.status,
    ).toBe('approved');
    const filed = (ack: string, filedOn: string) =>
      ca.call('POST', `/v1/filing-packs/${pack.body.id}/record-filed`, { arn: ack, filedOn });
    expect((await filed('AA331126123456Z', '2026-11-16')).status).toBe(422); // a GST ARN is not an acknowledgement number
    expect((await filed('12345', '2026-11-16')).status).toBe(422);
    // Built for a belated return (16 November), filed by the due date: it must be built again.
    expect((await filed('123456789012345', '2026-08-20')).status).toBe(422);
    const done = await filed('123456789012345', '2026-11-16');
    expect(done.status, done.text).toBe(200);
    expect(done.body).toMatchObject({ status: 'filed', arn: '123456789012345' });
    const prefs = await rowsOf(
      t,
      sql`select preferences from business_settings where business_id = ${t.businessId}`,
    );
    expect(JSON.stringify(prefs)).not.toContain('2026-03'); // no GST filed-month lock from an ITR
  });

  it('the edit log keeps the pack’s fingerprint, never a second copy of the file (it holds PAN, Aadhaar and accounts)', async () => {
    const [p] = await rowsOf(
      t,
      sql`select id, sha256 from filing_packs where business_id = ${t.businessId} and kind = 'itr4' order by created_at desc limit 1`,
    );
    const rows = await rowsOf(
      t,
      sql`select new_row from edit_log where table_name = 'filing_packs' and row_id = ${p!.id}`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(Object.keys(r.new_row)).not.toContain('payload');
      expect(JSON.stringify(r.new_row)).not.toContain(AADHAAR);
      expect(JSON.stringify(r.new_row)).not.toContain(ACCOUNT);
    }
    expect(rows.some((r) => r.new_row.sha256 === p!.sha256)).toBe(true);
  });

  it('a business with no GSTIN can still prepare an income-tax return, but not a GST one', async () => {
    const t3 = await h.newTenant();
    await t3.call('PUT', '/v1/taxpayer-profile', profile(t3));
    await putDraft(t3, professionalDraft());
    const b = await t3.call('POST', '/v1/filing-packs/build/itr4', {
      businessId: t3.businessId,
      fy: FY,
      filedOn: '2026-08-10',
    });
    expect(b.body.ok, JSON.stringify(b.body.issues)).toBe(true);
    expect(
      (
        await t3.call('POST', '/v1/filing-packs', {
          businessId: t3.businessId,
          kind: 'itr4',
          period: b.body.period,
          payload: b.body.payload,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await t3.call('POST', '/v1/filing-packs', {
          businessId: t3.businessId,
          kind: 'gstr1',
          period: '102026',
          payload: {},
        })
      ).status,
    ).toBe(422);
  });

  it('only people who prepare returns can build one; another organization can not', async () => {
    const other = await h.newTenant();
    expect((await build('2026-11-16', other)).status).toBe(404);
    const viewer = await h.addMember(t, 'viewer');
    expect((await build('2026-11-16', viewer)).status).toBe(403);
  });
});

describe('the register’s income-tax half', () => {
  it('lists the advance-tax dates with what was paid by each, and the ITR with its due date and status', async () => {
    const t = await h.newTenant();
    await challan(t, { date: '2025-06-10', serial: 1, amount: 20_000 });
    await challan(t, { date: '2025-11-30', serial: 2, amount: 50_000 });
    const c = (await t.call('GET', `/v1/income-tax-calendar?businessId=${t.businessId}&fy=${FY}`))
      .body;
    expect(c.label).toBe('AY 2026-27 (income of FY 2025-26)');
    expect(c.advanceTax.map((a: any) => [a.dueDate, a.cumulativePct, a.paidByDate])).toEqual([
      ['2025-06-15', 0.15, 20_000],
      ['2025-09-15', 0.45, 20_000],
      ['2025-12-15', 0.75, 70_000],
      ['2026-03-15', 1, 70_000],
    ]);
    expect(c.itr).toMatchObject({
      form: 'ITR-4',
      dueDate: '2026-08-31',
      status: 'not_started',
      schemaAvailable: true,
      overdue: true,
      confidence: 'official',
    });
    const next = (
      await t.call('GET', `/v1/income-tax-calendar?businessId=${t.businessId}&fy=2026-27`)
    ).body;
    expect(next.itr).toMatchObject({ schemaAvailable: false, confidence: 'single-source' });
  });
});
