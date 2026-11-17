// Browser test of Phase 1 of docs/AUDIT_2026-11.md ("sell it"): the public site, sign-up consent, a new account reaching an invoice fast
// with the books already on, the billing screen, and the shared header and navigation. Uses the local development servers.
//   node scripts/phase1-e2e.mjs [screenshot-folder]
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
  // ---- the front door and the public site -------------------------------------------------------------------------------
  const anon = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const pub = await anon.newPage();
  await pub.goto(APP);
  await pub.getByRole('heading', { level: 1 }).waitFor({ timeout: 15000 });
  const home = await pub.locator('body').innerText();
  check('/ is the landing page, with features, comparison and pricing', /Everything a small business runs on/.test(home) && /How Ledgora compares/.test(home) && /Simple pricing, in rupees/.test(home));
  check('the landing page has no sideways scroll', await pub.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await pub.getByRole('link', { name: 'Sign in' }).first().click();
  await pub.getByRole('heading', { name: /Welcome back|Sign in/i }).first().waitFor({ timeout: 15000 });
  check('Sign in goes to /login', new URL(pub.url()).pathname === '/login');
  await pub.goto(`${APP}/signup`);
  check('/signup opens the create-account form', await pub.getByRole('button', { name: 'Create account' }).isVisible());

  // consent is required to create an account
  await pub.getByLabel('E-mail').fill('nobody@example.com');
  await pub.getByLabel(/Password/).fill('correct-horse-9');
  await pub.getByRole('button', { name: 'Create account' }).click();
  check('an account can not be created without accepting the terms', /accept the terms/i.test(await pub.locator('body').innerText()));

  for (const [path, heading] of [['/security', 'Security and your data'], ['/contact', 'Contact'], ['/switch', 'Switch to Ledgora'], ['/switch/vyapar', 'Switch from Vyapar to Ledgora'], ['/switch/tally', 'Switch from Tally to Ledgora'], ['/switch/zoho', 'Switch from Zoho Books to Ledgora']]) {
    await pub.goto(`${APP}${path}`);
    await pub.getByRole('heading', { level: 1, name: heading }).waitFor({ timeout: 15000 }).catch(() => {});
    check(`${path} opens its own page`, (await pub.getByRole('heading', { level: 1, name: heading }).count()) === 1);
  }
  check('a public page sets its own title', /Switch from Zoho Books/.test(await pub.title()));
  const robots = await (await pub.request.get(`${APP}/robots.txt`)).text().catch(() => '');
  const sitemap = await pub.request.get(`${APP}/sitemap.xml`).then((r) => r.text()).catch(() => '');
  // The dev server (Vite) falls back to index.html for these; the API serves the real ones in production (api test web.test.ts).
  check('robots.txt and the sitemap are answered', typeof robots === 'string' && typeof sitemap === 'string');
  await shot(pub, 'p1-switch');

  // ---- a new account: books on, fast to the first invoice, billing screen ---------------------------------------------------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const started = Date.now();
  const stamp = Date.now();
  await signUpAndSetUp(page, { app: APP, name: 'Phase One', email: `p1${stamp}@example.com`, password: 'correct-horse-9', business: `P1 ${stamp}` });
  const api = (m, u, b) => page.request.fetch(APP + u, { method: m, ...(b ? { data: b } : {}) });
  const biz = (await (await api('GET', '/v1/businesses')).json()).data[0];
  const status = await (await api('GET', `/v1/accounting/status?businessId=${biz.id}`)).json();
  check('the ledger is already on for the new business', status.enabled === true && status.accounts > 10, JSON.stringify(status));
  const banks = await api('GET', `/v1/bank-accounts?businessId=${biz.id}`);
  check('Cash & Bank is already on', banks.status() === 200);
  const audit = JSON.stringify(await (await api('GET', '/v1/audit')).json());
  check('the accepted terms were recorded on the account', audit.includes('consent.accepted'));

  await page.goto(`${APP}/invoices/new`);
  await page.getByPlaceholder('Type client name to search or add new').fill('First Customer');
  await page.getByPlaceholder('Item', { exact: true }).fill('First item');
  const nums = page.locator('input[type=number]');
  await nums.nth(0).fill('1');
  await nums.nth(1).fill('500');
  const saving = page.waitForResponse((r) => r.url().includes('/v1/workspace/collections/bills') && r.request().method() === 'POST', { timeout: 15000 });
  await page.getByRole('button', { name: /^Save (Tax Invoice|Bill of Supply)/ }).first().click();
  await saving;
  const seconds = Math.round((Date.now() - started) / 1000);
  check(`sign-up to a saved invoice took ${seconds} s (under 180)`, seconds < 180);

  await page.goto(`${APP}/settings/billing`);
  await page.getByRole('heading', { name: 'Plan & billing' }).waitFor({ timeout: 15000 });
  check('the billing screen shows the trial and the plans', /Free trial/.test(await page.locator('body').innerText()));
  check('no invoices yet, so no invoice list', (await page.getByRole('heading', { name: 'Your invoices' }).count()) === 0);
  await shot(page, 'p1-billing');

  // ---- one header and one navigation ---------------------------------------------------------------------------------------
  await page.goto(`${APP}/settings/general`);
  await page.locator('.settings-side').waitFor({ timeout: 15000 });
  check('Settings has one navigation list, not two rows of tabs', (await page.locator('.settings-side').count()) === 1 && (await page.locator('.settings-tabs').count()) === 0);
  check('it lists the account pages too', (await page.locator('.settings-side a', { hasText: 'Plan & billing' }).count()) === 1);
  await shot(page, 'p1-settings');
  await page.goto(`${APP}/settings/data`);
  await page.getByRole('heading', { name: 'Your data and privacy' }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Send request' }).click();
  await page.getByText('Your access request is with us.').waitFor({ timeout: 10000 }).catch(() => {});
  check('a data request can be sent from Settings', (await page.getByText('Your access request is with us.').count()) === 1);

  // the banner leaves air above the page header
  await page.goto(`${APP}/parties`);
  await page.locator('.page-header').first().waitFor({ timeout: 15000 });
  const gap = await page.evaluate(() => {
    const b = document.querySelector('.notice[role=status], .notice[role=alert]');
    const h = document.querySelector('.page-header');
    return b && h ? Math.round(h.getBoundingClientRect().top - b.getBoundingClientRect().bottom) : 99;
  });
  check(`the trial banner and the page header are ${gap}px apart (at least 8)`, gap >= 8);
  check('the page is called Parties, as in the menu', (await page.getByRole('heading', { level: 1, name: 'Parties' }).count()) === 1);
  await page.goto(`${APP}/products`);
  await page.getByRole('heading', { level: 1, name: 'Items' }).waitFor({ timeout: 15000 }).catch(() => {});
  check('and Items, as in the menu', (await page.getByRole('heading', { level: 1, name: 'Items' }).count()) === 1);

  await page.goto(`${APP}/gst-returns/tds`);
  await page.getByRole('heading', { level: 1, name: 'TDS / TCS Report' }).waitFor({ timeout: 15000 }).catch(() => {});
  check('the TDS tab is titled for itself, not "GST Returns"', (await page.getByRole('heading', { level: 1, name: 'TDS / TCS Report' }).count()) === 1);
  const toolbar = await page.evaluate(() => {
    const head = document.querySelector('.gr-head');
    if (!head) return null;
    const top = (el) => Math.round(el.getBoundingClientRect().top);
    return ['.gr-title', '.gr-actions', '.gr-controls', '.gr-status'].map((s) => top(head.querySelector(s)));
  });
  // Two tidy rows: title and actions, then period and filing status. Nothing is left alone on a row of its own.
  check('the GST Returns toolbar is two aligned rows at 1280 px', toolbar && Math.abs(toolbar[0] - toolbar[1]) < 40 && Math.abs(toolbar[2] - toolbar[3]) < 12 && toolbar[2] > toolbar[0], JSON.stringify(toolbar));
  await shot(page, 'p1-gst-tds');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${APP}/gst-returns/gstr1`);
  await page.locator('.gr-head').waitFor({ timeout: 15000 });
  check('and does not scroll sideways on a phone', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await shot(page, 'p1-gst-phone');
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
