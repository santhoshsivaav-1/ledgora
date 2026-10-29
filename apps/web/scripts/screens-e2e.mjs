// Opens every screen of the app on a desktop and on a 360 px phone and checks that it draws: no script error, the app
// shell is there, and nothing is wider than the screen (changes 3.24). Same setup as auth-e2e.mjs (read its header).
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { firefox } = require('playwright');
const OUT = process.argv[2] || '';
const APP = process.env.E2E_APP_URL || 'http://localhost:5173';
const API = process.env.E2E_API_URL || 'http://localhost:4000';
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };

const ROUTES = ['/', '/invoices', '/invoices/new', '/clients', '/products', '/expenses', '/purchases', '/recurring', '/receipts', '/reports', '/gst-returns', '/gst-returns/gstr3b', '/gst-returns/tds', '/income-tax',
  '/settings/business', '/settings/documents', '/settings/features', '/settings/data', '/settings/team', '/settings/security', '/accept-invite/none'];

async function waitForMail(match) {
  for (let i = 0; i < 50; i++) {
    const found = (await (await fetch(`${API}/v1/dev/outbox`)).json()).data.find(match);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the e-mail never arrived');
}

const browser = await firefox.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
const email = `screens${Date.now()}@example.com`;
await page.goto(APP);
await page.getByRole('tab', { name: 'Create account' }).click();
await page.getByLabel('Your name').fill('Screen Tester');
await page.getByLabel('E-mail').fill(email);
await page.getByLabel(/Password/).fill('correct-horse-9');
await page.getByRole('button', { name: 'Create account' }).click();
await page.getByRole('heading', { name: 'Check your e-mail' }).waitFor();
await page.goto(/https?:\/\/\S+/.exec((await waitForMail((m) => m.to === email && /Confirm/.test(m.subject))).text)[0]);
await page.getByLabel('Business name').fill('Screens Shop');
await page.getByLabel('State').selectOption('Tamil Nadu');
await page.getByRole('button', { name: 'Save and continue' }).click();
await page.locator('.account-bar').waitFor({ timeout: 15000 });
// The first-run wizard appears once this business's print settings have loaded; skip it.
await page.getByRole('button', { name: /skip setup/i }).first().click({ timeout: 8000 }).catch(() => {});

for (const [label, size] of [['desktop 1280', { width: 1280, height: 800 }], ['phone 360', { width: 360, height: 740 }]]) {
  await page.setViewportSize(size);
  for (const route of ROUTES) {
    errors.length = 0;
    await page.goto(`${APP}${route}`);
    await page.locator('.account-bar, .sidebar, .main-content').first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(700);
    const wide = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
    const text = (await page.locator('body').innerText()).trim();
    const crashed = /Something went wrong|Cannot read properties|is not defined/.test(text);
    const name = `${label}: ${route}`;
    check(`${name} draws with no script error`, text.length > 40 && !crashed && errors.length === 0, `${errors[0] ?? ''} ${crashed ? 'error text on screen' : ''} len=${text.length}`);
    if (size.width === 360) check(`${name} fits a 360 px screen (no sideways scrolling)`, wide <= 1, `${wide}px too wide`);
    if (OUT && route === '/' ) await page.screenshot({ path: `${OUT}/screen-${size.width}.png` });
  }
}

await browser.close();
console.log(results.every(Boolean) ? '\nALL PASSED' : `\n${results.filter((r) => !r).length} FAILED`);
process.exit(results.every(Boolean) ? 0 : 1);
