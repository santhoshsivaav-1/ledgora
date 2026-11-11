// Vyapar parity Phase 5 on the web: the helpers behind the Cash & Bank screens (lib/data/cashbank.js) — cheque action
// buttons by status, the Add Loan form's EMI recompute, reading a bank statement for reconciliation.
import { describe, expect, it } from 'vitest';
import {
  cashbankRefLink,
  chequeButtons,
  ifscBank,
  loanFormEmi,
  refTypeLabel,
  statementClosing,
  statementRowsFromCsv,
} from '../src/lib/data/cashbank';

describe('cheque action buttons by status', () => {
  it('follow the actions the API allows, in order, with labels', () => {
    expect(chequeButtons({ actions: ['deposit', 'cancel'] }).map((b) => b.label)).toEqual(['Deposit', 'Cancel']);
    expect(chequeButtons({ actions: ['clear', 'bounce'] })).toEqual([
      { action: 'clear', label: 'Cleared', tone: 'primary' },
      { action: 'bounce', label: 'Bounced', tone: 'danger' },
    ]);
    expect(chequeButtons({ actions: [] })).toEqual([]);
    expect(chequeButtons(null)).toEqual([]);
  });
});

describe('Add Loan form: EMI recompute', () => {
  const form = { principal: '1000000', ratePct: '12', tenureMonths: '12', interestType: 'reducing', emi: '', emiEdited: false };
  it('is the formula figure while the owner has not typed one', () => {
    expect(loanFormEmi(form)).toBe(88848.79);
    expect(loanFormEmi({ ...form, interestType: 'flat', principal: '120000', ratePct: '10' })).toBe(11000);
    expect(loanFormEmi({ ...form, tenureMonths: '' })).toBe(0);
  });
  it('keeps a figure the owner typed', () => {
    expect(loanFormEmi({ ...form, emi: '90000', emiEdited: true })).toBe(90000);
  });
});

describe('reading a statement for reconciliation', () => {
  it('normalises dates, drops rows without a date or amount, finds the closing balance', () => {
    const csv = [
      'Date,Narration,Withdrawal Amt,Deposit Amt,Closing Balance',
      '01/11/2026,Opening Balance,,,235100',
      '03/11/2026,SMS charges,180,,234920',
      '06/11/2026,UPI/RCT-5/Ravi,,5000,239920',
    ].join('\n');
    const r = statementRowsFromCsv(csv);
    expect(r.skipped).toBe(1);
    expect(r.rows).toEqual([
      { date: '2026-11-03', description: 'SMS charges', debit: 180, credit: 0, balance: 234920 },
      { date: '2026-11-06', description: 'UPI/RCT-5/Ravi', debit: 0, credit: 5000, balance: 239920 },
    ]);
    expect(statementClosing(r.rows)).toBe(239920);
    expect(statementClosing([])).toBeNull();
  });
});

describe('labels and links', () => {
  it('IFSC bank lookup, statement types and where a row opens', () => {
    expect(ifscBank('hdfc0000123')).toBe('HDFC Bank');
    expect(ifscBank('bad')).toBe('');
    expect(refTypeLabel('loan_payment')).toBe('Loan payment');
    expect(cashbankRefLink('cheque')).toBe('/cash-bank/cheques');
    expect(cashbankRefLink('opening')).toBeNull();
  });
});

// ---- Excel statements: the built-in .xlsx reader ------------------------------------------------------------------------
import { deflateRawSync } from 'node:zlib';
import { readXlsx, rowsToCsv } from '../src/lib/xlsx';
import { RECON_QUICK, SECTION_138_TEXT, statementRowsFromFile } from '../src/lib/data/cashbank';

/** A minimal zip (what an .xlsx is): each part stored or deflated, with a central directory. */
function zip(parts) {
  const enc = new TextEncoder();
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text, deflate] of parts) {
    const raw = enc.encode(text);
    const data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const nm = enc.encode(name);
    const lh = new Uint8Array(30 + nm.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, deflate ? 8 : 0, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nm.length, true);
    lh.set(nm, 30);
    const ch = new Uint8Array(46 + nm.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, deflate ? 8 : 0, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nm.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nm, 46);
    locals.push(lh, data);
    central.push(ch);
    offset += lh.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, parts.length, true);
  ev.setUint16(10, parts.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...locals, ...central, end];
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

const SHARED = '<sst><si><t>Date</t></si><si><t>Narration</t></si><si><t>Withdrawal Amt</t></si><si><t>Deposit Amt</t></si><si><t>Closing Balance</t></si><si><r><t>UPI/RCT-5/</t></r><r><t>Ravi &amp; Sons</t></r></si></sst>';
const SHEET = [
  '<worksheet><sheetData>',
  '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row>',
  '<row r="2"><c r="A2"><v>46332</v></c><c r="B2" t="s"><v>5</v></c><c r="D2"><v>5000</v></c><c r="E2"><v>240100</v></c></row>',
  '<row r="3"><c r="A3" t="inlineStr"><is><t>07/11/2026</t></is></c><c r="B3" t="inlineStr"><is><t>SMS, charges</t></is></c><c r="C3"><v>180</v></c><c r="E3"><v>239920</v></c></row>',
  '</sheetData></worksheet>',
].join('');

describe('Excel (.xlsx) bank statements, read without a library', () => {
  it('reads shared and inline strings, numbers and Excel date serials, stored or deflated', async () => {
    for (const deflate of [false, true]) {
      const file = zip([['xl/sharedStrings.xml', SHARED, deflate], ['xl/worksheets/sheet1.xml', SHEET, deflate]]);
      const rows = await readXlsx(file);
      expect(rows[1]).toEqual(['46332', 'UPI/RCT-5/Ravi & Sons', '', '5000', '240100']);
      expect(rowsToCsv(rows).split('\n')[2]).toBe('07/11/2026,"SMS, charges",180,,239920');
    }
  });
  it('a statement file (.xlsx) becomes reconcile rows; an old .xls is refused with a hint', async () => {
    const bytes = zip([['xl/sharedStrings.xml', SHARED, true], ['xl/worksheets/sheet1.xml', SHEET, true]]);
    const r = await statementRowsFromFile(new File([bytes], 'hdfc.xlsx'));
    expect(r.rows).toEqual([
      { date: '2026-11-06', description: 'UPI/RCT-5/Ravi & Sons', debit: 0, credit: 5000, balance: 240100 },
      { date: '2026-11-07', description: 'SMS, charges', debit: 180, credit: 0, balance: 239920 },
    ]);
    const xls = new Uint8Array(64);
    new DataView(xls.buffer).setUint32(0, 0xe011cfd0, true);
    await expect(statementRowsFromFile(new File([xls], 'old.xls'))).rejects.toThrow(/save it as \.xlsx or CSV/);
    await expect(readXlsx(new Uint8Array(40))).rejects.toThrow(/not an \.xlsx/);
  });
});

describe('reconcile quick entries and the §138 tracker', () => {
  it('a statement debit can be bank charges, drawings or cash withdrawn; a credit interest, capital or cash deposited', () => {
    expect(RECON_QUICK.debit.map((o) => o.id)).toEqual(['bank_charges', 'drawings', 'to_cash']);
    expect(RECON_QUICK.credit.map((o) => o.id)).toEqual(['interest', 'capital', 'from_cash']);
    expect(RECON_QUICK.credit[0].body).toMatchObject({ direction: 'increase', countAsIncome: true });
  });
  it('says what to do at each §138 stage', () => {
    expect(SECTION_138_TEXT.send_notice.text({ noticeBy: '2026-12-05', daysLeft: 25 })).toBe('Send the demand notice by 2026-12-05 (25 days left)');
    expect(SECTION_138_TEXT.complaint_window.text({ complaintFrom: '2026-12-06', complaintBy: '2027-01-05', daysLeft: 3 })).toMatch(/2026-12-06 to 2027-01-05/);
  });
});

// ---- Cash & Bank reports (P6-S6) ----------------------------------------------------------------------------------------
import { CASH_BANK_REPORTS, bankStatementRows, chequeRegisterRows, loanStatementRows } from '../src/lib/data/cashbank';

describe('Cash & Bank report rows', () => {
  it('Bank Statement: an opening row, then entries; the last balance is the account closing', () => {
    const rows = bankStatementRows({
      opening: 200000,
      closing: 204820,
      rows: [
        { id: 'a', txnDate: '2026-11-03', refType: 'adjustment', narration: 'Withdrawal: SMS', partyName: null, deposit: 0, withdrawal: 180, running: 199820, reconciled: true },
        { id: 'b', txnDate: '2026-11-06', refType: 'payment', narration: 'Payment RCT-5', partyName: 'Ravi', deposit: 5000, withdrawal: 0, running: 204820, reconciled: false },
      ],
    });
    expect(rows[0]).toMatchObject({ id: 'opening', balance: 200000 });
    expect(rows[1]).toMatchObject({ withdrawal: 180, deposit: null, reconciled: '✔', reference: 'Adjustment' });
    expect(rows.at(-1)).toMatchObject({ party: 'Ravi', deposit: 5000, balance: 204820 });
  });
  it('Loan Statement: disbursal, payments and top-ups in date order; the balance ends at what the schedule says is owed', () => {
    const rows = loanStatementRows({
      id: 'L', principal: 1000000, receivedOn: '2026-04-01', processingFee: 5000, outstanding: 1121151.21,
      payments: [
        { id: 't', date: '2026-05-20', kind: 'topup', principal: 200000, interest: 0, charges: 0, tdsAmount: 0, createdAt: '2' },
        { id: 'e', date: '2026-05-05', kind: 'emi', principal: 78848.79, interest: 10000, charges: 0, tdsAmount: 1000, createdAt: '1' },
      ],
    });
    expect(rows.map((r) => r.type)).toEqual(['Disbursal', 'EMI', 'Top-up']);
    expect(rows[0]).toMatchObject({ principal: 1000000, charges: 5000, balance: 1000000 });
    expect(rows[1]).toMatchObject({ interest: 10000, tds: 1000, balance: 921151.21 });
    expect(rows.at(-1).balance).toBe(1121151.21);
  });
  it('Cheque Register: days past the cheque date only for cheques still open or deposited; stale marked', () => {
    const rows = chequeRegisterRows(
      [
        { id: '1', direction: 'received', number: '1', partyName: 'A', amount: 100, chequeDate: '2026-11-01', status: 'open', stale: false },
        { id: '2', direction: 'issued', number: '2', partyName: 'B', amount: 50, chequeDate: '2026-11-01', status: 'cleared', stale: false },
        { id: '3', direction: 'received', number: '3', partyName: 'C', amount: 10, chequeDate: '2026-11-20', status: 'open', stale: false },
        { id: '4', direction: 'received', number: '4', partyName: 'D', amount: 10, chequeDate: '2026-07-01', status: 'deposited', stale: true },
      ],
      '2026-11-11',
    );
    expect(rows.map((r) => r.daysOverdue)).toEqual([10, null, null, 133]);
    expect(rows[1].direction).toBe('Issued');
    expect(rows[3].status).toBe('deposited (stale)');
    expect(CASH_BANK_REPORTS.map((r) => r.id)).toEqual(['bank-statement', 'loan-statement', 'cheque-register']);
  });
});

describe('loan statement with interest credited before payment', () => {
  it('a credit is its own row; its later payment does not count the interest again; balance unchanged by the credit', async () => {
    const { loanStatementRows: rowsOf, fyEndOf } = await import('../src/lib/data/cashbank');
    const rows = rowsOf({
      id: 'L', principal: 300000, receivedOn: '2026-04-01', processingFee: 0,
      credits: [{ id: 'c', date: '2027-03-31', amount: 12000, tdsAmount: 1200, createdAt: '1' }],
      payments: [{ id: 'p', date: '2027-04-05', kind: 'emi', principal: 25000, interest: 12000, accruedSettled: 12000, charges: 0, tdsAmount: 0, createdAt: '2' }],
    });
    expect(rows.map((r) => [r.type, r.interest, r.tds, r.balance])).toEqual([
      ['Disbursal', null, null, 300000],
      ['Interest credited', 12000, 1200, 300000],
      ['EMI', null, null, 275000],
    ]);
    expect(fyEndOf('2026-11-11')).toBe('2027-03-31');
    expect(fyEndOf('2027-02-01')).toBe('2027-03-31');
  });
});
