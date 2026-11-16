// Phase 0 guard (docs/AUDIT_2026-11.md, S10): a page must not make more API calls than it needs. Signs up an account on the local
// development servers, then counts the API calls of a cold load and of in-app navigation, and fails when a budget is broken, when
// a call is made twice, or when a page that does not list bills, parties or items downloads them.
// React StrictMode is switched off in this browser (development runs every effect twice, which doubles the calls a real browser
// would not make). Needs the dev servers: web on :5173, API on :4000.
//   node scripts/perf-guard-e2e.mjs
import { createRequire } from 'node:module';
import { signUpAndSetUp } from './e2eSignup.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { firefox } = require('playwright');

const APP = process.env.E2E_APP_URL || 'http://localhost:5173';
const COLD_BUDGET = 12; // API calls to draw any page from nothing: start-up, settings, profile, bell, menu badges, the page's own
const NAV_BUDGET = 5; // API calls when moving between screens inside the app
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };

const COLLECTIONS = /\/v1\/workspace\/collections\/(bills|products|clients)$/;
// Screens that list those documents themselves may download them; every other screen may not.
const LISTS_DOCUMENTS = new Set(['/', '/parties', '/products', '/sales/invoices', '/invoices', '/gst-returns']);

const browser = await firefox.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { try { localStorage.setItem('ledgora_no_strict', '1'); } catch { /* private window */ } });
  const page = await ctx.newPage();
  const stamp = Date.now();
  await signUpAndSetUp(page, { app: APP, name: 'Perf Guard', email: `perf${stamp}@example.com`, password: 'correct-horse-9', business: `Perf ${stamp}` });

  let calls = [];
  page.on('request', (r) => { const u = r.url().replace(APP, ''); if (u.startsWith('/v1/')) calls.push(`${r.method()} ${u.split('?')[0]}${u.includes('?') ? '?' + u.split('?')[1] : ''}`); });
  const settle = async () => { await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(400); };
  const dups = (list) => { const seen = new Map(); for (const c of list) if (c.startsWith('GET')) seen.set(c, (seen.get(c) || 0) + 1); return [...seen].filter(([, n]) => n > 1).map(([c, n]) => `${n}x ${c}`); };
  const summary = (list) => `${list.length} calls: ${[...new Set(list.map((c) => c.replace(/\?.*/, '')))].join(', ')}`.slice(0, 700);

  // The first load of a new account writes its defaults once (print layout, saved preferences); measure from the second.
  await page.goto(APP + '/'); await settle();

  // ---- cold loads --------------------------------------------------------------------------------------------------
  for (const url of ['/', '/parties', '/reports', '/accounting/trial-balance', '/settings/general', '/utilities/backup', '/gst-returns']) {
    calls = [];
    await page.goto(APP + url); await settle();
    const own = calls.filter((c) => !c.endsWith('/health'));
    check(`cold load ${url}: ${own.length} API calls, at most ${COLD_BUDGET}`, own.length <= COLD_BUDGET, summary(own));
    check(`cold load ${url}: no call is made twice`, dups(own).length === 0, dups(own).join('; '));
    const listed = own.filter((c) => COLLECTIONS.test(c.replace('GET ', '')));
    check(`cold load ${url}: ${LISTS_DOCUMENTS.has(url) ? 'may list' : 'does not download'} bills, parties or items`, LISTS_DOCUMENTS.has(url) || listed.length === 0, listed.join(', '));
  }

  // ---- moving around inside the app --------------------------------------------------------------------------------
  await page.goto(APP + '/'); await settle();
  const item = (label) => page.locator('.vy-sidebar button.vy-item').filter({ has: page.locator('.vy-item-label', { hasText: new RegExp(`^\\s*${label}\\s*$`) }) }).first();
  const open = async (group) => { const g = item(group); if ((await g.getAttribute('aria-expanded')) !== 'true') await g.click(); };
  const hops = [
    ['Reports', '/reports', null], ['Settings', '/settings', null], ['Parties', '/parties', null], ['Items', '/products', null], ['Home', '/', null],
    ['Trial Balance', '/accounting/trial-balance', 'Accounting'], ['Invoices', '/sales/invoices', 'Sale'], ['Expenses', '/expenses', 'Purchase & Expense'],
  ];
  for (const [label, path, group] of hops) {
    if (group) await open(group);
    const link = item(label);
    if (!(await link.count())) { check(`menu item ${label} exists`, false); continue; }
    calls = [];
    await link.click(); await settle();
    const own = calls.filter((c) => !c.endsWith('/health'));
    check(`move to ${label}: ${own.length} API calls, at most ${NAV_BUDGET}`, own.length <= NAV_BUDGET, summary(own));
    check(`move to ${label}: no call is made twice`, dups(own).length === 0, dups(own).join('; '));
    const listed = own.filter((c) => COLLECTIONS.test(c.replace('GET ', '')));
    check(`move to ${label}: ${LISTS_DOCUMENTS.has(path) ? 'may list' : 'does not download'} bills, parties or items`, LISTS_DOCUMENTS.has(path) || listed.length === 0, listed.join(', '));
  }

  // ---- Open Anything asks the server, and only after two letters --------------------------------------------------------
  await page.goto(APP + '/'); await settle();
  calls = [];
  await page.keyboard.press('Control+f');
  await page.getByPlaceholder(/Open anything/i).fill('a');
  await page.waitForTimeout(600);
  check('Open Anything: one letter searches nothing', !calls.some((c) => c.includes('/search')), calls.join(', '));
  await page.getByPlaceholder(/Open anything/i).fill('ab');
  await page.waitForTimeout(900);
  check('Open Anything: two letters make one server search', calls.filter((c) => c.includes('/v1/workspace/search')).length === 1, calls.join(', '));
  check('Open Anything: and never download a whole collection', !calls.some((c) => COLLECTIONS.test(c.replace('GET ', ''))), calls.join(', '));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
