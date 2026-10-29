// Browser test of sign-in, sign-up, e-mail confirmation, onboarding, Log out and phone sign-in in the real app.
//
// It needs the whole stack running (docker or Homebrew Postgres, `pnpm dev`) and Firefox from Playwright
// (`pnpm --filter @ledgora/legacy-server exec playwright install firefox`). It creates throwaway accounts and
// WRITES THE BUSINESS PROFILE to the legacy server it talks to, so point it at a scratch copy, not your real data:
//
//   DATA_DIR=/tmp/ledgora-e2e PORT=47372 node apps/legacy-server/server.js
//   API_PORT=47372 pnpm --filter @ledgora/web exec vite --port 5173
//   E2E_LEGACY_URL=http://localhost:47372 node apps/web/scripts/auth-e2e.mjs [screenshot-folder]
import { createRequire } from 'node:module';
// Playwright lives with the legacy smoke test; reuse it.
const require = createRequire(new URL('../../legacy-server/package.json', import.meta.url));
const { firefox } = require('playwright');
const OUT = process.argv[2] || '';
const APP = process.env.E2E_APP_URL || 'http://localhost:5173';
const API = process.env.E2E_API_URL || 'http://localhost:4000';
const LEGACY = process.env.E2E_LEGACY_URL || 'http://localhost:47371';
const email = `e2e${Date.now()}@example.com`, password = 'correct-horse-9';
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };
const shot = (page, n) => (OUT ? page.screenshot({ path: `${OUT}/${n}.png` }) : Promise.resolve());

const browser = await firefox.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));

await page.goto(APP);
await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
check('signed-out visitor sees the sign-in screen, not the app', true);
await shot(page, '1-signin');

// wrong password
await page.getByLabel('E-mail').fill('nobody@example.com');
await page.getByLabel('Password').fill('wrong-password-1');
await page.getByRole('button', { name: 'Sign in', exact: true }).click();
await page.getByRole('alert').waitFor();
check('wrong password shows a friendly error', /do not match/.test(await page.getByRole('alert').innerText()));

// sign up
await page.getByRole('tab', { name: 'Create account' }).click();
await page.getByLabel('Your name').fill('Asha Sharma');
await page.getByLabel('E-mail').fill(email);
await page.getByLabel(/Password/).fill(password);
await page.getByRole('button', { name: 'Create account' }).click();
await page.getByRole('heading', { name: 'Check your e-mail' }).waitFor();
check('sign-up asks the user to confirm their e-mail', true);
await shot(page, '2-check-mail');

// unverified sign-in is refused
await page.getByRole('button', { name: /Back to sign in/ }).click();
await page.getByLabel('E-mail').fill(email);
await page.getByLabel('Password').fill(password);
await page.getByRole('button', { name: 'Sign in', exact: true }).click();
await page.getByRole('heading', { name: 'Check your e-mail' }).waitFor();
check('signing in before confirming the e-mail is blocked', true);

// open the mailed link
const outbox = await (await fetch(`${API}/v1/dev/outbox`)).json();
const mail = outbox.data.find((m) => m.to === email && /Confirm/.test(m.subject));
const link = /https?:\/\/\S+/.exec(mail.text)[0];
await page.goto(link);
await page.getByRole('heading', { name: 'Tell us about your business' }).waitFor({ timeout: 15000 });
check('confirming the e-mail signs the user in and opens the business form', true);

// onboarding: GSTIN picks the state; wrong-state GSTIN is refused by the server
await page.getByLabel('Business name').fill('Sri Lakshmi Traders');
await page.getByLabel(/GSTIN/).fill('27AAAAA0000A1Z5');
check('typing a GSTIN picks its state (Maharashtra)', (await page.getByLabel('State').inputValue()) === 'Maharashtra');
await page.getByLabel('State').selectOption('Tamil Nadu');
await page.getByRole('button', { name: 'Save and continue' }).click();
await page.getByText(/does not belong to the state/).first().waitFor();
check('server refuses a GSTIN from another state and the form shows why', true);
await shot(page, '3-onboarding-error');
await page.getByLabel(/GSTIN/).fill('33AAAAA0000A1Z5');
await page.getByLabel('State').selectOption('Tamil Nadu');
await page.getByLabel('Address').fill('12 Main Road');
await page.getByLabel('City').fill('Salem');
await page.getByRole('button', { name: 'Save and continue' }).click();
await page.locator('.sidebar, nav').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(1500);
// the legacy first-run wizard may appear on top: skip it
const skip = page.getByRole('button', { name: /skip/i }).first();
if (await skip.count()) await skip.click().catch(() => {});
await page.waitForTimeout(500);
const chip = await page.locator('.account-bar').innerText().catch(() => '');
check('after onboarding the main app opens with the account bar and Log out in view', /Asha Sharma/.test(chip) && /owner/.test(chip) && await page.locator('.account-bar-logout').isVisible() && (await page.locator('.account-bar-logout').boundingBox()).y < 200, chip);
const legacy = await (await fetch(`${LEGACY}/api/profile`)).json();
check('the business was also written to the billing profile', legacy.businessName === 'Sri Lakshmi Traders' && legacy.state === 'Tamil Nadu' && legacy.gstin === '33AAAAA0000A1Z5', JSON.stringify(legacy).slice(0, 120));
await shot(page, '4-app');

// reload keeps the session
await page.reload();
await page.locator('.account-bar').waitFor({ timeout: 15000 });
check('a reload keeps the user signed in (cookie session)', true);

// log out
await page.locator('.account-bar-logout').click();
await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
check('Log out returns to the main sign-in screen', true);
await shot(page, '5-after-logout');
await page.goBack().catch(() => {});
await page.waitForTimeout(500);
check('after logout the back button does not show the app', (await page.locator('.account-bar').count()) === 0);
check('the server session is gone', (await (await ctx.request.get(`${APP}/v1/me`)).status()) === 401);

// sign in again: onboarding is not asked twice
await page.goto(APP);
await page.getByLabel('E-mail').fill(email);
await page.getByLabel('Password').fill(password);
await page.getByRole('button', { name: 'Sign in', exact: true }).click();
await page.locator('.account-bar').waitFor({ timeout: 15000 });
check('signing in again goes straight to the app (no second onboarding)', true);
await page.locator('.account-bar-logout').click();
await page.getByRole('heading', { name: 'Welcome back' }).waitFor();

// phone sign-in
await page.getByRole('tab', { name: 'Phone' }).click();
const phone = `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
await page.getByLabel('Mobile number').fill(phone);
await page.getByRole('button', { name: 'Send code' }).click();
await page.getByLabel('6-digit code').waitFor();
await shot(page, '6-phone-code');
let sms;
for (let i = 0; i < 30 && !sms; i++) { const o = await (await fetch(`${API}/v1/dev/outbox`)).json(); sms = o.data.find((m) => m.kind === 'sms' && m.to === phone); if (!sms) await page.waitForTimeout(100); }
await page.getByLabel('6-digit code').fill(/^(\d{6})/.exec(sms.text)[1]);
await page.getByRole('button', { name: 'Confirm code' }).click();
await page.getByRole('heading', { name: 'Tell us about your business' }).waitFor({ timeout: 15000 });
check('a new phone number signs up on code confirmation and lands on the business form', true);
await page.getByRole('button', { name: 'Log out' }).click();
await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
check('the business form has its own Log out', true);

await browser.close();
console.log(results.every(Boolean) ? '\nALL PASSED' : '\nSOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
