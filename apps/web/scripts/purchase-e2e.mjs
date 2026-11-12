// Browser test of the Vyapar parity Phase 3 money flow (docs/VYAPAR_IMPLEMENTATION_PHASES.md, "Phase 3 test plan",
// E2E): purchase order with an advance → part delivery on a purchase bill → debit note → Payment Out with TDS → the
// GSTR-3B Table 4 numbers, the supplier statement and the TDS register. Same setup as billing-e2e.mjs (read
// auth-e2e.mjs's header): the web app on E2E_APP_URL and the API on E2E_API_URL; it creates a throwaway account.
import { createRequire } from 'node:module';
import { signUpAndSetUp } from './e2eSignup.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { firefox } = require('playwright');
const OUT = process.argv[2] || '';
const APP = process.env.E2E_APP_URL || 'http://localhost:5173';
const API = process.env.E2E_API_URL || 'http://localhost:4000';
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };
// Waits for something to appear (data loads after the page does); false after 5 s.
const visible = (loc) => loc.waitFor({ timeout: 5000 }).then(() => true, () => false);
const shot = (page, n) => (OUT ? page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }) : Promise.resolve());
const password = 'correct-horse-9';
const outbox = async () => (await (await fetch(`${API}/v1/dev/outbox`)).json()).data;
async function waitForMail(match) {
  for (let i = 0; i < 50; i++) {
    const found = (await outbox()).find(match);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the e-mail never arrived');
}

const browser = await firefox.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 200)));
const email = `buy${Date.now()}@example.com`;
await signUpAndSetUp(page, { app: APP, name: 'Buyer', email: email, password, business: 'Buyer Traders', state: 'Tamil Nadu', waitForMail: typeof waitForMail === 'function' ? waitForMail : null });
await page.locator('.account-bar').waitFor({ timeout: 15000 });
await page.getByRole('button', { name: /skip setup/i }).first().click({ timeout: 8000 }).catch(() => {});

const docs = async (coll) => (await ctx.request.get(`${APP}/v1/workspace/collections/${coll}`)).json();
const purchaseDocs = async () => docs('purchases');

// ---- 1. purchase order with an advance (no stock, no GST) ----
await page.goto(`${APP}/purchases/orders`);
await page.getByRole('button', { name: 'Add Purchase Order' }).first().click();
let dlg = page.getByRole('dialog', { name: 'Purchase order' });
await dlg.locator('input').first().fill('Om Supplies');
await dlg.getByLabel('Item, line 1').fill('Pen');
await dlg.getByLabel('Qty, line 1').fill('100');
await dlg.getByLabel('Rate, line 1').fill('10');
await dlg.locator('input[type=number]').first().fill('300');
await dlg.getByRole('button', { name: 'Save' }).click();
await page.getByText('Purchase order PO').first().waitFor();
const order = (await purchaseDocs()).find((d) => d.docType === 'order');
check('a purchase order is saved with its number, lines and advance', !!order && /^PO/.test(order.number) && order.items[0].quantity === 100 && order.advance === 300, JSON.stringify(order));
await shot(page, 'p3-1-orders');

// ---- 2. receive 60 of 100 on a purchase bill ----
await page.getByRole('button', { name: /Receive goods for/ }).click();
await page.getByText(/receiving PO/).waitFor();
const form = page.locator('.modal-content');
const qty = form.locator('input[type=number]').first();
check('Receive goods opens Add Purchase with the pending quantity', (await qty.inputValue()) === '100');
await qty.fill('60');
await form.getByPlaceholder('Supplier invoice no.').fill('OM-221');
await form.getByRole('button', { name: /^Save$/ }).click();
await page.getByText('Purchase Records').waitFor();
await page.waitForTimeout(800);
let bill = (await purchaseDocs()).find((d) => (d.docType || 'bill') === 'bill');
check('the bill receives 60 against the order, totals 708, and takes the 300 advance', bill?.poId === order.id && bill.totalAmount === 708 && bill.payments.some((p) => p.source === 'po_advance' && p.amount === 300) && bill.paymentStatus === 'Partial', JSON.stringify(bill).slice(0, 400));
await page.goto(`${APP}/purchases/orders`);
const orderRow = page.locator('tbody tr', { hasText: order.number });
const partial = await visible(orderRow.getByText('Partial', { exact: true }));
check('the order now shows Partial', partial, partial ? '' : `${await orderRow.innerText().catch(() => '?')} | order ${JSON.stringify(order.items)} | bill ${JSON.stringify(bill.items)}`);

// ---- 3. debit note for 10 pens, adjusted against the bill ----
await page.goto(`${APP}/purchases/returns`);
await page.getByRole('button', { name: 'Add Debit Note' }).first().click();
dlg = page.getByRole('dialog', { name: 'Debit note' });
await dlg.locator('input').first().fill('Om Supplies');
await dlg.locator('select').first().selectOption(bill.id);
check('picking the bill fills what is returnable (60)', (await dlg.getByLabel('Qty, line 1').inputValue()) === '60');
await dlg.getByLabel('Qty, line 1').fill('61');
check('returning more than was bought is refused', await dlg.getByRole('alert').isVisible());
await dlg.getByLabel('Qty, line 1').fill('10');
await dlg.getByRole('button', { name: 'Save' }).click();
await page.getByText(/Debit note DN/).first().waitFor();
await page.waitForTimeout(500);
const dn = (await purchaseDocs()).find((d) => d.docType === 'debit-note');
check('the debit note is 118 against the bill', dn?.totalAmount === 118 && dn.againstPurchaseId === bill.id, JSON.stringify(dn).slice(0, 300));
await shot(page, 'p3-2-debit-note');

// ---- 4. Payment Out of 280 with 10 TDS (194C) settles the remaining 290 ----
await page.goto(`${APP}/purchases/payment-out`);
await page.getByRole('button', { name: 'Add Payment Out' }).first().click();
dlg = page.getByRole('dialog', { name: 'Payment Out' });
await dlg.locator('input').first().fill('Om Supplies');
check('Payment Out lists the bill as pending 290', await visible(dlg.getByText('₹290.00').first()));
await dlg.locator('input[type=number]').nth(0).fill('280');
await dlg.locator('select').nth(1).selectOption('194C');
await dlg.locator('input[type=number]').nth(2).fill('10');
await dlg.getByRole('button', { name: 'Save' }).click();
await page.getByText(/Payment PAY/).first().waitFor();
await page.waitForTimeout(800);
bill = (await purchaseDocs()).find((d) => d.id === bill.id);
check('the bill is Paid (advance 300 + debit note 118 + 280 paid + 10 TDS = 708)', bill.paymentStatus === 'Paid', JSON.stringify(bill.payments));
const vouchers = (await docs('receipts')).filter((r) => r.direction === 'out');
check('the voucher is kept as a payment out, not a receipt', vouchers.length === 1 && vouchers[0].tdsSection === '194C');
await page.getByRole('button', { name: 'Show TDS register' }).click();
const tdsPanel = page.locator('.glass-panel', { hasText: 'TDS payable ·' }).first();
const tdsRow = tdsPanel.locator('tbody tr').first();
check('the TDS payable list shows 10 under 194C, with its due date and a Mark deposited button', await visible(tdsRow.getByText('₹10.00').first()) && /194C/.test(await tdsRow.innerText()) && /Due|\d{4}-\d{2}-\d{2}/.test(await tdsRow.innerText()) && await tdsRow.getByRole('button', { name: 'Mark deposited' }).isVisible() && await tdsPanel.locator('tfoot').getByText('₹10.00').first().isVisible());
await shot(page, 'p3-3-payment-out');

// ---- 5. supplier statement and GSTR-3B Table 4 ----
await page.goto(`${APP}/purchases`);
await page.getByRole('button', { name: 'Supplier statement' }).click();
check('the supplier statement closes at nothing to pay', await visible(page.getByRole('dialog', { name: 'Supplier statement' }).getByText(/₹0\.00 to pay/)));
await page.keyboard.press('Escape');
await page.goto(`${APP}/gst-returns/gstr3b`);
const t4 = page.locator('.glass-panel', { hasText: 'Table 4' });
await t4.waitFor();
const cells = async (label) => (await t4.locator('tr', { hasText: label }).locator('td').allInnerTexts()).slice(1);
const oth = await cells('All other ITC');
const rev = await cells('debit notes');
const net = await cells('Net ITC Available');
check('4(A) shows the bill credit 54 + 54', oth[1]?.includes('54.00') && oth[2]?.includes('54.00'), JSON.stringify(oth));
check('4(B)(2) reverses the debit note 9 + 9', rev[1]?.includes('9.00') && rev[2]?.includes('9.00'), JSON.stringify(rev));
check('net credit is 45 + 45', net[1]?.includes('45.00') && net[2]?.includes('45.00'), JSON.stringify(net));
check('the purchase order is not in the return', !(await t4.innerText()).includes('108'));
await shot(page, 'p3-4-gstr3b');

await browser.close();
console.log(results.every(Boolean) ? '\nALL PASSED' : '\nSOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
