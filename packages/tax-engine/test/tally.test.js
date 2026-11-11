// Vyapar parity P7-S2: golden XML for five scenarios (intra-state sale, inter-state sale, sales return, purchase, a
// discounted sale), balance of every voucher, validation. The XML files in test/golden are the reviewed output; run
// `UPDATE_GOLDEN=1 npx vitest run test/tally.test.js` to rewrite them and read the diff before committing.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  DEFAULT_TALLY_MAPPING,
  buildMasterXml,
  buildVoucherXml,
  expenseVoucher,
  paymentVoucher,
  tallyName,
  tallySummary,
  validateTally,
  voucherBalance,
  voucherEntries,
  xmlText,
} from '../src/index.ts';

const M = { ...DEFAULT_TALLY_MAPPING, company: 'Corner Store & Sons' };
const golden = (name, actual) => {
  const f = new URL(`./golden/${name}.xml`, import.meta.url);
  if (process.env.UPDATE_GOLDEN || !existsSync(f)) writeFileSync(f, actual);
  expect(actual).toBe(readFileSync(f, 'utf8'));
};

const intra = {
  id: 'v1',
  type: 'Sales',
  number: 'INV/2026-27/0001',
  date: '2026-10-05',
  party: 'Asha Kumar',
  partyGstin: '33ABCDE1234F1Z5',
  partyState: 'Tamil Nadu',
  placeOfSupply: 'Tamil Nadu',
  lines: [
    {
      name: 'Lux Soap',
      hsn: '3401',
      unit: 'PCS',
      quantity: 2,
      rate: 100,
      amount: 200,
      gstRate: 18,
    },
  ],
  cgst: 18,
  sgst: 18,
  total: 236,
};
const inter = {
  id: 'v2',
  type: 'Sales',
  number: 'INV/2026-27/0002',
  date: '2026-10-06',
  party: 'Kerala Traders',
  partyGstin: '32ABCDE1234F1Z5',
  partyState: 'Kerala',
  placeOfSupply: 'Kerala',
  lines: [
    {
      name: 'Basmati Rice',
      hsn: '1006',
      unit: 'KG',
      quantity: 10,
      rate: 100,
      amount: 1000,
      gstRate: 5,
    },
  ],
  igst: 50,
  roundOff: 0,
  total: 1050,
};
const ret = {
  id: 'v3',
  type: 'Credit Note',
  number: 'CN/2026-27/0001',
  date: '2026-10-09',
  party: 'Asha Kumar',
  partyGstin: '33ABCDE1234F1Z5',
  partyState: 'Tamil Nadu',
  placeOfSupply: 'Tamil Nadu',
  narration: 'Sales return',
  lines: [
    {
      name: 'Lux Soap',
      hsn: '3401',
      unit: 'PCS',
      quantity: 1,
      rate: 100,
      amount: 100,
      gstRate: 18,
    },
  ],
  cgst: 9,
  sgst: 9,
  total: 118,
};
const buy = {
  id: 'v4',
  type: 'Purchase',
  number: 'PB-17',
  date: '2026-10-02',
  party: 'Wholesale Mart',
  partyGstin: '33AAAAA0000A1Z5',
  partyState: 'Tamil Nadu',
  placeOfSupply: 'Tamil Nadu',
  lines: [
    {
      name: 'Lux Soap',
      hsn: '3401',
      unit: 'PCS',
      quantity: 50,
      rate: 60,
      amount: 3000,
      gstRate: 18,
    },
  ],
  cgst: 270,
  sgst: 270,
  total: 3540,
};
// 3 × ₹333 with a ₹99.90 discount and a ₹25 packing charge at 18%, rounded down 0.34: every figure from computeInvoiceTotals.
const disc = {
  id: 'v5',
  type: 'Sales',
  number: 'INV/2026-27/0003',
  date: '2026-10-12',
  party: 'Walk-in & "Co" <1>',
  lines: [{ name: 'Item <A>', unit: 'NOS', quantity: 3, rate: 333, amount: 899.1, gstRate: 12 }],
  charges: [{ name: 'Packing', amount: 25 }],
  cgst: 56.2,
  sgst: 56.2,
  roundOff: -0.5,
  total: 1036,
};

describe('voucher entries', () => {
  it('every scenario balances to zero in Tally terms', () => {
    for (const v of [intra, inter, ret, buy, disc])
      expect(voucherBalance(v, M), v.number).toBeCloseTo(0, 2);
  });
  it('a sale debits the party and credits the taxes; a return does the opposite; a purchase debits its input taxes', () => {
    const s = voucherEntries(intra, M);
    expect(s.party).toEqual({ ledger: 'Asha Kumar', amount: -236 });
    expect(s.others).toEqual([
      { ledger: 'Output CGST', amount: 18 },
      { ledger: 'Output SGST', amount: 18 },
    ]);
    expect(voucherEntries(ret, M).party.amount).toBe(118);
    expect(voucherEntries(ret, M).others[0]).toEqual({ ledger: 'Output CGST', amount: -9 });
    expect(voucherEntries(buy, M).party.amount).toBe(3540);
    expect(voucherEntries(buy, M).others[0]).toEqual({ ledger: 'Input CGST', amount: -270 });
  });
});

describe('golden XML', () => {
  it('1 intra-state sale', () => golden('sale-intra', buildVoucherXml([intra], M)));
  it('2 inter-state sale', () => golden('sale-inter', buildVoucherXml([inter], M)));
  it('3 sales return (credit note)', () => golden('sales-return', buildVoucherXml([ret], M)));
  it('4 purchase', () => golden('purchase', buildVoucherXml([buy], M)));
  it('5 discounted sale with a charge, round off and awkward characters', () =>
    golden('sale-discount', buildVoucherXml([disc], M)));
  it('masters: ledgers, taxes, units, stock items', () =>
    golden(
      'masters',
      buildMasterXml(
        [
          {
            name: 'Asha Kumar',
            kind: 'customer',
            gstin: '33ABCDE1234F1Z5',
            state: 'Tamil Nadu',
            address: '12 Mount Rd',
            pin: '600002',
            opening: 1500,
          },
          {
            name: 'Wholesale Mart',
            kind: 'supplier',
            gstin: '33AAAAA0000A1Z5',
            state: 'Tamil Nadu',
            opening: -4000,
          },
        ],
        [{ name: 'Lux Soap', unit: 'PCS', hsn: '3401', gstRate: 18 }],
        M,
        { vouchers: [intra, buy] },
      ),
    ));
  it('the vouchers file is UTF-8 XML with a Tally import envelope', () => {
    const x = buildVoucherXml([intra, inter], M);
    expect(x.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(x).toContain('<TALLYREQUEST>Import Data</TALLYREQUEST>');
    expect(x).toContain('<SVCURRENTCOMPANY>Corner Store &amp; Sons</SVCURRENTCOMPANY>');
    expect((x.match(/<VOUCHER /g) ?? []).length).toBe(2);
  });
});

describe('xml escaping', () => {
  it('escapes the five entities and drops control characters', () => {
    expect(xmlText(`A&B <c> "d" 'e'\u0001`)).toBe('A&amp;B &lt;c&gt; &quot;d&quot; &apos;e&apos;');
  });
});

describe('validation', () => {
  it('a clean period has no errors; warnings are listed', () => {
    const p = validateTally([intra, { ...inter, partyGstin: '' }], M);
    expect(p.filter((x) => x.level === 'error')).toEqual([]);
    expect(p.filter((x) => x.level === 'warning').map((x) => x.id)).toEqual(['v2']);
  });
  it('errors name the row: an empty mapped ledger, an unbalanced voucher, duplicate party names', () => {
    const bad = { ...intra, id: 'bad', total: 300 };
    const p = validateTally([bad], { ...M, sales: ' ', outCgst: '' }, [
      { id: 'a', name: 'Asha ' },
      { id: 'b', name: 'asha' },
    ]);
    const errs = p.filter((x) => x.level === 'error');
    expect(errs.find((e) => e.id === 'sales')).toBeTruthy();
    expect(errs.find((e) => e.id === 'outCgst')).toBeTruthy();
    expect(errs.find((e) => e.id === 'bad')?.message).toMatch(/does not balance/);
    expect(errs.find((e) => e.id === 'b')?.message).toMatch(/same party name/);
    expect(tallyName('  Asha   KUMAR ')).toBe('asha kumar');
  });
  it('a company name is required', () => {
    expect(validateTally([intra], { ...M, company: '' }).some((p) => p.id === 'company')).toBe(
      true,
    );
  });
  it('summary counts', () => {
    const s = tallySummary([intra, ret], [1, 2], [1], validateTally([intra, ret], M));
    expect(s).toMatchObject({ vouchers: 2, parties: 2, items: 1, total: 118, errors: 0 });
  });
});

// ---- receipts, payments and expenses (the optional extras) ----
const receipt = paymentVoucher(
  {
    id: 'r1',
    direction: 'in',
    number: 'RCT-3',
    date: '2025-10-15',
    party: 'Asha Kumar',
    mode: 'upi',
    amount: 9000,
    discount: 500,
    tds: 500,
    narration: 'Part payment',
  },
  M,
);
const payOut = paymentVoucher(
  {
    id: 'p1',
    direction: 'out',
    number: 'PAY-9',
    date: '2025-10-20',
    party: 'Wholesale Mart',
    mode: 'cash',
    amount: 3000,
    discount: 40,
  },
  M,
);
const rent = expenseVoucher(
  {
    id: 'e1',
    kind: 'expense',
    number: 'EXP-4',
    date: '2025-10-05',
    head: 'Office Rent',
    amount: 20000,
    tax: 3600,
    mode: 'bank',
    narration: 'October rent',
  },
  M,
);
const rentInter = expenseVoucher(
  {
    id: 'e2',
    kind: 'expense',
    number: 'EXP-5',
    date: '2025-10-06',
    head: 'Courier',
    amount: 1000,
    tax: 180,
    interstate: true,
    mode: 'cash',
  },
  M,
);
const income = expenseVoucher(
  {
    id: 'i1',
    kind: 'income',
    number: 'INC-1',
    date: '2025-10-07',
    head: 'Commission',
    amount: 5000,
    tax: 900,
    mode: 'bank',
  },
  M,
);

describe('receipts, payments and expenses', () => {
  it('every one balances to zero in Tally terms', () => {
    for (const v of [receipt, payOut, rent, rentInter, income])
      expect(voucherBalance(v, M), v.number).toBe(0);
  });
  it('a receipt credits the party with money + discount + TDS; a payment debits it', () => {
    expect(receipt.type).toBe('Receipt');
    expect(receipt.entries.find((e) => e.ledger === 'Asha Kumar').amount).toBe(10000);
    expect(receipt.entries.find((e) => e.ledger === 'Bank Account').amount).toBe(-9000);
    expect(payOut.type).toBe('Payment');
    expect(payOut.entries.find((e) => e.ledger === 'Wholesale Mart').amount).toBe(-3040);
    expect(payOut.entries.find((e) => e.ledger === 'Cash').amount).toBe(3000);
  });
  it('an expense debits the head and input GST (CGST+SGST, or IGST between states) and credits the bank', () => {
    expect(rent.entries.map((e) => [e.ledger, e.amount])).toEqual([
      ['Bank Account', 23600],
      ['Office Rent', -20000],
      ['Input CGST', -1800],
      ['Input SGST', -1800],
    ]);
    expect(rentInter.entries.map((e) => e.ledger)).toEqual(['Cash', 'Courier', 'Input IGST']);
    expect(income.entries.map((e) => [e.ledger, e.amount])).toEqual([
      ['Bank Account', -5900],
      ['Commission', 5000],
      ['Output CGST', 450],
      ['Output SGST', 450],
    ]);
  });
  it('golden XML', () => {
    golden('receipt-discount-tds', buildVoucherXml([receipt], M));
    golden('payment-out', buildVoucherXml([payOut], M));
    golden('expense-gst', buildVoucherXml([rent, rentInter], M));
    golden('other-income', buildVoucherXml([income], M));
    golden(
      'masters-accounting',
      buildMasterXml([{ name: 'Asha Kumar', kind: 'customer' }], [], M, {
        vouchers: [receipt, payOut, rent, income],
      }),
    );
  });
  it('validation does not ask accounting vouchers for items or a party', () => {
    const p = validateTally([rent, receipt], M);
    expect(p.filter((x) => x.level === 'error')).toEqual([]);
    expect(
      validateTally([{ ...rent, entries: [] }], M).some((x) => /no entries/.test(x.message)),
    ).toBe(true);
    expect(
      validateTally([{ ...rent, entries: [{ ledger: 'X', amount: 5 }] }], M).some((x) =>
        /does not balance/.test(x.message),
      ),
    ).toBe(true);
    expect(validateTally([rent], { ...M, cash: '' }).some((x) => x.id === 'cash')).toBe(true);
  });
});

// A well-formedness check of everything the exporter writes: tags nest and close, text has no raw & or <. Not a
// substitute for importing into Tally, which only the owner can do (see docs/DECISIONS.md), but it catches a broken file.
function wellFormed(xml) {
  const stack = [];
  for (const m of xml.matchAll(
    /<(\/?)([A-Za-z][\w.]*)((?:\s+[\w:]+="(?:[^"<&]|&(?:amp|lt|gt|quot|apos);)*")*)\s*(\/?)>|&(?!amp;|lt;|gt;|quot;|apos;|#)|<(?![/A-Za-z?])/g,
  )) {
    if (m[0].startsWith('&') || m[0] === '<') return `raw ${m[0]} at ${m.index}`;
    if (m[4]) continue;
    if (m[1]) {
      if (stack.pop() !== m[2]) return `unexpected </${m[2]}> at ${m.index}`;
    } else stack.push(m[2]);
  }
  return stack.length ? `unclosed <${stack.at(-1)}>` : '';
}
describe('well-formed XML', () => {
  it('every voucher and master file the exporter writes nests and closes', () => {
    const files = [
      buildVoucherXml([intra, inter, ret, buy, disc, receipt, payOut, rent, rentInter, income], M),
      buildMasterXml(
        [{ name: 'A & B <1>', kind: 'customer', address: '1 "Main" St' }],
        [{ name: 'X&Y', unit: 'PCS', hsn: '1', gstRate: 5 }],
        M,
        { vouchers: [intra, buy, receipt, rent, income] },
      ),
    ];
    for (const f of files) expect(wellFormed(f.replace(/^<\?xml[^>]*\?>/, ''))).toBe('');
    expect(wellFormed('<A><B></A>')).not.toBe('');
    expect(wellFormed('<A>a & b</A>')).not.toBe('');
  });
});
