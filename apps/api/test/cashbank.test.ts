import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { line, makeHarness, type Tenant } from './helpers.ts';

// Vyapar parity Phase 5 (Cash & Bank), API layer (docs/VYAPAR_IMPLEMENTATION_PHASES.md, P5-S1…S7 acceptance and the
// Phase 5 test plan). Every slice ends with the trial-balance check from Verify My Data: no unbalanced voucher, Σ debit
// = Σ credit, and every party's ledger balance equal to its documents.
const h = makeHarness();
let t: Tenant;

const today = new Date().toISOString().slice(0, 10);
const plusDays = (d: number) => {
  const x = new Date();
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
};

const enableLedger = async (who: Tenant) => {
  const r = await who.call('POST', '/v1/accounting/backfill', {
    businessId: who.businessId,
    dryRun: false,
  });
  expect(r.body.enabled, r.text).toBe(true);
};
const enableCashbank = async (who: Tenant, extra: Record<string, unknown> = {}) => {
  const r = await who.call('PUT', '/v1/cashbank/settings', {
    businessId: who.businessId,
    enabled: true,
    ...extra,
  });
  expect(r.status, r.text).toBe(200);
  expect(r.body.enabled).toBe(true);
};
const ready = async () => {
  const who = await h.newTenant();
  await enableLedger(who);
  await enableCashbank(who);
  return who;
};
const party = async (who: Tenant) => {
  const r = await who.call('POST', '/v1/parties', {
    name: `P ${Math.random().toString(36).slice(2, 7)}`,
    state: 'Tamil Nadu',
  });
  expect(r.status, r.text).toBe(201);
  return r.body.id as string;
};
const chart = async (who: Tenant) =>
  (await who.call('GET', `/v1/accounts?businessId=${who.businessId}`)).body.data as any[];
const acct = async (who: Tenant, code: string) => (await chart(who)).find((a) => a.code === code);
/** Dr-positive closing balance of an account by chart code (optionally one party's). */
const closing = async (who: Tenant, code: string, partyId?: string) => {
  const a = await acct(who, code);
  const l = (await who.call('GET', `/v1/ledger/${a.id}${partyId ? `?partyId=${partyId}` : ''}`))
    .body;
  return l.closingSide === 'Dr' ? l.closing : -l.closing;
};
const money = async (who: Tenant) =>
  (await who.call('GET', `/v1/cashbank/accounts?businessId=${who.businessId}`)).body.data as any[];
const cashBal = async (who: Tenant) => (await money(who)).find((m) => m.kind === 'cash').balance;
const bank = async (who: Tenant, over: Record<string, unknown> = {}) => {
  const r = await who.call('POST', '/v1/bank-accounts', {
    businessId: who.businessId,
    label: `Bank ${Math.random().toString(36).slice(2, 7)}`,
    ifsc: 'HDFC0000123',
    accountNumber: '50100012344521',
    openingBalance: 0,
    openingDate: '2026-04-01',
    ...over,
  });
  expect(r.status, r.text).toBe(201);
  return r.body;
};
const bankBal = async (who: Tenant, id: string) =>
  (await who.call('GET', `/v1/bank-accounts/${id}`)).body.balance as number;

/** The trial-balance check from Verify My Data. A failure here means stop: Dr ≠ Cr. */
const books = async (who: Tenant) => {
  const v = await who.call('GET', `/v1/verify?businessId=${who.businessId}`);
  expect(v.status, v.text).toBe(200);
  const check = (id: string) => v.body.checks.find((c: any) => c.id === id);
  expect(check('ledger_unbalanced').count, JSON.stringify(check('ledger_unbalanced'))).toBe(0);
  expect(
    check('party_balance_mismatch').count,
    JSON.stringify(check('party_balance_mismatch')),
  ).toBe(0);
  const tb = (await who.call('GET', `/v1/ledger/trial-balance?businessId=${who.businessId}`)).body;
  expect(tb.balanced, `trial balance Dr ${tb.debit} ≠ Cr ${tb.credit}`).toBe(true);
  return tb;
};

beforeAll(async () => {
  t = await h.newTenant();
});
afterAll(() => h.close());

describe('P5-S1 bank accounts', () => {
  it('Cash & Bank needs the ledger; off = 409 everywhere', async () => {
    const off = await h.newTenant();
    const r = await off.call('PUT', '/v1/cashbank/settings', {
      businessId: off.businessId,
      enabled: true,
    });
    expect(r.status).toBe(409);
    expect((await off.call('GET', `/v1/bank-accounts?businessId=${off.businessId}`)).status).toBe(
      409,
    );
    await enableLedger(off);
    expect(
      (await off.call('GET', `/v1/cashbank/settings?businessId=${off.businessId}`)).body,
    ).toEqual({ enabled: false, ledger: true, allowOverdraft: false });
    await enableCashbank(off);
    expect((await off.call('GET', `/v1/bank-accounts?businessId=${off.businessId}`)).status).toBe(
      200,
    );
    await books(off);
  });

  it('opening ₹2,00,000 shows ₹2,00,000 and one opening entry; balance = Σdr − Σcr', async () => {
    await enableLedger(t);
    await enableCashbank(t);
    const b = await bank(t, { label: 'HDFC Current', openingBalance: 200000 });
    expect(b).toMatchObject({
      balance: 200000,
      accountNumberMasked: '••4521',
      code: '1101',
      openingDate: '2026-04-01',
    });
    const st = (await t.call('GET', `/v1/bank-accounts/${b.id}/transactions`)).body;
    expect(st.rows).toHaveLength(1);
    expect(st.rows[0]).toMatchObject({ refType: 'opening', deposit: 200000, running: 200000 });
    expect(await closing(t, '1101')).toBe(200000);
    // An overdrawn opening is a credit.
    const od = await bank(t, { label: 'SBI OD', accountType: 'od', openingBalance: -5000 });
    expect(od.balance).toBe(-5000);
    expect(await closing(t, od.code)).toBe(-5000);
    await books(t);
  });

  it('field rules: IFSC, account number, unique name, one default printed on invoices', async () => {
    const bad = await t.call('POST', '/v1/bank-accounts', {
      businessId: t.businessId,
      label: 'X',
      ifsc: 'HDFC1000123',
    });
    expect(bad.status).toBe(400);
    expect(
      (
        await t.call('POST', '/v1/bank-accounts', {
          businessId: t.businessId,
          label: 'Y',
          accountNumber: '1234',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await t.call('POST', '/v1/bank-accounts', {
          businessId: t.businessId,
          label: 'hdfc current',
        })
      ).status,
    ).toBe(409);
    const a = await bank(t, { isDefault: true });
    const b = await bank(t, { isDefault: true });
    const list = (await t.call('GET', `/v1/bank-accounts?businessId=${t.businessId}`)).body.data;
    expect(list.filter((x: any) => x.isDefault).map((x: any) => x.id)).toEqual([b.id]);
    expect(a.id).not.toBe(b.id);
    expect(
      (
        await t.call('POST', '/v1/bank-accounts', {
          businessId: t.businessId,
          label: 'Z',
          isDefault: true,
          printOnInvoice: false,
        })
      ).status,
    ).toBe(422);
  });

  it('changing the opening reverses and reposts; deposit and withdraw post against capital and drawings', async () => {
    const b = await bank(t, { openingBalance: 1000 });
    const p = await t.call('PATCH', `/v1/bank-accounts/${b.id}`, { openingBalance: 1500 });
    expect(p.status, p.text).toBe(200);
    expect(p.body.balance).toBe(1500);
    const all = (await t.call('GET', `/v1/bank-accounts/${b.id}/transactions?all=1`)).body.rows;
    expect(all).toHaveLength(3); // original, its reversal, the new one
    const cap0 = await closing(t, '3000');
    const dep = await t.call('POST', '/v1/cash/entries', {
      businessId: t.businessId,
      accountId: b.accountId,
      kind: 'deposit',
      direction: 'increase',
      amount: 10000,
      date: '2026-11-02',
    });
    expect(dep.status, dep.text).toBe(201);
    expect(await closing(t, '3000')).toBe(cap0 - 10000);
    const wd = await t.call('POST', '/v1/cash/entries', {
      businessId: t.businessId,
      accountId: b.accountId,
      kind: 'withdraw',
      direction: 'reduce',
      amount: 2500,
      date: '2026-11-03',
    });
    expect(wd.status, wd.text).toBe(201);
    expect(await closing(t, '3010')).toBe(2500);
    expect(await bankBal(t, b.id)).toBe(1500 + 10000 - 2500);
    await books(t);
  });

  it('deleting an account with entries is refused (409); inactive hides it from pickers; one without entries goes', async () => {
    const b = await bank(t, { openingBalance: 700 });
    expect((await t.call('DELETE', `/v1/bank-accounts/${b.id}`)).status).toBe(409);
    expect((await t.call('DELETE', `/v1/payment-accounts/${b.id}`)).status).toBe(409);
    await t.call('PATCH', `/v1/bank-accounts/${b.id}`, { isActive: false });
    expect((await money(t)).some((m) => m.bankAccountId === b.id)).toBe(false);
    const empty = await bank(t);
    expect((await t.call('DELETE', `/v1/bank-accounts/${empty.id}`)).status).toBe(200);
    expect((await chart(t)).some((a) => a.code === empty.code)).toBe(false);
    await books(t);
  });

  it('a bank added before Cash & Bank gets its ledger account and opening when it is turned on', async () => {
    const o = await h.newTenant();
    await enableLedger(o);
    const pa = await o.call('POST', `/v1/businesses/${o.businessId}/payment-accounts`, {
      label: 'Old SBI',
    });
    expect(pa.status, pa.text).toBe(201);
    await enableCashbank(o);
    const m = await money(o);
    expect(m.map((x) => x.name)).toEqual(['Cash in Hand', 'Old SBI']);
    await books(o);
  });
});

describe('P5-S2 cash in hand and adjustments', () => {
  it('adjust changes cash by exactly the amount; cash can not go below zero; delete reverses', async () => {
    const c = await ready();
    const add = await c.call('POST', '/v1/cash/entries', {
      businessId: c.businessId,
      direction: 'increase',
      amount: 1000,
      date: '2026-11-01',
      remarks: 'float',
    });
    expect(add.status, add.text).toBe(201);
    expect(await cashBal(c)).toBe(1000);
    expect(await closing(c, '3100')).toBe(-1000);
    const income = await c.call('POST', '/v1/cash/entries', {
      businessId: c.businessId,
      direction: 'increase',
      amount: 200,
      date: '2026-11-01',
      countAsIncome: true,
    });
    expect(income.status).toBe(201);
    expect(await closing(c, '4100')).toBe(-200);
    const over = await c.call('POST', '/v1/cash/entries', {
      businessId: c.businessId,
      direction: 'reduce',
      amount: 5000,
      date: '2026-11-02',
    });
    expect(over.status).toBe(422);
    expect((await c.call('DELETE', `/v1/cash/entries/${income.body.id}`)).status).toBe(200);
    expect(await cashBal(c)).toBe(1000);
    await books(c);
  });

  it('cash balance = Σ cash vouchers = the statement; a sale paid in cash shows in it', async () => {
    const c = await ready();
    const p = await party(c);
    const inv = await c.call('POST', '/v1/invoices', {
      businessId: c.businessId,
      partyId: p,
      invoiceDate: '2026-11-04',
      items: [line({ quantity: 1, rate: 100, taxPercent: 18 })],
      payments: [{ mode: 'cash', amount: 118 }],
    });
    expect(inv.status, inv.text).toBe(201);
    const st = (await c.call('GET', `/v1/cash/transactions?businessId=${c.businessId}`)).body;
    expect(st.closing).toBe(118);
    expect(st.rows[0]).toMatchObject({ deposit: 118, partyId: p });
    expect(st.closing).toBe(await cashBal(c));
    expect(st.closing).toBe(await closing(c, '1000'));
    await books(c);
  });

  it('day-end count: equal makes no entry; short posts Cash Over / Short', async () => {
    const c = await ready();
    await c.call('POST', '/v1/cash/entries', {
      businessId: c.businessId,
      direction: 'increase',
      amount: 48300,
      date: '2026-11-01',
    });
    const same = await c.call('POST', '/v1/cash/count', {
      businessId: c.businessId,
      date: '2026-11-05',
      counted: 48300,
    });
    expect(same.status, same.text).toBe(200);
    expect(same.body).toMatchObject({ system: 48300, difference: 0, entry: null });
    expect(
      (await c.call('GET', `/v1/cash/entries?businessId=${c.businessId}`)).body.data,
    ).toHaveLength(1);
    const short = await c.call('POST', '/v1/cash/count', {
      businessId: c.businessId,
      date: '2026-11-05',
      counted: 48000,
    });
    expect(short.body).toMatchObject({ difference: -300, entry: { kind: 'count', amount: 300 } });
    expect(await cashBal(c)).toBe(48000);
    expect(await closing(c, '5270')).toBe(300);
    await books(c);
  });
});

describe('P5-S3 transfers', () => {
  it('both balances move by the amount; Σ(cash+bank) drops by the fee only; edit and delete repost', async () => {
    const c = await ready();
    const b = await bank(c, { openingBalance: 240100 });
    const cash = (await money(c)).find((m) => m.kind === 'cash');
    const total0 = (await money(c)).reduce((s, m) => s + m.balance, 0);
    const tr = await c.call('POST', '/v1/transfers', {
      businessId: c.businessId,
      fromAccountId: b.accountId,
      toAccountId: cash.accountId,
      amount: 10000,
      fee: 15,
      date: '2026-11-06',
      reference: 'ATM',
    });
    expect(tr.status, tr.text).toBe(201);
    expect(tr.body).toMatchObject({ fromName: b.label, toName: 'Cash in Hand' });
    expect(await bankBal(c, b.id)).toBe(240100 - 10015);
    expect(await cashBal(c)).toBe(10000);
    const total1 = (await money(c)).reduce((s, m) => s + m.balance, 0);
    expect(Math.round((total0 - total1) * 100) / 100).toBe(15);
    expect(await closing(c, '5210')).toBe(15);
    const ed = await c.call('PUT', `/v1/transfers/${tr.body.id}`, {
      businessId: c.businessId,
      fromAccountId: b.accountId,
      toAccountId: cash.accountId,
      amount: 4000,
      date: '2026-11-06',
    });
    expect(ed.status, ed.text).toBe(200);
    expect(await cashBal(c)).toBe(4000);
    expect(await bankBal(c, b.id)).toBe(240100 - 4000);
    expect((await c.call('DELETE', `/v1/transfers/${tr.body.id}`)).status).toBe(200);
    expect(await cashBal(c)).toBe(0);
    expect(await bankBal(c, b.id)).toBe(240100);
    await books(c);
  });

  it('can not move more cash than is in hand, nor to the same account; banks need overdraft allowed', async () => {
    const c = await ready();
    const b = await bank(c, { openingBalance: 100 });
    const cash = (await money(c)).find((m) => m.kind === 'cash');
    const body = {
      businessId: c.businessId,
      fromAccountId: cash.accountId,
      toAccountId: b.accountId,
      amount: 50,
      date: '2026-11-06',
    };
    expect((await c.call('POST', '/v1/transfers', body)).status).toBe(422);
    expect(
      (await c.call('POST', '/v1/transfers', { ...body, toAccountId: cash.accountId })).status,
    ).toBe(400);
    const fromBank = {
      ...body,
      fromAccountId: b.accountId,
      toAccountId: cash.accountId,
      amount: 500,
    };
    expect((await c.call('POST', '/v1/transfers', fromBank)).status).toBe(422);
    await enableCashbank(c, { allowOverdraft: true });
    expect((await c.call('POST', '/v1/transfers', fromBank)).status).toBe(201);
    expect(await bankBal(c, b.id)).toBe(-400);
    // Cash still never goes below zero, overdraft or not.
    expect((await c.call('POST', '/v1/transfers', { ...body, amount: 600 })).status).toBe(422);
    await books(c);
  });
});

describe('P5-S4 cheques', () => {
  it('received: bank moves only on cleared; the invoice is paid from the start', async () => {
    const c = await ready();
    const b = await bank(c);
    const p = await party(c);
    const inv = (
      await c.call('POST', '/v1/invoices', {
        businessId: c.businessId,
        partyId: p,
        invoiceDate: '2026-11-01',
        items: [line({ quantity: 10, rate: 100, taxPercent: 18 })],
      })
    ).body;
    const ch = await c.call('POST', '/v1/cheques', {
      businessId: c.businessId,
      direction: 'received',
      partyId: p,
      number: '000123',
      amount: 1180,
      chequeDate: '2026-11-03',
      receivedDate: '2026-11-02',
      bankAccountId: b.id,
      allocations: [{ invoiceId: inv.id, amount: 1180 }],
    });
    expect(ch.status, ch.text).toBe(201);
    expect(ch.body).toMatchObject({
      status: 'open',
      actions: ['deposit', 'clear', 'bounce', 'cancel'],
      validTill: '2027-02-02',
      stale: false,
      section138: null,
    });
    expect((await c.call('GET', `/v1/invoices/${inv.id}`)).body.paidAmount).toBe(1180);
    expect(await closing(c, '1200')).toBe(1180);
    expect(await bankBal(c, b.id)).toBe(0);
    const dep = await c.call('POST', `/v1/cheques/${ch.body.id}/actions`, {
      action: 'deposit',
      date: '2026-11-03',
    });
    expect(dep.body).toMatchObject({ status: 'deposited', actions: ['clear', 'bounce'] });
    expect(await bankBal(c, b.id)).toBe(0);
    const clr = await c.call('POST', `/v1/cheques/${ch.body.id}/actions`, {
      action: 'clear',
      date: '2026-11-05',
    });
    expect(clr.status, clr.text).toBe(200);
    expect(clr.body).toMatchObject({ status: 'cleared', actions: [] });
    expect(await bankBal(c, b.id)).toBe(1180);
    expect(await closing(c, '1200')).toBe(0);
    // Final: nothing more can happen to it.
    expect(
      (
        await c.call('POST', `/v1/cheques/${ch.body.id}/actions`, {
          action: 'bounce',
          date: '2026-11-06',
        })
      ).status,
    ).toBe(409);
    // The bank statement shows the deposit (Phase 5 E2E).
    const st = (await c.call('GET', `/v1/bank-accounts/${b.id}/transactions`)).body;
    expect(st.rows.at(-1)).toMatchObject({
      refType: 'cheque',
      deposit: 1180,
      txnDate: '2026-11-05',
    });
    await books(c);
  });

  it('bounce reopens the invoice, posts charges to the party and starts the §138 clock', async () => {
    const c = await ready();
    const b = await bank(c);
    const p = await party(c);
    const inv = (
      await c.call('POST', '/v1/invoices', {
        businessId: c.businessId,
        partyId: p,
        invoiceDate: '2026-11-01',
        items: [line({ quantity: 10, rate: 100, taxPercent: 18 })],
      })
    ).body;
    const ch = (
      await c.call('POST', '/v1/cheques', {
        businessId: c.businessId,
        direction: 'received',
        partyId: p,
        number: '000099',
        amount: 1180,
        chequeDate: '2026-11-02',
        receivedDate: '2026-11-02',
        autoAllocate: true,
      })
    ).body;
    expect(ch.paymentId).toBeTruthy();
    expect((await c.call('GET', `/v1/invoices/${inv.id}`)).body.paidAmount).toBe(1180);
    await c.call('POST', `/v1/cheques/${ch.id}/actions`, {
      action: 'deposit',
      date: '2026-11-03',
      bankAccountId: b.id,
    });
    // Its payment can not be edited once it is with the bank.
    expect((await c.call('DELETE', `/v1/payments/${ch.paymentId}`)).status).toBe(409);
    const bo = await c.call('POST', `/v1/cheques/${ch.id}/actions`, {
      action: 'bounce',
      date: '2026-11-06',
      bounceCharges: 250,
      chargeTo: 'party',
    });
    expect(bo.status, bo.text).toBe(200);
    expect(bo.body).toMatchObject({ status: 'bounced', bounceCharges: 250 });
    expect((await c.call('GET', `/v1/invoices/${inv.id}`)).body.paidAmount).toBe(0);
    expect((await c.call('GET', `/v1/payments/${ch.paymentId}`)).status).toBe(404);
    expect(await closing(c, '1300', p)).toBe(1180 + 250);
    expect(await closing(c, '1200')).toBe(0);
    expect(await bankBal(c, b.id)).toBe(0);
    expect(await closing(c, '4100')).toBe(-250);
    // NI Act §138: notice within 30 days of the bounce; once served, 15 days to pay, then a month to file.
    expect(bo.body.section138).toMatchObject({ noticeBy: '2026-12-06', payBy: null });
    expect(
      (await c.call('PATCH', `/v1/cheques/${ch.id}`, { noticeServedOn: '2026-11-01' })).status,
    ).toBe(422);
    const served = await c.call('PATCH', `/v1/cheques/${ch.id}`, { noticeServedOn: '2026-11-20' });
    expect(served.status, served.text).toBe(200);
    expect(served.body.section138).toMatchObject({
      payBy: '2026-12-05',
      complaintFrom: '2026-12-06',
      complaintBy: '2027-01-05',
    });
    await books(c);
  });

  it('Payment In by cheque joins the register; edit follows it; deleting an open one removes it', async () => {
    const c = await ready();
    const p = await party(c);
    const pay = await c.call('POST', '/v1/payments', {
      businessId: c.businessId,
      partyId: p,
      amount: 500,
      mode: 'cheque',
      chequeDate: '2026-11-08',
      reference: '445566',
      paymentDate: '2026-11-04',
    });
    expect(pay.status, pay.text).toBe(201);
    let list = (await c.call('GET', `/v1/cheques?businessId=${c.businessId}`)).body.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ number: '445566', amount: 500, paymentId: pay.body.id });
    const ed = await c.call('PUT', `/v1/payments/${pay.body.id}`, {
      businessId: c.businessId,
      partyId: p,
      amount: 600,
      mode: 'cheque',
      chequeDate: '2026-11-08',
      reference: '445566',
      paymentDate: '2026-11-04',
    });
    expect(ed.status, ed.text).toBe(200);
    list = (await c.call('GET', `/v1/cheques?businessId=${c.businessId}`)).body.data;
    expect(list[0].amount).toBe(600);
    // The same cheque number from the same party twice is refused.
    const dup = await c.call('POST', '/v1/payments', {
      businessId: c.businessId,
      partyId: p,
      amount: 1,
      mode: 'cheque',
      chequeDate: '2026-11-08',
      reference: '445566',
      paymentDate: '2026-11-04',
    });
    expect(dup.status).toBe(409);
    expect((await c.call('DELETE', `/v1/payments/${pay.body.id}`)).status).toBe(200);
    expect((await c.call('GET', `/v1/cheques?businessId=${c.businessId}`)).body.data).toHaveLength(
      0,
    );
    expect(await closing(c, '1200')).toBe(0);
    await books(c);
  });

  it('issued: Dr Payable / Cr Cheques Issued; cleared takes it from the bank; bounce charges are ours', async () => {
    const c = await ready();
    const b = await bank(c, { openingBalance: 50000 });
    const s = await party(c);
    const bill = await c.call('POST', '/v1/purchases', {
      businessId: c.businessId,
      supplierId: s,
      purchaseDate: '2026-11-01',
      invoiceNumber: 'S-1',
      items: [{ name: 'Pen', quantity: 100, rate: 10, taxPercent: 18 }],
    });
    expect(bill.status, bill.text).toBe(201);
    const one = (
      await c.call('POST', '/v1/cheques', {
        businessId: c.businessId,
        direction: 'issued',
        partyId: s,
        number: '700001',
        amount: 1000,
        chequeDate: '2026-11-02',
        receivedDate: '2026-11-02',
        bankAccountId: b.id,
        autoAllocate: true,
      })
    ).body;
    expect(one.actions).toEqual(['clear', 'bounce', 'cancel']);
    expect(await closing(c, '2400')).toBe(-1000);
    await c.call('POST', `/v1/cheques/${one.id}/actions`, { action: 'clear', date: '2026-11-04' });
    expect(await bankBal(c, b.id)).toBe(49000);
    expect(await closing(c, '2400')).toBe(0);
    const two = (
      await c.call('POST', '/v1/cheques', {
        businessId: c.businessId,
        direction: 'issued',
        partyId: s,
        number: '700002',
        amount: 180,
        chequeDate: '2026-11-02',
        receivedDate: '2026-11-02',
        bankAccountId: b.id,
        autoAllocate: true,
      })
    ).body;
    const bo = await c.call('POST', `/v1/cheques/${two.id}/actions`, {
      action: 'bounce',
      date: '2026-11-05',
      bounceCharges: 100,
      chargeTo: 'party',
    });
    expect(bo.body).toMatchObject({ status: 'bounced', chargeTo: 'us' });
    expect(await bankBal(c, b.id)).toBe(48900);
    expect(await closing(c, '2000', s)).toBe(-(1180 - 1000));
    await books(c);
  });

  it('cheques due: open or deposited and dated within the reminder days; post-dated flagged', async () => {
    const c = await ready();
    const p = await party(c);
    const add = (number: string, chequeDate: string) =>
      c.call('POST', '/v1/cheques', {
        businessId: c.businessId,
        direction: 'received',
        partyId: p,
        number,
        amount: 100,
        chequeDate,
        receivedDate: today,
      });
    const soon = (await add('1', plusDays(2))).body;
    const later = (await add('2', plusDays(20))).body;
    expect(soon).toMatchObject({ due: true, postDated: true });
    expect(later).toMatchObject({ due: false, postDated: true });
    const s = (await c.call('GET', `/v1/cashbank/summary?businessId=${c.businessId}`)).body;
    expect(s.chequesDue).toMatchObject({ count: 1, amount: 100 });
    expect(s.chequesDue.items[0].number).toBe('1');
    await books(c);
  });
});

describe('P5-S5 loans', () => {
  it('₹10,00,000 at 12% for 12 months: EMI ₹88,848.79; schedule sums; disbursal and EMI post balanced', async () => {
    const c = await ready();
    const b = await bank(c);
    const r = await c.call('POST', '/v1/loans', {
      businessId: c.businessId,
      name: 'Term loan A',
      lender: 'HDFC',
      principal: 1000000,
      ratePct: 12,
      tenureMonths: 12,
      firstEmiDate: '2026-05-05',
      receivedOn: '2026-04-01',
      receivedAccountId: b.id,
      processingFee: 5000,
    });
    expect(r.status, r.text).toBe(201);
    const loan = r.body;
    expect(loan).toMatchObject({ emi: 88848.79, outstanding: 1000000, code: '2301' });
    expect(loan.schedule).toHaveLength(12);
    const sumP = loan.schedule.reduce((s: number, x: any) => s + x.principalPart, 0);
    expect(Math.round(sumP * 100) / 100).toBe(1000000);
    expect(await bankBal(c, b.id)).toBe(995000);
    expect(await closing(c, '2301')).toBe(-1000000);
    expect(await closing(c, '5210')).toBe(5000);

    const due = loan.nextDue;
    expect(due).toMatchObject({ n: 1, principal: 78848.79, interest: 10000 });
    const paid = await c.call('POST', `/v1/loans/${loan.id}/payments`, {
      kind: 'emi',
      date: '2026-05-05',
      principal: due.principal,
      interest: due.interest,
      accountId: b.id,
    });
    expect(paid.status, paid.text).toBe(201);
    expect(paid.body.outstanding).toBe(921151.21);
    expect(paid.body.schedule[0].status).toBe('paid');
    // The loan account's balance equals the schedule's.
    expect(await closing(c, '2301')).toBe(-921151.21);
    expect(paid.body.schedule[0].balanceAfter).toBe(921151.21);
    expect(await closing(c, '5220')).toBe(10000);
    expect(await bankBal(c, b.id)).toBe(Math.round((995000 - 88848.79) * 100) / 100);
    await books(c);
  });

  it('prepayment shortens the tenure and keeps ledger = schedule; overpaying is refused; deleting a payment rebuilds', async () => {
    const c = await ready();
    const r = (
      await c.call('POST', '/v1/loans', {
        businessId: c.businessId,
        name: 'Cash loan',
        principal: 120000,
        cashAcknowledgement: 'test: cash loan',
        ratePct: 10,
        tenureMonths: 12,
        firstEmiDate: '2026-05-01',
        receivedOn: '2026-04-01',
      })
    ).body;
    expect(await cashBal(c)).toBe(120000);
    const pre = await c.call('POST', `/v1/loans/${r.id}/payments`, {
      kind: 'prepay',
      cashAcknowledgement: 'test',
      date: '2026-04-20',
      principal: 50000,
    });
    expect(pre.status, pre.text).toBe(201);
    expect(pre.body.outstanding).toBe(70000);
    expect(pre.body.schedule.length).toBeLessThan(12);
    expect(await closing(c, r.code)).toBe(-70000);
    const over = await c.call('POST', `/v1/loans/${r.id}/payments`, {
      kind: 'prepay',
      cashAcknowledgement: 'test',
      date: '2026-04-21',
      principal: 70000.01,
    });
    expect(over.status).toBe(422);
    const pid = pre.body.payments[0].id;
    const del = await c.call('DELETE', `/v1/loans/${r.id}/payments/${pid}`);
    expect(del.status, del.text).toBe(200);
    expect(del.body.outstanding).toBe(120000);
    expect(del.body.schedule).toHaveLength(12);
    expect(await closing(c, r.code)).toBe(-120000);
    // Paying it all off closes it.
    const all = await c.call('POST', `/v1/loans/${r.id}/payments`, {
      kind: 'prepay',
      cashAcknowledgement: 'test',
      date: '2026-04-25',
      principal: 120000,
    });
    expect(all.body).toMatchObject({ status: 'closed', outstanding: 0 });
    await books(c);
  });
});

describe('P5-S6 bank reconciliation', () => {
  it('matches by amount and date, flags the rest; finishing with a difference needs a reason; a statement is recognised again', async () => {
    const c = await ready();
    const b = await bank(c, { openingBalance: 235100, openingDate: '2026-11-01' });
    const p = await party(c);
    const rec = await c.call('POST', '/v1/payments', {
      businessId: c.businessId,
      partyId: p,
      amount: 5000,
      mode: 'upi',
      accountId: b.id,
      paymentDate: '2026-11-06',
    });
    expect(rec.status, rec.text).toBe(201);
    const rows = [
      { date: '2026-11-07', description: `UPI/${rec.body.number}/Ravi`, credit: 5000 },
      { date: '2026-11-03', description: 'SMS charges', debit: 180 },
    ];
    const m = await c.call('POST', `/v1/bank-accounts/${b.id}/reconcile/match`, { rows });
    expect(m.status, m.text).toBe(200);
    expect(m.body.matches).toHaveLength(1);
    expect(m.body.matches[0]).toMatchObject({ row: 0, byReference: true, days: 1 });
    expect(m.body.unmatchedRows).toEqual([1]);
    expect(m.body.bookBalance).toBe(240100);
    const save = {
      matches: [{ entryId: m.body.matches[0].entryId, hash: m.body.matches[0].hash }],
      statementBalance: 239920,
      clearedOn: '2026-11-07',
    };
    const refused = await c.call('POST', `/v1/bank-accounts/${b.id}/reconcile`, save);
    expect(refused.status).toBe(422);
    const ok = await c.call('POST', `/v1/bank-accounts/${b.id}/reconcile`, {
      ...save,
      reason: 'SMS charges not booked yet',
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body).toMatchObject({ reconciled: 1, difference: -180 });
    const again = await c.call('POST', `/v1/bank-accounts/${b.id}/reconcile/match`, { rows });
    expect(again.body.alreadyReconciled).toEqual([0]);
    expect(again.body.matches).toEqual([]);
    const st = (await c.call('GET', `/v1/bank-accounts/${b.id}/transactions`)).body;
    expect(st.rows.find((r: any) => r.refType === 'payment').reconciled).toBe(true);
    // Booking the charge closes the gap.
    await c.call('POST', '/v1/cash/entries', {
      businessId: c.businessId,
      accountId: b.accountId,
      kind: 'withdraw',
      direction: 'reduce',
      category: 'bank_charges',
      amount: 180,
      date: '2026-11-03',
    });
    const fin = await c.call('POST', `/v1/bank-accounts/${b.id}/reconcile`, {
      matches: [],
      statementBalance: 239920,
      clearedOn: '2026-11-07',
    });
    expect(fin.body.difference).toBe(0);
    expect(
      (await c.call('DELETE', `/v1/bank-accounts/${b.id}/reconcile/${save.matches[0].entryId}`))
        .status,
    ).toBe(200);
    await books(c);
  });
});

describe('P5-S7 dashboard widgets', () => {
  it('summary totals equal the bank accounts list plus cash; EMIs due in 7 days; overdraft warning', async () => {
    const c = await ready();
    const b1 = await bank(c, { openingBalance: 240100 });
    await bank(c, { openingBalance: -5000, accountType: 'od' });
    await c.call('POST', '/v1/cash/entries', {
      businessId: c.businessId,
      direction: 'increase',
      amount: 48300,
      date: '2026-11-01',
    });
    await c.call('POST', '/v1/loans', {
      businessId: c.businessId,
      name: 'Soon',
      principal: 12000,
      ratePct: 0,
      tenureMonths: 12,
      firstEmiDate: plusDays(3),
      receivedOn: today,
      receivedAccountId: b1.id,
    });
    const s = (await c.call('GET', `/v1/cashbank/summary?businessId=${c.businessId}`)).body;
    const banks = (await c.call('GET', `/v1/bank-accounts?businessId=${c.businessId}`)).body.data;
    const bankTotal = banks.reduce((x: number, b: any) => x + b.balance, 0);
    expect(s.bank).toBe(Math.round(bankTotal * 100) / 100);
    expect(s.cash).toBe(48300);
    expect(s.total).toBe(Math.round((bankTotal + 48300) * 100) / 100);
    expect(s.overdrawn).toHaveLength(1);
    expect(s.emiDue).toMatchObject({ count: 1, amount: 1000 });
    expect(s.emiDue.items[0].name).toBe('Soon');
    await books(c);
  });

  it('flag off: the summary is refused (the widgets hide)', async () => {
    const c = await ready();
    await c.call('PUT', '/v1/cashbank/settings', { businessId: c.businessId, enabled: false });
    expect((await c.call('GET', `/v1/cashbank/summary?businessId=${c.businessId}`)).status).toBe(
      409,
    );
  });
});

describe('Phase 5: permissions, isolation and the period lock', () => {
  it('a viewer reads, an accountant writes, a salesman sees nothing', async () => {
    const c = await ready();
    const viewer = await h.addMember(c, 'viewer');
    expect((await viewer.call('GET', `/v1/bank-accounts?businessId=${c.businessId}`)).status).toBe(
      200,
    );
    expect(
      (await viewer.call('POST', '/v1/bank-accounts', { businessId: c.businessId, label: 'V' }))
        .status,
    ).toBe(403);
    const acc = await h.addMember(c, 'accountant');
    expect(
      (await acc.call('POST', '/v1/bank-accounts', { businessId: c.businessId, label: 'A' }))
        .status,
    ).toBe(201);
    expect(
      (await acc.call('PUT', '/v1/cashbank/settings', { businessId: c.businessId, enabled: false }))
        .status,
    ).toBe(403);
    const sm = await h.addMember(c, 'salesman');
    expect((await sm.call('GET', `/v1/cheques?businessId=${c.businessId}`)).status).toBe(403);
  });

  it('another organization can not see or touch it', async () => {
    const c = await ready();
    const b = await bank(c, { openingBalance: 10 });
    const o = await ready();
    expect((await o.call('GET', `/v1/bank-accounts/${b.id}`)).status).toBe(404);
    expect((await o.call('PATCH', `/v1/bank-accounts/${b.id}`, { label: 'x' })).status).toBe(404);
    expect(
      (await o.call('GET', `/v1/bank-accounts?businessId=${c.businessId}`)).status,
    ).toBeGreaterThanOrEqual(400);
  });

  it('a locked period refuses transfers, cash entries, cheques and loan payments dated in it', async () => {
    const c = await ready();
    const b = await bank(c, { openingBalance: 1000 });
    const cash = (await money(c)).find((m) => m.kind === 'cash');
    const p = await party(c);
    expect(
      (
        await c.call('PUT', '/v1/accounting/lock', {
          businessId: c.businessId,
          lockBefore: '2026-10-31',
          allowEditAfterGstFiled: true,
        })
      ).status,
    ).toBe(200);
    const attempts: [string, () => Promise<{ status: number; body: any }>][] = [
      [
        'transfer',
        () =>
          c.call('POST', '/v1/transfers', {
            businessId: c.businessId,
            fromAccountId: b.accountId,
            toAccountId: cash.accountId,
            amount: 1,
            date: '2026-10-15',
          }),
      ],
      [
        'cash entry',
        () =>
          c.call('POST', '/v1/cash/entries', {
            businessId: c.businessId,
            direction: 'increase',
            amount: 1,
            date: '2026-10-15',
          }),
      ],
      [
        'cheque',
        () =>
          c.call('POST', '/v1/cheques', {
            businessId: c.businessId,
            direction: 'received',
            partyId: p,
            number: '9',
            amount: 1,
            chequeDate: '2026-10-15',
            receivedDate: '2026-10-15',
          }),
      ],
      [
        'loan',
        () =>
          c.call('POST', '/v1/loans', {
            businessId: c.businessId,
            name: 'L',
            principal: 100,
            ratePct: 0,
            tenureMonths: 1,
            firstEmiDate: '2026-11-15',
            receivedOn: '2026-10-15',
          }),
      ],
    ];
    for (const [name, call] of attempts) {
      const res = await call();
      expect(res.status, name).toBe(409);
      expect(res.body.error.code, name).toBe('period_locked');
    }
    await books(c);
  });
});

describe('Phase 5 for India: cheque validity, cash limits, Increase Loan, loan statement and tax, reconciliation', () => {
  it('a stale cheque (three months past its date) can not be presented; a fresh one may clear straight from open', async () => {
    const c = await ready();
    const b = await bank(c);
    const p = await party(c);
    const add = async (number: string, chequeDate: string) =>
      (
        await c.call('POST', '/v1/cheques', {
          businessId: c.businessId,
          direction: 'received',
          partyId: p,
          number,
          amount: 500,
          chequeDate,
          receivedDate: chequeDate,
          bankAccountId: b.id,
        })
      ).body;
    const old = await add('100001', '2026-04-10');
    expect(old.validTill).toBe('2026-07-09');
    const stale = await c.call('POST', `/v1/cheques/${old.id}/actions`, {
      action: 'deposit',
      date: '2026-07-10',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toMatch(/stale/);
    const early = await c.call('POST', `/v1/cheques/${old.id}/actions`, {
      action: 'deposit',
      date: '2026-04-09',
    });
    expect(early.status).toBeGreaterThanOrEqual(400);
    const fresh = await add('100002', '2026-11-02');
    const clr = await c.call('POST', `/v1/cheques/${fresh.id}/actions`, {
      action: 'clear',
      date: '2026-11-03',
    });
    expect(clr.status, clr.text).toBe(200);
    expect(await bankBal(c, b.id)).toBe(500);
    await books(c);
  });

  it('§269SS / §269T: ₹20,000 or more taken or repaid in cash needs an acknowledgement, which is audited', async () => {
    const c = await ready();
    const body = {
      businessId: c.businessId,
      name: 'From a relative',
      principal: 50000,
      ratePct: 0,
      tenureMonths: 5,
      firstEmiDate: '2026-12-01',
      receivedOn: '2026-11-01',
    };
    const refused = await c.call('POST', '/v1/loans', body);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: 'cash_limit', details: { section: '269SS' } });
    const ok = await c.call('POST', '/v1/loans', {
      ...body,
      cashAcknowledgement: 'Recorded as received',
    });
    expect(ok.status, ok.text).toBe(201);
    const repay = await c.call('POST', `/v1/loans/${ok.body.id}/payments`, {
      kind: 'part',
      date: '2026-11-05',
      principal: 25000,
    });
    expect(repay.body.error).toMatchObject({ code: 'cash_limit', details: { section: '269T' } });
    // Below the limit it just goes through.
    const small = await c.call('POST', `/v1/loans/${ok.body.id}/payments`, {
      kind: 'part',
      date: '2026-11-05',
      principal: 19999,
    });
    expect(small.status, small.text).toBe(201);
    await books(c);
  });

  it('Increase Loan adds to the loan account and the schedule; the statement shows borrowed and repaid; a needed top-up can not be deleted', async () => {
    const c = await ready();
    const b = await bank(c);
    const l = (
      await c.call('POST', '/v1/loans', {
        businessId: c.businessId,
        name: 'Term loan B',
        principal: 1000000,
        ratePct: 12,
        tenureMonths: 12,
        firstEmiDate: '2026-05-05',
        receivedOn: '2026-04-01',
        receivedAccountId: b.id,
      })
    ).body;
    await c.call('POST', `/v1/loans/${l.id}/payments`, {
      kind: 'emi',
      date: '2026-05-05',
      principal: 78848.79,
      interest: 10000,
      accountId: b.id,
    });
    const up = await c.call('POST', `/v1/loans/${l.id}/payments`, {
      kind: 'topup',
      date: '2026-05-20',
      principal: 200000,
      accountId: b.id,
    });
    expect(up.status, up.text).toBe(201);
    expect(up.body.outstanding).toBe(1121151.21);
    expect(up.body.schedule.length).toBeGreaterThan(12);
    expect(await closing(c, l.code)).toBe(-1121151.21);
    const st = (await c.call('GET', `/v1/loans/${l.id}/statement`)).body;
    expect(st.outstanding).toBe(1121151.21);
    expect(st.rows.map((r: any) => [r.borrowed, r.repaid])).toEqual([
      [1000000, 0],
      [0, 78848.79],
      [200000, 0],
    ]);
    // Paying back more than the original loan only works because of the top-up.
    await c.call('POST', `/v1/loans/${l.id}/payments`, {
      kind: 'prepay',
      date: '2026-05-25',
      principal: 1000000,
      accountId: b.id,
    });
    const del = await c.call('DELETE', `/v1/loans/${l.id}/payments/${up.body.payments[1].id}`);
    expect(del.status).toBe(422);
    await books(c);
  });

  it('the Regime Calculator gets §24(b), §80C and §80E figures from housing and education loans of the year', async () => {
    const c = await ready();
    const b = await bank(c);
    const mk = async (name: string, purpose: string) =>
      (
        await c.call('POST', '/v1/loans', {
          businessId: c.businessId,
          name,
          purpose,
          principal: 2400000,
          ratePct: 9,
          tenureMonths: 240,
          firstEmiDate: '2026-05-01',
          receivedOn: '2026-04-01',
          receivedAccountId: b.id,
        })
      ).body;
    const home = await mk('Home loan', 'housing');
    const edu = await mk('Education loan', 'education');
    await mk('Business loan', 'business');
    for (const l of [home, edu])
      await c.call('POST', `/v1/loans/${l.id}/payments`, {
        kind: 'emi',
        date: '2026-05-01',
        principal: l.nextDue.principal,
        interest: l.nextDue.interest,
        accountId: b.id,
      });
    const t = (await c.call('GET', `/v1/loans/tax-summary?businessId=${c.businessId}&fy=2026-27`))
      .body;
    expect(t.items).toHaveLength(2);
    expect(t.suggestions).toMatchObject({
      '24b': home.nextDue.interest,
      '80C': home.nextDue.principal,
      '80E': edu.nextDue.interest,
    });
    const other = (
      await c.call('GET', `/v1/loans/tax-summary?businessId=${c.businessId}&fy=2025-26`)
    ).body;
    expect(other.suggestions['24b']).toBe(0);
    await books(c);
  });

  it('reconciliation: an ignored statement row is remembered on the next upload', async () => {
    const c = await ready();
    const b = await bank(c, { openingBalance: 1000, openingDate: '2026-11-01' });
    const rows = [{ date: '2026-11-03', description: 'Reversed charge', debit: 59 }];
    const m = (await c.call('POST', `/v1/bank-accounts/${b.id}/reconcile/match`, { rows })).body;
    expect(m.unmatchedRows).toEqual([0]);
    const ig = await c.call('POST', `/v1/bank-accounts/${b.id}/reconcile/ignore`, {
      rows: [{ hash: m.hashes[0], statementDate: '2026-11-03', reason: 'Bank reversed it' }],
    });
    expect(ig.status, ig.text).toBe(200);
    const again = (await c.call('POST', `/v1/bank-accounts/${b.id}/reconcile/match`, { rows }))
      .body;
    expect(again).toMatchObject({ alreadyReconciled: [0], unmatchedRows: [] });
    await books(c);
  });

  it('§40A(3): cash paid out to one party above ₹10,000 in a day shows on the summary', async () => {
    const c = await ready();
    await c.call('POST', '/v1/cash/entries', {
      businessId: c.businessId,
      direction: 'increase',
      amount: 50000,
      date: today,
    });
    const s = await party(c);
    const pay = await c.call('POST', '/v1/payments', {
      businessId: c.businessId,
      partyId: s,
      direction: 'out',
      amount: 12000,
      mode: 'cash',
      paymentDate: today,
    });
    expect(pay.status, pay.text).toBe(201);
    const sum = (await c.call('GET', `/v1/cashbank/summary?businessId=${c.businessId}`)).body;
    expect(sum.cashOutWatch).toMatchObject([{ partyId: s, total: 12000 }]);
    await books(c);
  });
});

describe('Phase 5 follow-up: §194A TDS on loan interest, ITC by cheque clear date, IFSC branch lookup', () => {
  it('§194A: no TDS while the year’s interest is ₹10,000 or less; the crossing payment deducts on the whole year; TDS Payable and the TDS ledger agree', async () => {
    const c = await ready();
    const b = await bank(c, { openingBalance: 1000000, openingDate: '2026-04-01' });
    const l = (
      await c.call('POST', '/v1/loans', {
        businessId: c.businessId,
        name: 'Loan from Mr. Rao',
        lender: 'K. Rao',
        lenderType: 'individual',
        lenderPan: 'abcde1234f',
        principal: 500000,
        ratePct: 12,
        tenureMonths: 12,
        firstEmiDate: '2026-05-05',
        receivedOn: '2026-04-01',
        receivedAccountId: b.id,
      })
    ).body;
    expect(l).toMatchObject({ lenderType: 'individual', lenderPan: 'ABCDE1234F', tdsDeducted: 0 });
    let loan = l;
    const tdsByPayment: number[] = [];
    let interestSoFar = 0;
    for (const date of ['2026-05-05', '2026-06-05', '2026-07-05']) {
      const due = loan.nextDue;
      const r = await c.call('POST', `/v1/loans/${l.id}/payments`, {
        kind: 'emi',
        date,
        principal: due.principal,
        interest: due.interest,
        accountId: b.id,
      });
      expect(r.status, r.text).toBe(201);
      loan = r.body;
      interestSoFar += due.interest;
      tdsByPayment.push(loan.payments.at(-1).tdsAmount);
    }
    // 5,000 and 4,6xx stay under ₹10,000; the third payment crosses it and deducts 10% of all three.
    expect(tdsByPayment.slice(0, 2)).toEqual([0, 0]);
    expect(tdsByPayment[2]).toBe(Math.round(interestSoFar * 0.1));
    expect(loan.tdsDeducted).toBe(tdsByPayment[2]);
    expect(await closing(c, '2200')).toBe(-tdsByPayment[2]);
    const tds = (await c.call('GET', `/v1/tds?businessId=${c.businessId}&section=194A`)).body;
    expect(tds.data).toHaveLength(1);
    expect(tds.data[0]).toMatchObject({
      section: '194A',
      pan: 'ABCDE1234F',
      rate: 10,
      tdsAmount: tdsByPayment[2],
    });
    // Deleting the payment removes its accrued TDS entry and reverses the posting.
    await c.call('DELETE', `/v1/loans/${l.id}/payments/${loan.payments.at(-1).id}`);
    expect(
      (await c.call('GET', `/v1/tds?businessId=${c.businessId}&section=194A`)).body.data,
    ).toHaveLength(0);
    expect(await closing(c, '2200')).toBe(0);
    await books(c);
  });

  it('§194A: a bank lender is exempt; without the lender’s PAN it is 20%; a loan marked exempt deducts nothing', async () => {
    const c = await ready();
    const b = await bank(c, { openingBalance: 1000000, openingDate: '2026-04-01' });
    const mk = async (over: Record<string, unknown>) =>
      (
        await c.call('POST', '/v1/loans', {
          businessId: c.businessId,
          name: `L ${Math.random()}`,
          principal: 1000000,
          ratePct: 24,
          tenureMonths: 12,
          firstEmiDate: '2026-05-05',
          receivedOn: '2026-04-01',
          receivedAccountId: b.id,
          ...over,
        })
      ).body;
    const pay = async (l: any) =>
      (
        await c.call('POST', `/v1/loans/${l.id}/payments`, {
          kind: 'emi',
          date: '2026-05-05',
          principal: l.nextDue.principal,
          interest: l.nextDue.interest,
          accountId: b.id,
        })
      ).body.payments.at(-1);
    expect((await pay(await mk({ lenderType: 'bank' }))).tdsAmount).toBe(0);
    const noPan = await pay(await mk({ lenderType: 'nbfc' }));
    expect(noPan).toMatchObject({ tdsRate: 20, tdsAmount: 4000 });
    expect((await pay(await mk({ lenderType: 'company', tdsExempt: true }))).tdsAmount).toBe(0);
    expect(
      (
        await c.call('POST', '/v1/loans', {
          businessId: c.businessId,
          name: 'x',
          principal: 1,
          ratePct: 0,
          tenureMonths: 1,
          firstEmiDate: '2026-05-05',
          receivedOn: '2026-04-01',
          receivedAccountId: b.id,
          lenderPan: 'BAD',
        })
      ).status,
    ).toBe(400);
    await books(c);
  });

  it('ITC 180 days: a supplier cheque counts as paid on the day it clears, not the day it was handed over', async () => {
    const c = await ready();
    const b = await bank(c, { openingBalance: 100000, openingDate: '2026-01-01' });
    const s = await party(c);
    const mkBill = async (n: string) =>
      (
        await c.call('POST', '/v1/purchases', {
          businessId: c.businessId,
          supplierId: s,
          purchaseDate: '2026-01-01',
          invoiceNumber: n,
          items: [{ name: 'Pen', quantity: 10, rate: 100, taxPercent: 18 }],
        })
      ).body;
    const late = await mkBill('S-LATE');
    const early = await mkBill('S-EARLY');
    const cheque = async (number: string, billId: string, chequeDate: string) =>
      (
        await c.call('POST', '/v1/cheques', {
          businessId: c.businessId,
          direction: 'issued',
          partyId: s,
          number,
          amount: 1180,
          chequeDate,
          receivedDate: '2026-02-01',
          bankAccountId: b.id,
          allocations: [{ purchaseId: billId, amount: 1180 }],
        })
      ).body;
    const lateChq = await cheque('900001', late.id, '2026-06-01');
    const earlyChq = await cheque('900002', early.id, '2026-02-01');
    await c.call('POST', `/v1/cheques/${earlyChq.id}/actions`, {
      action: 'clear',
      date: '2026-02-03',
    });
    const risk = async () =>
      (
        await c.call('GET', `/v1/purchases/itc-at-risk?businessId=${c.businessId}&asOf=2026-07-10`)
      ).body.dueForReversal.map((x: any) => x.id);
    // Handed over on 1 Feb, but not cleared by the 180-day deadline (30 Jun): the credit is due for reversal.
    expect(await risk()).toEqual([late.id]);
    await c.call('POST', `/v1/cheques/${lateChq.id}/actions`, {
      action: 'clear',
      date: '2026-07-05',
    });
    expect(await risk()).toEqual([late.id]); // cleared after the deadline: still reversed for that period
    await books(c);
  });

  it('IFSC lookup: branch from the directory, cached; offline falls back to the bundled bank name; unknown is 404', async () => {
    const c = await ready();
    const real = globalThis.fetch;
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (!String(url).startsWith('https://ifsc.razorpay.com/')) return real(url, init);
      seen.push(String(url));
      if (String(url).endsWith('/HDFC0000123'))
        return new Response(
          JSON.stringify({
            BANK: 'HDFC Bank',
            BRANCH: 'MG Road',
            ADDRESS: '1 MG Road',
            CITY: 'Bengaluru',
            STATE: 'Karnataka',
            MICR: '560240002',
            IFSC: 'HDFC0000123',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      if (String(url).endsWith('/SBIN0099999')) return new Response('"Not Found"', { status: 404 });
      throw new Error('network down');
    });
    try {
      const r = await c.call('GET', '/v1/ifsc/hdfc0000123');
      expect(r.status, r.text).toBe(200);
      expect(r.body).toMatchObject({
        bank: 'HDFC Bank',
        branch: 'MG Road',
        city: 'Bengaluru',
        micr: '560240002',
        source: 'live',
      });
      await c.call('GET', '/v1/ifsc/HDFC0000123');
      expect(seen.filter((u) => u.endsWith('/HDFC0000123'))).toHaveLength(1); // cached
      expect((await c.call('GET', '/v1/ifsc/SBIN0099999')).status).toBe(404);
      const offline = await c.call('GET', '/v1/ifsc/ICIC0001234');
      expect(offline.body).toMatchObject({ bank: 'ICICI Bank', branch: '', source: 'bundled' });
      expect((await c.call('GET', '/v1/ifsc/BAD')).status).toBe(400);
    } finally {
      vi.unstubAllGlobals();
    }
    const b = await bank(c, { branch: 'MG Road' });
    expect(b.branch).toBe('MG Road');
    // IFSC_API_URL=off: never calls out, answers from the bundled table.
    const { lookupIfsc } = await import('../src/modules/ifsc.ts');
    vi.stubGlobal('fetch', async () => {
      throw new Error('must not be called');
    });
    try {
      expect(await lookupIfsc('KKBK0000958', 'off')).toMatchObject({
        bank: 'Kotak Mahindra Bank',
        source: 'bundled',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('§194A at credit: interest credited before it is paid', () => {
  it('the credit keeps TDS now; the later payment clears Interest Payable with no second TDS or expense', async () => {
    const c = await ready();
    const b = await bank(c, { openingBalance: 1000000, openingDate: '2026-04-01' });
    const l = (
      await c.call('POST', '/v1/loans', {
        businessId: c.businessId,
        name: 'Unsecured loan from a relative',
        lender: 'S. Iyer',
        lenderType: 'individual',
        lenderPan: 'ABCDE1234F',
        principal: 300000,
        ratePct: 0,
        tenureMonths: 12,
        firstEmiDate: '2026-05-01',
        receivedOn: '2026-04-01',
        receivedAccountId: b.id,
      })
    ).body;
    // Year-end: ₹12,000 interest for the year credited to the lender, not paid yet.
    const cr = await c.call('POST', `/v1/loans/${l.id}/interest-credits`, {
      date: '2027-03-31',
      amount: 12000,
      notes: 'FY 2026-27 interest',
    });
    expect(cr.status, cr.text).toBe(201);
    expect(cr.body.credits[0]).toMatchObject({ amount: 12000, tdsAmount: 1200, tdsRate: 10 });
    expect(cr.body).toMatchObject({ interestCreditedUnpaid: 12000, tdsDeducted: 1200 });
    expect(await closing(c, '5220')).toBe(12000);
    expect(await closing(c, '2420')).toBe(-10800);
    expect(await closing(c, '2200')).toBe(-1200);
    const bankBefore = await bankBal(c, b.id);
    // Paid in April with the first instalment: Interest Payable clears, the bank pays the net, nothing new is deducted.
    const pay = await c.call('POST', `/v1/loans/${l.id}/payments`, {
      kind: 'emi',
      date: '2027-04-05',
      principal: 25000,
      interest: 12000,
      accountId: b.id,
    });
    expect(pay.status, pay.text).toBe(201);
    expect(pay.body.payments[0]).toMatchObject({
      accruedSettled: 12000,
      accruedTds: 1200,
      tdsAmount: 0,
    });
    expect(pay.body.interestCreditedUnpaid).toBe(0);
    expect(await closing(c, '2420')).toBe(0);
    expect(await closing(c, '5220')).toBe(12000);
    expect(await closing(c, '2200')).toBe(-1200);
    expect(await bankBal(c, b.id)).toBe(bankBefore - 25000 - 10800);
    const tds = (await c.call('GET', `/v1/tds?businessId=${c.businessId}&section=194A`)).body.data;
    expect(tds).toMatchObject([{ refType: 'loan_interest', tdsAmount: 1200, date: '2027-03-31' }]);
    // The credit can not go while a payment has paid it; it can once the payment is gone.
    const creditId = cr.body.credits[0].id;
    expect((await c.call('DELETE', `/v1/loans/${l.id}/interest-credits/${creditId}`)).status).toBe(
      409,
    );
    await c.call('DELETE', `/v1/loans/${l.id}/payments/${pay.body.payments[0].id}`);
    const gone = await c.call('DELETE', `/v1/loans/${l.id}/interest-credits/${creditId}`);
    expect(gone.status, gone.text).toBe(200);
    expect(await closing(c, '2420')).toBe(0);
    expect(
      (await c.call('GET', `/v1/tds?businessId=${c.businessId}&section=194A`)).body.data,
    ).toHaveLength(0);
    await books(c);
  });
});
