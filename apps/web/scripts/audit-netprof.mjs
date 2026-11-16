// Counts and times the API calls one navigation makes (docs/AUDIT_2026-11.md, section 3).
//   node scripts/audit-netprof.mjs
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { firefox } = require('playwright');
const { signUpAndSetUp } = await import('./e2eSignup.mjs');
const APP = 'http://localhost:5173';
const b = await firefox.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }); const p = await ctx.newPage();
const stamp = Date.now();
await signUpAndSetUp(p, { app: APP, name: 'Net Prof', email: `net${stamp}@example.com`, password: 'correct-horse-9', business: `Net ${stamp}` });
async function prof(url) {
  const reqs = []; const t0 = Date.now();
  const on = (r) => reqs.push({ r, t: Date.now() - t0 }); const done = (r) => { const x = reqs.find((q) => q.r === r); if (x) x.d = Date.now() - t0; };
  p.on('request', on); p.on('requestfinished', done); p.on('requestfailed', done);
  await p.goto(APP + url, { waitUntil: 'domcontentloaded' }); await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  p.off('request', on); p.off('requestfinished', done); p.off('requestfailed', done);
  const api = reqs.filter((x) => /\/v1\/|\/health/.test(x.r.url()));
  const js = reqs.filter((x) => /\.(jsx?|tsx?|mjs)(\?|$)/.test(x.r.url().split('?')[0]) || /node_modules/.test(x.r.url()));
  console.log(`\n== ${url}: ${Date.now() - t0}ms total, ${reqs.length} requests, ${api.length} API, ${js.length} module/script`);
  const count = {}; for (const x of api) { const k = x.r.method() + ' ' + x.r.url().replace(APP, '').split('?')[0]; count[k] = (count[k] || 0) + 1; }
  console.log(Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${v}x ${k}`).join('\n'));
  console.log('last request finished at', Math.max(...reqs.map((x) => x.d || 0)), 'ms');
}
for (const u of ['/parties', '/sales/invoices', '/reports', '/accounting/trial-balance', '/']) await prof(u);
await b.close();
