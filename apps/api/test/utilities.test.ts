import { afterAll, describe, expect, it } from 'vitest';
import { gunzipSync, gzipSync } from 'node:zlib';
import { line, makeHarness, type Tenant } from './helpers.ts';

// Vyapar parity Phase 7 (Utilities), API layer: barcode codes, Tally export, Close financial year, backup and restore,
// the setup checklist, trash upgrades and Share with CA. The books are checked with the trial balance after each.
const h = makeHarness();
afterAll(() => h.close());

const enableLedger = async (who: Tenant) => {
  const r = await who.call('POST', '/v1/accounting/backfill', {
    businessId: who.businessId,
    dryRun: false,
  });
  expect(r.body.enabled, r.text).toBe(true);
};
const item = async (who: Tenant, over: Record<string, unknown> = {}) =>
  (
    await who.call('POST', '/v1/items', {
      name: `Item ${Math.random().toString(36).slice(2, 7)}`,
      salePrice: 100,
      taxPercent: 18,
      openingStock: 50,
      ...over,
    })
  ).body;
const party = async (who: Tenant, over: Record<string, unknown> = {}) =>
  (
    await who.call('POST', '/v1/parties', {
      name: `P ${Math.random().toString(36).slice(2, 7)}`,
      state: 'Tamil Nadu',
      ...over,
    })
  ).body;
const inv = (who: Tenant, over: Record<string, unknown> = {}) =>
  who.call('POST', '/v1/invoices', {
    businessId: who.businessId,
    invoiceDate: '2025-08-10',
    items: [line()],
    ...over,
  });
const bill = (who: Tenant, over: Record<string, unknown> = {}) =>
  who.call('POST', '/v1/purchases', {
    businessId: who.businessId,
    purchaseDate: '2025-09-02',
    invoiceNumber: `B-${Math.random().toString(36).slice(2, 8)}`,
    supplierName: 'Wholesale Mart',
    items: [{ name: 'Pen', quantity: 100, rate: 10, taxPercent: 18 }],
    ...over,
  });
const books = async (who: Tenant, businessId = who.businessId) => {
  const v = await who.call('GET', `/v1/verify?businessId=${businessId}`);
  expect(v.body.checks.find((c: any) => c.id === 'ledger_unbalanced').count).toBe(0);
  const tb = (await who.call('GET', `/v1/ledger/trial-balance?businessId=${businessId}`)).body;
  expect(tb.balanced, `Dr ${tb.debit} ≠ Cr ${tb.credit}`).toBe(true);
  return tb;
};
const report = async (who: Tenant, id: string, q: string) =>
  (await who.call('GET', `/v1/reports/${id}?businessId=${who.businessId}&${q}`)).body;
/** A tenant with the ledger on and a year of trading in FY 2025-26. */
async function trading() {
  const who = await h.newTenant();
  await enableLedger(who);
  const c = await party(who);
  expect(
    (
      await inv(who, {
        partyId: c.id,
        items: [line({ name: 'Widget', quantity: 10, rate: 1000, taxPercent: 18 })],
        payments: [{ mode: 'cash', amount: 5000 }],
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await inv(who, {
        partyId: c.id,
        invoiceDate: '2025-12-01',
        items: [line({ name: 'Gadget', quantity: 2, rate: 500, taxPercent: 12 })],
      })
    ).status,
  ).toBe(201);
  expect((await bill(who)).status).toBe(201);
  const cats = (await who.call('GET', '/v1/expense-categories?kind=expense')).body.data;
  await who.call('POST', '/v1/expenses', {
    businessId: who.businessId,
    expenseDate: '2025-10-05',
    categoryId: cats[0].id,
    amount: 2000,
    taxAmount: 0,
    paymentMode: 'cash',
    description: 'Rent',
  });
  return { who, customer: c };
}

describe('P7-S1 barcodes', () => {
  it('gives each item without a barcode the next valid in-store EAN-13; items that have one keep it', async () => {
    const t = await h.newTenant();
    const a = await item(t);
    const b = await item(t, { extra: { barcode: '4006381333931' } });
    const c = await item(t);
    const r = await t.call('POST', '/v1/utilities/barcodes/assign', {
      itemIds: [a.id, b.id, c.id],
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.alreadyHad).toBe(1);
    const codes = r.body.assigned.map((x: any) => x.code);
    expect(codes).toHaveLength(2);
    expect(codes[0]).toMatch(/^200\d{10}$/);
    expect(Number(codes[1].slice(3, 12))).toBe(Number(codes[0].slice(3, 12)) + 1);
    expect((await t.call('GET', `/v1/items/${b.id}`)).body.extra.barcode).toBe('4006381333931');
    expect((await t.call('GET', `/v1/items/${a.id}`)).body.extra.barcode).toBe(codes[0]);
    // running it again assigns nothing new
    expect(
      (await t.call('POST', '/v1/utilities/barcodes/assign', { itemIds: [a.id, c.id] })).body
        .assigned,
    ).toEqual([]);
  });
  it('concurrent runs never repeat a code', async () => {
    const t = await h.newTenant();
    const ids = [] as string[];
    for (let i = 0; i < 12; i++) ids.push((await item(t)).id);
    const runs = await Promise.all(
      [ids.slice(0, 8), ids.slice(4, 12), ids.slice(0, 12), ids.slice(2, 10)].map((s) =>
        t.call('POST', '/v1/utilities/barcodes/assign', { itemIds: s }),
      ),
    );
    runs.forEach((r) => expect(r.status, r.text).toBe(200));
    const all = (await t.call('GET', '/v1/items?limit=50')).body.data.map(
      (x: any) => x.extra.barcode,
    );
    expect(all.every(Boolean)).toBe(true);
    expect(new Set(all).size).toBe(12);
  });
  it('a viewer can not assign', async () => {
    const t = await h.newTenant();
    const v = await h.addMember(t, 'viewer');
    expect(
      (await v.call('POST', '/v1/utilities/barcodes/assign', { itemIds: [(await item(t)).id] }))
        .status,
    ).toBe(403);
  });
});

describe('P7-S2 Tally export', () => {
  it('refuses with the ledger off and says to enable accounting', async () => {
    const t = await h.newTenant();
    const q = `businessId=${t.businessId}&from=2025-04-01&to=2026-03-31`;
    for (const path of [
      `/v1/utilities/tally/preview?${q}`,
      `/v1/utilities/tally/export?${q}&file=vouchers`,
      `/v1/utilities/tally/config?businessId=${t.businessId}`,
    ]) {
      const r = await t.call('GET', path);
      expect(r.status, path).toBe(409);
      expect(r.body.error.code).toBe('ledger_required');
      expect(r.body.error.message).toMatch(/Enable accounting/);
    }
  });
  it('previews counts, exports vouchers whose totals equal the books, and the masters', async () => {
    const { who, customer } = await trading();
    const kerala = await party(who, {
      name: 'Kerala Traders',
      state: 'Kerala',
      gstin: '32ABCDE1234F1Z5',
    });
    await inv(who, {
      partyId: kerala.id,
      invoiceDate: '2025-11-02',
      placeOfSupply: 'Kerala',
      items: [line({ name: 'Widget', quantity: 1, rate: 1000, taxPercent: 5 })],
    });
    const first = (await who.call('GET', '/v1/invoices?limit=50')).body.data.find(
      (i: any) => i.partyId === customer.id && i.total === 11800,
    );
    await who.call('POST', '/v1/invoices', {
      businessId: who.businessId,
      invoiceType: 'credit-note',
      againstInvoiceId: first.id,
      partyId: customer.id,
      invoiceDate: '2025-12-20',
      returnReason: 'sales-return',
      items: [line({ name: 'Widget', quantity: 1, rate: 1000, taxPercent: 18 })],
    });
    const q = `businessId=${who.businessId}&from=2025-04-01&to=2026-03-31`;
    const pre = await who.call('GET', `/v1/utilities/tally/preview?${q}`);
    expect(pre.status, pre.text).toBe(200);
    expect(pre.body.summary).toMatchObject({ vouchers: 5, errors: 0 });
    expect(pre.body.summary.byType).toMatchObject({ Sales: 3, 'Credit Note': 1, Purchase: 1 });
    const x = await who.call('GET', `/v1/utilities/tally/export?${q}&file=vouchers`);
    expect(x.status, x.text).toBe(200);
    expect(x.headers.get('content-type')).toMatch(/xml/);
    expect(x.headers.get('content-disposition')).toMatch(/Voucher\.xml/);
    expect((x.text.match(/<VOUCHER /g) ?? []).length).toBe(5);
    // totals in the XML equal the books: Σ party amounts of Sales = Σ invoice totals
    const sales = (await who.call('GET', '/v1/invoices?limit=50')).body.data.filter(
      (i: any) => i.invoiceType === 'tax-invoice',
    );
    const sumSales = Math.round(sales.reduce((s: number, i: any) => s + i.total, 0) * 100) / 100;
    const partyAmts = [
      ...x.text.matchAll(
        /<VOUCHER VCHTYPE="Sales"[\s\S]*?<ISPARTYLEDGER>Yes<\/ISPARTYLEDGER>\s*<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g,
      ),
    ].map((m) => -Number(m[1]));
    expect(Math.round(partyAmts.reduce((s, v) => s + v, 0) * 100) / 100).toBe(sumSales);
    expect(x.text).toContain('<LEDGERNAME>Output IGST</LEDGERNAME>');
    expect(x.text).toContain('<LEDGERNAME>Input CGST</LEDGERNAME>');
    const m = await who.call('GET', `/v1/utilities/tally/export?${q}&file=master`);
    expect(m.text).toContain('<PARENT>Sundry Debtors</PARENT>');
    expect(m.text).toContain('<PARENT>Sundry Creditors</PARENT>');
    expect(m.text).toContain('Kerala Traders');
    expect(m.text).toContain('<STOCKITEM NAME="Widget"');
    // the period filter: a quiet month has no vouchers
    expect(
      (
        await who.call(
          'GET',
          `/v1/utilities/tally/preview?businessId=${who.businessId}&from=2026-01-01&to=2026-01-31`,
        )
      ).body.summary.vouchers,
    ).toBe(0);
    await books(who);
  });
  it('errors block the download with the document named; the mapping is saved per business', async () => {
    const { who } = await trading();
    const q = `businessId=${who.businessId}&from=2025-04-01&to=2026-03-31`;
    const put = await who.call('PUT', '/v1/utilities/tally/config', {
      businessId: who.businessId,
      mapping: { sales: '  ', company: 'Acme & Co' },
      include: {
        sales: true,
        salesReturns: true,
        purchases: true,
        purchaseReturns: true,
        cancelled: false,
      },
    });
    expect(put.status, put.text).toBe(200);
    const bad = await who.call('GET', `/v1/utilities/tally/export?${q}&file=vouchers`);
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.problems.some((p: any) => p.id === 'sales')).toBe(true);
    await who.call('PUT', '/v1/utilities/tally/config', {
      businessId: who.businessId,
      mapping: { sales: 'Sales - Retail', company: 'Acme & Co' },
      include: {
        sales: true,
        salesReturns: true,
        purchases: false,
        purchaseReturns: true,
        cancelled: false,
      },
    });
    const ok = await who.call('GET', `/v1/utilities/tally/export?${q}&file=vouchers`);
    expect(ok.status, ok.text).toBe(200);
    expect(ok.text).toContain('<LEDGERNAME>Sales - Retail</LEDGERNAME>');
    expect(ok.text).toContain('<SVCURRENTCOMPANY>Acme &amp; Co</SVCURRENTCOMPANY>');
    expect(ok.text).not.toContain('VCHTYPE="Purchase"');
  });
});

/** Every voucher in a Tally file adds up to nothing: debits (negative) and credits (positive) cancel. */
const voucherSums = (xml: string) =>
  [...xml.matchAll(/<VOUCHER [\s\S]*?<\/VOUCHER>/g)].map((m) => {
    const body = m[0].replace(
      /<ACCOUNTINGALLOCATIONS\.LIST>[\s\S]*?<\/ACCOUNTINGALLOCATIONS\.LIST>/g,
      '',
    );
    return (
      Math.round(
        [...body.matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].reduce((s, a) => s + Number(a[1]), 0) *
          100,
      ) / 100
    );
  });
const setInclude = (who: Tenant, over: Record<string, boolean>) =>
  who.call('PUT', '/v1/utilities/tally/config', {
    businessId: who.businessId,
    mapping: {},
    include: {
      sales: true,
      salesReturns: true,
      purchases: true,
      purchaseReturns: true,
      cancelled: false,
      receipts: false,
      payments: false,
      expenses: false,
      screens: true,
      ...over,
    },
  });

describe('P7-S2 Tally: receipts, payments, expenses and the older screens', () => {
  it('exports money in and out, expenses and other income as accounting vouchers that balance', async () => {
    const { who, customer } = await trading();
    const sup = await party(who, { name: 'Wholesale Mart', kind: 'supplier' });
    const base = `businessId=${who.businessId}&from=2025-04-01&to=2026-03-31`;
    expect(
      (
        await who.call('POST', '/v1/payments', {
          businessId: who.businessId,
          partyId: customer.id,
          amount: 1000,
          direction: 'in',
          mode: 'upi',
          paymentDate: '2025-09-01',
          discountAmount: 50,
          tdsAmount: 20,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await who.call('POST', '/v1/payments', {
          businessId: who.businessId,
          partyId: sup.id,
          amount: 400,
          direction: 'out',
          mode: 'cash',
          paymentDate: '2025-09-10',
        })
      ).status,
    ).toBe(201);
    const cats = (await who.call('GET', '/v1/expense-categories?kind=income')).body.data;
    await who.call('POST', '/v1/expenses', {
      businessId: who.businessId,
      kind: 'income',
      expenseDate: '2025-10-07',
      categoryId: cats[0]?.id,
      amount: 5000,
      taxAmount: 900,
      paymentMode: 'bank',
      description: 'Commission',
    });
    // off by default: only the documents
    expect(
      (await who.call('GET', `/v1/utilities/tally/preview?${base}`)).body.summary.byType.Receipt,
    ).toBeUndefined();
    await setInclude(who, { receipts: true, payments: true, expenses: true });
    const pre = (await who.call('GET', `/v1/utilities/tally/preview?${base}`)).body;
    expect(pre.summary.errors, JSON.stringify(pre.problems)).toBe(0);
    expect(pre.summary.byType.Receipt).toBeGreaterThanOrEqual(2); // the money received with the first invoice, the receipt, the income
    expect(pre.summary.byType.Payment).toBeGreaterThanOrEqual(2); // the payment to the supplier, the rent expense
    const x = await who.call('GET', `/v1/utilities/tally/export?${base}&file=vouchers`);
    expect(x.status, x.text).toBe(200);
    const sums = voucherSums(x.text);
    expect(sums.length).toBe(pre.summary.vouchers);
    expect(
      sums.every((v) => v === 0),
      JSON.stringify(sums),
    ).toBe(true);
    expect(x.text).toContain('OBJVIEW="Accounting Voucher View"');
    expect(x.text).toContain('<LEDGERNAME>Discount Allowed</LEDGERNAME>');
    expect(x.text).toContain('<LEDGERNAME>TDS Receivable</LEDGERNAME>');
    expect(x.text).toContain('<LEDGERNAME>Input CGST</LEDGERNAME>');
    const m = (await who.call('GET', `/v1/utilities/tally/export?${base}&file=master`)).text;
    expect(m).toContain('<PARENT>Cash-in-Hand</PARENT>');
    expect(m).toContain('<PARENT>Bank Accounts</PARENT>');
    expect(m).toContain('<NAME>Discount Allowed</NAME>');
    await books(who);
  });

  it('reads what the older screens saved, once per number, and does not repeat a typed document', async () => {
    const who = await h.newTenant();
    await enableLedger(who);
    const doc = (collection: string, body: Record<string, unknown>) =>
      who.call('POST', `/v1/workspace/collections/${collection}`, body);
    expect(
      (
        await doc('bills', {
          id: 'LEG-1',
          invoiceNumber: 'LEG-1',
          invoiceType: 'tax-invoice',
          invoiceDate: '2025-10-01',
          clientName: 'Old Client',
          status: 'unpaid',
          data: {
            client: { name: 'Old Client', state: 'Tamil Nadu', gstin: '33ABCDE1234F1Z5' },
            items: [{ name: 'Old Item', quantity: 2, rate: 100, taxPercent: 18, unit: 'PCS' }],
            details: { placeOfSupply: 'Tamil Nadu' },
            profile: { state: 'Tamil Nadu', country: 'India' },
            totals: { taxableAmount: 200, cgst: 18, sgst: 18, total: 236 },
          },
        })
      ).status,
    ).toBeLessThan(300);
    await doc('purchases', {
      id: 'pur_1',
      invoiceNumber: 'SUP-9',
      date: '2025-10-03',
      supplierName: 'Old Supplier',
      items: [{ name: 'Old Item', quantity: 10, rate: 50, taxPercent: 12 }],
    });
    await doc('receipts', {
      id: 'rcp_1',
      date: '2025-10-05',
      clientName: 'Old Client',
      amount: 100,
      mode: 'upi',
    });
    await doc('expenses', {
      id: 'exp_1',
      date: '2025-10-06',
      category: 'Rent',
      amount: 1000,
      taxAmount: 180,
      paymentMode: 'cash',
    });
    // the same invoice, also in the typed tables, must not appear twice
    const c = await party(who, { name: 'Typed Client' });
    await inv(who, { partyId: c.id, number: 'LEG-1', invoiceDate: '2025-10-01' });
    const base = `businessId=${who.businessId}&from=2025-04-01&to=2026-03-31`;
    await setInclude(who, { receipts: true, expenses: true });
    const pre = (await who.call('GET', `/v1/utilities/tally/preview?${base}`)).body;
    expect(pre.summary.errors, JSON.stringify(pre.problems)).toBe(0);
    expect(pre.summary.byType).toMatchObject({ Sales: 1, Purchase: 1, Receipt: 1, Payment: 1 });
    const x = (await who.call('GET', `/v1/utilities/tally/export?${base}&file=vouchers`)).text;
    expect(voucherSums(x).every((v) => v === 0)).toBe(true);
    expect(x).toContain('Old Supplier');
    expect(x).toContain('<LEDGERNAME>Rent</LEDGERNAME>');
    // with the switch off only the typed tables are read
    await setInclude(who, { screens: false });
    expect(
      (await who.call('GET', `/v1/utilities/tally/preview?${base}`)).body.summary.byType,
    ).toEqual({ Sales: 1 });
  });

  it('an expense paid only in part is exported paid in full, with a warning', async () => {
    const { who } = await trading();
    const cats = (await who.call('GET', '/v1/expense-categories?kind=expense')).body.data;
    await who.call('POST', '/v1/expenses', {
      businessId: who.businessId,
      expenseDate: '2025-11-05',
      categoryId: cats[0].id,
      amount: 1000,
      taxAmount: 0,
      paymentMode: 'cash',
      description: 'Repairs',
      paidAmount: 300,
    });
    await setInclude(who, { expenses: true });
    const pre = (
      await who.call(
        'GET',
        `/v1/utilities/tally/preview?businessId=${who.businessId}&from=2025-04-01&to=2026-03-31`,
      )
    ).body;
    expect(
      pre.problems.some(
        (p: any) => p.level === 'warning' && /only ₹300 of ₹1000 is paid/.test(p.message),
      ),
    ).toBe(true);
  });
});

describe('P7-S3 Close financial year', () => {
  it('refuses with the ledger off', async () => {
    const t = await h.newTenant();
    await inv(t);
    const yrs = (await t.call('GET', `/v1/financial-years?businessId=${t.businessId}`)).body.data;
    const r = await t.call('POST', '/v1/utilities/fy-close', {
      businessId: t.businessId,
      yearId: yrs.at(-1).id,
      method: 'new-year',
      confirmText: yrs.at(-1).label,
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ledger_required');
    expect(r.body.error.message).toMatch(/Enable accounting/);
  });

  it('closes a year: needs a backup and the typed label, moves the profit, keeps the balance sheet, restarts numbering, locks, and reopens', async () => {
    const { who, customer } = await trading();
    const years = (await who.call('GET', `/v1/financial-years?businessId=${who.businessId}`)).body
      .data;
    const fy = years.find((y: any) => y.label === '2025-26');
    const body = {
      businessId: who.businessId,
      yearId: fy.id,
      method: 'new-year',
      newPrefix: '',
      confirmText: '2025-26',
    };
    const qs = (o: any) => new URLSearchParams(o).toString();

    // preview says what is in the way
    const pre0 = (await who.call('GET', `/v1/utilities/fy-close/preview?${qs(body)}`)).body;
    expect(pre0.problems.map((p: any) => p.code)).toContain('backup_needed');
    expect((await who.call('POST', '/v1/utilities/fy-close', body)).status).toBe(422);
    expect((await who.call('POST', '/v1/backups', {})).status).toBe(201);
    expect(
      (await who.call('POST', '/v1/utilities/fy-close', { ...body, confirmText: 'wrong' })).body
        .error.message,
    ).toMatch(/Type 2025-26/);

    const tbBefore = await books(who);
    const bsBefore = await report(who, 'balance-sheet', 'to=2026-03-31');
    const plBefore = await report(who, 'profit-loss', 'from=2025-04-01&to=2026-03-31');
    const profit = plBefore.totals.netProfit;
    expect(profit).not.toBe(0);

    const pre = (await who.call('GET', `/v1/utilities/fy-close/preview?${qs(body)}`)).body;
    expect(pre.canClose, JSON.stringify(pre.problems)).toBe(true);
    expect(pre.journal.lines.at(-1).account).toBe('3100');

    const closed = await who.call('POST', '/v1/utilities/fy-close', body);
    expect(closed.status, closed.text).toBe(200);
    expect(closed.body.year.status).toBe('closed');
    // ledger profit (stock is not posted), as the P&L shows it before stock: matches the journal
    expect(closed.body.netProfit).toBeCloseTo(closed.body.income - closed.body.expense, 2);

    await books(who);
    // 1. the balance sheet at the year end is the same before and after, side by side
    const bsAfter = await report(who, 'balance-sheet', 'to=2026-03-31');
    expect(bsAfter.totals.assets).toBe(bsBefore.totals.assets);
    expect(bsAfter.totals.liabilities).toBe(bsBefore.totals.liabilities);
    expect(bsAfter.totals.difference).toBe(bsBefore.totals.difference);
    // 2. the year's own P&L still reads the same (the closing entry is not part of the period)
    const plAfter = await report(who, 'profit-loss', 'from=2025-04-01&to=2026-03-31');
    expect(plAfter.totals.netProfit).toBe(profit);
    // 3. the new year opens with every asset and liability as the old one closed
    const bsNew = await report(who, 'balance-sheet', 'to=2026-04-01');
    expect(bsNew.totals.assets).toBe(bsBefore.totals.assets);
    expect(bsNew.totals.liabilities).toBe(bsBefore.totals.liabilities);
    // 4. P&L accounts are zero at the year end, and Retained Earnings carries the profit
    const tbAfter = (
      await who.call('GET', `/v1/ledger/trial-balance?businessId=${who.businessId}&asOf=2026-03-31`)
    ).body;
    const lineOf = (code: string) => tbAfter.lines?.find((l: any) => l.code === code);
    expect(lineOf('4000')).toBeUndefined();
    expect(lineOf('5000')).toBeUndefined();
    const re = lineOf('3100');
    expect((re.credit ?? 0) - (re.debit ?? 0)).toBeCloseTo(closed.body.netProfit, 2);
    expect(tbAfter.balanced).toBe(true);
    void tbBefore;

    // writes into the closed year are refused for a non-owner; the owner needs a reason
    const admin = await h.addMember(who, 'admin');
    const refused = await admin.call('POST', '/v1/invoices', {
      businessId: who.businessId,
      partyId: customer.id,
      invoiceDate: '2025-11-11',
      items: [line()],
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('period_locked');

    // numbering restarts in the new year
    const n1 = (await inv(who, { partyId: customer.id, invoiceDate: '2026-05-05' })).body
      .number as string;
    const n2 = (await inv(who, { partyId: customer.id, invoiceDate: '2026-05-06' })).body
      .number as string;
    expect(n1).toMatch(/2026-27\/0001$/);
    expect(n2).toMatch(/2026-27\/0002$/);

    // the plain unlock can not undo a Close FY; only the owner's reopen with a reason reverses the entry
    expect((await who.call('POST', `/v1/financial-years/${fy.id}/reopen`)).status).toBe(409);
    expect(
      (
        await admin.call('POST', '/v1/utilities/fy-reopen', {
          businessId: who.businessId,
          yearId: fy.id,
          reason: 'Late purchase bill',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await who.call('POST', '/v1/utilities/fy-reopen', {
          businessId: who.businessId,
          yearId: fy.id,
          reason: 'x',
        })
      ).status,
    ).toBe(422);
    const reopened = await who.call('POST', '/v1/utilities/fy-reopen', {
      businessId: who.businessId,
      yearId: fy.id,
      reason: 'Late purchase bill',
    });
    expect(reopened.status, reopened.text).toBe(200);
    const tbOpen = (
      await who.call('GET', `/v1/ledger/trial-balance?businessId=${who.businessId}&asOf=2026-03-31`)
    ).body;
    expect(tbOpen.lines.find((l: any) => l.code === '4000')).toBeTruthy();
    expect(tbOpen.lines.find((l: any) => l.code === '3100')).toBeUndefined();
    await books(who);
    expect(
      (await who.call('GET', `/v1/utilities/fy-close/history?businessId=${who.businessId}`)).body
        .data[0],
    ).toMatchObject({ year: '2025-26', reopenReason: 'Late purchase bill' });

    // closing again after the change gives the new profit
    const again = await who.call('POST', '/v1/utilities/fy-close', body);
    expect(again.status, again.text).toBe(200);
    await books(who);
  });

  it('Verify My Data finds a closing entry gone stale after an owner override, and fixes it by closing again', async () => {
    const { who, customer } = await trading();
    await who.call('POST', '/v1/backups', {});
    const fy = (
      await who.call('GET', `/v1/financial-years?businessId=${who.businessId}`)
    ).body.data.find((y: any) => y.label === '2025-26');
    const closed = (
      await who.call('POST', '/v1/utilities/fy-close', {
        businessId: who.businessId,
        yearId: fy.id,
        method: 'new-year',
        confirmText: '2025-26',
      })
    ).body;
    const check = async () =>
      (await who.call('GET', `/v1/verify?businessId=${who.businessId}`)).body.checks.find(
        (c: any) => c.id === 'fy_close_stale',
      );
    expect((await check()).count).toBe(0);
    // the owner overrides the lock with a reason and adds a sale to the closed year
    const late = await who.call('POST', '/v1/invoices', {
      businessId: who.businessId,
      partyId: customer.id,
      invoiceDate: '2026-02-10',
      items: [line({ name: 'Late', quantity: 1, rate: 5000, taxPercent: 0 })],
      confirm: { overrideReason: 'Forgot an invoice' },
    });
    expect(late.status, late.text).toBe(201);
    const c = await check();
    expect(c.count).toBe(1);
    expect(c.rows[0]).toMatchObject({ label: '2025-26', difference: 5000 });
    expect(c.fix).toBe('reclose');
    // the books still balance (the stale entry is wrong about profit, not unbalanced)
    await books(who);
    const fixed = await who.call('POST', '/v1/verify/fy_close_stale/fix', {
      businessId: who.businessId,
    });
    expect(fixed.status, fixed.text).toBe(200);
    expect(fixed.body.fixed).toBe(1);
    expect(fixed.body.check.count).toBe(0);
    const tb = (
      await who.call('GET', `/v1/ledger/trial-balance?businessId=${who.businessId}&asOf=2026-03-31`)
    ).body;
    expect(tb.lines.find((l: any) => l.code === '4000')).toBeUndefined(); // P&L accounts are zero again
    const re = tb.lines.find((l: any) => l.code === '3100');
    expect((re.credit ?? 0) - (re.debit ?? 0)).toBeCloseTo(closed.netProfit + 5000, 2);
    expect(
      (await who.call('GET', `/v1/utilities/fy-close/history?businessId=${who.businessId}`)).body
        .data[0].netProfit,
    ).toBeCloseTo(closed.netProfit + 5000, 2);
    await books(who);
  });

  it('a later year can not be closed before an earlier one, or before it has ended', async () => {
    const { who } = await trading();
    await who.call('POST', '/v1/backups', {});
    const years = (await who.call('GET', `/v1/financial-years?businessId=${who.businessId}`)).body
      .data;
    const cur = years[0]; // newest first
    const r = await who.call(
      'GET',
      `/v1/utilities/fy-close/preview?${new URLSearchParams({ businessId: who.businessId, yearId: cur.id, method: 'new-year', confirmText: cur.label })}`,
    );
    expect(r.body.problems.map((p: any) => p.code)).toEqual(
      expect.arrayContaining(['not_ended', 'earlier_open']),
    );
  });

  it('the prefix method sets the new prefix and restarts numbering', async () => {
    const { who, customer } = await trading();
    await who.call('POST', '/v1/backups', {});
    const fy = (
      await who.call('GET', `/v1/financial-years?businessId=${who.businessId}`)
    ).body.data.find((y: any) => y.label === '2025-26');
    expect(
      (
        await who.call('POST', '/v1/utilities/fy-close', {
          businessId: who.businessId,
          yearId: fy.id,
          method: 'prefix',
          newPrefix: 'A B',
          confirmText: '2025-26',
        })
      ).status,
    ).toBe(422);
    const r = await who.call('POST', '/v1/utilities/fy-close', {
      businessId: who.businessId,
      yearId: fy.id,
      method: 'prefix',
      newPrefix: 'SHOP',
      confirmText: '2025-26',
    });
    expect(r.status, r.text).toBe(200);
    const n = (await inv(who, { partyId: customer.id, invoiceDate: '2026-06-01' })).body
      .number as string;
    expect(n).toMatch(/^SHOP\/2026-27\/0001$/);
  });
});

describe('P7-S4 backup and restore', () => {
  const download = async (who: Tenant, id: string) => {
    const r = await who
      .app()
      .request(`/v1/backups/${id}/download`, { headers: { cookie: who.cookie } });
    return Buffer.from(await r.arrayBuffer());
  };
  it('round trip: a backup restores into an empty organization with the same counts, totals and books', async () => {
    const { who } = await trading();
    await who.call('POST', '/v1/workspace/collections/products', {
      id: 'prod_1',
      name: 'Legacy product',
    });
    const b = await who.call('POST', '/v1/backups', { note: 'before' });
    expect(b.status, b.text).toBe(201);
    expect(b.body.counts.invoices).toBe(2);
    const bytes = await download(who, b.body.id);
    const sourceInvoices = (await who.call('GET', '/v1/invoices?limit=50')).body.data;

    const dest = await h.newTenant();
    const preview = await dest.call('POST', '/v1/backups/restore', {
      file: bytes.toString('base64'),
    });
    expect(preview.status, preview.text).toBe(200);
    expect(preview.body).toMatchObject({ restored: false, canRestore: true });
    expect(preview.body.counts.invoices).toBe(2);
    expect((await dest.call('GET', '/v1/invoices?limit=50')).body.data).toHaveLength(0); // a preview writes nothing
    expect(
      (
        await dest.call('POST', '/v1/backups/restore', {
          file: bytes.toString('base64'),
          confirm: 'restore',
        })
      ).status,
    ).toBe(422);

    const done = await dest.call('POST', '/v1/backups/restore', {
      file: bytes.toString('base64'),
      confirm: 'RESTORE',
    });
    expect(done.status, done.text).toBe(200);
    expect(done.body.restored).toBe(true);
    expect(done.body.restoredCounts.invoices).toBe(2);
    const destInvoices = (await dest.call('GET', '/v1/invoices?limit=50')).body.data;
    expect(destInvoices).toHaveLength(2);
    expect(destInvoices.map((i: any) => i.total).sort()).toEqual(
      sourceInvoices.map((i: any) => i.total).sort(),
    );
    expect(destInvoices.map((i: any) => i.number).sort()).toEqual(
      sourceInvoices.map((i: any) => i.number).sort(),
    );
    // new ids, not the source's
    expect(destInvoices.some((i: any) => sourceInvoices.some((s: any) => s.id === i.id))).toBe(
      false,
    );
    // the restored business has the same books: balanced, same totals
    const restoredBiz = (await dest.call('GET', '/v1/businesses')).body.data.find(
      (x: any) => x.id !== dest.businessId,
    );
    const tbSource = await books(who);
    const tbDest = await books(dest, restoredBiz.id);
    expect(tbDest.debit).toBe(tbSource.debit);
    expect(tbDest.lines.length).toBe(tbSource.lines.length);
    // the screens' own documents came across
    expect(
      (await dest.call('GET', '/v1/workspace/collections/products')).body.some(
        (p: any) => p.name === 'Legacy product',
      ),
    ).toBe(true);
    // a safety snapshot was taken first and is in the history
    const hist = (await dest.call('GET', '/v1/backups')).body;
    expect(
      hist.data.some((x: any) => x.kind === 'safety' && x.id === done.body.safetyBackupId),
    ).toBe(true);
    // and now that it has data, a second restore is refused, still writing nothing
    const second = await dest.call('POST', '/v1/backups/restore', {
      file: bytes.toString('base64'),
      confirm: 'RESTORE',
    });
    expect(second.status).toBe(409);
    expect((await dest.call('GET', '/v1/invoices?limit=50')).body.data).toHaveLength(2);
  });

  it('attachments travel in the backup: a logo comes back under a new id with the same bytes', async () => {
    const { who } = await trading();
    const bytes = new TextEncoder().encode('PNG-logo-bytes');
    const up = await who.call('POST', '/v1/files/upload-url', {
      kind: 'logo',
      fileName: 'logo.png',
      contentType: 'image/png',
      sizeBytes: bytes.length,
      ownerType: 'business',
      ownerId: who.businessId,
    });
    expect(
      (
        await h.app.request(up.body.uploadUrl.replace(/^https?:\/\/[^/]+/, ''), {
          method: 'PUT',
          body: bytes,
          headers: up.body.headers,
        })
      ).status,
    ).toBe(200);
    expect((await who.call('POST', `/v1/files/${up.body.fileId}/complete`)).status).toBe(200);
    const b = await who.call('POST', '/v1/backups', {});
    expect(b.body.counts.files).toBe(1);
    expect(b.body.counts.fileBytes).toBe(1);
    // the backup itself is not a file inside the next backup
    expect((await who.call('POST', '/v1/backups', {})).body.counts.files).toBe(1);
    const bytesOfBackup = await download(who, b.body.id);
    const dest = await h.newTenant();
    const r = await dest.call('POST', '/v1/backups/restore', {
      file: bytesOfBackup.toString('base64'),
      confirm: 'RESTORE',
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.restoredCounts.files).toBe(1);
    const biz = (await dest.call('GET', '/v1/businesses')).body.data.find(
      (x: any) => x.id !== dest.businessId,
    );
    expect(biz.logoFileId).toBeTruthy();
    expect(biz.logoFileId).not.toBe(up.body.fileId);
    const link = await dest.call('GET', `/v1/files/${biz.logoFileId}/download-url`);
    expect(link.status, link.text).toBe(200);
    const got = await h.app.request(link.body.url.replace(/^https?:\/\/[^/]+/, ''));
    expect(got.status).toBe(200);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
  });

  it('wrong password, tampered file and newer schema give clear errors and write nothing', async () => {
    const { who } = await trading();
    const enc = await who.call('POST', '/v1/backups', { password: 'correct horse battery' });
    expect(enc.body.encrypted).toBe(true);
    const bytes = await download(who, enc.body.id);
    const dest = await h.newTenant();
    const go = (file: Buffer, password?: string) =>
      dest.call('POST', '/v1/backups/restore', {
        file: file.toString('base64'),
        password,
        confirm: 'RESTORE',
      });
    const noPw = await go(bytes);
    expect(noPw.status).toBe(422);
    expect(noPw.body.error.details.reason).toBe('needs_password');
    expect((await go(bytes, 'nope nope nope')).body.error.details.reason).toBe('wrong_password');
    const flipped = Buffer.from(bytes);
    flipped[flipped.length - 3] ^= 1;
    expect((await go(flipped, 'correct horse battery')).body.error.details.reason).toBe(
      'wrong_password',
    );
    // a plain backup edited by hand
    const plainB = await who.call('POST', '/v1/backups', {});
    const plain = await download(who, plainB.body.id);
    const inner = JSON.parse(gunzipSync(plain.subarray(8)).toString());
    inner.files.invoices = inner.files.invoices.replace(/"total":\d+(\.\d+)?/, '"total":1');
    const forged = Buffer.concat([
      plain.subarray(0, 8),
      gzipSync(Buffer.from(JSON.stringify(inner))),
    ]);
    expect((await go(forged)).body.error.details.reason).toBe('tampered');
    // newer schema
    const newer = JSON.parse(gunzipSync(plain.subarray(8)).toString());
    newer.manifest.schema += 5;
    expect(
      (
        await go(
          Buffer.concat([plain.subarray(0, 8), gzipSync(Buffer.from(JSON.stringify(newer)))]),
        )
      ).body.error.details.reason,
    ).toBe('newer_schema');
    expect((await go(Buffer.from('not a backup'))).body.error.details.reason).toBe('bad_format');
    // nothing was written by any of them
    expect((await dest.call('GET', '/v1/invoices?limit=50')).body.data).toHaveLength(0);
    expect(
      (await dest.call('GET', '/v1/backups')).body.data.filter((x: any) => x.kind === 'safety'),
    ).toHaveLength(0);
    // the right password works
    expect((await go(bytes, 'correct horse battery')).body.restored).toBe(true);
  });

  it('restore is owner-only', async () => {
    const t = await h.newTenant();
    const b = await t.call('POST', '/v1/backups', {});
    const admin = await h.addMember(t, 'admin');
    const r = await admin.call('POST', '/v1/backups/restore', {
      backupId: b.body.id,
      confirm: 'RESTORE',
    });
    expect(r.status).toBe(403);
  });

  it('the schedule runs once per slot, and keeps only the newest', async () => {
    const t = await h.newTenant();
    expect(
      (
        await t.call('PUT', '/v1/backups/settings', {
          frequency: 'daily',
          hour: 0,
          keepLast: 2,
          remind: true,
          remindDays: 7,
        })
      ).status,
    ).toBe(200);
    expect((await t.call('POST', '/v1/backups/run-due')).body.taken).toBe(true);
    expect((await t.call('POST', '/v1/backups/run-due')).body.taken).toBe(false); // same slot
    const list = (await t.call('GET', '/v1/backups')).body;
    expect(list.data.filter((x: any) => x.kind === 'auto')).toHaveLength(1);
    expect(list.lastBackupAt).toBeTruthy();
    expect(list.reminderDue).toBe(false);
    // three more manual autos aged by hand, then settings with keepLast 1 prunes
    const { withTenant, schema } = await import('@ledgora/db');
    await withTenant(h.db, t.orgId, (tx) =>
      tx.insert(schema.backups).values(
        [1, 2, 3].map(() => ({
          orgId: t.orgId,
          kind: 'auto',
          fileName: 'x.ledgora',
          schemaVersion: 1,
          sha256: 'x',
        })),
      ),
    );
    await t.call('PUT', '/v1/backups/settings', {
      frequency: 'daily',
      hour: 0,
      keepLast: 1,
      remind: true,
      remindDays: 7,
    });
    expect(
      (await t.call('GET', '/v1/backups')).body.data.filter((x: any) => x.kind === 'auto'),
    ).toHaveLength(1);
  });

  it('a new organization is reminded to back up; deleting a backup removes it', async () => {
    const t = await h.newTenant();
    expect((await t.call('GET', '/v1/backups')).body.reminderDue).toBe(true);
    const b = await t.call('POST', '/v1/backups', {});
    expect((await t.call('GET', '/v1/backups')).body.reminderDue).toBe(false);
    expect((await t.call('DELETE', `/v1/backups/${b.body.id}`)).status).toBe(200);
    expect((await t.call('GET', '/v1/backups')).body.data).toHaveLength(0);
  });
});

describe('P7-S5 setup checklist', () => {
  it('ticks itself as the business fills in, and the card can be hidden from 5 of 8', async () => {
    const t = await h.newTenant();
    const get = async () =>
      (await t.call('GET', `/v1/setup/checklist?businessId=${t.businessId}`)).body;
    const c0 = await get();
    expect(c0.total).toBe(8);
    expect(c0.rows.find((r: any) => r.id === 'item').done).toBe(false);
    expect(c0.showDot).toBe(true);
    expect(
      (await t.call('POST', '/v1/setup/dismiss', { businessId: t.businessId, dismissed: true }))
        .status,
    ).toBe(422);
    await item(t);
    const p = await party(t);
    await t.call('PATCH', `/v1/businesses/${t.businessId}`, {
      gstin: '33ABCDE1234F1Z5',
      address: '12 Mount Rd',
    });
    await inv(t, { partyId: p.id });
    await t.call('POST', '/v1/backups', {});
    const c1 = await get();
    for (const id of ['item', 'party', 'invoice', 'gstinAndAddress', 'backup'])
      expect(c1.rows.find((r: any) => r.id === id).done, id).toBe(true);
    expect(c1.canDismiss).toBe(true);
    expect(
      (await t.call('POST', '/v1/setup/dismiss', { businessId: t.businessId, dismissed: true }))
        .status,
    ).toBe(200);
    expect(await get()).toMatchObject({ dismissed: true, showDot: false });
    await t.call('POST', '/v1/setup/dismiss', { businessId: t.businessId, dismissed: false });
    expect((await get()).showDot).toBe(true);
  });
  it("counts the older screens' documents too", async () => {
    const t = await h.newTenant();
    await t.call('POST', '/v1/workspace/collections/products', {
      id: 'prod_1',
      name: 'Old product',
    });
    await t.call('POST', '/v1/workspace/collections/clients', { id: 'cli_1', name: 'Old client' });
    const c = (await t.call('GET', `/v1/setup/checklist?businessId=${t.businessId}`)).body;
    expect(c.rows.find((r: any) => r.id === 'item').done).toBe(true);
    expect(c.rows.find((r: any) => r.id === 'party').done).toBe(true);
  });
});

describe('P7-S6 trash and Share with CA', () => {
  it('restoring from the trash reposts the ledger and respects the period lock; bulk restore reports each failure', async () => {
    const t = await h.newTenant();
    await enableLedger(t);
    // Tax invoices are cancelled, never trashed; purchase bills are trashed.
    const a = (await bill(t, { purchaseDate: '2026-11-01' })).body;
    const b = (await bill(t, { purchaseDate: '2026-11-02' })).body;
    const old = (await bill(t, { purchaseDate: '2026-02-02' })).body;
    for (const x of [a, b, old])
      expect((await t.call('DELETE', `/v1/purchases/${x.id}`)).status).toBe(200);
    expect((await t.call('GET', '/v1/trash?type=purchase')).body.data).toHaveLength(3);
    expect((await t.call('GET', '/v1/trash?type=party')).body.data).toHaveLength(0);
    const tbGone = await books(t);
    // lock everything up to 31 Mar 2026
    await t.call('PUT', '/v1/accounting/lock', {
      businessId: t.businessId,
      lockBefore: '2026-03-31',
      allowEditAfterGstFiled: false,
    });
    const admin = await h.addMember(t, 'admin');
    const r = await admin.call('POST', '/v1/trash/restore', { ids: [a.id, old.id, b.id] });
    expect(r.status, r.text).toBe(200);
    expect(r.body.restored).toBe(2);
    expect(r.body.failed).toHaveLength(1);
    expect(r.body.failed[0].id).toBe(old.id);
    expect(r.body.failed[0].message).toMatch(/lock|closed|period/i);
    const tbBack = await books(t);
    expect(tbBack.debit).toBeGreaterThan(tbGone.debit); // reposted
    expect((await t.call('GET', '/v1/trash?type=purchase')).body.data).toHaveLength(1);
    // the owner may restore into the locked period with a reason
    expect(
      (
        await t.call('POST', `/v1/trash/${old.id}/restore`, undefined, {
          'x-override-reason': 'Deleted by mistake',
        })
      ).status,
    ).toBe(200);
    await books(t);
  });
  it("emptying the trash is the owner's action", async () => {
    const t = await h.newTenant();
    const admin = await h.addMember(t, 'admin');
    expect((await admin.call('POST', '/v1/trash/purge')).status).toBe(403);
    expect((await t.call('POST', '/v1/trash/purge')).status).toBe(200);
  });

  const invite = async (t: Tenant, body: Record<string, unknown>) => {
    const email = `ca${Math.random().toString(36).slice(2, 8)}@example.com`;
    const inviteRes = await t.call('POST', '/v1/invitations', { email, role: 'ca', ...body });
    expect(inviteRes.status, inviteRes.text).toBe(201);
    const { cookie } = await h.signUp(email);
    const call = h.client(cookie);
    const acc = await call('POST', `/v1/invitations/${inviteRes.body.id}/accept`);
    expect(acc.status, acc.text).toBe(200);
    return { call, cookie, invitation: inviteRes.body };
  };
  it('the CA role can read everything and write nothing (ten write endpoints)', async () => {
    const { who, customer } = await trading();
    const it1 = await item(who);
    const ca = await invite(who, {});
    const j = await ca.call('GET', `/v1/invoices?limit=5`);
    expect(j.status).toBe(200);
    expect(j.body.data.length).toBeGreaterThan(0);
    expect(
      (
        await ca.call(
          'GET',
          `/v1/reports/profit-loss?businessId=${who.businessId}&from=2025-04-01&to=2026-03-31`,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await ca.call(
          'GET',
          `/v1/reports/day-book/export?businessId=${who.businessId}&from=2025-04-01&to=2026-03-31`,
        )
      ).status,
    ).toBe(200);
    expect(
      (await ca.call('GET', `/v1/ledger/trial-balance?businessId=${who.businessId}`)).status,
    ).toBe(200);
    const writes: [string, string, unknown][] = [
      [
        'POST',
        '/v1/invoices',
        {
          businessId: who.businessId,
          partyId: customer.id,
          invoiceDate: '2026-11-01',
          items: [line()],
        },
      ],
      ['POST', '/v1/parties', { name: 'X' }],
      ['POST', '/v1/items', { name: 'X' }],
      ['PATCH', `/v1/items/${it1.id}`, { name: 'Y' }],
      [
        'POST',
        '/v1/payments',
        {
          businessId: who.businessId,
          partyId: customer.id,
          amount: 10,
          direction: 'in',
          mode: 'cash',
          paymentDate: '2026-11-01',
        },
      ],
      [
        'POST',
        '/v1/expenses',
        { businessId: who.businessId, expenseDate: '2026-11-01', amount: 1, paymentMode: 'cash' },
      ],
      [
        'POST',
        '/v1/journals',
        {
          businessId: who.businessId,
          date: '2026-11-01',
          rows: [
            { accountId: it1.id, debit: 1 },
            { accountId: it1.id, credit: 1 },
          ],
        },
      ],
      [
        'PUT',
        `/v1/businesses/${who.businessId}/settings`,
        { numberSettings: {}, printSettings: {}, preferences: {} },
      ],
      ['POST', '/v1/utilities/barcodes/assign', { itemIds: [it1.id] }],
      ['POST', '/v1/backups/restore', { backupId: it1.id, confirm: 'RESTORE' }],
      ['POST', '/v1/trash/restore', { ids: [it1.id] }],
      ['POST', '/v1/verify/ledger_unbalanced/fix', { businessId: who.businessId }],
      [
        'POST',
        '/v1/utilities/fy-close',
        { businessId: who.businessId, yearId: it1.id, method: 'new-year', confirmText: '2025-26' },
      ],
    ];
    expect(writes.length).toBeGreaterThanOrEqual(10);
    for (const [m, p, body] of writes)
      expect((await ca.call(m, p, body)).status, `${m} ${p}`).toBe(403);
    expect((await ca.call('DELETE', `/v1/invoices/${j.body.data[0].id}`)).status).toBe(403);
  });
  it('a CA can be limited to a date range and the link can be made to expire sooner', async () => {
    const { who } = await trading();
    const ca = await invite(who, {
      dataFrom: '2025-04-01',
      dataTo: '2025-09-30',
      expiresInDays: 3,
    });
    expect(new Date(ca.invitation.expiresAt).getTime() - Date.now()).toBeLessThan(3.1 * 86_400_000);
    expect(ca.invitation).toMatchObject({ dataFrom: '2025-04-01', dataTo: '2025-09-30' });
    const p = (q: string) =>
      ca.call('GET', `/v1/reports/profit-loss?businessId=${who.businessId}&${q}`);
    expect((await p('from=2025-04-01&to=2025-09-30')).status).toBe(200);
    const out = await p('from=2025-04-01&to=2026-03-31');
    expect(out.status).toBe(403);
    expect(out.body.error.message).toMatch(/2025-04-01 to 2025-09-30/);
    expect((await p('from=2024-01-01&to=2025-06-30')).status).toBe(403);
    // with no dates the range is applied for them
    const dflt = await p('');
    expect(dflt.status, dflt.text).toBe(200);
    expect(dflt.body.meta).toMatchObject({ from: '2025-04-01', to: '2025-09-30' });
    // the same range holds on the list and detail screens, not only on reports
    const all = (await who.call('GET', '/v1/invoices?limit=50')).body.data;
    expect(all.map((i: any) => i.invoiceDate).sort()).toEqual(['2025-08-10', '2025-12-01']);
    const mine = (await ca.call('GET', '/v1/invoices?limit=50')).body.data;
    expect(mine.map((i: any) => i.invoiceDate)).toEqual(['2025-08-10']);
    const december = all.find((i: any) => i.invoiceDate === '2025-12-01');
    expect((await ca.call('GET', `/v1/invoices/${december.id}`)).status).toBe(403);
    expect(
      (
        await ca.call(
          'GET',
          `/v1/invoices/${all.find((i: any) => i.invoiceDate === '2025-08-10').id}`,
        )
      ).status,
    ).toBe(200);
    expect((await ca.call('GET', '/v1/invoices?from=2025-04-01&to=2026-03-31')).status).toBe(403);
    expect(
      (
        await ca.call(
          'GET',
          `/v1/ledger/trial-balance?businessId=${who.businessId}&asOf=2026-03-31`,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await ca.call(
          'GET',
          `/v1/ledger/trial-balance?businessId=${who.businessId}&asOf=2025-09-30`,
        )
      ).status,
    ).toBe(200);
    const exps = (await who.call('GET', '/v1/expenses?limit=50')).body.data;
    expect(exps.length).toBeGreaterThan(0);
    expect((await ca.call('GET', '/v1/expenses?limit=50')).body.data).toEqual([]); // the rent is dated 5 Oct
    expect((await ca.call('GET', '/v1/purchases?limit=50')).body.data).toHaveLength(1); // the bill is dated 2 Sep
    // the owner is not limited
    expect(
      (
        await who.call(
          'GET',
          `/v1/reports/profit-loss?businessId=${who.businessId}&from=2025-04-01&to=2026-03-31`,
        )
      ).status,
    ).toBe(200);
  });
  it("an expired invitation can not be accepted, and the audit log records the CA's exports", async () => {
    const { who } = await trading();
    const email = `late${Math.random().toString(36).slice(2, 7)}@example.com`;
    const r = await who.call('POST', '/v1/invitations', { email, role: 'ca' });
    await h.sql`update invitation set expires_at = now() - interval '1 hour' where id = ${r.body.id}`;
    const { cookie } = await h.signUp(email);
    expect((await h.client(cookie)('POST', `/v1/invitations/${r.body.id}/accept`)).status).toBe(
      404,
    );
    const ca = await invite(who, {});
    await ca.call(
      'GET',
      `/v1/reports/day-book/export?businessId=${who.businessId}&from=2025-04-01&to=2026-03-31`,
    );
    const log = (await who.call('GET', '/v1/audit?limit=50')).body.data ?? [];
    expect(log.some((x: any) => x.action === 'report.export')).toBe(true);
  });
});
