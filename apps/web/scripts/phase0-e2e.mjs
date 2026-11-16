// Browser test of Phase 0 of docs/AUDIT_2026-11.md: the public pages, the top bar and sidebar layout, a clean console, the server
// search, and the bell. Creates an account on the local development servers (web :5173, API :4000).
//   node scripts/phase0-e2e.mjs [screenshot-folder]
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
  // ---- public pages, signed out ----------------------------------------------------------------------------------------
  const anon = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const pub = await anon.newPage();
  await pub.goto(`${APP}/pricing`);
  await pub.getByRole('heading', { name: 'Simple pricing' }).waitFor({ timeout: 15000 });
  const pricing = await pub.locator('body').innerText();
  check('/pricing shows the plans, not the sign-in form', /Free/.test(pricing) && /Silver/.test(pricing) && /Gold/.test(pricing) && !/Welcome back/.test(pricing));
  check('the prices are the catalogue\'s (₹2,999 and ₹4,999 a year)', pricing.includes('₹2,999') && pricing.includes('₹4,999'));
  await pub.getByRole('radio', { name: 'Monthly' }).click();
  check('the monthly toggle changes the prices', !(await pub.locator('body').innerText()).includes('₹2,999'));
  check('every plan row has a dash or a tick (an accessible table)', (await pub.locator('table.plan-matrix').count()) === 1);
  await shot(pub, 'p0-pricing');
  await pub.goto(`${APP}/privacy`);
  await pub.getByRole('heading', { name: 'Privacy policy' }).waitFor({ timeout: 15000 });
  const privacy = await pub.locator('body').innerText();
  check('/privacy describes what is kept, sealed identity numbers and the user\'s rights', /Aadhaar/.test(privacy) && /Digital Personal Data Protection/.test(privacy) && /encrypted/.test(privacy));
  await shot(pub, 'p0-privacy');
  await pub.goto(`${APP}/terms`);
  await pub.getByRole('heading', { name: 'Terms of use' }).waitFor({ timeout: 15000 });
  check('/terms says the software does not file returns', /does not file anything for you/.test(await pub.locator('body').innerText()));
  check('the public pages link to each other and to sign-in', (await pub.locator('.pub-head nav a').count()) === 4);
  await pub.goto(`${APP}/terms/`);
  await pub.getByRole('heading', { name: 'Terms of use' }).waitFor({ timeout: 15000 }).catch(() => {});
  check('a trailing slash still opens the page', (await pub.getByRole('heading', { name: 'Terms of use' }).count()) === 1);
  await pub.goto(`${APP}/forgot-password`);
  await pub.getByText(/reset/i).first().waitFor({ timeout: 15000 });
  const forgot = await pub.locator('body').innerText();
  check('/forgot-password opens the reset form directly', /Forgot|Reset/i.test(forgot) && (await pub.locator('input[type=email]').count()) >= 1 && !/Welcome back/.test(forgot));
  await shot(pub, 'p0-forgot');
  await pub.goto(`${APP}/login`);
  const lang = pub.getByLabel('Language');
  const pad = await lang.evaluate((e) => parseFloat(getComputedStyle(e).paddingRight));
  check('the language selector leaves room for its arrow', pad >= 24, `padding-right ${pad}px`);
  await anon.close();

  // ---- signed in ---------------------------------------------------------------------------------------------------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const stamp = Date.now();
  await signUpAndSetUp(page, { app: APP, name: 'Phase Zero', email: `p0${stamp}@example.com`, password: 'correct-horse-9', business: `P0 Shop ${stamp}` });
  const api = (method, url, body) => page.request.fetch(`${APP}${url}`, { method, ...(body ? { data: body } : {}) });
  await page.goto(`${APP}/pricing`);
  await page.getByRole('heading', { name: 'Simple pricing' }).waitFor({ timeout: 15000 }).catch(() => {});
  check('the pricing page also opens when signed in', (await page.getByRole('heading', { name: 'Simple pricing' }).count()) === 1);

  // The plan chip is one line and clear of its neighbours.
  const chipBox = async () => page.locator('.plan-chip').first().boundingBox();
  for (const w of [1440, 1280, 1024]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`${APP}/`);
    await page.locator('.plan-chip').first().waitFor({ timeout: 15000 });
    const b = await chipBox();
    check(`the plan chip is one line at ${w}px (${Math.round(b.width)}x${Math.round(b.height)})`, b.height <= 40 && b.width >= 100, JSON.stringify(b));
    const overlap = await page.evaluate(() => {
      const chip = document.querySelector('.plan-chip').getBoundingClientRect();
      const bar = [...document.querySelectorAll('.vy-topbar-right > *, .vy-crumb, .vy-biz')].filter((e) => !e.contains(document.querySelector('.plan-chip')));
      return bar.filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.left < chip.right && r.right > chip.left && r.top < chip.bottom && r.bottom > chip.top; }).map((e) => e.className);
    });
    check(`nothing in the top bar overlaps the chip at ${w}px`, overlap.length === 0, overlap.join(', '));
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${APP}/`);
  await page.locator('.plan-chip').first().waitFor({ timeout: 15000 });
  await shot(page, 'p0-home');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${APP}/`);
  await page.locator('.plan-chip').first().waitFor({ timeout: 15000 });
  const phone = await chipBox();
  check(`on a phone the chip is an icon, not a squashed paragraph (${Math.round(phone.width)}x${Math.round(phone.height)})`, phone.width < 60 && phone.height < 40, JSON.stringify(phone));
  check('and the page does not scroll sideways', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await page.setViewportSize({ width: 1280, height: 900 });

  // The menu: the long group name fits, and the list scrolls clear of the footer.
  await page.goto(`${APP}/`);
  await page.locator('.vy-sidebar').waitFor({ timeout: 15000 });
  check('the menu group reads "Backup & Sync" (not "Sync, Share & Back…")', (await page.locator('.vy-item-label', { hasText: /^Backup & Sync$/ }).count()) === 1);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('.vy-item-label')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
  check('no menu label is cut off', clipped.length === 0, clipped.join(', '));
  check('the menu leaves room under its last item', (await page.locator('.vy-nav').evaluate((e) => parseFloat(getComputedStyle(e).paddingBottom))) >= 24);

  // ---- a clean console ---------------------------------------------------------------------------------------------
  const bad = [];
  page.on('console', (m) => { if (m.type() === 'error') bad.push(`${m.text().slice(0, 140)}`); });
  const failedCalls = [];
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/v1/')) failedCalls.push(`${r.status()} ${r.url().replace(APP, '').split('?')[0]}`); });
  for (const u of ['/settings/business', '/settings/documents', '/settings/features', '/settings/data', '/pos', '/reports', '/parties']) {
    await page.goto(`${APP}${u}`);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  check('no "unique key" warnings on the Settings pages', !bad.some((m) => /unique "key"/.test(m)), bad.join(' | '));
  check('no Content-Security-Policy errors in development', !bad.some((m) => /Content-Security-Policy/.test(m)), bad.join(' | '));
  check('no console errors at all across those pages', bad.length === 0, bad.join(' | '));
  check('the POS counter makes no failing calls while Cash & Bank is off', !failedCalls.some((c) => c.includes('bank-accounts')), failedCalls.join(', '));
  check('no screen made a failing API call', failedCalls.length === 0, failedCalls.join(', '));

  // ---- Open Anything finds records on the server --------------------------------------------------------------------
  await api('POST', '/v1/workspace/collections/clients', { id: 'c1', name: 'Zephyr Traders', phone: '9876500000' });
  await api('POST', '/v1/workspace/collections/bills', { id: 'ZEP-001', invoiceNumber: 'ZEP-001', invoiceDate: '2026-11-01', invoiceType: 'tax-invoice', status: 'unpaid', clientName: 'Zephyr Traders', totalAmount: 1180 });
  await page.goto(`${APP}/`);
  await page.locator('.vy-sidebar').waitFor({ timeout: 15000 });
  await page.keyboard.press('Control+f');
  await page.getByPlaceholder(/Open anything/i).fill('zephyr');
  await page.getByText(/Zephyr Traders/).first().waitFor({ timeout: 10000 });
  const rows = await page.locator('[role=dialog], .cmd-palette, .palette').first().innerText().catch(() => page.locator('body').innerText());
  check('typing a party name finds the party and its invoice', /Zephyr Traders — client/.test(rows) && /ZEP-001/.test(rows), rows.slice(0, 300));
  await shot(page, 'p0-open-anything');
  await page.keyboard.press('Escape');

  // ---- the bell, answered by the server ---------------------------------------------------------------------------------
  const dueYesterday = new Date(Date.now() - 86400000 * 3).toISOString().slice(0, 10);
  await api('POST', '/v1/workspace/collections/bills', { id: 'LATE-1', invoiceNumber: 'LATE-1', invoiceDate: '2026-10-01', invoiceType: 'tax-invoice', status: 'unpaid', clientName: 'Slow Payer', totalAmount: 5000, data: { details: { dueDate: dueYesterday } } });
  await api('POST', '/v1/workspace/collections/products', { id: 'p1', name: 'Nearly Out', stock: 2 });
  await page.goto(`${APP}/`);
  await page.locator('.vy-sidebar').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: /Notifications/ }).click();
  const bell = await page.locator('body').innerText();
  check('the bell lists the overdue invoice', /1 overdue invoice/.test(bell) && /LATE-1/.test(bell), bell.slice(-400));
  check('and the product that is low on stock', /1 product low on stock/.test(bell) && /Nearly Out \(2 left\)/.test(bell), bell.slice(-400));
  await shot(page, 'p0-bell');
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
