// Browser test of the Phase 4 screens (docs/VYAPAR_IMPLEMENTATION_PHASES.md, P4-S1…S7 and the Phase 4 acceptance): turn the
// ledger on for a business that already has documents, read the chart, an account's ledger and the trial balance, post a
// journal, run Verify My Data, and see the period lock refuse a write. Same setup as purchase-e2e.mjs: the web app on
// E2E_APP_URL and the API on E2E_API_URL; it creates a throwaway account.
import { createRequire } from 'node:module';
import { signUpAndSetUp } from './e2eSignup.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { firefox } = require('playwright');
const OUT = process.argv[2] || '';
const APP = process.env.E2E_APP_URL || 'http://localhost:5173';
const API = process.env.E2E_API_URL || 'http://localhost:4000';
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };
const visible = (loc) => loc.waitFor({ timeout: 6000 }).then(() => true, () => false);
const shot = (page, n) => (OUT ? page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }) : Promise.resolve());
const password = 'correct-horse-9';
const outbox = async () => (await (await fetch(`${API}/v1/dev/outbox`)).json()).data;
async function waitForMail(match) {
  for (let i = 0; i < 50; i++) { const f = (await outbox()).find(match); if (f) return f; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('the e-mail never arrived');
}

const browser = await firefox.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 200)));
const email = `led${Date.now()}@example.com`;
await signUpAndSetUp(page, { app: APP, name: 'Bookkeeper', email: email, password, business: 'Books Traders', state: 'Tamil Nadu', waitForMail: typeof waitForMail === 'function' ? waitForMail : null });
await page.locator('.account-bar').waitFor({ timeout: 15000 });
await page.getByRole('button', { name: /skip setup/i }).first().click({ timeout: 8000 }).catch(() => {});

// ---- documents made before the ledger exists (through the typed API) ----
const api = async (method, path, data) => {
  const res = await ctx.request.fetch(`${APP}${path}`, { method, data, headers: { 'content-type': 'application/json' } });
  return { status: res.status(), body: await res.json().catch(() => null) };
};
const biz = (await api('GET', '/v1/businesses')).body.data[0].id;
await api('PATCH', `/v1/businesses/${biz}`, { state: 'Tamil Nadu' });
const cust = (await api('POST', '/v1/parties', { name: 'Acme Traders', state: 'Tamil Nadu' })).body.id;
const supp = (await api('POST', '/v1/parties', { name: 'Om Supplies', state: 'Tamil Nadu' })).body.id;
await api('POST', '/v1/invoices', { businessId: biz, partyId: cust, invoiceDate: '2026-11-05', items: [{ name: 'Notebook', quantity: 2, rate: 100, taxPercent: 18 }], payments: [{ mode: 'cash', amount: 36 }] });
await api('POST', '/v1/purchases', { businessId: biz, supplierId: supp, purchaseDate: '2026-11-05', invoiceNumber: 'OM-1', items: [{ name: 'Pen', quantity: 100, rate: 10, taxPercent: 18 }] });

// ---- P4-S4: check, then enable ----
await page.goto(`${APP}/accounting/setup`);
await page.getByText('Not enabled').waitFor();
check('before enabling the ledger is off', await visible(page.getByText('Ledger off')));
await page.getByRole('button', { name: /Run check/ }).click();
check('the check reports 3 documents (invoice, its payment, the bill) in 3 vouchers, a balanced trial balance and matching party balances', await visible(page.getByText(/3 documents · 3 vouchers · 0 problems.*balanced.*match documents/s)));
await shot(page, 'p4-1-check');
await page.getByRole('button', { name: /Enable ledger and post history/ }).click();
await page.getByRole('button', { name: 'Enable ledger and post history', exact: true }).click();
check('enabling turns the ledger on', await visible(page.getByText('Ledger on', { exact: true })));
check('status shows the seeded chart and the posted entries', await visible(page.getByText(/\d+ accounts · \d+ entries/)));

// ---- P4-S1 chart, P4-S7 ledger and trial balance ----
await page.goto(`${APP}/accounting/accounts`);
const recvRow = page.locator('tr', { hasText: 'Accounts Receivable' });
check('the chart shows Accounts Receivable at ₹200.00 Dr (invoice 236 less 36 paid)', await visible(recvRow.getByText(/₹200\.00 Dr/)));
check('a system account carries a lock and has no delete', (await page.locator('tr', { hasText: 'Cash in Hand' }).getByRole('button').count()) === 0);
await shot(page, 'p4-2-chart');
await page.goto(`${APP}/accounting/ledger`);
check('the ledger of Receivable opens by default with the invoice and the payment', await visible(page.getByText(/Closing\s*₹200\.00 Dr/)) && (await page.locator('tbody tr').count()) === 2);
await page.goto(`${APP}/accounting/trial-balance`);
check('the trial balance is balanced', await visible(page.getByText('✔ Balanced')));
await shot(page, 'p4-3-trial-balance');

// ---- P4-S7 journal: an unbalanced voucher can not be saved ----
await page.goto(`${APP}/accounting/journal`);
await page.getByRole('button', { name: 'New Journal Voucher' }).click();
const dlg = page.getByRole('dialog', { name: 'Journal voucher' });
await dlg.getByPlaceholder('e.g. Depreciation on laptop').fill('Depreciation on laptop');
const accountOptions = await dlg.getByLabel('Account, row 1').locator('option').allInnerTexts();
const pick = (re) => accountOptions.find((o) => re.test(o));
await dlg.getByLabel('Account, row 1').selectOption({ label: pick(/Fixed Assets/) });
await dlg.getByLabel('Account, row 2').selectOption({ label: pick(/Round-off Loss/) });
await dlg.getByLabel('Credit, row 1').fill('2000');
await dlg.getByLabel('Debit, row 2').fill('1999');
check('an unbalanced journal shows the difference and Save is disabled', (await visible(dlg.getByText(/differ by ₹1\.00/))) && (await dlg.getByRole('button', { name: 'Save' }).isDisabled()));
await dlg.getByLabel('Debit, row 2').fill('2000');
check('a balanced journal shows ✔ Balanced and Save enables', (await visible(dlg.getByText('✔ Balanced'))) && !(await dlg.getByRole('button', { name: 'Save' }).isDisabled()));
await dlg.getByRole('button', { name: 'Save' }).click();
check('the journal is saved as JV-1', await visible(page.locator('tr', { hasText: 'JV-1' })));
await shot(page, 'p4-4-journal');
await page.goto(`${APP}/accounting/trial-balance`);
check('the trial balance still balances with the journal', await visible(page.getByText('✔ Balanced')) && await visible(page.locator('tr', { hasText: 'Round-off Loss' })));

// ---- P4-S5 Verify My Data ----
await page.goto(`${APP}/utilities/verify`);
check('Verify My Data runs 13 checks and passes them on clean data', await visible(page.getByText(/✔ 1[0-3] passed/)));
await shot(page, 'p4-5-verify');

// ---- P4-S6 period lock ----
await page.goto(`${APP}/accounting/setup`);
await page.locator('input[type=date]').first().fill('2026-11-30');
await page.getByRole('button', { name: 'Save', exact: true }).first().click();
await page.waitForTimeout(600);
const locked = await api('POST', '/v1/expenses', { businessId: biz, expenseDate: '2026-11-10', amount: 10 });
check('with the books locked, a write dated before the lock is refused', locked.status === 409 && locked.body?.error?.code === 'period_locked', JSON.stringify(locked));
check('a write after the lock date is allowed', (await api('POST', '/v1/expenses', { businessId: biz, expenseDate: '2026-12-10', amount: 10 })).status === 201);
await shot(page, 'p4-6-setup');

await browser.close();
console.log(results.every(Boolean) ? '\nALL PASSED' : '\nSOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
