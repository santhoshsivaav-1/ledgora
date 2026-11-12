// P11-S2 browser check: jspdf/html2canvas no longer load with the app, and Download still makes a PDF from the real
// editor. Same setup as billing-e2e.mjs (the API serving the built app, dev outbox on). It creates a throwaway account.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { firefox } = require('playwright');
const APP = process.env.E2E_APP_URL || 'http://localhost:4000';
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };
const outbox = async () => (await (await fetch(`${APP}/v1/dev/outbox`)).json()).data;
async function waitForMail(match) {
  for (let i = 0; i < 50; i++) {
    const found = (await outbox()).find(match);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the e-mail never arrived');
}

const browser = await firefox.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
const scripts = [];
page.on('request', (r) => r.resourceType() === 'script' && scripts.push(r.url()));
const email = `pdf${Date.now()}@example.com`;
await page.goto(APP);
await page.getByRole('tab', { name: 'Create account' }).click();
await page.getByLabel('Your name').fill('Pdf Check');
await page.getByLabel('E-mail').fill(email);
await page.getByLabel(/Password/).fill('correct-horse-9');
await page.getByRole('button', { name: 'Create account' }).click();
await page.getByRole('heading', { name: 'Check your e-mail' }).waitFor();
const mail = await waitForMail((m) => m.to === email && /Confirm/.test(m.subject));
await page.goto(/https?:\/\/\S+/.exec(mail.text)[0]);
await page.getByLabel('Business name').fill('Pdf Shop');
await page.getByLabel('State').selectOption('Tamil Nadu');
await page.getByRole('button', { name: 'Save and continue' }).click();
await page.locator('.account-bar').waitFor({ timeout: 15000 });
await page.getByRole('button', { name: /skip setup/i }).first().click({ timeout: 8000 }).catch(() => {});

await page.goto(`${APP}/invoices/new`);
await page.getByPlaceholder('Type client name to search or add new').fill('Acme Traders');
await page.getByPlaceholder('Item', { exact: true }).fill('Notebook A4');
const nums = page.locator('input[type=number]');
await nums.nth(0).fill('2');
await nums.nth(1).fill('100');
await page.waitForTimeout(800);
const pdfChunk = (u) => /\/assets\/pdf-[^/]+\.js$/.test(u);
check('the editor opened without loading the pdf chunk', !scripts.some(pdfChunk), scripts.filter(pdfChunk).join());
const download = page.waitForEvent('download', { timeout: 30000 });
await page.getByRole('button', { name: /^Download$/ }).click();
const d = await download.catch((e) => (check('Download produced a file', false, e.message), null));
if (d) {
  const p = await d.path();
  const head = p ? (await import('node:fs')).readFileSync(p).subarray(0, 5).toString() : '';
  check('Download produced a PDF file', head === '%PDF-', `${d.suggestedFilename()} starts with ${JSON.stringify(head)}`);
  check('the pdf chunk loaded on the click', scripts.some(pdfChunk));
}
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
