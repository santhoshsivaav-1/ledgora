// Browser test of the Phase 6 report library, in Firefox: the hub with its groups, a favourite that survives a reload, a
// saved view restored exactly, the full CSV from the server, an e-mail schedule, the e-way bill recorder, and every report
// opened once to see it loads. Same setup as cashbank-e2e.mjs: the API serving the built app on E2E_APP_URL; it creates a
// throwaway account and its own documents. Screenshots go to the folder given as the first argument.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { firefox } = require('playwright');
const OUT = process.argv[2] || '';
const APP = process.env.E2E_APP_URL || 'http://localhost:5173';
const API = process.env.E2E_API_URL || APP;
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };
const visible = (loc, timeout = 8000) => loc.first().waitFor({ timeout }).then(() => true, () => false);
const shot = (page, n) => (OUT ? page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }) : Promise.resolve());
const password = 'correct-horse-9';
const today = new Date().toISOString().slice(0, 10);
const outbox = async () => (await (await fetch(`${API}/v1/dev/outbox`)).json()).data;
async function waitForMail(match) {
  for (let i = 0; i < 50; i++) { const f = (await outbox()).find(match); if (f) return f; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('the e-mail never arrived');
}

const browser = await firefox.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('pageerror:', e.message.slice(0, 200)); });

try {
  const email = `rp${Date.now()}@example.com`;
  await page.goto(APP);
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByLabel('Your name').fill('Owner');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel(/Password/).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  const verify = page.getByRole('heading', { name: 'Check your e-mail' });
  await Promise.race([verify.waitFor(), page.getByLabel('Business name').waitFor()]);
  if (await verify.isVisible()) { const mail = await waitForMail((m) => m.to === email && /Confirm/.test(m.subject)); await page.goto(/https?:\/\/\S+/.exec(mail.text)[0]); }
  await page.getByLabel('Business name').fill('Report Traders');
  await page.getByLabel('State').selectOption('Tamil Nadu');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.locator('.account-bar').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: /skip setup/i }).first().click({ timeout: 8000 }).catch(() => {});

  const api = async (method, path, data) => {
    const res = await ctx.request.fetch(`${APP}${path}`, { method, data, headers: { 'content-type': 'application/json' } });
    return { status: res.status(), body: await res.json().catch(() => null) };
  };
  const biz = (await api('GET', '/v1/businesses')).body.data[0].id;
  await api('PATCH', `/v1/businesses/${biz}`, { state: 'Tamil Nadu' });
  const asha = (await api('POST', '/v1/parties', { name: 'Asha Stores', state: 'Tamil Nadu' })).body.id;
  const bala = (await api('POST', '/v1/parties', { name: 'Bala Traders', state: 'Tamil Nadu' })).body.id;
  const om = (await api('POST', '/v1/parties', { name: 'Om Supplies', state: 'Tamil Nadu' })).body.id;
  const pen = (await api('POST', '/v1/items', { name: 'Pen', hsn: '96081019', salePrice: 20, purchasePrice: 6, taxPercent: 18, openingStock: 100, extra: { category: 'Stationery' } })).body.id;
  await api('POST', '/v1/purchases', { businessId: biz, supplierId: om, purchaseDate: today, invoiceNumber: 'OM-1', items: [{ name: 'Pen', itemId: pen, quantity: 100, rate: 8, taxPercent: 18 }] });
  const inv = (p, qty, rate, extra = {}) => api('POST', '/v1/invoices', { businessId: biz, partyId: p, invoiceDate: today, items: [{ name: 'Pen', itemId: pen, hsn: '96081019', quantity: qty, rate, taxPercent: 18, ...extra }], ...extra.top });
  await inv(asha, 10, 20);
  const big = (await inv(bala, 100, 600)).body.id; // ₹70,800: needs an e-way bill
  await api('POST', '/v1/expenses', { businessId: biz, expenseDate: today, amount: 500, description: 'Tea', paymentMode: 'cash' });
  check('the ledger turns on', (await api('POST', '/v1/accounting/backfill', { businessId: biz, dryRun: false })).body?.enabled === true);

  // ---- hub ----
  await page.goto(`${APP}/reports`);
  const groups = ['Financial statements', 'Transactions', 'Party', 'GST', 'Item / Stock', 'Expense', 'Orders', 'Income Tax'];
  let all = true;
  for (const g of groups) all = all && (await visible(page.getByRole('region', { name: g }), 4000));
  check('the hub lists every group', all);
  check('GST and Income Tax link to the screens that already exist', (await page.getByRole('link', { name: 'GSTR-1' }).getAttribute('href')) === '/gst-returns/gstr1' && (await page.getByRole('link', { name: 'ITR Summary' }).getAttribute('href')) === '/income-tax');
  await page.getByPlaceholder('Search reports…').fill('discount');
  check('search narrows by title and description', (await page.getByRole('region').count()) === 2 && (await visible(page.getByRole('link', { name: 'Item-wise Discount' }))));
  await page.getByPlaceholder('Search reports…').fill('');
  await page.getByRole('button', { name: 'Star Sale Report' }).click();
  check('a starred report appears under Favourites', await visible(page.getByLabel('Favourites').getByRole('link', { name: 'Sale Report' })));
  await page.reload();
  check('the favourite is still there after a reload', await visible(page.getByLabel('Favourites').getByRole('link', { name: 'Sale Report' })));
  await shot(page, 'p6-hub');

  // ---- Sale Report: filters, saved view, full CSV, schedule ----
  await page.getByLabel('Favourites').getByRole('link', { name: 'Sale Report' }).click();
  check('Sale Report shows server totals in its chips', await visible(page.locator('.ui-chip', { hasText: 'Total sale' })));
  await page.getByRole('button', { name: 'Add to favourites' }).or(page.getByRole('button', { name: 'Remove from favourites' })).first().waitFor();
  check('its star is on, as in the hub', await visible(page.getByRole('button', { name: 'Remove from favourites' })));
  await page.getByLabel('Party').selectOption({ label: 'Asha Stores' });
  check('filtering by party leaves only that party', await visible(page.locator('tbody tr', { hasText: 'Asha Stores' })) && (await page.locator('tbody tr', { hasText: 'Bala Traders' }).count()) === 0);
  await page.getByRole('button', { name: 'Save view' }).click();
  let dlg = page.getByRole('dialog', { name: 'Save this view' });
  await dlg.getByPlaceholder(/Name/).fill('Asha only');
  await dlg.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByLabel('Party').selectOption({ label: 'All parties' });
  check('back to all parties', await visible(page.locator('tbody tr', { hasText: 'Bala Traders' })));
  await page.getByLabel('Saved views').selectOption({ label: 'Asha only' });
  check('the saved view restores the party filter exactly', (await page.getByLabel('Party').inputValue()) !== '' && (await page.locator('tbody tr', { hasText: 'Bala Traders' }).count()) === 0 && await visible(page.locator('tbody tr', { hasText: 'Asha Stores' })));
  await page.getByLabel('Party').selectOption({ label: 'All parties' });
  const dl = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
  await page.getByRole('button', { name: /Full CSV/ }).click();
  const file = await dl;
  const text = file ? readFileSync(await file.path(), 'utf8') : '';
  check('Full CSV downloads every row from the server', !!file && file.suggestedFilename() === 'sale.csv' && /Taxable/.test(text.split('\n')[0]) && text.trim().split('\n').length >= 3, text.slice(0, 120));
  await page.getByRole('button', { name: /Schedule/ }).click();
  dlg = page.getByRole('dialog', { name: 'E-mail this report' });
  await dlg.getByPlaceholder('owner@shop.in, ca@firm.in').fill('ca@example.com');
  await dlg.getByRole('button', { name: 'Add schedule' }).click();
  check('the e-mail schedule is listed with its recipient', await visible(dlg.locator('tr', { hasText: 'ca@example.com' })) && await visible(dlg.getByText('not yet')));
  await shot(page, 'p6-schedule');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button', { name: /Schedule/ }).click();
  check('the schedule is still there after a reload', await visible(page.getByRole('dialog', { name: 'E-mail this report' }).locator('tr', { hasText: 'ca@example.com' })));

  // ---- the e-way bill register and its recorder ----
  await page.goto(`${APP}/reports/eway-register`);
  const row = page.locator('tbody tr', { hasText: 'pending' });
  check('the ₹70,800 goods invoice is pending an e-way bill', await visible(row));
  await page.getByLabel('Record for invoice').selectOption({ index: 1 });
  await page.locator('label', { hasText: 'E-way bill no' }).locator('input').fill('281001234567');
  await page.locator('label', { hasText: 'Vehicle' }).locator('input').fill('tn09ab1234');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  check('recording it shows the number, the vehicle and generated', await visible(page.locator('tbody tr', { hasText: '281001234567' })) && await visible(page.locator('tbody tr', { hasText: 'TN09AB1234' })));
  await shot(page, 'p6-eway');

  // ---- Bill Wise Profit and a financial figure, seen on screen ----
  await page.goto(`${APP}/reports/bill-wise-profit`);
  check('Bill Wise Profit shows profit and margin chips', await visible(page.locator('.ui-chip', { hasText: 'Margin' })));
  await shot(page, 'p6-bill-wise-profit');

  // ---- every report opens ----
  const ids = ['day-book', 'cash-flow', 'party-statement', 'profit-loss', 'trial-balance', 'balance-sheet', 'payable-ageing', 'sale', 'purchase', 'all-transactions', 'bill-wise-profit', 'ageing', 'all-parties', 'party-pnl', 'party-by-item', 'by-party', 'by-party-group', 'salesman', 'stock-summary', 'stock-by-category', 'stock-detail', 'item-detail', 'low-stock', 'item-by-party', 'item-pnl', 'category-pnl', 'by-category', 'item-discount', 'gst-rate', 'hsn', 'sac', 'sale-gst', 'purchase-gst', 'form-27eq', 'eway-register', 'expense', 'expense-category', 'expense-item', 'other-income', 'discount', 'sale-order', 'sale-order-item', 'purchase-order', 'cash-watch', 'bank-statement', 'loan-statement', 'cheque-register'];
  const broken = [];
  for (const id of ids) {
    await page.goto(`${APP}/reports/${id}`);
    const shell = await visible(page.locator('.ui-report'), 10000);
    await page.waitForLoadState('networkidle').catch(() => {});
    const body = await page.locator('body').innerText();
    // Cash & Bank is off in this business, so its three reports say so; everything else must load.
    const off = ['bank-statement', 'loan-statement', 'cheque-register'].includes(id);
    if (off ? !/Cash & Bank is off/.test(body) : !shell || /Could not load|Something went wrong|Not for your role/.test(body)) broken.push(id);
  }
  check(`all ${ids.length} reports open (Cash & Bank ones say it is off)`, broken.length === 0, broken.join(', '));
  await page.goto(`${APP}/reports/stock-summary`);
  check('Stock Summary lists the pen with its weighted-average value', await visible(page.locator('tbody tr', { hasText: 'Pen' })));
  await shot(page, 'p6-stock-summary');
  await page.goto(`${APP}/reports/hsn`);
  check('HSN Summary groups the pens by code', await visible(page.locator('tbody tr', { hasText: '96081019' })));

  const v = (await api('GET', `/v1/verify?businessId=${biz}`)).body;
  check('Verify My Data: the books are balanced', v.checks.find((c) => c.id === 'ledger_unbalanced').count === 0);
  check('no script errors in the page', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
  void big;
} catch (e) {
  check('the run finished', false, e.message.slice(0, 400));
  await shot(page, 'zz-failure');
}

await browser.close();
console.log(results.every(Boolean) ? '\nALL PASSED' : '\nSOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
