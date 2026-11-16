// Alignment audit (docs/AUDIT_2026-11.md section 4): signs up an account on the local dev servers, seeds a little data and visits
// every screen at 1280, 1024 and 390 px wide, measuring what the eye catches: a header jammed against the trial banner, a table or
// an input whose content is cut off, a single item orphaned on a wrapped row, a link in the browser's default blue, a button whose
// label wraps, content that sticks out of the page, and cards whose left edges disagree.
//   node scripts/audit-align.mjs [output-folder]     prints the findings; with a folder it also saves a screenshot of each page that has one
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { signUpAndSetUp } from './e2eSignup.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { firefox } = require('playwright');
const APP = process.env.E2E_APP_URL || 'http://localhost:5173';
const OUT = process.argv[2] || '';

const PATHS = ['/', '/sales', '/sales/invoices', '/invoices/new', '/parties', '/products', '/expenses', '/purchases', '/purchases/payment-out', '/purchases/orders', '/purchases/returns', '/other-income', '/recurring', '/sales/payment-in', '/grow/salesman', '/grow/reminders', '/grow/catalog', '/reports', '/reports/profit-loss', '/reports/sale', '/pos', '/cash-bank/accounts', '/accounting/setup', '/accounting/accounts', '/accounting/ledger', '/accounting/trial-balance', '/accounting/journal', '/gst-returns/gstr1', '/gst-returns/gstr3b', '/gst-returns/gstr2b', '/gst-returns/tds', '/gst-returns/guide', '/income-tax', '/itr-4', '/itr-3', '/fixed-assets', '/filing', '/ca', '/utilities/verify', '/utilities/edit-log', '/utilities/barcode', '/utilities/tally', '/utilities/close-fy', '/utilities/backup', '/utilities/setup', '/utilities/trash', '/settings/general', '/settings/transaction', '/settings/print', '/settings/taxes', '/settings/gst', '/settings/party', '/settings/item', '/settings/accounting', '/settings/business', '/settings/documents', '/settings/features', '/settings/data', '/settings/team', '/settings/roles', '/settings/billing', '/settings/security'];

const probe = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const out = [];
  const vw = document.documentElement.clientWidth;
  const main = document.querySelector('.vy-main > .main-content, .main-content, main') || document.body;
  // A. content jammed against the trial banner (needs at least 8px of air)
  const banner = document.querySelector('.plan-banner, [class*="plan-banner"]');
  if (banner && vis(banner)) {
    const b = banner.getBoundingClientRect();
    const next = [...main.querySelectorAll('*')].filter((e) => vis(e) && !banner.contains(e) && e.getBoundingClientRect().top >= b.bottom - 1 && e.getBoundingClientRect().height > 20).sort((x, y) => x.getBoundingClientRect().top - y.getBoundingClientRect().top)[0];
    if (next && next.getBoundingClientRect().top - b.bottom < 8) out.push(`jammed under the banner (${Math.round(next.getBoundingClientRect().top - b.bottom)}px): ${next.tagName}.${String(next.className).slice(0, 30)}`);
  }
  // B. tables whose content is cut off or sticks out of the page without a scroll container
  for (const t of document.querySelectorAll('table')) {
    if (!vis(t)) continue;
    let p = t.parentElement; let scroller = null;
    while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') { scroller = p; break; } p = p.parentElement; }
    const r = t.getBoundingClientRect();
    const box = (t.closest('.card, .glass-panel, section, .ui-card') || t.parentElement).getBoundingClientRect();
    if (!scroller && r.right > box.right + 2) out.push(`table sticks out of its card by ${Math.round(r.right - box.right)}px`);
    if (!scroller && r.right > vw + 2) out.push(`table wider than the screen by ${Math.round(r.right - vw)}px`);
    if (!scroller) { const cut = [...t.querySelectorAll('th, td')].filter((c) => vis(c) && c.getBoundingClientRect().right > box.right + 2).length; if (cut) out.push(`${cut} table cells beyond the card edge`); }
  }
  // C. text boxes whose value is cut off
  for (const i of document.querySelectorAll('input[type=text], input[type=email], input:not([type]), textarea')) {
    if (vis(i) && i.value && i.scrollWidth > i.clientWidth + 2 && i.tagName === 'INPUT') out.push(`input shows "${i.value.slice(0, 24)}…" cut off (${i.clientWidth}px wide)`);
  }
  // D. wrapped flex rows that leave one small item alone on the last line
  for (const f of document.querySelectorAll('main *, .main-content *')) {
    const s = getComputedStyle(f);
    if (s.display !== 'flex' || s.flexWrap === 'nowrap' || !vis(f)) continue;
    const kids = [...f.children].filter(vis);
    if (kids.length < 3) continue;
    const rows = new Map();
    for (const k of kids) { const top = Math.round(k.getBoundingClientRect().top / 6); rows.set(top, (rows.get(top) || []).concat(k)); }
    if (rows.size < 2) continue;
    const last = [...rows.entries()].sort((a, b) => a[0] - b[0]).at(-1)[1];
    const fw = f.getBoundingClientRect().width;
    if (last.length === 1 && last[0].getBoundingClientRect().width < fw * 0.3 && kids.length >= 4 && f.getBoundingClientRect().width > 500) out.push(`one item alone on the last row: "${(last[0].innerText || '').trim().slice(0, 24)}"`);
  }
  // E. links in the browser's default colours
  const raw = [...document.querySelectorAll('a[href]')].filter((a) => { if (!vis(a)) return false; const c = getComputedStyle(a).color; return c === 'rgb(0, 0, 238)' || c === 'rgb(85, 26, 139)' || c === 'rgb(0, 0, 255)'; });
  if (raw.length) out.push(`${raw.length} links in the default browser blue ("${(raw[0].innerText || '').trim().slice(0, 24)}")`);
  // F. buttons whose label wraps onto a second line
  const wrapped = [...document.querySelectorAll('button, a.btn')].filter((b) => { if (!vis(b)) return false; const lh = parseFloat(getComputedStyle(b).lineHeight) || 18; const t = (b.innerText || '').trim(); return t.length > 3 && b.getBoundingClientRect().height > lh * 2.4 && !b.closest('.vy-item, .ui-tab'); });
  if (wrapped.length) out.push(`${wrapped.length} buttons with wrapped labels ("${(wrapped[0].innerText || '').trim().slice(0, 28)}")`);
  // G. anything sticking out of the page
  if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls sideways by ${document.documentElement.scrollWidth - vw}px`);
  // H. cards in the main column whose left edges disagree
  const cards = [...main.children].filter((e) => vis(e) && e.getBoundingClientRect().width > vw * 0.4);
  const lefts = new Set(cards.map((e) => Math.round(e.getBoundingClientRect().left / 2)));
  if (cards.length > 2 && lefts.size > 1) out.push(`main blocks start at ${[...lefts].map((x) => x * 2).join(' / ')}px`);
  // I. page title that does not name the page (the heading and the menu item disagree)
  const h1 = [...document.querySelectorAll('h1')].find(vis);
  const crumb = document.querySelector('.vy-crumb b')?.textContent?.trim();
  if (h1 && crumb && !h1.textContent.toLowerCase().includes(crumb.toLowerCase().replace(/ filing$/, '').split(' ')[0]) && !crumb.toLowerCase().includes(h1.textContent.toLowerCase().split(' ')[0])) out.push(`title "${h1.textContent.trim().slice(0, 28)}" vs menu "${crumb}"`);
  // J. two header-ish controls overlapping
  const bar = [...document.querySelectorAll('.vy-topbar > *, .vy-topbar-right > *')].filter(vis);
  for (let a = 0; a < bar.length; a++) for (let b = a + 1; b < bar.length; b++) { const x = bar[a].getBoundingClientRect(); const y = bar[b].getBoundingClientRect(); if (x.left < y.right - 1 && x.right > y.left + 1 && x.top < y.bottom - 1 && x.bottom > y.top + 1 && !bar[a].contains(bar[b]) && !bar[b].contains(bar[a])) out.push(`top bar items overlap: ${bar[a].className} / ${bar[b].className}`); }
  return [...new Set(out)];
};

const browser = await firefox.launch();
const report = {};
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const stamp = Date.now();
  await signUpAndSetUp(page, { app: APP, name: 'Align Audit', email: `al${stamp}@example.com`, password: 'correct-horse-9', business: `Align ${stamp}` });
  const api = (m, u, b) => page.request.fetch(APP + u, { method: m, ...(b ? { data: b } : {}) });
  const biz = (await (await api('GET', '/v1/businesses')).json()).data[0];
  await api('POST', '/v1/accounting/backfill', { businessId: biz.id, dryRun: false });
  for (const n of ['Asha Traders', 'Ravi Stores', 'Meena Textiles']) await api('POST', '/v1/workspace/collections/clients', { name: n, phone: '9876543210', email: 'a@example.com', address: 'Chennai', state: 'Tamil Nadu' });
  for (const [n, p] of [['Cotton Shirt', 450], ['Denim Jeans', 900]]) await api('POST', '/v1/workspace/collections/products', { name: n, sellingPrice: p, rate: p, purchasePrice: p * 0.7, taxPercent: 12, hsn: '6205', unit: 'Pcs', stock: 50, trackStock: true });
  await api('POST', '/v1/workspace/collections/bills', { id: 'INV-1', invoiceNumber: 'INV-1', invoiceDate: '2026-11-01', invoiceType: 'tax-invoice', status: 'unpaid', clientName: 'Asha Traders', totalAmount: 50400, data: { totals: { total: 50400 }, items: [{ name: 'Cotton Shirt', quantity: 10, rate: 4500, taxPercent: 12, hsn: '6205' }] } });
  for (const w of [1280, 1024, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const u of PATHS) {
      await page.goto(APP + u, { waitUntil: 'domcontentloaded' });
      await page.locator('h1, h2, [role=tablist], form, .ui-table').first().waitFor({ timeout: 12000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(300);
      const found = await page.evaluate(probe).catch((e) => [`probe failed: ${String(e).slice(0, 60)}`]);
      if (found.length) {
        report[`${w} ${u}`] = found;
        if (OUT && w === 1280) await page.screenshot({ path: `${OUT}/align${u.replace(/\//g, '_') || '_root'}.png`, fullPage: false }).catch(() => {});
      }
    }
  }
} finally {
  await browser.close();
  const keys = Object.keys(report);
  const kinds = {};
  for (const k of keys) for (const f of report[k]) { const kind = f.replace(/[\d.]+px/g, 'Npx').replace(/"[^"]*"/g, '"…"').replace(/\(\d+px wide\)/, '').slice(0, 60); kinds[kind] = (kinds[kind] || 0) + 1; }
  console.log(`${keys.length} page views with findings`);
  console.log(Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${String(n).padStart(4)}  ${k}`).join('\n'));
  if (OUT) writeFileSync(`${OUT}/align-report.json`, JSON.stringify(report, null, 1));
  else for (const k of keys) console.log(k, '→', report[k].join(' ; '));
}
