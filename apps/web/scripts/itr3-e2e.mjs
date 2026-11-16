// Browser test of R2.5 / R4.1: a trader's books, the fixed-asset register, and the ITR-3 built from them. The owner fills the
// taxpayer details and the business details, adds an asset, reads the depreciation, posts it to the books, reads the books
// (profit and loss, balance sheet), builds the ITR-3 file, saves it as a pack. Creates an account on the servers it talks to
// (local development servers only): API on :4000, web dev server on :5173.
//   node scripts/itr3-e2e.mjs [screenshot-folder]
import { createRequire } from 'node:module';
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
  await signUpAndSetUp(page, { app: APP, name: 'Itr Three', email: `itr3${stamp}@example.com`, password: 'correct-horse-9', business: `Itr3 Shop ${stamp}` });

  // ---- the books, through the API the screens use ---------------------------------------------------------------
  const api = (method, url, body) => page.request.fetch(`${APP}${url}`, { method, ...(body ? { data: body } : {}) });
  const biz = (await (await api('GET', '/v1/businesses')).json()).data[0];
  await api('POST', '/v1/accounting/backfill', { businessId: biz.id, dryRun: false });
  const bill = (id, date, taxable) => ({
    id, invoiceNumber: id, invoiceDate: date, invoiceType: 'tax-invoice', status: 'paid', clientName: 'Asha',
    totalAmount: taxable * 1.18,
    data: { totals: { total: taxable * 1.18, cgst: taxable * 0.09, sgst: taxable * 0.09, igst: 0, cess: 0, roundOff: 0 }, items: [] },
  });
  await api('POST', '/v1/workspace/collections/bills', bill('INV-1', '2025-09-10', 1000000));
  await api('POST', '/v1/workspace/collections/purchases', { docType: 'bill', date: '2025-08-02', invoiceNumber: 'P-1', taxableAmount: 600000, totalTax: 108000, totalAmount: 708000, interstate: false, items: [{ name: 'Goods', quantity: 1, rate: 600000, taxPercent: 18 }] });
  await api('POST', '/v1/workspace/collections/expenses', { date: '2025-10-08', amount: 120000, gstAmount: 0, paymentMode: 'cash', category: 'Rent' });
  await api('POST', '/v1/accounts', { businessId: biz.id, name: 'Computers', group: 'Fixed assets', opening: { amount: 60000, side: 'Dr', date: '2025-06-01' } });

  // ---- the fixed-asset register ----------------------------------------------------------------------------------
  await page.goto(`${APP}/fixed-assets`);
  await page.getByRole('tab', { name: 'Register' }).waitFor({ timeout: 15000 });
  check('the Fixed Assets screen opens with three steps', (await page.getByRole('tab').count()) === 3);
  await page.getByRole('button', { name: 'Add an asset' }).click();
  await page.getByLabel(/^Asset name/).fill('Laptop');
  await page.getByLabel('Income-tax block').selectOption('PM40');
  await page.getByLabel(/^Cost/).fill('60000');
  await page.getByLabel(/^Put to use on/).fill('2025-06-01');
  await page.getByRole('button', { name: 'Save asset' }).click();
  await page.getByText('Asset saved').waitFor({ timeout: 10000 });
  await page.getByRole('cell', { name: 'Laptop' }).waitFor({ timeout: 10000 });
  check('the asset is listed as in use', (await page.locator('tr', { hasText: 'Laptop' }).innerText()).includes('In use'));
  await shot(page, 'assets-register');

  await page.getByRole('tab', { name: 'Depreciation' }).click();
  await page.getByRole('heading', { name: /Income tax \(for the return\)/ }).waitFor({ timeout: 15000 });
  await page.locator('.dashboard-container').getByLabel('Financial year').selectOption('2025-26');
  await page.getByText('PM40 · 40%').waitFor({ timeout: 15000 });
  const dep = await page.locator('body').innerText();
  check('tax depreciation is 40% of the laptop: ₹24,000, closing ₹36,000', dep.includes('24,000') && dep.includes('36,000'), dep.slice(-500));
  check('book depreciation is ₹15,825 (304 days, straight line)', dep.includes('15,825'));
  await shot(page, 'assets-depreciation');
  await page.getByRole('button', { name: /Post .* to the books/ }).click();
  await page.getByText(/Posted JV-\d+/).waitFor({ timeout: 10000 });
  check('the depreciation is posted to the books as a journal', true);

  // ---- ITR-3: taxpayer --------------------------------------------------------------------------------------------
  await page.goto(`${APP}/itr-3`);
  await page.getByRole('tab', { name: 'Taxpayer' }).waitFor({ timeout: 15000 });
  check('the ITR-3 screen opens with its six steps', (await page.getByRole('tab').count()) === 6);
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
  await page.getByLabel('IFSC').fill('HDFC0000123');
  await page.getByLabel('Bank name').fill('HDFC Bank');
  await page.getByLabel('Account number').fill('50100123456789');
  await page.getByRole('button', { name: 'Save taxpayer details' }).click();
  await page.getByText('Taxpayer details saved').waitFor({ timeout: 10000 });
  check('the taxpayer details save', true);

  // ---- ITR-3: business and return ---------------------------------------------------------------------------------
  await page.getByRole('tab', { name: 'Business & return' }).click();
  await page.getByLabel(/^Business name/).fill('Kumar Stores');
  await page.getByLabel(/^Nature of business/).selectOption('09001');
  await page.getByLabel('Cash receipts, % of the total').fill('10');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Saved', { exact: true }).waitFor({ timeout: 10000 });
  check('the business details save', true);
  await page.reload();
  await page.getByRole('tab', { name: 'Business & return' }).click();
  check('they come back after a reload', (await page.getByLabel(/^Business name/).inputValue()) === 'Kumar Stores');

  // ---- ITR-3: the books ----------------------------------------------------------------------------------------
  await page.getByRole('tab', { name: 'Books' }).click();
  await page.getByText('Trading and profit and loss account').waitFor({ timeout: 15000 });
  const books = await page.locator('body').innerText();
  check('the books show sales of ₹10,00,000 and purchases of ₹6,00,000', books.includes('10,00,000') && books.includes('6,00,000'));
  check('the balance sheet balances', books.includes('balanced') && !books.includes('does not balance'));
  check('depreciation posted to the books is in the profit and loss account', books.includes('15,825'));
  await shot(page, 'itr3-books');

  // ---- build and save -------------------------------------------------------------------------------------------
  await page.getByRole('tab', { name: 'Build the file' }).click();
  await page.getByLabel('Planned filing date').fill('2026-11-16');
  await page.getByRole('button', { name: 'Build the ITR-3 file' }).click();
  await page.getByText(/Total income|error/).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  if (!(await page.getByText('Total income').count())) console.log((await page.locator('section[aria-label="Build the file"]').innerText()).slice(0, 1500));
  await page.getByText('Total income').waitFor({ timeout: 5000 });
  const body = await page.locator('body').innerText();
  // Profit 2,80,000 - 15,825 (books depreciation) = 2,64,175; business income adds the books' 15,825 back and takes the tax 24,000.
  check('profit before tax is ₹2,64,175 and business income ₹2,56,000', body.includes('2,64,175') && body.includes('2,56,000'), body.slice(-700));
  await shot(page, 'itr3-build');
  await page.getByRole('button', { name: 'Save as a pack for review' }).click();
  await page.waitForURL(/\/filing\/[0-9a-f-]{36}/, { timeout: 15000 });
  check('saving opens the pack', true);
  check('the pack is an ITR-3', /ITR-3/.test(await page.locator('body').innerText()));
  const reg = await (await page.request.get(`${APP}/v1/filing-packs?kind=itr3`)).json();
  check('the pack is in the list as ITR-3', reg.data?.length === 1 && reg.data[0].kind === 'itr3', JSON.stringify(reg).slice(0, 200));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
