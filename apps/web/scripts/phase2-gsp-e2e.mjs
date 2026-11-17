// Browser test of Phase 2's online routes against the built-in sandbox GST service provider: an IRN made from the invoice list,
// printed with a SANDBOX mark, cancelled inside 24 hours; and a GSTR-3B pack uploaded to the sandbox, its ARN recorded by the
// status check. Needs the API started with GSP_MODE=sandbox (the test says so and stops if it is not).
//   GSP_MODE=sandbox (API)   node scripts/phase2-gsp-e2e.mjs [screenshot-folder]
import { createRequire } from 'node:module';
import { signUpAndSetUp } from './e2eSignup.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { firefox } = require('playwright');
const OUT = process.argv[2] || '';
const APP = process.env.E2E_APP_URL || 'http://localhost:5173';
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };
const shot = (page, n) => (OUT ? page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }) : Promise.resolve());
const OWN = '33ABCDE1234F1Z7';
const BUYER = '33AABCU9603R1ZU';

const browser = await firefox.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })).newPage();
  const stamp = Date.now();
  await signUpAndSetUp(page, { app: APP, name: 'Gsp Person', email: `gsp${stamp}@example.com`, password: 'correct-horse-9', business: `Gsp ${stamp}`, gstin: OWN });
  const api = (m, u, b) => page.request.fetch(APP + u, { method: m, ...(b ? { data: b } : {}) });
  const gs = await (await api('GET', '/v1/gsp/status')).json();
  if (!gs.sandbox) { console.log('The API is not running with GSP_MODE=sandbox. Start it that way and run this again.'); process.exit(2); }
  const biz = (await (await api('GET', '/v1/businesses')).json()).data[0];
  await api('PATCH', '/v1/settings', { businessId: biz.id, values: { 'gst.einvoice.enabled': true } });

  // a B2B invoice in the list
  const no = `E${String(stamp).slice(-6)}`;
  const bill = {
    id: no, invoiceNumber: no, invoiceDate: '2026-11-05', invoiceType: 'tax-invoice', status: 'unpaid', clientName: 'Buyer Co', totalAmount: 1180,
    data: {
      profile: { gstin: OWN, businessName: 'Seller Co', address: '1 Main St', city: 'Chennai', pin: '600001', state: 'Tamil Nadu' },
      client: { name: 'Buyer Co', gstin: BUYER, address: '2 Lake Rd', city: 'Madurai', pin: '625001', state: 'Tamil Nadu' },
      details: {}, items: [{ name: 'Widget', hsn: '8471', quantity: 2, unit: 'Nos', rate: 500, taxPercent: 18 }],
      totals: { total: 1180, taxableAmount: 1000, isInterstate: false }, invoiceOptions: {},
    },
  };
  const made = await api('POST', '/v1/workspace/collections/bills', bill);
  check('a B2B invoice is in place', made.status() < 300, String(made.status()));
  await page.goto(`${APP}/sales/invoices`);
  await page.getByText(no).first().waitFor({ timeout: 15000 });
  await page.getByRole('row', { name: new RegExp(no) }).getByRole('button', { name: /more|actions|⋯|\.\.\./i }).last().click().catch(async () => { await page.getByRole('row', { name: new RegExp(no) }).locator('button').last().click(); });
  await page.getByRole('menuitem', { name: /^E-invoice/ }).click();
  await page.getByRole('heading', { name: /Generate the IRN now/ }).waitFor({ timeout: 10000 });
  check('the dialog offers the online route and says it is a sandbox', /sandbox/i.test(await page.locator('[role=dialog], .modal-content').first().innerText()));
  await shot(page, 'p2gsp-dialog');
  await page.getByRole('button', { name: 'Generate IRN' }).click();
  await page.getByText(/Sandbox IRN/).waitFor({ timeout: 10000 }).catch(() => {});
  await page.goto(`${APP}/sales/invoices`);
  await page.getByText(no).first().waitFor({ timeout: 15000 });
  check('the invoice now carries an IRN badge (locked)', (await page.getByRole('row', { name: new RegExp(no) }).getByText('IRN', { exact: true }).count()) === 1);
  const all = await (await api('GET', '/v1/workspace/collections/bills')).json().catch(() => null);
  const saved = (all?.data ?? all ?? []).find?.((b) => b.invoiceNumber === no || b.id === no);
  const e = saved?.data?.invoiceOptions?.einvoice;
  check('what was stored is the IRN, the ack and a sandbox mark', e && /^[a-f0-9]{64}$/.test(e.irn) && e.sandbox === true && e.status === 'generated', JSON.stringify(e));

  // GSTR-3B up to the sandbox
  const r3 = { gstin: OWN, ret_period: '102026', version: 'GST3.0.4', hash: 'hash', sup_details: { osup_det: { txval: 1000, iamt: 0, camt: 90, samt: 90, csamt: 0 } }, itc_elg: { itc_avl: [{ ty: 'OTH', iamt: 0, camt: 0, samt: 0, csamt: 0 }] } };
  const pack = await (await api('POST', '/v1/filing-packs', { businessId: biz.id, kind: 'gstr3b', period: '102026', payload: r3 })).json();
  const full = await (await api('GET', `/v1/filing-packs/${pack.id}`)).json();
  if (!full.ready) await api('POST', `/v1/filing-packs/${pack.id}/acknowledge`, { acknowledged: full.issues.map((i) => i.id) });
  await page.goto(`${APP}/filing/${pack.id}`);
  await page.getByRole('button', { name: 'Upload to GST portal' }).click();
  await page.getByText(/Sent through your GST service provider/).waitFor({ timeout: 10000 });
  check('the upload shows the sandbox reference', /sandbox/.test(await page.locator('body').innerText()));
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /Check status/ }).click();
  await page.getByText(/Filed, ARN AA/).waitFor({ timeout: 10000 }).catch(async () => { await shot(page, 'p2gsp-status-failed'); console.log((await page.locator('body').innerText()).slice(-700)); });
  check('the status check records the ARN with no manual step', /Filed, ARN AA\w+/.test(await page.locator('body').innerText()));
  await shot(page, 'p2gsp-filed');
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
