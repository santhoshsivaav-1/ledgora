// Browser test of file-ready returns (docs/FILE_READY_PLAN.md, Phase 1): the owner saves a GSTR-1 pack, sees it in the
// Return Register, downloads the file and sends it to a CA; the CA accepts the invitation, finds it on the CA
// Dashboard, opens the client and approves it; the owner records the ARN. Creates accounts on the servers it talks to
// (run it against local development servers only): API on :4000, web dev server on :5173.
//   node scripts/filing-e2e.mjs [screenshot-folder]
import { createRequire } from 'node:module';
import { signUpAndSetUp } from './e2eSignup.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { firefox } = require('playwright');
const { GSTIN_CHARS } = await import('../../../packages/tax-engine/src/gstin.ts').catch(() => ({ GSTIN_CHARS: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ' }));

const OUT = process.argv[2] || '';
const APP = process.env.E2E_APP_URL || 'http://localhost:5173';
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };
const shot = (page, n) => (OUT ? page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }) : Promise.resolve());
const password = 'correct-horse-9';
const OWN = '33ABCDE1234F1Z7'; // what signUpAndSetUp enters
const gstin = (first14) => {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const p = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return first14 + GSTIN_CHARS[(36 - (sum % 36)) % 36];
};
const BUYER = gstin('33AABCU9603R1Z');
const r1 = {
  gstin: OWN, fp: '102026', version: 'GST3.0.4', hash: 'hash',
  b2b: [{ ctin: BUYER, inv: [{ inum: 'INV/001', idt: '05-10-2026', val: 11800, pos: '33', inv_typ: 'R', itms: [{ num: 1, itm_det: { rt: 18, txval: 10000, camt: 900, samt: 900, csamt: 0 } }] }] }],
  hsn: { data: [{ num: 1, hsn_sc: '8471', txval: 10000 }] },
};

const browser = await firefox.launch();
try {
  const stamp = Date.now();
  // ---- the owner -----------------------------------------------------------------------------------------------
  const oc = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block', acceptDownloads: true });
  const owner = await oc.newPage();
  await signUpAndSetUp(owner, { app: APP, name: 'Owner Person', email: `fo${stamp}@example.com`, password, business: `Filing Shop ${stamp}` });
  const biz = (await (await owner.request.get(`${APP}/v1/businesses`)).json()).data[0];
  check('the business has the GSTIN from setup', biz.gstin === OWN, biz.gstin);

  await owner.goto(`${APP}/gst-returns/gstr1`);
  await owner.getByRole('link', { name: 'Return Register' }).waitFor({ timeout: 15000 });
  check('GST Returns links to the Return Register', true);
  check('GSTR-1 has a "Save filing pack" button', await owner.getByRole('button', { name: 'Save filing pack' }).isVisible());

  // The same request the button sends, with a known file (the test account has no October invoices).
  const saved = await owner.request.post(`${APP}/v1/filing-packs`, { data: { businessId: biz.id, kind: 'gstr1', period: '102026', payload: r1 } });
  const pack = await saved.json();
  check('the server saves and checks the pack', saved.status() === 201 && pack.status === 'ready', JSON.stringify(pack).slice(0, 200));

  await owner.goto(`${APP}/filing`);
  await owner.getByRole('heading', { name: 'Return Register' }).waitFor({ timeout: 15000 });
  const row = owner.locator('tr', { hasText: 'GSTR-1 (Oct 2026)' });
  check('the register lists October GSTR-1 as ready', /Ready to file/.test(await row.innerText()), await row.innerText());
  check('past returns with nothing filed show as overdue', (await owner.locator('tr', { hasText: 'Overdue' }).count()) > 0);
  await shot(owner, 'filing-register');
  check('the register offers to prepare GSTR-9 and GSTR-9C for the year', (await owner.getByRole('button', { name: /^Prepare GSTR-9 \(FY/ }).isVisible()) && (await owner.getByRole('button', { name: 'Prepare GSTR-9C' }).isVisible()));
  check('GSTR-1 and GSTR-3B rows can be built on the server from the books', (await owner.getByTitle('Build it from your books on the server').count()) > 0);
  // R1.5: the database wrote the pack into the edit log; the screen shows it and offers the auditor's CSV.
  await owner.goto(`${APP}/utilities/edit-log`);
  await owner.getByRole('heading', { name: 'Edit Log' }).waitFor({ timeout: 15000 });
  await owner.locator('td', { hasText: 'Filing pack' }).first().waitFor({ timeout: 15000 });
  check('the edit log lists the new filing pack, created by the owner', /Filing pack[\s\S]*Created[\s\S]*Owner Person/.test(await owner.locator('table').innerText()));
  check('the edit log offers a CSV for the auditor', await owner.getByRole('link', { name: 'Export CSV for the auditor' }).isVisible());
  await shot(owner, 'edit-log');
  await owner.goto(`${APP}/filing`);
  await owner.getByRole('heading', { name: 'Return Register' }).waitFor({ timeout: 15000 });

  check('a business owner who is nobody’s CA has no CA Dashboard entry', (await owner.locator('a[href="/ca"], nav button:has-text("CA Dashboard"), aside button:has-text("CA Dashboard")').count()) === 0);
  await row.getByRole('link', { name: 'Open' }).click();
  await owner.getByRole('heading', { name: 'Is it ready to upload?' }).waitFor({ timeout: 15000 });
  check('the pack screen shows the checks and the fingerprint', (await owner.locator('body').innerText()).includes(pack.sha256));
  const [dl] = await Promise.all([owner.waitForEvent('download'), owner.getByRole('button', { name: 'Download file' }).click()]);
  check('download gives the portal file', /^GSTR1_33ABCDE1234F1Z7_102026_v1\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  await shot(owner, 'filing-pack-ready');

  // ---- invite the CA and send the pack for review ----------------------------------------------------------------
  const caEmail = `fca${stamp}@example.com`;
  const inv = await (await owner.request.post(`${APP}/v1/invitations`, { data: { email: caEmail, role: 'ca', businessIds: [] } })).json();
  check('the CA is invited', !!inv.acceptUrl, JSON.stringify(inv).slice(0, 200));
  await owner.getByRole('button', { name: 'Send to CA for review' }).click();
  await owner.getByRole('button', { name: 'Send for review' }).click();
  await owner.getByText('With CA', { exact: true }).first().waitFor({ timeout: 10000 });
  check('the pack is with the CA', true);

  // ---- the CA ----------------------------------------------------------------------------------------------------
  const cc = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block' });
  const ca = await cc.newPage();
  await ca.goto(`${APP}/login`);
  await ca.getByRole('tab', { name: 'Create account' }).click();
  await ca.getByLabel('Your name').fill('CA Person');
  await ca.getByLabel('E-mail').fill(caEmail);
  await ca.getByLabel(/Password/).fill(password);
  await ca.getByRole('button', { name: 'Create account' }).click();
  await ca.getByRole('heading', { name: 'Choose how to start' }).waitFor({ timeout: 15000 });
  await ca.goto(inv.acceptUrl.replace(/^https?:\/\/[^/]+/, APP));
  await ca.getByRole('button', { name: 'Accept and join' }).click();
  await ca.waitForURL((u) => u.pathname === '/', { timeout: 15000 });

  await ca.goto(`${APP}/ca`);
  await ca.getByRole('heading', { name: 'CA Dashboard' }).waitFor({ timeout: 15000 });
  // Either shell: the new one links to /ca, the classic sidebar has a button.
  const caEntry = (p) => p.locator('a[href="/ca"], nav button:has-text("CA Dashboard"), aside button:has-text("CA Dashboard")').count();
  check('the menu has a CA Dashboard entry for a CA', (await caEntry(ca)) > 0);
  const review = ca.getByRole('button', { name: 'Review GSTR-1 · Oct 2026' });
  await review.waitFor({ timeout: 15000 });
  check('the CA sees the client and what waits for review', /1 waiting for your review/.test(await ca.locator('body').innerText()));
  await shot(ca, 'filing-ca-dashboard');
  await review.click();
  await ca.waitForURL((u) => u.pathname === `/filing/${pack.id}`, { timeout: 20000 });
  await ca.getByRole('button', { name: 'Approve' }).waitFor({ timeout: 15000 });
  check('a pack in review offers the CA Approve and Send back, not Send for review', !(await ca.getByRole('button', { name: 'Send to CA for review' }).isVisible()));
  await ca.getByRole('button', { name: 'Approve' }).click();
  await ca.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await ca.getByText('Approved by CA', { exact: true }).first().waitFor({ timeout: 10000 });
  check('the CA approves the exact file', true);
  await shot(ca, 'filing-ca-approved');

  // ---- the owner records the ARN ---------------------------------------------------------------------------------
  await owner.reload();
  await owner.getByRole('button', { name: 'Record as filed' }).click();
  await owner.getByLabel(/ARN/).fill('AA331126123456Z');
  await owner.getByRole('dialog').getByRole('button', { name: 'Record' }).click();
  await owner.getByText('Filed', { exact: true }).first().waitFor({ timeout: 10000 });
  const body = await owner.locator('body').innerText();
  check('filed with the ARN, and the timeline shows every step', /AA331126123456Z/.test(body) && /With CA/.test(body) && /Approved by CA/.test(body));
  await shot(owner, 'filing-filed');
  await owner.goto(`${APP}/filing`);
  const after = owner.locator('tr', { hasText: 'GSTR-1 (Oct 2026)' });
  await after.waitFor({ timeout: 15000 });
  check('the register shows the ARN', /AA331126123456Z/.test(await after.innerText()));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
