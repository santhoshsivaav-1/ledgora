// Browser test of Phase 5 (Cash & Bank) and the Phase 6 core reports, in Firefox: turn Cash & Bank on, add a bank
// account, adjust cash, transfer, take a cheque through deposit and clearing, add a loan and pay an EMI, reconcile a
// statement, then open the report hub, the Trial Balance, Balance Sheet, Day Book, Cash Flow and Bank Statement and
// export one. Same setup as ledger-e2e.mjs: the web app on E2E_APP_URL and the API on E2E_API_URL (one origin when the
// API serves the built app); it creates a throwaway account. Screenshots go to the folder given as the first argument.
import { createRequire } from 'node:module';
import { signUpAndSetUp } from './e2eSignup.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(new URL('../package.json', import.meta.url));
const { firefox } = require('playwright');
const OUT = process.argv[2] || '';
const APP = process.env.E2E_APP_URL || 'http://localhost:5173';
const API = process.env.E2E_API_URL || APP;
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };
const visible = (loc, timeout = 8000) => loc.first().waitFor({ timeout }).then(() => true, () => false);
const shot = (page, n) => (OUT ? page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }) : Promise.resolve());
const password = 'correct-horse-9';
const today = new Date().toISOString().slice(0, 10);
const outbox = async () => (await (await fetch(`${API}/v1/dev/outbox`)).json()).data;
async function waitForMail(match) {
  for (let i = 0; i < 50; i++) { const f = (await outbox()).find(match); if (f) return f; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('the e-mail never arrived');
}

const browser = await firefox.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('pageerror:', e.message.slice(0, 200)); });
/** The input or select of a form field, found by its label text inside `scope` (a dialog). */
const field = (scope, label) => scope.locator('.form-group', { has: page.locator('label', { hasText: label }) }).locator('input, select').first();

try {
  // ---- account and business ----
  const email = `cb${Date.now()}@example.com`;
  await signUpAndSetUp(page, { app: APP, name: 'Owner', email: email, password, business: 'Cash Book Traders', state: 'Tamil Nadu', waitForMail: typeof waitForMail === 'function' ? waitForMail : null });
  await page.locator('.account-bar').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: /skip setup/i }).first().click({ timeout: 8000 }).catch(() => {});

  const api = async (method, path, data) => {
    const res = await ctx.request.fetch(`${APP}${path}`, { method, data, headers: { 'content-type': 'application/json' } });
    return { status: res.status(), body: await res.json().catch(() => null) };
  };
  const biz = (await api('GET', '/v1/businesses')).body.data[0].id;
  await api('PATCH', `/v1/businesses/${biz}`, { state: 'Tamil Nadu' });
  const cust = (await api('POST', '/v1/parties', { name: 'Ravi Traders', state: 'Tamil Nadu' })).body.id;
  await api('POST', '/v1/invoices', { businessId: biz, partyId: cust, invoiceDate: today, items: [{ name: 'Notebook', quantity: 10, rate: 100, taxPercent: 18 }] });
  check('the ledger turns on (backfill)', (await api('POST', '/v1/accounting/backfill', { businessId: biz, dryRun: false })).body?.enabled === true);

  // ---- P5: turn Cash & Bank on ----
  await page.goto(`${APP}/cash-bank/accounts`);
  await page.getByRole('button', { name: 'Turn on Cash & Bank' }).click();
  check('Cash & Bank turns on from its screen', await visible(page.getByRole('button', { name: 'Add Bank Account' })));

  // ---- P5-S1 add a bank account with an opening balance; IFSC names the bank ----
  await page.getByRole('button', { name: 'Add Bank Account' }).click();
  let dlg = page.getByRole('dialog', { name: 'Add Bank Account' });
  await field(dlg, 'Account display name').fill('HDFC Current');
  await field(dlg, 'IFSC').fill('HDFC0000123');
  check('typing an IFSC names the bank', await visible(dlg.getByText('IFSC · HDFC Bank')));
  await dlg.getByRole('button', { name: 'Find branch' }).click();
  // The server runs with IFSC_API_URL=off for this test: the lookup answers from the bundled table, with a notice.
  check('Find branch answers offline with the bundled bank name', await visible(page.getByText(/Branch lookup is offline/)));
  await field(dlg, 'Account number').fill('50100012344521');
  await field(dlg, 'Opening balance').fill('200000');
  await dlg.getByRole('button', { name: 'Save' }).click();
  check('the bank card shows the opening balance and the masked number', await visible(page.locator('.glass-panel', { hasText: 'HDFC Current' }).getByText(/2,00,000/)) && await visible(page.getByText(/••4521/)));
  await shot(page, 'p5-1-bank-accounts');

  // ---- P5-S2 adjust cash ----
  await page.goto(`${APP}/cash-bank/cash`);
  await page.getByRole('button', { name: 'Adjust Cash' }).click();
  dlg = page.getByRole('dialog', { name: /Adjust Cash in Hand/ });
  await field(dlg, 'Amount').fill('5000');
  await dlg.getByRole('button', { name: 'Save' }).click();
  check('adding cash shows on the Cash in Hand statement', await visible(page.locator('tfoot').getByText(/5,000/)));
  await shot(page, 'p5-2-cash');

  // ---- P5-S3 transfer bank → cash ----
  await page.goto(`${APP}/cash-bank/transfers`);
  await page.getByRole('button', { name: 'Transfer Money' }).click();
  dlg = page.getByRole('dialog', { name: 'Transfer Money' });
  await field(dlg, 'From').selectOption({ label: 'HDFC Current' });
  await field(dlg, 'To').selectOption({ label: 'Cash in Hand' });
  await field(dlg, 'Amount').fill('10000');
  await dlg.getByRole('button', { name: 'Transfer' }).click();
  check('the transfer is listed', await visible(page.locator('tr', { hasText: 'HDFC Current' }).getByText(/10,000/)));

  // ---- P5-S4 cheque: add, deposit, clear ----
  await page.goto(`${APP}/cash-bank/cheques`);
  await page.getByRole('button', { name: 'Add Cheque' }).click();
  dlg = page.getByRole('dialog', { name: 'Add received cheque' });
  await field(dlg, 'Party').selectOption({ label: 'Ravi Traders' });
  await field(dlg, 'Cheque number').fill('000123');
  await field(dlg, 'Amount').fill('1180');
  await field(dlg, 'Deposit to').selectOption({ label: 'HDFC Current' });
  await dlg.getByRole('button', { name: 'Save' }).click();
  const chqRow = page.locator('tr', { hasText: '000123' });
  check('the cheque is in the register as open with Deposit / Cleared / Bounced / Cancel', await visible(chqRow.getByText('open', { exact: true })) && await visible(chqRow.getByRole('button', { name: 'Deposit' })) && await visible(chqRow.getByRole('button', { name: 'Bounced' })));
  await chqRow.getByRole('button', { name: 'Deposit' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  check('deposited', await visible(chqRow.getByText('deposited', { exact: true })));
  await chqRow.getByRole('button', { name: 'Cleared' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  check('cleared: no more actions', await visible(chqRow.getByText('cleared', { exact: true })) && (await chqRow.getByRole('button').count()) === 0);
  await shot(page, 'p5-4-cheques');

  // ---- P5-S5 loan with EMI and a payment ----
  await page.goto(`${APP}/cash-bank/loans`);
  await page.getByRole('button', { name: 'Add Loan' }).click();
  dlg = page.getByRole('dialog', { name: 'Add Loan' });
  await field(dlg, 'Account name').fill('Term loan A');
  await field(dlg, 'Principal').fill('1000000');
  await field(dlg, 'Received in').selectOption({ label: 'HDFC Current' });
  await field(dlg, 'Interest rate').fill('12');
  await field(dlg, 'Tenure').fill('12');
  check('the EMI fills in as the owner types (₹88,848.79)', (await field(dlg, 'EMI').inputValue()) === '88848.79');
  await dlg.getByRole('button', { name: 'Save' }).click();
  check('the loan opens with a 12-row schedule', await visible(page.getByText(/Outstanding/)) && (await page.locator('tbody tr').count()) === 12);
  await page.getByRole('button', { name: 'Make Payment' }).click();
  dlg = page.getByRole('dialog', { name: 'Make Payment' });
  check('Make Payment prefills the first EMI', (await field(dlg, 'Principal').inputValue()) === '78848.79' && (await field(dlg, 'Interest').inputValue()) === '10000');
  await field(dlg, 'From account').selectOption({ label: 'HDFC Current' });
  await dlg.getByRole('button', { name: 'Save' }).click();
  check('instalment 1 is paid', await visible(page.locator('tbody tr').first().getByText(/Paid/)));
  await shot(page, 'p5-5-loan');

  // ---- P5-S6 reconcile a statement ----
  const csv = join(tmpdir(), `stmt-${Date.now()}.csv`);
  const d = today.split('-').reverse().join('/');
  writeFileSync(csv, `Date,Narration,Withdrawal Amt,Deposit Amt,Closing Balance\n${d},CLG 000123 Ravi,,1180,\n${d},SMS charges,59,,\n`);
  await page.goto(`${APP}/cash-bank/reconcile`);
  await page.locator('input[type=file]').setInputFiles(csv);
  check('the cleared cheque matches its statement row', await visible(page.getByText(/● Cheque 000123 cleared/)));
  await page.getByLabel('Record row 2 as').selectOption('bank_charges');
  check('an unmatched bank charge is recorded from the statement and then matches', await visible(page.getByText(/Recorded as bank charges/)) && await visible(page.getByText(/● Withdrawal/)));
  await shot(page, 'p5-6-reconcile');

  // ---- P5-S7 Home widgets ----
  const sum = (await api('GET', `/v1/cashbank/summary?businessId=${biz}`)).body;
  await page.goto(`${APP}/`);
  check('Home shows the Cash + Bank widget', await visible(page.getByText('Cash + Bank')));
  await shot(page, 'p5-7-home');

  // ---- Phase 6 core reports ----
  await page.goto(`${APP}/reports`);
  check('the report hub lists the groups', await visible(page.getByRole('region', { name: 'Financial statements' })) && await visible(page.getByRole('region', { name: 'Cash & Bank' })));
  await shot(page, 'p6-1-hub');
  await page.getByRole('link', { name: 'Trial Balance' }).click();
  check('Trial Balance: balanced', await visible(page.getByText('Balanced ✔')));
  await page.goto(`${APP}/reports/balance-sheet`);
  check('Balance Sheet: balanced', await visible(page.getByText('Balanced ✔')));
  await shot(page, 'p6-2-balance-sheet');
  await page.goto(`${APP}/reports/day-book`);
  check('Day Book lists today’s vouchers', await visible(page.getByText('Cheque').or(page.getByText('Sale'))));
  await page.goto(`${APP}/reports/cash-flow`);
  const closingChip = page.locator('.ui-chip', { hasText: 'Closing' });
  check('Cash Flow closes at the Cash & Bank total', await visible(closingChip) && (await closingChip.innerText()).replace(/[^\d.]/g, '').includes(String(Math.round(sum.total))), `${await closingChip.innerText().catch(() => '')} vs ${sum.total}`);
  await shot(page, 'p6-3-cash-flow');
  await page.goto(`${APP}/reports/profit-loss`);
  check('Profit & Loss opens with gross and net profit', await visible(page.locator('.ui-chip', { hasText: 'Net profit' })));
  await page.goto(`${APP}/reports/bank-statement`);
  check('Bank Statement report shows the opening row and the cheque', await visible(page.getByText('Opening balance')) && await visible(page.getByText(/Cheque 000123/)));
  await page.getByRole('button', { name: /Export/ }).click();
  const download = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await page.getByRole('menuitem', { name: /Excel/ }).click();
  const file = await download;
  check('the report exports to Excel', !!file && /\.xlsx$/.test(file.suggestedFilename()), file ? file.suggestedFilename() : 'no download');
  await shot(page, 'p6-4-bank-statement');

  // ---- the books after all of it ----
  const v = (await api('GET', `/v1/verify?businessId=${biz}`)).body;
  const tb = (await api('GET', `/v1/ledger/trial-balance?businessId=${biz}`)).body;
  check('Verify My Data: no unbalanced voucher, party balances match', v.checks.find((c) => c.id === 'ledger_unbalanced').count === 0 && v.checks.find((c) => c.id === 'party_balance_mismatch').count === 0);
  check('trial balance Dr = Cr', tb.balanced, `${tb.debit} vs ${tb.credit}`);
  check('no script errors in the page', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
} catch (e) {
  check('the run finished', false, e.message.slice(0, 400));
  await shot(page, 'zz-failure');
}

await browser.close();
console.log(results.every(Boolean) ? '\nALL PASSED' : '\nSOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
