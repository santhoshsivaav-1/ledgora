// Browser test that the billing screens run on the account API's workspace (change 3.23): an invoice made in the real
// editor is stored in Postgres for the signed-in organization, survives a reload and a sign-out, and another
// organization cannot see it. Same setup as auth-e2e.mjs (read its header). It creates throwaway accounts.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { firefox } = require('playwright');
const OUT = process.argv[2] || '';
const APP = process.env.E2E_APP_URL || 'http://localhost:5173';
const API = process.env.E2E_API_URL || 'http://localhost:4000';
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };
const shot = (page, n) => (OUT ? page.screenshot({ path: `${OUT}/${n}.png` }) : Promise.resolve());
const password = 'correct-horse-9';
const outbox = async () => (await (await fetch(`${API}/v1/dev/outbox`)).json()).data;
// Mail is handed over in the background, so give it a moment to arrive.
async function waitForMail(match) {
  for (let i = 0; i < 50; i++) {
    const found = (await outbox()).find(match);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the e-mail never arrived');
}

async function account(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`pageerror (${label}):`, e.message.slice(0, 200)));
  const email = `bill${label}${Date.now()}@example.com`.toLowerCase(); // e-mail addresses are stored in lower case
  await page.goto(APP);
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByLabel('Your name').fill(`Person ${label}`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel(/Password/).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('heading', { name: 'Check your e-mail' }).waitFor();
  const mail = await waitForMail((m) => m.to === email && /Confirm/.test(m.subject));
  await page.goto(/https?:\/\/\S+/.exec(mail.text)[0]);
  await page.getByLabel('Business name').fill(`Shop ${label}`);
  await page.getByLabel('State').selectOption('Tamil Nadu');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.locator('.account-bar').waitFor({ timeout: 15000 });
  // The first-run wizard appears once this business's print settings have loaded; skip it.
await page.getByRole('button', { name: /skip setup/i }).first().click({ timeout: 8000 }).catch(() => {});
  return { ctx, page, email };
}
const bills = async (ctx) => (await ctx.request.get(`${APP}/v1/workspace/collections/bills`)).json();

const browser = await firefox.launch({ headless: true });
const a = await account(browser, 'A');
const page = a.page;

// ---- an invoice made in the real editor ----
await page.goto(`${APP}/invoices/new`);
await page.getByPlaceholder('Type client name to search or add new').fill('Acme Traders');
await page.getByPlaceholder('Item', { exact: true }).fill('Notebook A4');
const nums = page.locator('input[type=number]');
await nums.nth(0).fill('2');
await nums.nth(1).fill('100');
await page.waitForTimeout(500);
await shot(page, 'billing-editor');
const saving = page.waitForResponse((r) => r.url().includes('/v1/workspace/collections/bills') && r.request().method() === 'POST', { timeout: 15000 });
await page.getByRole('button', { name: 'Save', exact: true }).click();
await saving.catch(async (e) => { await shot(page, 'billing-save-failed'); throw e; });
const saved = await bills(a.ctx);
check('saving in the editor stores one bill for this organization', saved.length === 1, JSON.stringify(saved).slice(0, 200));
const bill = saved[0];
check('it carries the number, client and amount the screen computed', /^INV\//.test(bill.invoiceNumber) && bill.clientName === 'Acme Traders' && bill.totalAmount > 0, JSON.stringify({ n: bill.invoiceNumber, c: bill.clientName, t: bill.totalAmount }));
const counter = await (await a.ctx.request.get(`${APP}/v1/workspace/meta/counter_INV`)).json();
check('the number came from the organization counter in the database', counter.value === 1, JSON.stringify(counter));

// ---- print settings are saved per business on the server (change 3.11) ----
await page.waitForTimeout(1500); // the layout choice is sent a moment after it is made
const exported = await (await a.ctx.request.get(`${APP}/v1/workspace/export`)).json();
const printKey = Object.keys(exported.meta).find((k) => k.startsWith('printSettings:'));
check('the first-run print choices were saved for this business on the server', !!printKey && exported.meta[printKey].onboardingComplete === true, JSON.stringify(Object.keys(exported.meta)));

// ---- it shows on the dashboard, and survives reload and sign-out ----
await page.goto(APP);
await page.getByText(bill.invoiceNumber).first().waitFor({ timeout: 15000 });
check('the dashboard lists the invoice', true);
await shot(page, 'billing-dashboard');
await page.reload();
await page.getByText(bill.invoiceNumber).first().waitFor({ timeout: 15000 });
check('a reload still lists it (nothing lives only in the browser)', true);
await page.locator('.account-bar-logout').click();
await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
await page.getByLabel('E-mail').fill(a.email);
await page.getByLabel('Password').fill(password);
await page.getByRole('button', { name: 'Sign in', exact: true }).click();
await page.getByText(bill.invoiceNumber).first().waitFor({ timeout: 15000 });
check('after signing out and in again the invoice is still there', true);

// ---- delete goes to the 30-day trash and can be restored (the same calls the screens make) ----
const del = await page.evaluate(async (id) => (await fetch(`/v1/workspace/collections/bills/${encodeURIComponent(id)}`, { method: 'DELETE' })).json(), bill.id);
check('deleting a bill moves it to the trash', del.trashed === true && (await bills(a.ctx)).length === 0);
await page.goto(`${APP}/settings/data`);
await page.getByText('Deleted invoices (1)').waitFor({ timeout: 15000 });
await shot(page, 'billing-trash');
await page.getByRole('button', { name: 'Restore', exact: true }).first().click();
await page.getByText('Deleted invoices (0)').waitFor({ timeout: 15000 });
check('Settings shows it in the trash and Restore brings it back', (await bills(a.ctx)).length === 1);

// ---- another organization sees none of it ----
const b = await account(browser, 'B');
check("another organization's invoice list is empty", (await bills(b.ctx)).length === 0);
await b.page.goto(APP);
await b.page.waitForTimeout(1500);
check("and its dashboard does not show the first organization's invoice", !(await b.page.locator('body').innerText()).includes(bill.invoiceNumber));
const peek = await b.ctx.request.get(`${APP}/v1/workspace/collections/bills`, { headers: { 'x-org-id': '00000000-0000-4000-8000-000000000001' } });
check("naming someone else's organization is refused", peek.status() === 403);

// ---- permissions through the screens' own data layer ----
const forbidden = await page.evaluate(async () => (await fetch('/v1/workspace/export')).status);
check('the owner can export', forbidden === 200);

await browser.close();
console.log(results.every(Boolean) ? '\nALL PASSED' : '\nSOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
