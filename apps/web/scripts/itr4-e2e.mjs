// Browser test of R2 income tax: the owner fills the taxpayer details, the return's inputs, records a challan, reads an
// AIS file, builds the ITR-4 file, saves it as a pack and opens it in the Return Register flow. Creates an account on
// the servers it talks to (local development servers only): API on :4000, web dev server on :5173.
//   node scripts/itr4-e2e.mjs [screenshot-folder]
import { createRequire } from 'node:module';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
  const stamp = Date.now();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await signUpAndSetUp(page, { app: APP, name: 'Itr Person', email: `itr${stamp}@example.com`, password: 'correct-horse-9', business: `Itr Shop ${stamp}` });

  await page.goto(`${APP}/itr-4`);
  await page.getByRole('heading', { name: 'ITR-4 (Sugam)' }).waitFor({ timeout: 15000 });
  check('the ITR-4 screen opens with its five steps', (await page.getByRole('tab').count()) === 5);

  // ---- taxpayer ------------------------------------------------------------------------------------------------
  await page.getByLabel(/^PAN/).fill('ABCPK1234F');
  await page.getByLabel(/^Date of birth/).fill('1985-06-15');
  await page.getByLabel(/^Surname/).fill('Kumar');
  await page.getByLabel(/^Father/).fill('Suresh Kumar');
  await page.getByLabel('Place of signing').fill('Chennai');
  await page.getByLabel('Flat / door no.').fill('12');
  await page.getByLabel('Area / locality').fill('Adyar');
  await page.getByLabel('Town / city').fill('Chennai');
  await page.getByLabel('PIN code').fill('600020');
  await page.getByLabel('Mobile').fill('9876543210');
  await page.getByLabel('Email').fill('ravi@example.com');
  await page.getByLabel('Aadhaar').fill('987654321098');
  await page.getByLabel('IFSC').fill('HDFC0000123');
  await page.getByLabel('Bank name').fill('HDFC Bank');
  await page.getByLabel('Account number').fill('50100123456789');
  await shot(page, 'itr4-taxpayer');
  await page.getByRole('button', { name: 'Save taxpayer details' }).click();
  await page.getByText('Taxpayer details saved').waitFor({ timeout: 10000 });
  check('the taxpayer details save', true);
  await page.reload();
  await page.getByLabel(/^PAN/).waitFor({ timeout: 15000 });
  check('the account number comes back masked, never in full', (await page.locator('body').innerText()).includes('•••• 6789') && !(await page.locator('body').innerText()).includes('50100123456789'));
  check('Aadhaar comes back masked', (await page.locator('body').innerText()).includes('•••• •••• 1098'));

  // ---- the return ----------------------------------------------------------------------------------------------
  await page.getByRole('tab', { name: 'Return' }).click();
  await page.getByLabel('Scheme').selectOption('44ADA');
  await page.getByLabel('Business code').fill('16001');
  await page.getByLabel('Business name').fill('Kumar and Associates');
  await page.getByLabel('Receipts by bank / UPI').fill('4000000');
  await page.getByLabel('Receipts in cash').fill('0');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Saved', { exact: true }).waitFor({ timeout: 10000 });
  check('the return’s inputs save', true);

  // ---- challan + advance tax -----------------------------------------------------------------------------------
  await page.getByRole('tab', { name: 'Challans & advance tax' }).click();
  await page.getByRole('heading', { name: /Advance tax/ }).waitFor({ timeout: 15000 });
  await page.getByLabel('BSR code (7)').fill('0510308');
  await page.getByLabel('Date of deposit').fill('2026-03-14');
  await page.getByLabel('Challan serial no.').fill('12345');
  await page.getByLabel('Amount').fill('100000');
  await page.getByRole('button', { name: 'Add challan' }).click();
  await page.getByRole('cell', { name: '0510308' }).waitFor({ timeout: 10000 });
  check('the challan is listed as advance tax', (await page.locator('tr', { hasText: '0510308' }).innerText()).includes('Advance tax'));
  await shot(page, 'itr4-challans');

  // ---- AIS ----------------------------------------------------------------------------------------------------
  await page.getByRole('tab', { name: 'AIS / TIS' }).click();
  const dir = mkdtempSync(path.join(tmpdir(), 'ais-'));
  const f = path.join(dir, 'ais.csv');
  writeFileSync(f, 'Information Category,Information Source,TAN/PAN,Reported Value,Tax Deducted,Section\nInterest from savings bank,HDFC BANK,CHEH12345A,12500,0,\n');
  await page.getByLabel('AIS or TIS file').setInputFiles(f);
  await page.getByText(/rows understood/).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Save as AIS' }).click();
  await page.getByText('What differs').waitFor({ timeout: 10000 });
  check('AIS interest not in the return is reported', /savings/i.test(await page.locator('body').innerText()));
  await shot(page, 'itr4-ais');

  // ---- build and save -------------------------------------------------------------------------------------------
  await page.getByRole('tab', { name: 'Build the file' }).click();
  await page.getByLabel('Planned filing date').fill('2026-11-16');
  await page.getByRole('button', { name: 'Build the ITR-4 file' }).click();
  await page.getByText(/Total income|error/).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  if (!(await page.getByText('Total income').count())) console.log((await page.locator('section[aria-label="Build the file"]').innerText()).slice(0, 1200));
  await page.getByText('Total income').waitFor({ timeout: 5000 });
  const body = await page.locator('body').innerText();
  check('the computation shows ₹20,00,000 income and ₹2,08,000 tax', body.includes('20,00,000') && body.includes('2,08,000'), body.slice(-600));
  check('a late fee of ₹5,000 is shown for a return filed after 31 August', body.includes('5,000'));
  await shot(page, 'itr4-build');
  await page.getByRole('button', { name: 'Save as a pack for review' }).click();
  await page.waitForURL(/\/filing\/[0-9a-f-]{36}/, { timeout: 15000 });
  check('saving opens the pack', true);
  check('the pack is an ITR-4', /ITR-4/.test(await page.locator('body').innerText()));

  const reg = await (await page.request.get(`${APP}/v1/filing-packs?kind=itr4`)).json();
  check('the pack is in the list as ITR-4', reg.data?.length === 1 && reg.data[0].kind === 'itr4', JSON.stringify(reg).slice(0, 200));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
