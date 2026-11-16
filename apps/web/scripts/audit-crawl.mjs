// Repeatable UI audit (docs/AUDIT_2026-11.md): signs up a fresh account on the local dev servers, seeds a little data, visits every screen
// at desktop and mobile width and records console errors, failed requests, overflow, unlabelled controls and screenshots.
//   node scripts/audit-crawl.mjs <output-folder>   (needs <output-folder>/shots to exist)
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { firefox } = require('playwright');
const OUT = process.argv[2];
const APP = 'http://localhost:5173';
const browser = await firefox.launch();
const report = { routes: [], seed: {}, timing: {} };
const tm = async (name, fn) => { const t = Date.now(); const r = await fn(); report.timing[name] = Date.now() - t; console.log('T', name, report.timing[name]); return r; };

const PATHS = ['/', '/sales', '/sales/quotations', '/sales/orders', '/sales/challans', '/sales/invoices', '/sales/proforma', '/sales/credit-notes', '/invoices', '/invoices/new', '/parties', '/products', '/expenses', '/purchases', '/purchases/payment-out', '/purchases/orders', '/purchases/returns', '/other-income', '/recurring', '/sales/payment-in', '/grow/salesman', '/grow/reminders', '/grow/catalog', '/reports', '/pos', '/cash-bank/accounts', '/cash-bank/cash', '/cash-bank/transfers', '/cash-bank/cheques', '/cash-bank/loans', '/cash-bank/reconcile', '/accounting/setup', '/accounting/accounts', '/accounting/ledger', '/accounting/trial-balance', '/accounting/journal', '/gst-returns', '/gst-returns/gstr1', '/gst-returns/gstr3b', '/gst-returns/gstr2b', '/gst-returns/tds', '/income-tax', '/itr-4', '/itr-3', '/fixed-assets', '/filing', '/ca', '/utilities/verify', '/utilities/edit-log', '/utilities/barcode', '/utilities/tally', '/utilities/close-fy', '/utilities/backup', '/utilities/setup', '/utilities/trash', '/settings', '/settings/general', '/settings/transaction', '/settings/print', '/settings/taxes', '/settings/gst', '/settings/message', '/settings/party', '/settings/item', '/settings/service', '/settings/accounting', '/settings/currency', '/settings/business', '/settings/documents', '/settings/features', '/settings/data', '/settings/team', '/settings/roles', '/settings/billing', '/settings/security'];
const REPORTS = ['sale','purchase','day-book','all-transactions','profit-loss','balance-sheet','trial-balance','cash-flow','party-statement','all-parties','ageing','payable-ageing','stock-summary','low-stock','stock-by-category','item-pnl','party-pnl','bill-wise-profit','gst-rate','expense','by-category','sale-order','purchase-order','salesman','discount','cash-watch','form-27eq','eway-register','item-by-party','party-by-item'];
for (const r of REPORTS) PATHS.push('/reports/' + r);

async function audit(page, url, tag) {
  const issues = { console: [], pageerrors: [], failed: [], slow: [] };
  const onC = (m) => { if (['error', 'warning'].includes(m.type())) issues.console.push(m.type() + ': ' + m.text().slice(0, 160)); };
  const onE = (e) => issues.pageerrors.push(String(e).slice(0, 160));
  const onR = async (r) => { if (r.status() >= 400 && !/favicon|workbox/.test(r.url())) issues.failed.push(r.status() + ' ' + r.request().method() + ' ' + r.url().replace(APP, '').slice(0, 100)); };
  page.on('console', onC); page.on('pageerror', onE); page.on('response', onR);
  const t0 = Date.now(); let nav = 'ok', ready = null;
  try {
    await page.goto(APP + url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.locator('h1, h2, [role=tablist], .ui-table, form, input').first().waitFor({ timeout: 15000 }).then(() => { ready = Date.now() - t0; }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
  } catch (e) { nav = 'nav-fail ' + String(e).slice(0, 80); }
  const total = Date.now() - t0;
  const dom = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.value || '').trim();
    const labelled = (el) => el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
    const buttons = [...document.querySelectorAll('button, [role=button], a[href]')].filter(vis);
    const unnamed = buttons.filter((b) => !name(b) && !b.querySelector('img[alt]')).map((b) => b.tagName + '.' + String(b.className).slice(0, 30)).slice(0, 5);
    const inputs = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(vis);
    const unlabelled = inputs.filter((i) => !labelled(i)).map((i) => i.tagName + (i.type ? ':' + i.type : '') + '[' + (i.placeholder || i.name || i.id || '').slice(0, 24) + ']').slice(0, 6);
    const vw = document.documentElement.clientWidth;
    const hOverflow = document.documentElement.scrollWidth > vw + 1;
    const clipped = [...document.querySelectorAll('button, h1, h2, h3, label, th, a')].filter((el) => vis(el) && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible' && getComputedStyle(el).textOverflow !== 'ellipsis').map((e) => (e.innerText || '').trim().slice(0, 30)).slice(0, 4);
    const text = document.body.innerText;
    const bad = ['undefined', 'NaN', '[object', 'Invalid Date', '{{', 'Infinity', 'null'].filter((w) => text.includes(w));
    const h = [...document.querySelectorAll('h1,h2')].filter(vis).map((e) => e.innerText.trim()).filter(Boolean).slice(0, 3);
    const tiny = buttons.filter((b) => { const r = b.getBoundingClientRect(); return (r.width < 24 || r.height < 24) && b.tagName === 'BUTTON'; }).length;
    return { unnamed, unlabelled, hOverflow, clipped, bad, h, buttons: buttons.length, inputs: inputs.length, tiny, textLen: text.length, title: document.title, snippet: text.replace(/\s+/g, ' ').slice(0, 220) };
  }).catch((e) => ({ err: String(e) }));
  page.off('console', onC); page.off('pageerror', onE); page.off('response', onR);
  return { url, tag, nav, ready, total, ...dom, ...issues };
}

try {
  const pub = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const pp = await pub.newPage();
  for (const u of ['/', '/forgot-password', '/pricing', '/plans', '/privacy', '/terms']) { const r = await audit(pp, u, 'public'); report.routes.push(r); await pp.screenshot({ path: `${OUT}/shots/public${u.replace(/\//g, '_') || '_root'}.png`, fullPage: true }).catch(() => {}); }
  await pp.goto(APP); await pp.getByRole('tab', { name: 'Phone' }).click().catch(() => {}); await pp.screenshot({ path: `${OUT}/shots/public_phone.png` });
  await pub.close();

  const stamp = Date.now();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const logs = []; page.on('response', (r) => { if (r.status() >= 400) logs.push(r.status() + ' ' + r.url().replace(APP, '').slice(0, 90)); });
  await tm('signup_page_load', () => page.goto(APP, { waitUntil: 'load' }));
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByLabel('Your name').fill('Audit User'); await page.getByLabel('E-mail').fill(`audit${stamp}@example.com`); await page.getByLabel(/Password/).fill('correct-horse-9');
  await page.screenshot({ path: `${OUT}/shots/auth_register_filled.png` });
  await tm('create_account_to_plans', async () => { await page.getByRole('button', { name: 'Create account' }).click(); await page.getByRole('heading', { name: 'Choose how to start' }).waitFor({ timeout: 40000 }); });
  await page.screenshot({ path: `${OUT}/shots/plans.png`, fullPage: true });
  report.plansText = await page.evaluate(() => document.body.innerText.slice(0, 3000));
  await tm('start_trial_to_onboarding', async () => { await page.getByRole('button', { name: /Start 7-day free trial/ }).click(); await page.getByLabel('Business name').waitFor({ timeout: 40000 }); });
  await page.screenshot({ path: `${OUT}/shots/onboarding1.png`, fullPage: true });
  await page.getByLabel('Business name').fill(`Audit Traders ${stamp}`);
  await page.getByLabel('GST registration').selectOption('regular'); await page.locator('#bs-gstin').fill('33ABCDE1234F1Z7'); await page.locator('#bs-state').selectOption('Tamil Nadu');
  for (let i = 0; i < 3; i++) { await tm('onboarding_next_' + (i + 1), () => page.getByRole('button', { name: 'Next' }).click()); await page.screenshot({ path: `${OUT}/shots/onboarding${i + 2}.png`, fullPage: true }); }
  await tm('finish_setup_to_guide', async () => { await page.getByRole('button', { name: 'Finish setup' }).click(); await page.getByRole('heading', { name: 'Who is your first customer?' }).waitFor({ timeout: 40000 }); });
  await page.screenshot({ path: `${OUT}/shots/guide1.png`, fullPage: true });
  await page.getByRole('button', { name: 'Skip' }).click(); await page.screenshot({ path: `${OUT}/shots/guide2.png`, fullPage: true }); await page.getByRole('button', { name: 'Skip' }).click(); await page.screenshot({ path: `${OUT}/shots/guide3.png`, fullPage: true });
  await tm('guide_to_app', async () => { await page.getByRole('button', { name: 'Take me to the app' }).click(); await page.locator('.account-bar, .vy-topbar, .topbar').first().waitFor({ timeout: 40000 }); });
  report.signupFailures = logs.slice();

  const api = async (m, u, b) => { const r = await page.request.fetch(APP + u, { method: m, ...(b ? { data: b } : {}) }); let j = null; try { j = await r.json(); } catch {} return { s: r.status(), j }; };
  const biz = (await api('GET', '/v1/businesses')).j.data[0];
  await api('POST', '/v1/accounting/backfill', { businessId: biz.id, dryRun: false });
  const mk = async (c, b) => { const r = await api('POST', '/v1/workspace/collections/' + c, b); (report.seed[c] ||= []).push(r.s); return r; };
  for (const n of ['Asha Traders', 'Ravi Stores', 'Meena Textiles']) await mk('clients', { name: n, phone: '9876543210', gstin: '', email: n.split(' ')[0].toLowerCase() + '@example.com', address: 'Chennai', state: 'Tamil Nadu' });
  for (const [n, p] of [['Cotton Shirt', 450], ['Denim Jeans', 900], ['Silk Saree', 2500]]) await mk('products', { name: n, price: p, purchasePrice: p * 0.7, taxPercent: 12, hsn: '6205', unit: 'Pcs', stock: 50, trackStock: true });
  const bill = (id, date, taxable, status, client) => ({ id, invoiceNumber: id, invoiceDate: date, invoiceType: 'tax-invoice', status, clientName: client, totalAmount: taxable * 1.12, data: { totals: { total: taxable * 1.12, cgst: taxable * 0.06, sgst: taxable * 0.06, igst: 0, cess: 0, roundOff: 0 }, items: [{ name: 'Cotton Shirt', quantity: 10, rate: taxable / 10, taxPercent: 12 }] } });
  await mk('bills', bill('INV-1', '2026-11-01', 45000, 'paid', 'Asha Traders')); await mk('bills', bill('INV-2', '2026-11-05', 22000, 'unpaid', 'Ravi Stores')); await mk('bills', bill('INV-3', '2026-11-10', 90000, 'unpaid', 'Meena Textiles'));
  await mk('purchases', { docType: 'bill', date: '2026-11-02', invoiceNumber: 'P-1', taxableAmount: 30000, totalTax: 3600, totalAmount: 33600, interstate: false, items: [{ name: 'Cotton', quantity: 1, rate: 30000, taxPercent: 12 }] });
  await mk('expenses', { date: '2026-11-03', amount: 5000, gstAmount: 0, paymentMode: 'cash', category: 'Rent' });

  for (const vp of [{ w: 1280, h: 900, tag: 'desktop' }, { w: 390, h: 844, tag: 'mobile' }]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    for (const u of PATHS) {
      if (vp.tag === 'mobile' && u.startsWith('/reports/')) continue;
      const r = await audit(page, u, vp.tag); report.routes.push(r);
      const f = `${OUT}/shots/${vp.tag}${u.replace(/\//g, '_') || '_root'}.png`;
      if (vp.tag === 'desktop') await page.screenshot({ path: f, fullPage: true }).catch(() => {}); else if (r.hOverflow) await page.screenshot({ path: f }).catch(() => {});
    }
  }
  await ctx.close();
} catch (e) { report.fatal = String(e); }
finally { await browser.close(); writeFileSync(OUT + '/report.json', JSON.stringify(report, null, 1)); console.log('routes', report.routes.length, 'fatal', report.fatal || 'none'); }
