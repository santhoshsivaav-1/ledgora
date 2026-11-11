import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, withTenant } from '@ledgora/db';
import { and, eq, sql } from 'drizzle-orm';
import { DEFAULT_CHART } from '@ledgora/tax-engine';
import { line, makeHarness, type Tenant } from './helpers.ts';
import { repost } from '../src/modules/ledgerRules.ts';
import { clean, report } from '../src/backfillLedger.ts';

// Vyapar parity Phase 4 (ledger foundation) and P10-S4 / P10-S5, API layer
// (docs/VYAPAR_IMPLEMENTATION_PHASES.md, P4-S1…S7 acceptance and the Phase 4 acceptance list).
const h = makeHarness();
let t: Tenant;
let other: Tenant;

const party = async (
  who: Tenant,
  name = `P ${Math.random()}`,
  extra: Record<string, unknown> = {},
) => {
  const res = await who.call('POST', '/v1/parties', { name, state: 'Tamil Nadu', ...extra });
  expect(res.status, res.text).toBe(201);
  return res.body.id as string;
};
const saleBody = (who: Tenant, p: string, over: Record<string, unknown> = {}) => ({
  businessId: who.businessId,
  partyId: p,
  invoiceDate: '2026-11-05',
  items: [line({ quantity: 2, rate: 100, taxPercent: 18 })],
  ...over,
});
const sale = (who: Tenant, p: string, over: Record<string, unknown> = {}) =>
  who.call('POST', '/v1/invoices', saleBody(who, p, over));
const enable = async (who: Tenant) => {
  const r = await who.call('POST', '/v1/accounting/backfill', {
    businessId: who.businessId,
    dryRun: false,
  });
  expect(r.status, r.text).toBe(200);
  expect(r.body.enabled, JSON.stringify(r.body)).toBe(true);
  return r.body;
};
const chart = async (who: Tenant) =>
  (await who.call('GET', `/v1/accounts?businessId=${who.businessId}`)).body.data as any[];
const acct = async (who: Tenant, code: string) => (await chart(who)).find((a) => a.code === code);
/** Dr-positive closing balance of an account (optionally one party's). */
const closing = async (who: Tenant, code: string, partyId?: string) => {
  const a = await acct(who, code);
  const l = (await who.call('GET', `/v1/ledger/${a.id}${partyId ? `?partyId=${partyId}` : ''}`))
    .body;
  return l.closingSide === 'Dr' ? l.closing : -l.closing;
};
const trial = async (who: Tenant) =>
  (await who.call('GET', `/v1/ledger/trial-balance?businessId=${who.businessId}`)).body;
const rows = (who: Tenant, refType: string, refId: string) =>
  withTenant(h.db, who.orgId, (tx) =>
    tx
      .select()
      .from(schema.ledgerEntries)
      .where(and(eq(schema.ledgerEntries.refType, refType), eq(schema.ledgerEntries.refId, refId))),
  );
/** Raw SQL as the tenant (row-level security applies, so it only sees this organization's rows). */
const raw = (who: Tenant, q: ReturnType<typeof sql>) =>
  withTenant(h.db, who.orgId, (tx) => tx.execute(q));
/** The database's own message (drizzle wraps it in "Failed query"). */
const failure = async (p: Promise<unknown>) => {
  try {
    await p;
    return '';
  } catch (e: any) {
    return String(e?.cause?.message ?? e?.message ?? e);
  }
};
const count = (who: Tenant) =>
  withTenant(
    h.db,
    who.orgId,
    async (tx) =>
      (await tx.select({ n: sql<number>`count(*)::int` }).from(schema.ledgerEntries))[0].n,
  );
const bill = (who: Tenant, over: Record<string, unknown> = {}) =>
  who.call('POST', '/v1/purchases', {
    businessId: who.businessId,
    purchaseDate: '2026-11-05',
    invoiceNumber: `B-${Math.random().toString(36).slice(2, 8)}`,
    items: [{ name: 'Pen', quantity: 100, rate: 10, taxPercent: 18 }],
    ...over,
  });

beforeAll(async () => {
  t = await h.newTenant();
  other = await h.newTenant();
});
afterAll(() => h.close());

describe('P4-S1 chart of accounts and the database rules', () => {
  it('enabling the ledger seeds exactly the default chart, idempotently', async () => {
    const first = await enable(t);
    expect(first).toMatchObject({ documents: 0, problems: [], diffs: [] });
    const a = await chart(t);
    expect(a.map((x) => x.code).sort()).toEqual(DEFAULT_CHART.map((x) => x.code).sort());
    expect(a.find((x) => x.code === '1000')).toMatchObject({
      name: 'Cash in Hand',
      kind: 'asset',
      system: true,
    });
    await enable(t);
    expect(await chart(t)).toHaveLength(DEFAULT_CHART.length);
    const st = (await t.call('GET', `/v1/accounting/status?businessId=${t.businessId}`)).body;
    expect(st).toMatchObject({ enabled: true, accounts: DEFAULT_CHART.length, entries: 0 });
  });

  it('the database refuses an entry with both sides, an unbalanced voucher, and any update or delete by the app role', async () => {
    const cash = await acct(t, '1000');
    const base = {
      orgId: t.orgId,
      businessId: t.businessId,
      txnDate: '2026-11-01',
      accountId: cash.id,
      refType: 'journal',
      refId: crypto.randomUUID(),
      fy: '2026-27',
    };
    await expect(
      withTenant(h.db, t.orgId, (tx) =>
        tx
          .insert(schema.ledgerEntries)
          .values({ ...base, voucherId: crypto.randomUUID(), debit: 5, credit: 5 }),
      ),
    ).rejects.toThrow();
    // One-sided voucher: the deferred trigger fails the transaction at commit.
    await expect(
      withTenant(h.db, t.orgId, (tx) =>
        tx
          .insert(schema.ledgerEntries)
          .values({ ...base, voucherId: crypto.randomUUID(), debit: 10, credit: 0 }),
      ),
    ).rejects.toThrow(/not balanced/);
    const capital = await acct(t, '3000');
    const v = crypto.randomUUID();
    await withTenant(h.db, t.orgId, (tx) =>
      tx.insert(schema.ledgerEntries).values([
        { ...base, voucherId: v, debit: 10, credit: 0 },
        { ...base, accountId: capital.id, voucherId: v, debit: 0, credit: 10 },
      ]),
    );
    expect(
      await failure(
        withTenant(h.db, t.orgId, (tx) =>
          tx
            .update(schema.ledgerEntries)
            .set({ narration: 'x' })
            .where(eq(schema.ledgerEntries.voucherId, v)),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await failure(
        withTenant(h.db, t.orgId, (tx) =>
          tx.delete(schema.ledgerEntries).where(eq(schema.ledgerEntries.voucherId, v)),
        ),
      ),
    ).toMatch(/permission denied/);
    // That test voucher stays (nothing can remove it): cash against capital, which nets to a balanced book.
    expect((await trial(t)).balanced).toBe(true);
  });

  it('adds accounts in a group, posts an opening balance, and protects system accounts', async () => {
    const add = await t.call('POST', '/v1/accounts', {
      businessId: t.businessId,
      name: 'Rent',
      group: 'Indirect expense',
      opening: { amount: 1000, side: 'Dr', date: '2026-04-01' },
    });
    expect(add.status, add.text).toBe(201);
    expect(add.body).toMatchObject({ code: '5300', kind: 'expense', system: false, balance: 1000 });
    expect(await closing(t, '3100')).toBe(-1000); // the opening is against Opening Balance Equity
    expect(
      (
        await t.call('POST', '/v1/accounts', {
          businessId: t.businessId,
          code: '5300',
          name: 'Dup',
          group: 'Indirect expense',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await t.call('POST', '/v1/accounts', {
          businessId: t.businessId,
          name: 'Tax',
          group: 'Duties & taxes',
        })
      ).status,
    ).toBe(422);
    const duty = await t.call('POST', '/v1/accounts', {
      businessId: t.businessId,
      name: 'Cess credit',
      group: 'Duties & taxes',
      kind: 'asset',
    });
    expect(duty.body).toMatchObject({ code: '1540', kind: 'asset' });
    const cash = await acct(t, '1000');
    expect((await t.call('DELETE', `/v1/accounts/${cash.id}`)).status).toBe(422);
    expect((await t.call('PATCH', `/v1/accounts/${cash.id}`, { active: false })).status).toBe(422);
    expect((await t.call('PATCH', `/v1/accounts/${cash.id}`, { name: 'Till' })).status).toBe(200);
    expect((await t.call('DELETE', `/v1/accounts/${add.body.id}`)).status).toBe(409); // has entries
    expect((await t.call('DELETE', `/v1/accounts/${duty.body.id}`)).status).toBe(200);
    expect(
      (await t.call('GET', `/v1/accounts?businessId=${t.businessId}&q=till`)).body.data,
    ).toHaveLength(1);
    expect(await closing(t, '1000')).toBe(10); // the raw test voucher above is the only cash so far
  });
});

describe('P4-S3 posting wiring', () => {
  it('flag off: no ledger rows are written', async () => {
    const off = await h.newTenant();
    const p = await party(off);
    expect((await sale(off, p)).status).toBe(201);
    expect(await count(off)).toBe(0);
    expect((await off.call('GET', `/v1/accounts?businessId=${off.businessId}`)).body.data).toEqual(
      [],
    );
  });

  it('create → the expected vouchers; edit → reversal + new; unchanged edit → nothing; cancel → net zero', async () => {
    const p = await party(t);
    const body = saleBody(t, p);
    const inv = (await t.call('POST', '/v1/invoices', body)).body;
    expect(inv.total).toBe(236);
    const r1 = await rows(t, 'invoice', inv.id);
    expect(r1).toHaveLength(4);
    expect(await closing(t, '1300', p)).toBe(236);
    expect([await closing(t, '4000'), await closing(t, '2100'), await closing(t, '2110')]).toEqual([
      -200, -18, -18,
    ]);

    const same = await t.call('PUT', `/v1/invoices/${inv.id}`, { ...body, number: undefined });
    expect(same.status, same.text).toBe(200);
    expect(await rows(t, 'invoice', inv.id)).toHaveLength(4); // nothing changed, nothing written

    const edited = await t.call('PUT', `/v1/invoices/${inv.id}`, {
      ...body,
      items: [line({ quantity: 3, rate: 100, taxPercent: 18 })],
    });
    expect(edited.body.total).toBe(354);
    const r2 = await rows(t, 'invoice', inv.id);
    expect(r2).toHaveLength(12); // 4 original + 4 reversal + 4 new
    expect(r2.filter((r) => r.reversalOf)).toHaveLength(4);
    expect(await closing(t, '1300', p)).toBe(354);
    // The ledger view hides the reversed pair by default and shows it with all=1.
    const a = await acct(t, '1300');
    expect((await t.call('GET', `/v1/ledger/${a.id}?partyId=${p}`)).body.entries).toHaveLength(1);
    expect(
      (await t.call('GET', `/v1/ledger/${a.id}?partyId=${p}&all=1`)).body.entries,
    ).toHaveLength(3);

    expect((await t.call('POST', `/v1/invoices/${inv.id}/cancel`, {})).status).toBe(200);
    expect(await closing(t, '1300', p)).toBe(0);
    expect(await closing(t, '4000')).toBe(0);
    expect((await trial(t)).balanced).toBe(true);
  });

  it('a sale with money taken: one more voucher per payment, by mode; credit note refund too', async () => {
    const p = await party(t);
    const inv = (
      await sale(t, p, {
        payments: [
          { mode: 'cash', amount: 100 },
          { mode: 'upi', amount: 36 },
        ],
      })
    ).body;
    expect(await rows(t, 'invoice', inv.id)).toHaveLength(4 + 2 + 2);
    expect(await closing(t, '1300', p)).toBe(100);
    const cn = await sale(t, p, {
      invoiceType: 'credit-note',
      items: [line({ quantity: 1, rate: 100, taxPercent: 18 })],
      refund: { mode: 'bank', amount: 118 },
    });
    expect(cn.status, cn.text).toBe(201);
    expect(await closing(t, '1300', p)).toBe(100 - 118 + 118);
    expect(await closing(t, '4010')).toBeGreaterThanOrEqual(100);
  });

  it('receipts and payments out post with TDS and discount; deleting a payment reverses it', async () => {
    const p = await party(t);
    const inv = (await sale(t, p, { items: [line({ quantity: 1, rate: 1000, taxPercent: 0 })] }))
      .body;
    const rec = await t.call('POST', '/v1/payments', {
      businessId: t.businessId,
      partyId: p,
      amount: 900,
      tdsAmount: 50,
      discountAmount: 50,
      paymentDate: '2026-11-06',
      mode: 'bank',
      allocations: [{ invoiceId: inv.id, amount: 1000 }],
    });
    expect(rec.status, rec.text).toBe(201);
    expect(await closing(t, '1300', p)).toBe(0);
    expect(await closing(t, '1600')).toBe(50);
    expect((await t.call('DELETE', `/v1/payments/${rec.body.id}`)).status).toBe(200);
    expect(await closing(t, '1300', p)).toBe(1000);
    expect(await rows(t, 'payment', rec.body.id)).toHaveLength(8); // posted, then reversed
    expect(await closing(t, '1600')).toBe(0);
    const s = await party(t);
    const out = await t.call('POST', '/v1/payments', {
      businessId: t.businessId,
      partyId: s,
      direction: 'out',
      amount: 400,
      tdsAmount: 10,
      discountAmount: 5,
      tdsSection: '194C',
      paymentDate: '2026-11-06',
      mode: 'cheque',
      chequeDate: '2026-11-20',
    });
    expect(out.status, out.text).toBe(201);
    expect([
      await closing(t, '2000', s),
      await closing(t, '2400'),
      await closing(t, '2200'),
      await closing(t, '4110'),
    ]).toEqual([415, -400, -10, -5]);
    expect((await trial(t)).balanced).toBe(true);
  });

  it('purchases post (ITC split, RCM, §194Q TDS, payments); edit reposts; delete and Trash restore round-trip', async () => {
    const pt = await h.newTenant();
    await enable(pt);
    const s = await party(pt);
    const car = await bill(pt, {
      supplierId: s,
      items: [
        { name: 'Car', quantity: 1, rate: 1000, taxPercent: 28, itcStatus: 'ineligible_17_5' },
        { name: 'Pen', quantity: 10, rate: 10, taxPercent: 18 },
      ],
      payments: [{ mode: 'cash', amount: 500 }],
    });
    expect(car.status, car.text).toBe(201);
    // taxable 1100, tax 280 + 18, total 1398; credit claimed 18; 280 is cost.
    expect([
      await closing(pt, '5000'),
      await closing(pt, '5250'),
      (await closing(pt, '1500')) + (await closing(pt, '1510')),
    ]).toEqual([1100, 280, 18]);
    expect(await closing(pt, '2000', s)).toBe(-(1398 - 500)); // what we owe is a credit
    const rcm = await bill(pt, {
      supplierId: s,
      reverseCharge: true,
      tds194QPercent: 0.1,
      items: [{ name: 'Steel', quantity: 1, rate: 100000, taxPercent: 18 }],
    });
    expect(rcm.status, rcm.text).toBe(201);
    expect([await closing(pt, '2140'), await closing(pt, '2200')]).toEqual([-18000, -100]);
    expect(await closing(pt, '2000', s)).toBe(-(1398 - 500 + (100000 - 100)));

    expect((await pt.call('DELETE', `/v1/purchases/${car.body.id}`)).status).toBe(200);
    expect(await closing(pt, '2000', s)).toBe(-(100000 - 100));
    expect((await pt.call('POST', `/v1/trash/${car.body.id}/restore`)).status).toBe(200);
    // Trashing a bill removes the payments made with it for good (Phase 3), so the restored bill is unpaid again, and the
    // ledger agrees with the documents.
    expect(await closing(pt, '2000', s)).toBe(-(1398 + (100000 - 100)));
    expect((await trial(pt)).balanced).toBe(true);
  });

  it('expenses and other income post by category; a forced unbalanced posting rolls the document back too', async () => {
    const cats = (await t.call('GET', '/v1/expense-categories?kind=expense')).body.data;
    const e = await t.call('POST', '/v1/expenses', {
      businessId: t.businessId,
      expenseDate: '2026-11-06',
      categoryId: cats[0].id,
      amount: 1000,
      taxAmount: 180,
      paymentMode: 'bank',
      description: 'Rent',
    });
    expect(e.status, e.text).toBe(201);
    const own = (await chart(t)).find((x) => x.name === cats[0].name);
    expect(own).toMatchObject({ kind: 'expense', code: expect.stringMatching(/^51\d\d$/) });
    expect(own.balance).toBe(1000);
    const income = (await t.call('GET', '/v1/expense-categories?kind=income')).body.data[0];
    await t.call('POST', '/v1/expenses', {
      businessId: t.businessId,
      kind: 'income',
      expenseDate: '2026-11-06',
      categoryId: income.id,
      amount: 500,
      taxAmount: 0,
      exempt: true,
      paymentMode: 'cash',
    });
    expect(await closing(t, '4100')).toBe(-500);

    const before = await count(t);
    const cash = await acct(t, '1000');
    await expect(
      withTenant(h.db, t.orgId, async (tx) => {
        await tx.insert(schema.expenses).values({
          orgId: t.orgId,
          businessId: t.businessId,
          expenseDate: '2026-11-06',
          amount: 1,
        });
        await repost(tx, t.orgId, {
          businessId: t.businessId,
          refType: 'expense',
          refId: crypto.randomUUID(),
          postings: [
            {
              date: '2026-11-06',
              refType: 'expense',
              refId: 'x',
              lines: [{ account: '1000', debit: 99 }],
            },
          ],
        });
      }),
    ).rejects.toThrow(/not balanced/);
    expect(await count(t)).toBe(before);
    expect(cash.id).toBeTruthy();
  });
});

describe('P4-S4 backfill', () => {
  it('posts existing documents, matches party balances, is idempotent, and a dry run writes nothing', async () => {
    const b = await h.newTenant();
    const c1 = await party(b),
      c2 = await party(b),
      s1 = await party(b);
    const i1 = (await sale(b, c1, { payments: [{ mode: 'cash', amount: 50 }] })).body;
    const i2 = (await sale(b, c2, { items: [line({ quantity: 1, rate: 500, taxPercent: 5 })] }))
      .body;
    await sale(b, c1, {
      invoiceType: 'credit-note',
      items: [line({ quantity: 1, rate: 100, taxPercent: 18 })],
    });
    await b.call('POST', '/v1/payments', {
      businessId: b.businessId,
      partyId: c1,
      amount: 100,
      tdsAmount: 10,
      paymentDate: '2026-11-06',
      mode: 'upi',
      allocations: [{ invoiceId: i1.id, amount: 110 }],
    });
    await b.call('POST', '/v1/payments', {
      businessId: b.businessId,
      partyId: c2,
      amount: 100,
      paymentDate: '2026-11-06',
      mode: 'cash',
    });
    const pu = (await bill(b, { supplierId: s1, payments: [{ mode: 'bank', amount: 300 }] })).body;
    await bill(b, { supplierId: s1, reverseCharge: true });
    await b.call('POST', '/v1/purchases', {
      businessId: b.businessId,
      docType: 'debit-note',
      supplierId: s1,
      againstPurchaseId: pu.id,
      returnReason: 'purchase-return',
      purchaseDate: '2026-11-07',
      items: [{ name: 'Pen', quantity: 10, rate: 10, taxPercent: 18 }],
      refundMode: 'cash',
    });
    await b.call('POST', '/v1/payments', {
      businessId: b.businessId,
      partyId: s1,
      direction: 'out',
      amount: 200,
      tdsAmount: 5,
      tdsSection: '194C',
      paymentDate: '2026-11-08',
      mode: 'bank',
      autoAllocate: true,
    });
    const cats = (await b.call('GET', '/v1/expense-categories?kind=expense')).body.data;
    await b.call('POST', '/v1/expenses', {
      businessId: b.businessId,
      expenseDate: '2026-11-06',
      categoryId: cats[0].id,
      amount: 700,
      taxAmount: 126,
      paymentMode: 'cash',
      paidAmount: 300,
    });
    expect(i2.id).toBeTruthy();

    expect(await count(b)).toBe(0);
    const dry = (
      await b.call('POST', '/v1/accounting/backfill', { businessId: b.businessId, dryRun: true })
    ).body;
    expect(dry).toMatchObject({ dryRun: true, enabled: false, problems: [], diffs: [] });
    expect(dry.documents).toBeGreaterThanOrEqual(10);
    expect(dry.trialBalance.balanced).toBe(true);
    expect(await count(b)).toBe(0);
    expect((await b.call('GET', `/v1/accounts?businessId=${b.businessId}`)).body.data).toEqual([]);

    const real = await enable(b);
    expect(real).toMatchObject({
      documents: dry.documents,
      vouchers: dry.vouchers,
      diffs: [],
      problems: [],
    });
    const entries = await count(b);
    expect(entries).toBeGreaterThan(0);
    const tb1 = await trial(b);
    expect(tb1.balanced).toBe(true);
    // Idempotent: a second run changes nothing.
    await enable(b);
    expect(await count(b)).toBe(entries);
    expect(await trial(b)).toEqual(tb1);
    // Party balances worked out by hand: c1 owes 236 − 50 paid with it − 118 credit note − 110 receipt = −42 (an advance);
    // c2 owes 525 less a 100 receipt that is not applied to anything.
    expect(await closing(b, '1300', c1)).toBe(-42);
    expect(await closing(b, '1300', c2)).toBe(425);
    const v = (await b.call('GET', `/v1/verify?businessId=${b.businessId}`)).body;
    expect(v.checks.find((x: any) => x.id === 'party_balance_mismatch').count).toBe(0);
    expect(v.checks.find((x: any) => x.id === 'ledger_missing').count).toBe(0);
    // From here the documents post by themselves.
    await sale(b, c1);
    expect(await count(b)).toBeGreaterThan(entries);
  });

  it('the CLI stops on differences and prints the diff table (it has no --force)', () => {
    const base = {
      dryRun: false,
      documents: 3,
      vouchers: 4,
      problems: [],
      diffs: [],
      trialBalance: { debit: 100, credit: 100, balanced: true },
      enabled: true,
    };
    expect(clean(base)).toBe(true);
    expect(report(base)).toContain('every party matches');
    const bad = {
      ...base,
      enabled: false,
      diffs: [{ partyId: 'p-1', name: 'Asha Traders (receivable)', ledger: 236, documents: 200 }],
    };
    expect(clean(bad)).toBe(false);
    const text = report(bad);
    expect(text).toContain('Party balances that differ');
    expect(text).toMatch(/Asha Traders \(receivable\) │ p-1 *│ *236\.00 │ *200\.00 │ *36\.00/);
    expect(clean({ ...base, trialBalance: { debit: 1, credit: 2, balanced: false } })).toBe(false);
  });
});

describe('P4-S4 party opening balances', () => {
  it('a positive opening is receivable, a negative one payable; the check matches; changing it and posting again follows', async () => {
    const O = await h.newTenant();
    const owes = await party(O, 'Owes Us', { openingBalance: 500 });
    const owed = await party(O, 'We Owe', { openingBalance: -300 });
    await party(O, 'Zero');
    const inv = (await sale(O, owes, { items: [line({ quantity: 1, rate: 100, taxPercent: 0 })] }))
      .body;
    expect(inv.total).toBe(100);
    const dry = (
      await O.call('POST', '/v1/accounting/backfill', { businessId: O.businessId, dryRun: true })
    ).body;
    expect(dry).toMatchObject({ problems: [], diffs: [], vouchers: 3 }); // two openings and the invoice
    await enable(O);
    expect(await closing(O, '1300', owes)).toBe(600);
    expect(await closing(O, '2000', owed)).toBe(-300);
    expect(await closing(O, '3100')).toBe(-500 + 300); // Opening Balance Equity takes the other side
    expect((await trial(O)).balanced).toBe(true);
    const v = (await O.call('GET', `/v1/verify?businessId=${O.businessId}`)).body.checks;
    expect(v.find((c: any) => c.id === 'party_balance_mismatch').count).toBe(0);
    // The opening is edited behind the ledger's back: Verify notices, "Post history again" fixes it.
    await O.call('PATCH', `/v1/parties/${owes}`, { openingBalance: 200 });
    expect(
      (await O.call('GET', `/v1/verify?businessId=${O.businessId}`)).body.checks.find(
        (c: any) => c.id === 'party_balance_mismatch',
      ).count,
    ).toBe(1);
    await enable(O);
    expect(await closing(O, '1300', owes)).toBe(300);
    expect(
      (await O.call('GET', `/v1/verify?businessId=${O.businessId}`)).body.checks.find(
        (c: any) => c.id === 'party_balance_mismatch',
      ).count,
    ).toBe(0);
  });
});

describe('P4-S5 Verify My Data', () => {
  it('runs 14 checks, finds seeded problems, and the fixes are idempotent and audited', async () => {
    const v = await h.newTenant();
    const p = await party(v, 'Bad GSTIN', { gstin: '29ABCDE1234F1Z0' });
    const inv = (
      await sale(v, p, { items: [line({ quantity: 1, rate: 100, taxPercent: 18, hsn: '' })] })
    ).body;
    await enable(v);
    const run = async () => (await v.call('GET', `/v1/verify?businessId=${v.businessId}`)).body;
    const first = await run();
    expect(first.checks).toHaveLength(14);
    expect(first.checks.find((c: any) => c.id === 'gstin_invalid').count).toBe(1);
    expect(first.checks.find((c: any) => c.id === 'hsn_missing').count).toBe(1);
    expect(first.checks.find((c: any) => c.id === 'invoice_total_mismatch').count).toBe(0);

    // A document written behind the API's back: missing from the ledger until reposted.
    await raw(v, sql`update invoices set total = total + 50 where id = ${inv.id}`);
    expect((await run()).checks.find((c: any) => c.id === 'invoice_total_mismatch').count).toBe(1);
    await raw(v, sql`update invoices set total = total - 50 where id = ${inv.id}`);
    await raw(
      v,
      sql`insert into invoices (id, org_id, business_id, party_id, invoice_type, number, invoice_date, total, taxable_amount) values (gen_random_uuid(), ${v.orgId}, ${v.businessId}, ${p}, 'tax-invoice', 'RAW-1', '2026-11-09', 500, 500)`,
    );
    const missing = (await run()).checks.find((c: any) => c.id === 'ledger_missing');
    expect(missing).toMatchObject({ count: 1, fix: 'repost' });
    const fix = await v.call('POST', '/v1/verify/ledger_missing/fix', { businessId: v.businessId });
    expect(fix.status, fix.text).toBe(200);
    expect(fix.body.fixed).toBe(1);
    expect(fix.body.check.count).toBe(0);
    expect(
      (await v.call('POST', '/v1/verify/ledger_missing/fix', { businessId: v.businessId })).body
        .fixed,
    ).toBe(0); // idempotent
    expect(
      (await v.call('POST', '/v1/verify/gstin_invalid/fix', { businessId: v.businessId })).status,
    ).toBe(422);
    expect(
      ((await v.call('GET', '/v1/audit?q=verify.fix&limit=10')).body.data as any[]).some(
        (a) => a.action === 'verify.fix',
      ),
    ).toBe(true);

    // Over-allocation: made behind the API's back, trimmed by the fix.
    const pay = (
      await v.call('POST', '/v1/payments', {
        businessId: v.businessId,
        partyId: p,
        amount: 100,
        paymentDate: '2026-11-06',
        mode: 'cash',
        allocations: [{ invoiceId: inv.id, amount: 100 }],
      })
    ).body;
    await raw(v, sql`update payment_allocations set amount = 300 where payment_id = ${pay.id}`);
    expect(
      (await run()).checks.find((c: any) => c.id === 'payment_over_allocated').count,
    ).toBeGreaterThan(0);
    expect(
      (await v.call('POST', '/v1/verify/payment_over_allocated/fix', { businessId: v.businessId }))
        .body.check.count,
    ).toBe(0);
  });
});

describe('P4-S6 period lock and financial years', () => {
  it('every module refuses a write in a locked period; the owner overrides with a reason, audited', async () => {
    const L = await h.newTenant();
    const p = await party(L);
    const s = await party(L);
    await enable(L);
    const cash = await acct(L, '1000');
    const cap = await acct(L, '3000');
    const inv = (await sale(L, p, { invoiceDate: '2026-11-05' })).body;
    const pur = (await bill(L, { supplierId: s, purchaseDate: '2026-11-05' })).body;
    const exp = (
      await L.call('POST', '/v1/expenses', {
        businessId: L.businessId,
        expenseDate: '2026-11-05',
        amount: 10,
      })
    ).body;
    const pay = (
      await L.call('POST', '/v1/payments', {
        businessId: L.businessId,
        partyId: p,
        amount: 10,
        paymentDate: '2026-11-05',
        mode: 'cash',
      })
    ).body;
    const jv = (
      await L.call('POST', '/v1/journals', {
        businessId: L.businessId,
        date: '2026-11-05',
        narration: 'x',
        rows: [
          { accountId: cash.id, debit: 5 },
          { accountId: cap.id, credit: 5 },
        ],
      })
    ).body;
    const po = (
      await L.call('POST', '/v1/purchase-orders', {
        businessId: L.businessId,
        supplierId: s,
        orderDate: '2026-11-01',
        items: [{ name: 'Pen', quantity: 5, rate: 10, taxPercent: 0 }],
      })
    ).body;
    expect(
      (
        await L.call('PUT', '/v1/accounting/lock', {
          businessId: L.businessId,
          lockBefore: '2026-11-30',
          allowEditAfterGstFiled: false,
        })
      ).status,
    ).toBe(200);
    expect((await L.call('GET', `/v1/accounting/lock?businessId=${L.businessId}`)).body).toEqual({
      lockBefore: '2026-11-30',
      allowEditAfterGstFiled: false,
    });

    const attempts: [string, () => Promise<{ status: number; body: any }>][] = [
      ['invoice', () => sale(L, p, { invoiceDate: '2026-11-10' })],
      ['purchase', () => bill(L, { supplierId: s, purchaseDate: '2026-11-10' })],
      [
        'purchase edit',
        () =>
          L.call('PUT', `/v1/purchases/${pur.id}`, {
            businessId: L.businessId,
            supplierId: s,
            purchaseDate: '2026-12-10',
            invoiceNumber: pur.invoiceNumber,
            items: [{ name: 'Pen', quantity: 1, rate: 1, taxPercent: 0 }],
          }),
      ],
      ['purchase delete', () => L.call('DELETE', `/v1/purchases/${pur.id}`)],
      [
        'payment',
        () =>
          L.call('POST', '/v1/payments', {
            businessId: L.businessId,
            partyId: p,
            amount: 5,
            paymentDate: '2026-11-10',
            mode: 'cash',
          }),
      ],
      ['payment delete', () => L.call('DELETE', `/v1/payments/${pay.id}`)],
      [
        'expense',
        () =>
          L.call('POST', '/v1/expenses', {
            businessId: L.businessId,
            expenseDate: '2026-11-10',
            amount: 5,
          }),
      ],
      ['expense delete', () => L.call('DELETE', `/v1/expenses/${exp.id}`)],
      [
        'journal',
        () =>
          L.call('POST', '/v1/journals', {
            businessId: L.businessId,
            date: '2026-11-10',
            narration: 'y',
            rows: [
              { accountId: cash.id, debit: 1 },
              { accountId: cap.id, credit: 1 },
            ],
          }),
      ],
      ['journal delete', () => L.call('DELETE', `/v1/journals/${jv.id}`)],
      [
        'order conversion',
        () =>
          L.call('POST', `/v1/purchase-orders/${po.id}/convert`, {
            purchaseDate: '2026-11-10',
            lines: [{ name: 'Pen', quantity: 1 }],
          }),
      ],
      [
        'opening balance',
        () =>
          L.call('POST', '/v1/accounts', {
            businessId: L.businessId,
            name: 'Opening',
            group: 'Cash',
            opening: { amount: 5, side: 'Dr', date: '2026-11-10' },
          }),
      ],
    ];
    for (const [name, go] of attempts) {
      const res = await go();
      expect(res.status, `${name}: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(409);
      expect(res.body.error.code, name).toBe('period_locked');
    }
    expect(inv.id).toBeTruthy();
    // Dated after the lock: fine.
    expect((await sale(L, p, { invoiceDate: '2026-12-05' })).status).toBe(201);
    // The owner may save into the locked period, with a reason (the editor's confirm for invoices, a header elsewhere).
    expect(
      (
        await L.call(
          'POST',
          '/v1/expenses',
          { businessId: L.businessId, expenseDate: '2026-11-10', amount: 5 },
          { 'x-override-reason': '' },
        )
      ).status,
    ).toBe(409);
    const ok = await L.call(
      'POST',
      '/v1/expenses',
      { businessId: L.businessId, expenseDate: '2026-11-10', amount: 5 },
      { 'x-override-reason': 'late supplier bill' },
    );
    expect(ok.status, ok.text).toBe(201);
    expect(
      (await sale(L, p, { invoiceDate: '2026-11-10', confirm: { overrideReason: 'client asked' } }))
        .status,
    ).toBe(201);
    const audits = (
      (await L.call('GET', '/v1/audit?q=guard.override&limit=20')).body.data as any[]
    ).filter((a) => a.action === 'guard.override');
    expect(audits.length).toBeGreaterThanOrEqual(2);
    // A non-owner can not override.
    const acc = await h.addMember(L, 'accountant');
    expect(
      (
        await acc.call(
          'POST',
          '/v1/expenses',
          { businessId: L.businessId, expenseDate: '2026-11-10', amount: 5 },
          { 'x-override-reason': 'trying' },
        )
      ).status,
    ).toBe(409);
  });

  it('a closed financial year refuses writes; reopening allows them; years are created from the first document', async () => {
    const Y = await h.newTenant();
    await Y.call('POST', '/v1/expenses', {
      businessId: Y.businessId,
      expenseDate: '2025-06-10',
      amount: 100,
    });
    const years = (await Y.call('GET', `/v1/financial-years?businessId=${Y.businessId}`)).body
      .data as any[];
    expect(years.map((y) => y.label)).toEqual(expect.arrayContaining(['2025-26', '2026-27']));
    const fy = years.find((y) => y.label === '2025-26');
    expect(fy).toMatchObject({ status: 'open', startDate: '2025-04-01', endDate: '2026-03-31' });
    expect((await Y.call('POST', `/v1/financial-years/${fy.id}/close`)).body.status).toBe('closed');
    const blocked = await Y.call('POST', '/v1/expenses', {
      businessId: Y.businessId,
      expenseDate: '2026-02-01',
      amount: 5,
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details.reason).toBe('closed_year');
    expect(
      (
        await Y.call('POST', '/v1/expenses', {
          businessId: Y.businessId,
          expenseDate: '2026-05-01',
          amount: 5,
        })
      ).status,
    ).toBe(201);
    expect((await Y.call('POST', `/v1/financial-years/${fy.id}/reopen`)).body.status).toBe('open');
    expect(
      (
        await Y.call('POST', '/v1/expenses', {
          businessId: Y.businessId,
          expenseDate: '2026-02-01',
          amount: 5,
        })
      ).status,
    ).toBe(201);
  });
});

describe('P4-S7 account ledger and journals', () => {
  it('an unbalanced journal is refused; a balanced one posts; edit and delete reverse; the ledger closing equals the trial balance row', async () => {
    const J = await h.newTenant();
    await enable(J);
    const dep = await J.call('POST', '/v1/accounts', {
      businessId: J.businessId,
      name: 'Depreciation',
      group: 'Indirect expense',
    });
    const fixed = await acct(J, '1700');
    const rowsOf = (d: number, c: number) => [
      { accountId: dep.body.id, debit: d },
      { accountId: fixed.id, credit: c },
    ];
    const bad = await J.call('POST', '/v1/journals', {
      businessId: J.businessId,
      date: '2026-11-06',
      narration: 'Depreciation',
      rows: rowsOf(2000, 1999),
    });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toMatch(/must be equal/);
    expect(
      (
        await J.call('POST', '/v1/journals', {
          businessId: J.businessId,
          date: '2026-11-06',
          rows: [
            { accountId: dep.body.id, debit: 5, credit: 5 },
            { accountId: fixed.id, credit: 0, debit: 0 },
          ],
        })
      ).status,
    ).toBe(400);
    const ok = await J.call('POST', '/v1/journals', {
      businessId: J.businessId,
      date: '2026-11-06',
      narration: 'Depreciation on laptop',
      rows: rowsOf(2000, 2000),
    });
    expect(ok.status, ok.text).toBe(201);
    expect(ok.body).toMatchObject({
      number: 'JV-1',
      total: 2000,
      narration: 'Depreciation on laptop',
    });
    expect(await closing(J, '5300')).toBe(2000);
    const tb = await trial(J);
    expect(tb.lines.find((l: any) => l.code === '5300')).toMatchObject({ debit: 2000, credit: 0 });
    expect(tb.lines.find((l: any) => l.code === '1700')).toMatchObject({ debit: 0, credit: 2000 });
    const led = (await J.call('GET', `/v1/ledger/${dep.body.id}`)).body;
    expect(led).toMatchObject({ closing: 2000, closingSide: 'Dr', opening: 0 });
    expect(led.entries[0]).toMatchObject({
      running: 2000,
      narration: 'JV-1 · Depreciation on laptop',
    });

    const put = await J.call('PUT', `/v1/journals/${ok.body.id}`, {
      businessId: J.businessId,
      date: '2026-11-06',
      narration: 'Corrected',
      rows: rowsOf(1500, 1500),
    });
    expect(put.body).toMatchObject({ number: 'JV-1', total: 1500 });
    expect(await closing(J, '5300')).toBe(1500);
    expect((await J.call('GET', `/v1/journals?businessId=${J.businessId}`)).body.data).toHaveLength(
      1,
    );
    // Date range: opening balance carries what came before.
    const later = (await J.call('GET', `/v1/ledger/${dep.body.id}?from=2026-12-01`)).body;
    expect(later).toMatchObject({ opening: 1500, closing: 1500, entries: [] });
    expect((await J.call('DELETE', `/v1/journals/${ok.body.id}`)).status).toBe(200);
    expect(await closing(J, '5300')).toBe(0);
    expect((await J.call('GET', `/v1/journals?businessId=${J.businessId}`)).body.data).toEqual([]);
    expect(
      (
        await J.call('POST', '/v1/journals', {
          businessId: J.businessId,
          date: '2026-11-06',
          rows: rowsOf(1, 1),
        })
      ).body.number,
    ).toBe('JV-2');
    // With the ledger off a journal is refused.
    const off = await h.newTenant();
    expect(
      (
        await off.call('POST', '/v1/journals', {
          businessId: off.businessId,
          date: '2026-11-06',
          rows: [
            { accountId: crypto.randomUUID(), debit: 1 },
            { accountId: crypto.randomUUID(), credit: 1 },
          ],
        })
      ).status,
    ).toBe(409);
  });
});

describe('purchase edit (PUT /v1/purchases/:id)', () => {
  it('redoes lines, stock, payments and totals; refuses what would break its returns or payments', async () => {
    const E = await h.newTenant();
    const s = await party(E);
    const item = (await E.call('POST', '/v1/items', { name: 'Edited Pen' })).body.id as string;
    const stock = async () => (await E.call('GET', `/v1/items/${item}`)).body.stock as number;
    const body = (over: Record<string, unknown> = {}) => ({
      businessId: E.businessId,
      supplierId: s,
      purchaseDate: '2026-11-05',
      invoiceNumber: 'ED-1',
      items: [{ itemId: item, name: 'Edited Pen', quantity: 10, rate: 100, taxPercent: 18 }],
      ...over,
    });
    const b = (
      await E.call('POST', '/v1/purchases', body({ payments: [{ mode: 'cash', amount: 500 }] }))
    ).body;
    expect(await stock()).toBe(10);
    const up = await E.call(
      'PUT',
      `/v1/purchases/${b.id}`,
      body({
        items: [{ itemId: item, name: 'Edited Pen', quantity: 4, rate: 100, taxPercent: 18 }],
        payments: [{ mode: 'cash', amount: 200 }],
      }),
    );
    expect(up.status, up.text).toBe(200);
    expect(up.body).toMatchObject({
      id: b.id,
      number: b.number,
      total: 472,
      paidAmount: 200,
      paymentStatus: 'Partial',
    });
    expect(await stock()).toBe(4);
    expect((await E.call('GET', `/v1/payments?partyId=${s}&direction=out`)).body.data).toHaveLength(
      1,
    );
    // Paid through a voucher: the bill can not shrink below it.
    await E.call('POST', '/v1/payments', {
      businessId: E.businessId,
      partyId: s,
      direction: 'out',
      amount: 272,
      paymentDate: '2026-11-06',
      mode: 'bank',
      allocations: [{ purchaseId: b.id, amount: 272 }],
    });
    const shrink = await E.call(
      'PUT',
      `/v1/purchases/${b.id}`,
      body({
        items: [{ itemId: item, name: 'Edited Pen', quantity: 1, rate: 100, taxPercent: 18 }],
      }),
    );
    expect(shrink.status).toBe(422);
    expect(shrink.body.error.code).toBe('over_allocated');
    expect(await stock()).toBe(4); // the refused edit changed nothing
    // A bill with a debit note against it can not be edited.
    const b2 = (await E.call('POST', '/v1/purchases', body({ invoiceNumber: 'ED-2' }))).body;
    await E.call('POST', '/v1/purchases', {
      businessId: E.businessId,
      docType: 'debit-note',
      supplierId: s,
      againstPurchaseId: b2.id,
      returnReason: 'purchase-return',
      purchaseDate: '2026-11-07',
      items: [{ itemId: item, name: 'Edited Pen', quantity: 2, rate: 100, taxPercent: 18 }],
    });
    expect(
      (await E.call('PUT', `/v1/purchases/${b2.id}`, body({ invoiceNumber: 'ED-2' }))).status,
    ).toBe(409);
    // A duplicate bill number is still caught, but not against itself; type can not change.
    expect(
      (await E.call('PUT', `/v1/purchases/${b2.id}`, body({ invoiceNumber: 'ED-1' }))).status,
    ).toBe(409);
    expect(
      (
        await E.call(
          'PUT',
          `/v1/purchases/${b.id}`,
          body({ docType: 'debit-note', returnReason: 'other' }),
        )
      ).status,
    ).toBe(422);
  });

  it('with the ledger on, an edit reverses and reposts the bill', async () => {
    const E = await h.newTenant();
    const s = await party(E);
    await enable(E);
    const b = (await bill(E, { supplierId: s, invoiceNumber: 'LP-1' })).body;
    expect(await closing(E, '2000', s)).toBe(-1180);
    await E.call('PUT', `/v1/purchases/${b.id}`, {
      businessId: E.businessId,
      supplierId: s,
      purchaseDate: '2026-11-05',
      invoiceNumber: 'LP-1',
      items: [{ name: 'Pen', quantity: 200, rate: 10, taxPercent: 18 }],
    });
    expect(await closing(E, '2000', s)).toBe(-2360);
    expect((await rows(E, 'purchase', b.id)).length).toBe(4 + 4 + 4);
    expect((await trial(E)).balanced).toBe(true);
  });
});

describe('P10-S5 TDS ledger and P10-S4 ITC at risk', () => {
  it('Payment Out TDS and §194Q TDS become entries with due dates, PAN flag, interest and challans', async () => {
    const T = await h.newTenant();
    await enable(T);
    const noPan = await party(T, 'Landlord');
    const withPan = await party(T, 'Contractor Co', { gstin: '29ABCDE1234F1Z5' });
    const a = await T.call('POST', '/v1/payments', {
      businessId: T.businessId,
      partyId: noPan,
      direction: 'out',
      amount: 4950,
      tdsAmount: 50,
      tdsSection: '194C',
      paymentDate: '2026-10-15',
      mode: 'bank',
    });
    const b = await T.call('POST', '/v1/payments', {
      businessId: T.businessId,
      partyId: withPan,
      direction: 'out',
      amount: 9900,
      tdsAmount: 100,
      tdsSection: '194C',
      paymentDate: '2026-12-20',
      mode: 'bank',
    });
    await bill(T, {
      supplierId: withPan,
      purchaseDate: '2026-11-20',
      tds194QPercent: 0.1,
      items: [{ name: 'Steel', quantity: 1, rate: 100000, taxPercent: 18 }],
    });
    const list = (await T.call('GET', `/v1/tds?businessId=${T.businessId}`)).body;
    expect(list.data).toHaveLength(3);
    expect(list.total).toBe(250);
    const first = list.data.find((x: any) => x.refId === a.body.id);
    expect(first).toMatchObject({
      partyName: 'Landlord',
      pan: '',
      panMissing: true,
      section: '194C',
      baseAmount: 5000,
      tdsAmount: 50,
      dueDate: '2026-11-07',
      status: 'accrued',
      overdue: true,
    });
    expect(first.interest).toBeGreaterThan(0);
    expect(list.data.find((x: any) => x.refId === b.body.id)).toMatchObject({
      pan: 'ABCDE1234F',
      panMissing: false,
    });
    expect(list.data.find((x: any) => x.section === '194Q')).toMatchObject({
      tdsAmount: 100,
      rate: 0.1,
      baseAmount: 100000,
    });
    expect(
      (await T.call('GET', `/v1/tds?businessId=${T.businessId}&section=194Q`)).body.data,
    ).toHaveLength(1);

    const dep = await T.call('POST', `/v1/tds/${first.id}/deposit`, {
      challanNo: '00012',
      bsrCode: '0510308',
      challanDate: '2026-11-25',
    });
    expect(dep.status, dep.text).toBe(200);
    expect(
      (
        await T.call('POST', `/v1/tds/${first.id}/deposit`, {
          challanNo: '1',
          bsrCode: '0510308',
          challanDate: '2026-11-25',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await T.call('POST', `/v1/tds/${first.id}/deposit`, {
          challanNo: '1',
          bsrCode: '12',
          challanDate: '2026-11-25',
        })
      ).status,
    ).toBe(400);
    const after = (await T.call('GET', `/v1/tds?businessId=${T.businessId}`)).body;
    expect(after).toMatchObject({ deposited: 50, pending: 200 });
    // Deposited: Dr TDS Payable / Cr bank, so what is still owed to the government drops by the challan.
    expect(await closing(T, '2200')).toBe(-(250 - 50));
    // A deposited entry survives deleting its source; an accrued one goes with it.
    await T.call('DELETE', `/v1/payments/${a.body.id}`);
    await T.call('DELETE', `/v1/payments/${b.body.id}`);
    const left = (await T.call('GET', `/v1/tds?businessId=${T.businessId}`)).body.data;
    expect(left.map((x: any) => x.section).sort()).toEqual(['194C', '194Q']);
    expect((await trial(T)).balanced).toBe(true);
  });

  it('ITC at risk: from day 150 with days left; past 180 days for reversal; paying clears or shrinks it', async () => {
    const R = await h.newTenant();
    const s = await party(R, 'Om');
    const b = (
      await bill(R, {
        supplierId: s,
        purchaseDate: '2026-01-01',
        invoiceNumber: 'OLD-1',
        items: [{ name: 'Pen', quantity: 100, rate: 100, taxPercent: 18 }],
      })
    ).body;
    const at = (asOf: string) =>
      R.call('GET', `/v1/purchases/itc-at-risk?businessId=${R.businessId}&asOf=${asOf}`);
    expect((await at('2026-05-20')).body).toEqual({ atRisk: [], dueForReversal: [] }); // day 139
    const risk = (await at('2026-06-20')).body; // day 170
    expect(risk.atRisk[0]).toMatchObject({
      id: b.id,
      number: 'OLD-1',
      supplier: 'Om',
      unpaid: 11800,
      itc: 1800,
      daysLeft: 10,
    });
    expect((await at('2026-06-30')).body.atRisk[0].daysLeft).toBe(0); // day 180
    const late = (await at('2026-07-01')).body; // day 181
    expect(late.atRisk).toEqual([]);
    expect(late.dueForReversal[0]).toMatchObject({ unpaid: 11800, itc: 1800, daysLate: 1 });
    await R.call('POST', '/v1/payments', {
      businessId: R.businessId,
      partyId: s,
      direction: 'out',
      amount: 5900,
      paymentDate: '2026-03-01',
      mode: 'bank',
      allocations: [{ purchaseId: b.id, amount: 5900 }],
    });
    expect((await at('2026-07-15')).body.dueForReversal[0]).toMatchObject({
      unpaid: 5900,
      itc: 900,
    });
    await R.call('POST', '/v1/payments', {
      businessId: R.businessId,
      partyId: s,
      direction: 'out',
      amount: 5900,
      paymentDate: '2026-06-30',
      mode: 'bank',
      allocations: [{ purchaseId: b.id, amount: 5900 }],
    });
    expect((await at('2026-07-15')).body).toEqual({ atRisk: [], dueForReversal: [] });
  });
});

describe('permissions and tenant isolation', () => {
  it('a viewer reads the books but can not post; an accountant can post a journal; a salesman sees nothing', async () => {
    const P = await h.newTenant();
    await enable(P);
    const cash = await acct(P, '1000');
    const cap = await acct(P, '3000');
    const jv = {
      businessId: P.businessId,
      date: '2026-11-06',
      narration: 'x',
      rows: [
        { accountId: cash.id, debit: 1 },
        { accountId: cap.id, credit: 1 },
      ],
    };
    const viewer = await h.addMember(P, 'viewer');
    expect((await viewer.call('GET', `/v1/accounts?businessId=${P.businessId}`)).status).toBe(200);
    expect(
      (await viewer.call('GET', `/v1/ledger/trial-balance?businessId=${P.businessId}`)).status,
    ).toBe(200);
    expect((await viewer.call('POST', '/v1/journals', jv)).status).toBe(403);
    expect(
      (await viewer.call('POST', '/v1/accounting/backfill', { businessId: P.businessId })).status,
    ).toBe(403);
    expect((await viewer.call('GET', `/v1/verify?businessId=${P.businessId}`)).status).toBe(403);
    const acc = await h.addMember(P, 'accountant');
    expect((await acc.call('POST', '/v1/journals', jv)).status).toBe(201);
    expect((await acc.call('GET', `/v1/verify?businessId=${P.businessId}`)).status).toBe(200);
    expect(
      (await acc.call('POST', '/v1/accounting/backfill', { businessId: P.businessId })).status,
    ).toBe(403);
    expect(
      (await acc.call('POST', '/v1/financial-years/' + crypto.randomUUID() + '/close')).status,
    ).toBe(403);
    const sm = await h.addMember(P, 'salesman');
    expect((await sm.call('GET', `/v1/accounts?businessId=${P.businessId}`)).status).toBe(403);
    expect((await sm.call('GET', `/v1/tds?businessId=${P.businessId}`)).status).toBe(200); // payment:read
  });

  it('another organization sees none of it and can not point at it', async () => {
    const a = await h.newTenant();
    await enable(a);
    const p = await party(a);
    await sale(a, p);
    const acc = await acct(a, '1300');
    const ent = (await a.call('GET', `/v1/ledger/${acc.id}`)).body.entries[0];
    expect(ent).toBeTruthy();
    const q = `businessId=${a.businessId}`;
    for (const path of [`/v1/accounts?${q}`, `/v1/journals?${q}`, `/v1/financial-years?${q}`]) {
      const res = await other.call('GET', path);
      expect([200, 404].includes(res.status), path).toBe(true);
      if (res.status === 200) expect(res.body.data, path).toEqual([]);
    }
    expect((await other.call('GET', `/v1/ledger/${acc.id}`)).status).toBe(404);
    expect((await other.call('GET', `/v1/ledger/trial-balance?${q}`)).body.lines ?? []).toEqual([]);
    expect((await other.call('GET', `/v1/accounting/status?${q}`)).status).toBe(404);
    expect(
      (
        await other.call('POST', '/v1/accounting/backfill', {
          businessId: a.businessId,
          dryRun: false,
        })
      ).status,
    ).toBe(404);
    expect((await other.call('GET', `/v1/verify?${q}`)).status).toBe(404);
    const mine = await acct(other, '1000'); // other has no ledger on: nothing
    expect(mine).toBeUndefined();
    const bad = await other.call('POST', '/v1/journals', {
      businessId: a.businessId,
      date: '2026-11-06',
      rows: [
        { accountId: acc.id, debit: 1 },
        { accountId: acc.id, credit: 1 },
      ],
    });
    expect(bad.status).toBe(404);
    // Rows are invisible to the other tenant's connection too (row-level security, not just the route).
    expect(
      await withTenant(h.db, other.orgId, (tx) => tx.select().from(schema.ledgerEntries)),
    ).toEqual([]);
    expect(await withTenant(h.db, other.orgId, (tx) => tx.select().from(schema.accounts))).toEqual(
      [],
    );
  });
});
