// Captures the GSTR-1 and GSTR-3B JSON the GST Returns screen builds today, for a fixed set of October 2026 documents,
// as golden files for the server-side builders (X1 in docs/FEATURE_GAPS_2026-11.md). Run it against local development
// servers BEFORE the builders move: it creates an account, saves the documents through the workspace API, opens the
// screen in a browser and saves exactly what the JSON buttons download.
//   node scripts/gst-golden-capture.mjs            → writes packages/tax-engine/test/golden/gst-returns/{input,gstr1,gstr3b}.json
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { signUpAndSetUp } from './e2eSignup.mjs';
import { GSTIN_CHARS, computeInvoiceTotals } from '../../../packages/tax-engine/src/index.ts';
const gstin = (first14) => {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const p = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return first14 + GSTIN_CHARS[(36 - (sum % 36)) % 36];
};

const require = createRequire(new URL('../package.json', import.meta.url));
const { firefox } = require('playwright');
const APP = process.env.E2E_APP_URL || 'http://localhost:5173';
// GOLDEN_OUT=<folder> writes elsewhere, to compare a later build of the screen with the saved files.
const OUT = process.env.GOLDEN_OUT ? new URL(`file://${process.env.GOLDEN_OUT.replace(/\/?$/, '/')}`) : new URL('../../../packages/tax-engine/test/golden/gst-returns/', import.meta.url);
const OWN = '33ABCDE1234F1Z7';

const browser = await firefox.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
  const page = await ctx.newPage();
  await signUpAndSetUp(page, { app: APP, name: 'Golden Owner', email: `golden${Date.now()}@example.com`, password: 'correct-horse-9', business: 'Golden Traders' });
  const get = async (p) => (await page.request.get(`${APP}${p}`)).json();
  const profile = await get('/v1/workspace/profile');

  const client = (name, state, gstin = '', country = 'India') => ({ name, state, gstin, country, address: `${name} street` });
  const bill = (no, date, c, items, over = {}) => {
    const details = { invoiceNumber: no, invoiceDate: date, placeOfSupply: over.pos ?? c.state };
    const totals = computeInvoiceTotals({ items, profile, client: c, details, showGST: over.invoiceType !== 'bill-of-supply', taxInclusive: false, invoiceOptions: {} });
    return {
      id: no, clientName: c.name, invoiceNumber: no, invoiceDate: date, invoiceType: over.invoiceType || 'tax-invoice', currency: 'INR',
      totalAmount: totals.total, totalTaxAmount: totals.totalTaxAmount ?? 0, status: over.status || 'unpaid', paidAmount: 0, payments: [],
      ...(over.status === 'cancelled' ? { cancelledAt: `${date}T10:00:00.000Z` } : {}),
      data: { profile, client: c, details, items, totals, invoiceType: over.invoiceType || 'tax-invoice', taxInclusive: false, invoiceOptions: {} },
    };
  };
  const line = (name, hsn, quantity, rate, taxPercent, extra = {}) => ({ name, hsn, quantity, rate, taxPercent, unit: 'NOS', ...extra });
  const TN_B2B = client('Chennai Retail Pvt Ltd', 'Tamil Nadu', gstin('33AABCU9603R1Z'));
  const KA_B2B = client('Bengaluru Tech LLP', 'Karnataka', gstin('29AABCU9603R1Z'));
  const bills = [
    bill('INV/2026/001', '2026-10-03', TN_B2B, [line('Laptop', '8471', 2, 50000, 18), line('Bag', '4202', 2, 1000, 12)]),
    bill('INV/2026/002', '2026-10-05', KA_B2B, [line('Monitor', '8528', 3, 12000, 18)]),
    bill('INV/2026/003', '2026-10-08', client('Walk-in', 'Tamil Nadu'), [line('Mouse', '8471', 5, 500, 18), line('Rice', '1006', 10, 60, 0, { supplyKind: 'nil' })]),
    bill('INV/2026/004', '2026-10-10', client('Kochi Buyer', 'Kerala'), [line('Server', '8471', 1, 180000, 18)]),
    bill('INV/2026/005', '2026-10-12', client('Acme Inc', '', '', 'United States'), [line('Software', '998314', 1, 100000, 18)], { pos: '' }),
    bill('INV/2026/006', '2026-10-15', TN_B2B, [line('Laptop', '8471', 1, 50000, 18)], { status: 'cancelled' }),
    bill('CN/2026/001', '2026-10-20', TN_B2B, [line('Bag', '4202', 1, 1000, 12)], { invoiceType: 'credit-note' }),
    bill('BOS/2026/001', '2026-10-22', client('Farmer', 'Tamil Nadu'), [line('Seeds', '1209', 4, 250, 0)], { invoiceType: 'bill-of-supply' }),
  ];
  const purchases = [
    { id: 'p1', docType: 'bill', date: '2026-10-04', supplierName: 'Hosur Components', supplierGstin: gstin('33AAACH1234K1Z'), invoiceNumber: 'HC-88', interstate: false, items: [line('Parts', '8473', 10, 2000, 18)], taxableAmount: 20000, totalTax: 3600 },
    { id: 'p2', docType: 'bill', date: '2026-10-09', supplierName: 'Delhi Wholesale', supplierGstin: gstin('07AAACD1234K1Z'), invoiceNumber: 'DW-12', interstate: true, items: [line('Cables', '8544', 20, 300, 18)], taxableAmount: 6000, totalTax: 1080 },
    { id: 'p3', docType: 'bill', date: '2026-10-11', supplierName: 'Advocate', supplierGstin: '', invoiceNumber: 'L-1', interstate: false, reverseCharge: true, items: [line('Legal fees', '998211', 1, 10000, 18)], taxableAmount: 10000, totalTax: 1800 },
  ];
  const expenses = [
    { id: 'e1', date: '2026-10-06', category: 'Rent', vendor: 'Landlord', amount: 23600, gstAmount: 3600, interstate: false, itcEligible: true },
    { id: 'e2', date: '2026-10-18', category: 'Food', vendor: 'Hotel', amount: 1180, gstAmount: 180, interstate: false, itcEligible: false },
  ];
  const post = async (collection, doc) => {
    const r = await page.request.post(`${APP}/v1/workspace/collections/${collection}`, { data: doc });
    if (!r.ok()) throw new Error(`${collection} ${doc.id}: ${r.status()} ${await r.text()}`);
  };
  for (const b of bills) await post('bills', b);
  for (const p of purchases) await post('purchases', p);
  for (const e of expenses) await post('expenses', e);

  const download = async (tab, button) => {
    await page.goto(`${APP}/gst-returns/${tab}`);
    const selects = page.locator('select.form-input');
    await selects.first().waitFor({ timeout: 15000 });
    await selects.nth(1).selectOption('9'); // October (0-based)
    await selects.nth(2).selectOption('2026');
    await page.waitForTimeout(500);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()]);
    return JSON.parse(readFileSync(await dl.path(), 'utf8'));
  };
  const gstr1 = await download('gstr1', 'JSON Export');
  const gstr3b = await download('gstr3b', '3B JSON');
  // What the screen loaded, as the server will read it: the workspace documents themselves.
  const input = {
    profile,
    bills: await get('/v1/workspace/collections/bills'),
    purchases: await get('/v1/workspace/collections/purchases'),
    expenses: await get('/v1/workspace/collections/expenses'),
    receipts: [],
    otherIncome: [],
    period: { mode: 'month', year: 2026, month: 9 },
  };
  mkdirSync(OUT, { recursive: true });
  for (const [name, v] of Object.entries({ input, gstr1, gstr3b })) writeFileSync(new URL(`${name}.json`, OUT), `${JSON.stringify(v, null, 2)}\n`);
  console.log(`captured: ${gstr1.b2b?.length ?? 0} B2B parties, ${gstr1.b2cs?.length ?? 0} B2CS rows, ${gstr1.b2cl?.length ?? 0} B2CL, cdnr ${gstr1.cdnr?.length ?? 0}, hsn ${gstr1.hsn?.data?.length ?? 0}; 3B osup ${JSON.stringify(gstr3b.sup_details.osup_det)}`);
} finally {
  await browser.close();
}
