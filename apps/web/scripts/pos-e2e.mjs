// Browser test of Phase 12 (Point of Sale), in Firefox: scan an item by barcode, change the quantity, give a bill
// discount, hold a second bill in a tab, take cash with change, save with the keyboard, then check the invoice, stock
// and the books through the API. Same setup as ledger-e2e.mjs: the web app on E2E_APP_URL and the API on E2E_API_URL (one origin when the
// API serves the built app); it creates a throwaway account. Screenshots go to the folder given as the first argument.
import { createRequire } from 'node:module';
import { signUpAndSetUp } from './e2eSignup.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
/** The input or select of a form field, found by its label text inside `scope` (a dialog). */
const field = (scope, label) => scope.locator('.form-group', { has: page.locator('label', { hasText: label }) }).locator('input, select').first();

try {
  const email = `pos${Date.now()}@example.com`;
  await signUpAndSetUp(page, { app: APP, name: 'Owner', email: email, password, business: 'Corner Store', state: 'Tamil Nadu', waitForMail: typeof waitForMail === 'function' ? waitForMail : null });
  await page.locator('.account-bar').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: /skip setup/i }).first().click({ timeout: 8000 }).catch(() => {});

  const api = async (method, path, data) => {
    const res = await ctx.request.fetch(`${APP}${path}`, { method, data, headers: { 'content-type': 'application/json' } });
    return { status: res.status(), body: await res.json().catch(() => null) };
  };
  const biz = (await api('GET', '/v1/businesses')).body.data[0].id;
  await api('PATCH', `/v1/businesses/${biz}`, { state: 'Tamil Nadu' });
  check('the ledger turns on', (await api('POST', '/v1/accounting/backfill', { businessId: biz, dryRun: false })).body?.enabled === true);
  const soap = (await api('POST', '/v1/items', { name: 'Lux Soap', sku: 'LUX1', salePrice: 118, taxPercent: 18, openingStock: 20, extra: { barcode: '8901234567890', salePriceInclTax: true } })).body;
  await api('POST', '/v1/items', { name: 'Basmati Rice', sku: 'RICE', unit: 'KG', salePrice: 100, taxPercent: 5, openingStock: 50, extra: { barcode: '8909999999990', salePriceInclTax: false } });
  await api('POST', '/v1/parties', { name: 'Asha Kumar', phone: '9876543210', state: 'Tamil Nadu' });

  await page.goto(`${APP}/pos`);
  const search = page.getByLabel('Scan or search an item');
  check('the counter opens with the search box focused', await visible(search));
  await search.fill('8901234567890');
  await search.press('Enter');
  check('a scanned barcode adds the item to the bill', await visible(page.locator('.pos-table tbody tr', { hasText: 'Lux Soap' })));
  await search.fill('8901234567890');
  await search.press('Enter');
  check('scanning the same item again adds to its line', await visible(page.locator('.pos-table tbody tr', { hasText: 'Lux Soap' }).locator('input.q[value="2"]')));
  await search.fill('3*rice');
  await search.press('Enter');
  check('"3*rice" adds three kg of rice', await visible(page.locator('.pos-table tbody tr', { hasText: 'Basmati Rice' }).locator('input.q[value="3"]')));
  // 2 × 118 (incl. 18%) = 236; 3 × 100 + 5% = 315  →  551
  check('the total is 551', await visible(page.locator('.pos-total .amt', { hasText: '551.00' })));

  // F9: a 10% bill discount
  await page.keyboard.press('F9');
  await page.getByRole('dialog').locator('input').fill('10%');
  await page.getByRole('button', { name: 'OK' }).click();
  check('F9 gives a bill discount and the total falls', await visible(page.locator('.pos-total .amt', { hasText: '496.00' })) || await visible(page.locator('.pos-total .amt', { hasText: '495.90' })));
  await page.keyboard.press('Control+f');
  check('Ctrl+F shows the full breakup', await visible(page.getByRole('dialog', { name: 'Full breakup' }).getByText('Taxable value')));
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Full breakup' }).waitFor({ state: 'detached' }).catch(() => {});
  await shot(page, 'p12-1-bill');

  // a second bill in its own tab
  await page.keyboard.press('Alt+n');
  check('Alt+N opens a second bill tab', (await page.locator('.pos-tab').count()) === 2);
  await page.getByLabel('Scan or search an item').fill('lux');
  check('searching by name lists the item with stock', await visible(page.locator('.pos-result', { hasText: 'Lux Soap' }).getByText(/in stock/)));
  await page.getByLabel('Scan or search an item').press('Escape');
  await page.keyboard.press('Control+1');
  check('Ctrl+1 returns to the first bill', await visible(page.locator('.pos-tab[aria-selected="true"]', { hasText: '2 items' })));

  // cash with change
  await page.getByLabel('Amount Received').fill('500');
  check('Change to Return is shown', await visible(page.locator('.pos-change', { hasText: /4\.00|4\.10/ })));
  await page.getByLabel('Scan or search an item').click();
  await page.keyboard.press('Control+Enter');
  check('Ctrl+Enter saves the bill', await visible(page.getByText(/Saved \S+/)));
  await shot(page, 'p12-2-saved');

  // what the books hold
  const bills = (await api('GET', '/v1/invoices?limit=5')).body.data;
  const inv = (await api('GET', `/v1/invoices/${bills[0].id}`)).body;
  check('the invoice is paid, taxed and has its cash payment', inv.status === 'paid' && inv.totalTax > 0 && inv.payments.length === 1 && inv.payments[0].mode === 'cash', JSON.stringify(inv.payments));
  const stock = (await api('GET', `/v1/items/${soap.id}`)).body.stock;
  check('stock went down by the quantity sold', stock === 18, String(stock));

  // settings drawer
  await page.getByRole('button', { name: 'POS settings' }).click();
  const drawer = page.getByRole('dialog', { name: 'POS settings' });
  await drawer.getByLabel('Enable Loyalty Points').check();
  // The app's floating "Finish setup" button sits over the drawer's Save in a new account: click it directly.
  await drawer.getByRole('button', { name: 'Save' }).evaluate((el) => el.click());
  check('POS settings save', await visible(page.getByText('POS settings saved')));
  const s = (await api('GET', `/v1/pos/settings?businessId=${biz}`)).body;
  check('loyalty is on in the saved settings', s.loyalty.enabled === true);
  await page.keyboard.press('F1');
  check('F1 lists the shortcuts', await visible(page.getByRole('dialog', { name: 'POS keyboard shortcuts' })));

  const v = (await api('GET', `/v1/verify?businessId=${biz}`)).body;
  const tb = (await api('GET', `/v1/ledger/trial-balance?businessId=${biz}`)).body;
  check('Verify My Data: no unbalanced voucher', v.checks.find((c) => c.id === 'ledger_unbalanced').count === 0);
  check('trial balance Dr = Cr', tb.balanced, `${tb.debit} vs ${tb.credit}`);
  check('no script errors in the page', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
} catch (e) {
  check('the run finished', false, e.message.slice(0, 400));
  await shot(page, 'zz-failure');
}

await browser.close();
console.log(results.every(Boolean) ? '\nALL PASSED' : '\nSOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
