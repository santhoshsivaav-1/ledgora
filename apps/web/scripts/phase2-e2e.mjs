// Browser test of Phase 2 of docs/AUDIT_2026-11.md as far as it needs no provider credentials: the TDS Deducted page (the
// quarter register, marking a deduction deposited, the CSV, and the "what to deduct" helper). Uses the local development servers.
//   node scripts/phase2-e2e.mjs [screenshot-folder]
import { createRequire } from 'node:module';
import { signUpAndSetUp } from './e2eSignup.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { firefox } = require('playwright');
const OUT = process.argv[2] || '';
const APP = process.env.E2E_APP_URL || 'http://localhost:5173';
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };
const shot = (page, n) => (OUT ? page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }) : Promise.resolve());

const browser = await firefox.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })).newPage();
  const stamp = Date.now();
  await signUpAndSetUp(page, { app: APP, name: 'Tds Person', email: `tds${stamp}@example.com`, password: 'correct-horse-9', business: `Tds ${stamp}` });
  const api = (m, u, b) => page.request.fetch(APP + u, { method: m, ...(b ? { data: b } : {}) });
  const biz = (await (await api('GET', '/v1/businesses')).json()).data[0];
  const mk = async (name, extra = {}) => (await (await api('POST', '/v1/parties', { businessId: biz.id, name, kind: 'supplier', ...extra })).json()).id;
  const a = await mk('Landlord Ltd');
  const b = await mk('Contractor Co', { gstin: '29ABCPK1234F1Z5' });
  const year = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const d = `${year}-05-10`;
  for (const [p, amt, tds] of [[a, 4950, 50], [b, 9900, 100]]) {
    const r = await api('POST', '/v1/payments', { businessId: biz.id, partyId: p, direction: 'out', amount: amt, tdsAmount: tds, tdsSection: '194C', paymentDate: d, mode: 'bank' });
    if (r.status() >= 300) console.log('payment failed', r.status(), await r.text());
  }

  await page.goto(`${APP}/tds-deducted`);
  await page.getByRole('heading', { level: 1, name: 'TDS Deducted' }).waitFor({ timeout: 15000 });
  check('the menu has a TDS Deducted entry under Taxes, open on this page', await page.locator('.vy-sidebar').getByText('TDS Deducted', { exact: true }).isVisible());
  await page.getByRole('button', { name: 'Q1', exact: true }).click();
  await page.getByText('Contractor Co').first().waitFor({ timeout: 15000 });
  const body = await page.locator('body').innerText();
  check('the quarter register lists both deductions', /Landlord Ltd/.test(body) && /Contractor Co/.test(body));
  check('the totals say ₹150.00 deducted and all of it undeposited', /₹150\.00/.test(body));
  check('a missing PAN is flagged and listed under things to fix', /missing/.test(body) && /without a valid PAN/.test(body));
  check('it says plainly that this is not the FVU file', /not the department's FVU file/.test(body));
  check('the page does not scroll sideways', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await shot(page, 'p2-tds-register');

  // mark one deposited
  await page.getByRole('row', { name: /Contractor Co/ }).getByRole('button', { name: 'Mark deposited' }).click();
  await page.getByLabel('Challan number').fill('00123');
  await page.getByLabel('BSR code').fill('0510308');
  await page.getByLabel('Deposited on').fill(`${year}-06-05`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('00123').first().waitFor({ timeout: 15000 });
  const after = await page.locator('body').innerText();
  check('the deposit shows in the challan table and the row', /0510308/.test(after) && /Deposited/.test(after));
  const dl = page.waitForEvent('download', { timeout: 10000 });
  await page.getByRole('button', { name: /Download CSV/ }).click();
  const file = await dl;
  check('the CSV downloads with a sensible name', /^tds-\d{4}-Q1\.csv$/.test(file.suggestedFilename()), file.suggestedFilename());

  // the helper
  await page.getByRole('tab', { name: 'What to deduct' }).click();
  await page.getByLabel('Paying (₹)').fill('50000');
  await page.getByRole('button', { name: 'Work it out' }).click();
  await page.getByRole('status').getByText(/Deduct/).waitFor({ timeout: 10000 });
  check('the helper works out TDS at 20% when there is no PAN', /Deduct ₹10,000\.00/.test(await page.locator('body').innerText()));
  await shot(page, 'p2-tds-calc');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Quarter register' }).click();
  await page.getByText('Contractor Co').first().waitFor({ timeout: 15000 });
  check('and on a phone the page does not scroll sideways', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
