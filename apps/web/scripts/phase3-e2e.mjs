// Browser test of the Phase 3 foundations: URLs, the Team and Security pages, permissions, shared 401/402/403 handling
// and the invitation page. Same setup and warnings as auth-e2e.mjs (read its header): it creates accounts and writes
// to the legacy server it talks to.
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
const require = createRequire(new URL('../package.json', import.meta.url));
const { firefox } = require('playwright');
const OUT = process.argv[2] || '';
const APP = process.env.E2E_APP_URL || 'http://localhost:5173';
const API = process.env.E2E_API_URL || 'http://localhost:4000';
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };
const shot = (page, n) => (OUT ? page.screenshot({ path: `${OUT}/${n}.png` }) : Promise.resolve());
const password = 'correct-horse-9';

function totp(secret) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = ''; for (const c of secret.replace(/=+$/, '')) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac('sha1', key).update(counter).digest(); const o = mac[mac.length - 1] & 15;
  return String((((mac[o] & 127) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3]) % 1000000).padStart(6, '0');
}
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

async function signUpAndOnboard(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const email = `p3${label}${Date.now()}@example.com`;
  await page.goto(APP);
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByLabel('Your name').fill(`Person ${label}`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel(/Password/).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('heading', { name: 'Check your e-mail' }).waitFor();
  const mail = await waitForMail((m) => m.to === email && /Confirm/.test(m.subject));
  await page.goto(/https?:\/\/\S+/.exec(mail.text)[0]);
  await page.getByRole('heading', { name: 'Tell us about your business' }).waitFor({ timeout: 15000 });
  await page.getByLabel('Business name').fill(`Shop ${label}`);
  await page.getByLabel('State').selectOption('Tamil Nadu');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.locator('.account-bar').waitFor({ timeout: 15000 });
  // The first-run wizard appears once this business's print settings have loaded; skip it.
  await page.getByRole('button', { name: /skip setup/i }).first().click({ timeout: 8000 }).catch(() => {});
  return { ctx, page, email };
}

const browser = await firefox.launch({ headless: true });
const owner = await signUpAndOnboard(browser, 'owner');
const page = owner.page;
page.on('pageerror', (e) => console.log('pageerror:', e.message));

// ---- 3.1 URLs ----
check('the dashboard lives at /', new URL(page.url()).pathname === '/');
await page.getByRole('button', { name: 'Clients', exact: true }).click();
await page.waitForURL('**/clients');
check('opening Clients changes the address to /clients', true);
await page.reload();
await page.locator('.account-bar').waitFor();
check('a reload stays on /clients (it used to jump back to the dashboard)', new URL(page.url()).pathname === '/clients');
await page.goBack();
await page.waitForURL((u) => u.pathname === '/');
check('the browser Back button returns to the dashboard', true);
await page.goto(`${APP}/?view=new`);
await page.waitForURL('**/invoices/new');
check('an old /?view=new shortcut still works', true);
await page.goto(`${APP}/no/such/page`);
await page.waitForURL((u) => u.pathname === '/');
check('an unknown address opens the dashboard', true);

// ---- 3.19 Team ----
await page.getByRole('button', { name: 'Team', exact: true }).click();
await page.waitForURL('**/settings/team');
await page.getByTestId('members-table').waitFor();
check('the owner sees the Team page with themselves listed', /Person owner/.test(await page.getByTestId('members-table').innerText()));
await shot(page, 'team');
const salesEmail = `p3sales${Date.now()}@example.com`;
await page.getByLabel('E-mail or phone').fill(salesEmail);
await page.getByLabel('Role', { exact: true }).selectOption('salesman');
await page.getByRole('button', { name: 'Send invitation' }).click();
await page.getByText('Waiting to accept').waitFor();
check('an invitation appears under "Waiting to accept"', (await page.locator('body').innerText()).includes(salesEmail));
const invMail = await waitForMail((m) => m.to === salesEmail && /invited/.test(m.subject));
const inviteUrl = /https?:\/\/\S+/.exec(invMail.text)[0];
check('the invitation e-mail links to the web app accept page', new URL(inviteUrl).pathname.startsWith('/accept-invite/') && new URL(inviteUrl).origin === APP, inviteUrl);

// ---- invited person: 3.6 accept page, 3.22 permissions ----
const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
const guest = await guestCtx.newPage();
await guest.goto(APP);
await guest.getByRole('tab', { name: 'Create account' }).click();
await guest.getByLabel('Your name').fill('Sam Sales');
await guest.getByLabel('E-mail').fill(salesEmail);
await guest.getByLabel(/Password/).fill(password);
await guest.getByRole('button', { name: 'Create account' }).click();
await guest.getByRole('heading', { name: 'Check your e-mail' }).waitFor();
const vm = await waitForMail((m) => m.to === salesEmail && /Confirm/.test(m.subject));
await guest.goto(/https?:\/\/\S+/.exec(vm.text)[0]);
await guest.getByRole('heading', { name: 'Tell us about your business' }).waitFor({ timeout: 15000 });
await guest.goto(inviteUrl); // open the link while still on the first-run form: the gate keeps onboarding first
await guest.getByLabel('Business name').fill('Sam Own Shop');
await guest.getByLabel('State').selectOption('Kerala');
await guest.getByRole('button', { name: 'Save and continue' }).click();
await guest.locator('.account-bar').waitFor({ timeout: 15000 });
await guest.getByRole('button', { name: /skip setup/i }).first().click({ timeout: 8000 }).catch(() => {});
await guest.goto(inviteUrl);
await guest.getByRole('heading', { name: 'Invitation' }).waitFor({ timeout: 8000 }).catch(async () => { await shot(guest, 'accept-debug'); throw new Error('accept page did not open: ' + (await guest.locator('body').innerText()).slice(0, 300)); });
check('the accept page names the inviter, the business and the role', /Person owner.*Shop owner.*Salesman/s.test(await guest.locator('body').innerText()));
await shot(guest, 'accept-invite');
await guest.getByRole('button', { name: 'Accept and join' }).click();
await guest.waitForURL((u) => u.pathname === '/');
await guest.locator('.account-bar').waitFor();
await guest.getByRole('button', { name: /skip setup/i }).first().click({ timeout: 8000 }).catch(() => {});

// A person in two organizations gets the organization switcher; the one just joined is the active one.
const active = await guest.locator('.org-switcher').evaluate((el) => el.options[el.selectedIndex].text);
check('after accepting, the shared business is the active organization (own one still in the switcher)', active === 'Shop owner' && (await guest.locator('.org-switcher option').count()) === 2, active);
check('a salesman has no Team link in the sidebar', (await guest.getByRole('button', { name: 'Team', exact: true }).count()) === 0);
await guest.goto(`${APP}/settings/team`);
await guest.getByTestId('members-table').waitFor().catch(() => {});
await guest.waitForTimeout(800);
check('and opening /settings/team shows the shared 403 message as a toast', /can not do this|Your role/.test(await guest.locator('body').innerText()));
await shot(guest, 'salesman-forbidden');

// ---- 3.19 Security (2FA + devices) ----
await page.getByRole('button', { name: 'Security', exact: true }).click();
await page.waitForURL('**/settings/security');
await page.getByTestId('devices-panel').getByText('this device').waitFor();
check('the Security page lists this device', true);
await page.getByLabel('Your password').fill(password);
await page.getByRole('button', { name: 'Turn on' }).click();
await page.getByAltText('Authenticator QR code').waitFor();
const secret = (await page.locator('code').first().innerText()).trim();
await shot(page, 'security-2fa-setup');
await page.getByLabel('6-digit code').fill(totp(secret));
await page.getByRole('button', { name: 'Confirm' }).click();
await page.getByText('Save these 10 backup codes now').waitFor();
const codes = (await page.locator('pre').innerText()).trim().split('\n');
check('turning on two-step shows 10 backup codes once', codes.length === 10, String(codes.length));
await shot(page, 'security-2fa-on');

// ---- 3.3 shared handling of 401, 402, 403 ----
await page.route('**/v1/members', (route) => route.fulfill({ status: 402, contentType: 'application/json', body: JSON.stringify({ error: { code: 'payment_required', message: 'Your plan does not include team members.' } }) }));
await page.goto(`${APP}/settings/team`);
await page.getByRole('dialog', { name: 'Upgrade your plan' }).waitFor({ timeout: 8000 }).catch(async () => { await shot(page, 'upgrade-debug'); throw new Error('no upgrade sheet: ' + (await page.locator('body').innerText()).slice(0, 300)); });
check('a 402 answer opens the Upgrade sheet', /does not include team members/.test(await page.getByRole('dialog').innerText()));
await shot(page, 'upgrade-sheet');
await page.getByRole('button', { name: 'Got it' }).click();
await page.unroute('**/v1/members');

// end the session from another place, then use the app: the next data request sends the user to sign-in
const ownerCookies = await owner.ctx.cookies();
const cookieHeader = ownerCookies.map((c) => `${c.name}=${c.value}`).join('; ');
await fetch(`${API}/v1/sessions/revoke-all`, { method: 'POST', headers: { cookie: cookieHeader, origin: APP, 'content-type': 'application/json' }, body: JSON.stringify({ includeCurrent: true }) });
await page.getByRole('button', { name: 'Security', exact: true }).click();
await page.getByRole('heading', { name: 'Welcome back' }).waitFor({ timeout: 10000 });
check('a 401 from any data request returns to the sign-in screen', true);

// ---- sign in again: two-step code is now required ----
await page.getByLabel('E-mail').fill(owner.email);
await page.getByLabel('Password').fill(password);
await page.getByRole('button', { name: 'Sign in', exact: true }).click();
await page.getByRole('heading', { name: /Two-step check/ }).waitFor();
await page.getByLabel('Code').fill(totp(secret));
await page.getByRole('button', { name: 'Continue' }).click();
await page.locator('.account-bar').waitFor({ timeout: 15000 });
check('with two-step on, sign-in asks for the code and then opens the app', true);

// ---- dark mode through the theme provider ----
await page.getByRole('button', { name: /Dark Mode/ }).click();
check('the theme provider switches to dark mode', (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark');
await shot(page, 'dark');

await browser.close();
console.log(results.every(Boolean) ? '\nALL PASSED' : '\nSOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
