// Browser test of Phase 7 (Utilities), in Firefox: the Enable accounting prompt, barcode labels, Export to Tally,
// backup, Close Financial Year (the wizard), the setup checklist, the Trash and the Share-with-CA invitation form. Same setup as ledger-e2e.mjs: the web app on E2E_APP_URL and the API on E2E_API_URL (one origin when the
// API serves the built app); it creates a throwaway account. Screenshots go to the folder given as the first argument.
import { createRequire } from 'node:module';
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
  const email = `ut${Date.now()}@example.com`;
  await page.goto(APP);
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByLabel('Your name').fill('Owner');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel(/Password/).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  const verify = page.getByRole('heading', { name: 'Check your e-mail' });
  await Promise.race([verify.waitFor(), page.getByLabel('Business name').waitFor()]);
  if (await verify.isVisible()) { const mail = await waitForMail((m) => m.to === email && /Confirm/.test(m.subject)); await page.goto(/https?:\/\/\S+/.exec(mail.text)[0]); }
  await page.getByLabel('Business name').fill('Utility Traders');
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

  // ---- the ledger is off: Tally and Close FY say so, with the way to turn it on ----
  await page.goto(`${APP}/utilities/tally`);
  check('Export to Tally with accounting off shows Enable accounting', await visible(page.getByRole('link', { name: 'Enable accounting' })));
  await page.goto(`${APP}/utilities/close-fy`);
  check('Close FY with accounting off shows Enable accounting', await visible(page.getByRole('link', { name: 'Enable accounting' })) || await visible(page.getByText(/needs accounting/)));
  await shot(page, 'p7-1-enable-accounting');

  // data: items, a customer, a year of trading
  await api('POST', '/v1/items', { name: 'Lux Soap', sku: 'LUX1', salePrice: 118, taxPercent: 18, openingStock: 20 });
  await api('POST', '/v1/items', { name: 'Basmati Rice', sku: 'RICE', unit: 'KG', salePrice: 100, taxPercent: 5, openingStock: 50 });
  const cust = (await api('POST', '/v1/parties', { name: 'Asha Kumar', state: 'Tamil Nadu', phone: '9876543210' })).body.id;
  check('the ledger turns on', (await api('POST', '/v1/accounting/backfill', { businessId: biz, dryRun: false })).body?.enabled === true);
  await api('POST', '/v1/invoices', { businessId: biz, partyId: cust, invoiceDate: '2025-08-10', items: [{ name: 'Lux Soap', quantity: 10, rate: 1000, taxPercent: 18 }] });
  await api('POST', '/v1/invoices', { businessId: biz, partyId: cust, invoiceDate: '2025-12-01', items: [{ name: 'Basmati Rice', quantity: 4, rate: 500, taxPercent: 5 }] });
  await api('POST', '/v1/payments', { businessId: biz, partyId: cust, amount: 500, direction: 'in', mode: 'upi', paymentDate: '2025-09-01' });
  await api('POST', '/v1/purchases', { businessId: biz, purchaseDate: '2025-09-02', invoiceNumber: 'B-1', supplierName: 'Wholesale Mart', items: [{ name: 'Pen', quantity: 100, rate: 10, taxPercent: 18 }] });

  // ---- P7-S1 barcode ----
  await page.goto(`${APP}/utilities/barcode`);
  await page.getByRole('checkbox', { name: 'Select all shown' }).check();
  check('selecting items shows a label preview', await visible(page.locator('[data-testid="label-preview"] svg')));
  check('the preview says how many labels and pages', await visible(page.getByText(/2 labels on 1 page/)));
  await page.getByLabel('Copies per item').fill('40');
  await page.getByLabel('Start at label').fill('60');
  check('copies and start-at change the page count', await visible(page.getByText(/80 labels on 3 pages/)));
  await page.getByRole('button', { name: 'Generate missing codes' }).click();
  check('Generate missing codes saves an in-store EAN-13 per item', await visible(page.getByText(/2 items got a barcode/)));
  const items = (await api('GET', '/v1/items?limit=20')).body.data;
  check('both items have a valid 13-digit 200… code, all different', items.every((i) => /^200\d{10}$/.test(i.extra.barcode)) && new Set(items.map((i) => i.extra.barcode)).size === 2);
  await page.getByRole('radio', { name: 'QR' }).check();
  check('QR labels draw a QR code once the item has a code', await visible(page.locator('[data-testid="label-preview"] svg rect')));
  await page.getByRole('button', { name: 'Save these settings' }).click();
  check('label settings save for the business', await visible(page.getByText('Label settings saved for this business')));
  await page.reload();
  check('the saved barcode type comes back', await page.getByRole('radio', { name: 'QR' }).isChecked());
  await page.getByRole('radio', { name: 'EAN-13' }).check();
  await shot(page, 'p7-2-barcode');

  // ---- P7-S2 Tally ----
  await page.goto(`${APP}/utilities/tally`);
  await page.getByLabel('From', { exact: true }).fill('2025-04-01');
  await page.getByLabel('To', { exact: true }).fill('2026-03-31');
  await page.getByRole('button', { name: 'Preview counts' }).click();
  check('the preview counts the vouchers', await visible(page.locator('[data-testid="tally-preview"]').getByText(/3/)) && await visible(page.getByText(/2 Sales · 1 Purchase|1 Purchase · 2 Sales/)));
  await page.getByLabel('Receipts (money in)').check();
  await page.getByLabel('Expenses and other income').check();
  await page.getByRole('button', { name: 'Preview counts' }).click();
  check('the optional extras are counted when ticked', await visible(page.getByText(/1 Receipt/)));
  await page.getByLabel('Receipts (money in)').uncheck();
  await page.getByLabel('Expenses and other income').uncheck();
  await page.getByRole('button', { name: 'Preview counts' }).click();
  const dlMaster = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
  await page.getByRole('button', { name: 'Download Master.xml' }).click();
  const fm = await dlMaster;
  check('Master.xml downloads', !!fm && fm.suggestedFilename() === 'Master.xml');
  const dlV = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
  await page.getByRole('button', { name: 'Download Voucher.xml' }).click();
  const fv = await dlV;
  check('Voucher.xml downloads', !!fv && fv.suggestedFilename() === 'Voucher.xml');
  if (fv) { const p = join(tmpdir(), `v-${Date.now()}.xml`); await fv.saveAs(p); const { readFileSync } = await import('node:fs'); const xml = readFileSync(p, 'utf8'); check('the voucher XML has 3 vouchers', (xml.match(/<VOUCHER /g) ?? []).length === 3); }
  await shot(page, 'p7-3-tally');

  // ---- P7-S4 backup ----
  await page.goto(`${APP}/utilities/backup`);
  check('with no backup yet the reminder shows', await visible(page.getByText(/You have not backed up yet/)));
  check('Google Drive says it is not set up on this server', await visible(page.getByText(/Not set up on this server/)));
  await page.getByRole('button', { name: 'Back up now' }).first().click();
  check('Back up now adds a history row', await visible(page.getByRole('row', { name: /Manual/ })));
  const dlB = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
  await page.getByRole('button', { name: 'Download' }).first().click();
  const fb = await dlB;
  check('the .ledgora file downloads', !!fb && /\.ledgora$/.test(fb.suggestedFilename()));
  await page.getByLabel('How often').selectOption('daily');
  check('the schedule saves', await visible(page.getByText('Schedule saved')));
  await shot(page, 'p7-4-backup');
  // restore is refused with a clear message on an account that has data
  await page.getByRole('button', { name: 'Restore' }).first().click();
  check('restore previews the contents and says why it can not run here', await visible(page.getByText(/already has data/)));
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' }).catch(() => {});

  // ---- P7-S3 Close FY wizard ----
  await page.goto(`${APP}/utilities/close-fy`);
  await page.getByLabel('Financial year to close').selectOption({ value: await page.locator('option', { hasText: '2025-26' }).first().getAttribute('value') });
  check('step 1 shows the backup just taken', await visible(page.getByText(/Last backup:/)));
  await page.getByRole('button', { name: 'Next' }).click();
  check('step 2 offers the two methods', await visible(page.getByText('Start new year')) && await visible(page.getByText('Change prefix only')));
  await page.getByRole('button', { name: 'Next' }).click();
  check('step 3 explains the lock', await visible(page.getByText(/locked/)));
  await page.getByRole('button', { name: 'Next' }).click();
  const closeBtn = page.getByRole('button', { name: /Close FY 2025-26/ });
  check('Close is off until the year is typed', await closeBtn.isDisabled());
  await page.getByLabel(/Type 2025-26 to confirm/).fill('2025-26');
  await closeBtn.click();
  check('the result page shows the profit moved and what carries forward', await visible(page.locator('[data-testid="fy-result"]').getByText(/Retained Earnings/)) && await visible(page.getByText('Cash and bank')));
  await shot(page, 'p7-5-closed');
  const years = (await api('GET', `/v1/financial-years?businessId=${biz}`)).body.data;
  check('the year is closed', years.find((y) => y.label === '2025-26').status === 'closed');
  const tb = (await api('GET', `/v1/ledger/trial-balance?businessId=${biz}`)).body;
  check('trial balance Dr = Cr after closing', tb.balanced, `${tb.debit} vs ${tb.credit}`);

  // ---- P7-S5 / S6 ----
  await page.goto(`${APP}/utilities/setup`);
  check('the setup checklist lists eight rows with progress', await visible(page.getByRole('progressbar')) && (await page.locator('li', { hasText: /Add a bank account|Set up backup/ }).count()) === 2);
  await page.goto(`${APP}/utilities/trash`);
  check('the Trash opens with a type filter', await visible(page.getByLabel('Type')) && await visible(page.getByRole('button', { name: /Empty trash/ })));
  await page.goto(`${APP}/settings/team`);
  await page.getByLabel('Role', { exact: true }).selectOption({ label: 'CA (read-only)' });
  check('choosing the CA role shows the date range and link expiry', await visible(page.getByLabel('Can see from')) && await visible(page.getByLabel('Link works for (days)')));

  const v = (await api('GET', `/v1/verify?businessId=${biz}`)).body;
  check('Verify My Data: no unbalanced voucher', v.checks.find((c) => c.id === 'ledger_unbalanced').count === 0);
  check('no script errors in the page', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
} catch (e) {
  check('the run finished', false, e.message.slice(0, 400));
  await shot(page, 'zz-failure');
}

await browser.close();
console.log(results.every(Boolean) ? '\nALL PASSED' : '\nSOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
