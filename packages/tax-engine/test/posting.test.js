// Vyapar parity P4-S2: the posting rules (docs/VYAPAR_IMPLEMENTATION_PHASES.md, "Test matrix (posting.test.ts)").
import { describe, it, expect } from 'vitest';
import {
  ACC,
  DEFAULT_CHART,
  PostingError,
  kindForGroup,
  balanceOf,
  drCr,
  isBalanced,
  moneyAccount,
  naturalSide,
  postAdjustment,
  postChequeEvent,
  postCreditNote,
  postDebitNote,
  postExpense,
  postIncome,
  postInvoice,
  postJournal,
  postLoanDisbursal,
  postLoanPayment,
  postOpening,
  postPayment,
  postPurchase,
  postTransfer,
  postingTotals,
  runningBalance,
  trialBalance,
  voucher,
} from '../src/index.ts';

const r2 = (n) => Math.round(n * 100) / 100;
/** Σ of the named account on one side across postings. */
const sum = (posts, account, side) =>
  r2(
    posts
      .flatMap((p) => p.lines)
      .filter((l) => l.account === account)
      .reduce((s, l) => s + (l[side] || 0), 0),
  );
const net = (posts, account) => r2(sum(posts, account, 'debit') - sum(posts, account, 'credit'));
const allBalanced = (posts) => posts.every(isBalanced);

const sale = (o = {}) => ({
  id: 'i1',
  invoiceType: 'tax-invoice',
  invoiceDate: '2026-11-05',
  partyId: 'p1',
  number: 'INV-1',
  status: 'unpaid',
  taxableAmount: 1000,
  cgst: 90,
  sgst: 90,
  igst: 0,
  cess: 0,
  total: 1180,
  ...o,
});
const purchase = (o = {}) => ({
  id: 'b1',
  docType: 'bill',
  purchaseDate: '2026-11-05',
  supplierId: 's1',
  invoiceNumber: 'OM-1',
  taxableAmount: 1000,
  cgst: 90,
  sgst: 90,
  igst: 0,
  cess: 0,
  total: 1180,
  tdsAmount: 0,
  ...o,
});

describe('chart of accounts (P4-S1)', () => {
  it("has the guide's system accounts, unique codes, and a kind that matches its group", () => {
    const codes = DEFAULT_CHART.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of [
      '1000',
      '1200',
      '1300',
      '1400',
      '1500',
      '1510',
      '1520',
      '1530',
      '1600',
      '1610',
      '2000',
      '2100',
      '2140',
      '2200',
      '2210',
      '2400',
      '3000',
      '3100',
      '4000',
      '4010',
      '4100',
      '4110',
      '4120',
      '4130',
      '5000',
      '5010',
      '5200',
      '5210',
      '5220',
      '5230',
      '5240',
      '5250',
      '5260',
    ])
      expect(codes, c).toContain(c);
    for (const a of DEFAULT_CHART) expect(kindForGroup(a.group, a.kind), a.code).toBe(a.kind);
    expect(kindForGroup('Duties & taxes')).toBeNull();
    expect(kindForGroup('Nope')).toBeNull();
  });
  it('reads balances in the natural direction and trial balances', () => {
    expect(naturalSide('asset')).toBe('debit');
    expect(balanceOf('liability', 0, 500)).toBe(500);
    expect(balanceOf('asset', 100, 40)).toBe(60);
    expect(drCr(10, 40)).toEqual({ amount: 30, side: 'Cr' });
    const tb = trialBalance([
      { code: '1000', name: 'Cash', kind: 'asset', debit: 100, credit: 30 },
      { code: '3000', name: 'Capital', kind: 'equity', debit: 0, credit: 70 },
      { code: '9', name: 'Nil', kind: 'asset', debit: 5, credit: 5 },
    ]);
    expect(tb).toMatchObject({ debit: 70, credit: 70, balanced: true });
    expect(tb.lines).toHaveLength(2);
    expect(
      trialBalance([{ code: '1', name: 'x', kind: 'asset', debit: 5, credit: 0 }]).balanced,
    ).toBe(false);
    expect(
      runningBalance([
        { debit: 100, credit: 0 },
        { debit: 0, credit: 30 },
      ]),
    ).toEqual([100, 70]);
  });
});

describe('sales', () => {
  it('intra-state 18%: Cr CGST and SGST', () => {
    const p = postInvoice(sale());
    expect(allBalanced(p)).toBe(true);
    expect(p).toHaveLength(1);
    expect(sum(p, ACC.RECEIVABLE, 'debit')).toBe(1180);
    expect([
      sum(p, ACC.OUT_CGST, 'credit'),
      sum(p, ACC.OUT_SGST, 'credit'),
      sum(p, ACC.SALES, 'credit'),
    ]).toEqual([90, 90, 1000]);
    expect(p[0].lines[0].partyId).toBe('p1');
  });
  it('inter-state: Cr IGST', () => {
    const p = postInvoice(sale({ cgst: 0, sgst: 0, igst: 180 }));
    expect(sum(p, ACC.OUT_IGST, 'credit')).toBe(180);
    expect(sum(p, ACC.OUT_CGST, 'credit')).toBe(0);
  });
  it('charges at 5%: Cr Additional Charges Income and the tax at 5%', () => {
    const p = postInvoice(
      sale({ taxableAmount: 1100, cgst: 99, sgst: 99, total: 1298, chargesTaxable: 100 }),
    );
    expect(sum(p, ACC.CHARGES_INCOME, 'credit')).toBe(100);
    expect(sum(p, ACC.SALES, 'credit')).toBe(1000);
    expect(allBalanced(p)).toBe(true);
  });
  it('with TCS: Cr TCS Payable', () => {
    const p = postInvoice(sale({ total: 1186, tcsAmount: 6 }));
    expect(sum(p, ACC.TCS_PAYABLE, 'credit')).toBe(6);
    expect(sum(p, ACC.SALES, 'credit')).toBe(1000);
  });
  it('round-off up is a gain, down a loss, on the right side (±0.49)', () => {
    const up = postInvoice(sale({ total: 1180.49, roundOff: 0.49 }));
    expect(sum(up, ACC.ROUND_GAIN, 'credit')).toBe(0.49);
    const down = postInvoice(sale({ total: 1179.51, roundOff: -0.49 }));
    expect(sum(down, ACC.ROUND_LOSS, 'debit')).toBe(0.49);
    expect(sum(down, ACC.SALES, 'credit')).toBe(1000);
    expect(allBalanced([...up, ...down])).toBe(true);
  });
  it('a discount on the whole bill lowers Sales, not the tax', () => {
    const p = postInvoice(sale({ total: 1130 }));
    expect(sum(p, ACC.SALES, 'credit')).toBe(950);
  });
  it('three inline payments are three more vouchers, by mode', () => {
    const p = postInvoice(
      sale({
        payments: [
          { amount: 200, mode: 'cash' },
          { amount: 300, mode: 'upi' },
          { amount: 100, mode: 'cheque', date: '2026-12-01' },
        ],
      }),
    );
    expect(p).toHaveLength(4);
    expect([
      sum(p, ACC.CASH, 'debit'),
      sum(p, ACC.BANK_UNASSIGNED, 'debit'),
      sum(p, ACC.CHEQUES_IN_HAND, 'debit'),
    ]).toEqual([200, 300, 100]);
    expect(net(p, ACC.RECEIVABLE)).toBe(580);
    expect(p[3].date).toBe('2026-12-01');
  });
  it('a bank id resolves through the context', () => {
    const ctx = { bankAccount: (id) => (id === 'hdfc' ? '1101' : null) };
    expect(moneyAccount(ctx, 'bank', 'hdfc', 'in')).toBe('1101');
    expect(moneyAccount(ctx, 'bank', 'x', 'in')).toBe(ACC.BANK_UNASSIGNED);
    expect(moneyAccount(ctx, 'cheque', 'hdfc', 'out')).toBe(ACC.CHEQUES_ISSUED);
  });
  it('bill of supply: no tax lines; composition posts too', () => {
    const p = postInvoice(sale({ invoiceType: 'bill-of-supply', cgst: 0, sgst: 0, total: 1000 }));
    expect(p[0].lines.map((l) => l.account)).toEqual([ACC.RECEIVABLE, ACC.SALES]);
    expect(postInvoice(sale({ invoiceType: 'composition' }))).toHaveLength(1);
  });
  it('quotations, sale orders, proformas, challans and cancelled invoices post nothing; so does a zero-value invoice', () => {
    for (const t of ['quotation', 'sales-order', 'proforma', 'delivery-challan'])
      expect(postInvoice(sale({ invoiceType: t }))).toEqual([]);
    expect(postInvoice(sale({ status: 'cancelled' }))).toEqual([]);
    expect(postInvoice(sale({ total: 0, taxableAmount: 0, cgst: 0, sgst: 0 }))).toEqual([]);
  });
  it('credit note: Dr Sales Return and Output tax, Cr Receivable; a bank refund is an extra voucher', () => {
    const p = postInvoice(
      sale({ invoiceType: 'credit-note', refunds: [{ amount: 500, mode: 'bank' }] }),
    );
    expect(p).toHaveLength(2);
    expect([
      sum(p, ACC.SALES_RETURN, 'debit'),
      sum(p, ACC.OUT_CGST, 'debit'),
      net(p, ACC.RECEIVABLE),
    ]).toEqual([1000, 90, -680]);
    expect(sum(p, ACC.BANK_UNASSIGNED, 'credit')).toBe(500);
    expect(postCreditNote(sale({ status: 'cancelled' }))).toEqual([]);
  });
});

describe('payments', () => {
  const base = {
    id: 'pay1',
    partyId: 'p1',
    amount: 900,
    mode: 'bank',
    paymentDate: '2026-11-06',
    discountAmount: 0,
    tdsAmount: 0,
    source: 'receipt',
  };
  it('Payment In with TDS and discount: all three sides, Cr Receivable for the whole', () => {
    const p = postPayment({ ...base, direction: 'in', tdsAmount: 50, discountAmount: 30 });
    expect([
      sum(p, ACC.BANK_UNASSIGNED, 'debit'),
      sum(p, ACC.TDS_RECEIVABLE, 'debit'),
      sum(p, ACC.DISCOUNT_ALLOWED, 'debit'),
      sum(p, ACC.RECEIVABLE, 'credit'),
    ]).toEqual([900, 50, 30, 980]);
    expect(allBalanced(p)).toBe(true);
  });
  it('Payment Out: Dr Payable; Cr Bank, TDS Payable, Discount Received', () => {
    const p = postPayment({
      ...base,
      direction: 'out',
      source: 'payment',
      tdsAmount: 45,
      discountAmount: 5,
      mode: 'cheque',
    });
    expect([
      sum(p, ACC.PAYABLE, 'debit'),
      sum(p, ACC.CHEQUES_ISSUED, 'credit'),
      sum(p, ACC.TDS_PAYABLE, 'credit'),
      sum(p, ACC.DISCOUNT_RECEIVED, 'credit'),
    ]).toEqual([950, 900, 45, 5]);
  });
  it('money posted with its own document is not posted twice', () => {
    for (const source of [
      'invoice_inline',
      'purchase_inline',
      'credit_note_refund',
      'debit_note_refund',
    ])
      expect(postPayment({ ...base, direction: 'in', source })).toEqual([]);
    expect(postPayment({ ...base, direction: 'out', source: 'po_advance' })).toHaveLength(1);
  });
});

describe('purchases', () => {
  it('normal: Dr Purchases and Input GST, Cr Payable', () => {
    const p = postPurchase(purchase());
    expect([
      sum(p, ACC.PURCHASES, 'debit'),
      sum(p, ACC.IN_CGST, 'debit'),
      sum(p, ACC.IN_SGST, 'debit'),
      sum(p, ACC.PAYABLE, 'credit'),
    ]).toEqual([1000, 90, 90, 1180]);
    expect(allBalanced(p)).toBe(true);
  });
  it('mixed ITC flags: tax splits between Input and Ineligible GST expensed', () => {
    const p = postPurchase(
      purchase({ itc: { eligible: { cgst: 54, sgst: 54 }, ineligible: { cgst: 36, sgst: 36 } } }),
    );
    expect([
      sum(p, ACC.IN_CGST, 'debit'),
      sum(p, ACC.INELIGIBLE_GST, 'debit'),
      sum(p, ACC.PAYABLE, 'credit'),
    ]).toEqual([54, 72, 1180]);
  });
  it('RCM: the supplier is owed the value only; the tax is Cr RCM Payable and the credit is claimed', () => {
    const p = postPurchase(purchase({ reverseCharge: true }));
    expect([
      sum(p, ACC.RCM_PAYABLE, 'credit'),
      sum(p, ACC.PAYABLE, 'credit'),
      sum(p, ACC.IN_CGST, 'debit'),
    ]).toEqual([180, 1000, 90]);
    expect(allBalanced(p)).toBe(true);
  });
  it('§194Q TDS: Cr TDS Payable and the supplier is owed less', () => {
    const p = postPurchase(
      purchase({ taxableAmount: 100000, cgst: 9000, sgst: 9000, total: 118000, tdsAmount: 100 }),
    );
    expect([sum(p, ACC.TDS_PAYABLE, 'credit'), sum(p, ACC.PAYABLE, 'credit')]).toEqual([
      100, 117900,
    ]);
  });
  it('round-off on a bill goes to the round-off accounts', () => {
    expect(sum(postPurchase(purchase({ total: 1180.4 })), ACC.ROUND_LOSS, 'debit')).toBe(0.4);
    expect(sum(postPurchase(purchase({ total: 1179.6 })), ACC.ROUND_GAIN, 'credit')).toBe(0.4);
  });
  it('payments made with the bill are vouchers; purchase orders post nothing', () => {
    const p = postPurchase(
      purchase({
        payments: [
          { amount: 500, mode: 'cash' },
          { amount: 100, mode: 'cheque' },
        ],
      }),
    );
    expect(p).toHaveLength(3);
    expect(net(p, ACC.PAYABLE)).toBe(-580);
    expect(postPurchase(purchase({ docType: 'order' }))).toEqual([]);
  });
  it('debit note partial: proportional ITC reversal, Cr Purchase Return, refund voucher', () => {
    const dn = {
      id: 'd1',
      docType: 'debit-note',
      purchaseDate: '2026-11-06',
      supplierId: 's1',
      taxableAmount: 60,
      cgst: 5.4,
      sgst: 5.4,
      total: 70.8,
      itc: { eligible: { cgst: 5.4, sgst: 5.4 }, ineligible: {} },
    };
    const p = postDebitNote(dn);
    expect([
      sum(p, ACC.PAYABLE, 'debit'),
      sum(p, ACC.PURCHASE_RETURN, 'credit'),
      sum(p, ACC.IN_CGST, 'credit'),
    ]).toEqual([70.8, 60, 5.4]);
    const refunded = postPurchase({ ...dn, refundMode: 'cash' });
    expect(refunded).toHaveLength(2);
    expect(net(refunded, ACC.PAYABLE)).toBe(0);
    expect(sum(refunded, ACC.CASH, 'debit')).toBe(70.8);
  });
});

describe('expenses and other income', () => {
  it('expense without GST: no tax lines', () => {
    const p = postExpense({
      id: 'e1',
      expenseDate: '2026-11-01',
      amount: 1200,
      taxAmount: 0,
      paymentMode: 'cash',
    });
    expect(p[0].lines.map((l) => l.account)).toEqual([ACC.EXPENSES, ACC.CASH]);
  });
  it('with GST and ITC: Dr category and Input GST; Cr bank for what was paid and Payable (the payee) for the rest', () => {
    const ctx = { expenseAccount: (c) => (c === 'rent' ? '5101' : null) };
    const p = postExpense(
      {
        id: 'e2',
        expenseDate: '2026-11-01',
        categoryId: 'rent',
        amount: 25000,
        taxAmount: 4500,
        interstate: false,
        paidAmount: 20000,
        paymentMode: 'bank',
        payeePartyId: 'll',
      },
      ctx,
    );
    expect([
      sum(p, '5101', 'debit'),
      sum(p, ACC.IN_CGST, 'debit'),
      sum(p, ACC.IN_SGST, 'debit'),
      sum(p, ACC.BANK_UNASSIGNED, 'credit'),
      sum(p, ACC.PAYABLE, 'credit'),
    ]).toEqual([25000, 2250, 2250, 20000, 9500]);
    expect(p[0].lines.find((l) => l.account === ACC.PAYABLE).partyId).toBe('ll');
  });
  it('GST not claimed as credit becomes cost', () => {
    const p = postExpense({
      id: 'e3',
      expenseDate: '2026-11-01',
      amount: 1000,
      taxAmount: 180,
      itcEligible: false,
      paymentMode: 'cash',
    });
    expect([sum(p, ACC.EXPENSES, 'debit'), sum(p, ACC.IN_CGST, 'debit')]).toEqual([1180, 0]);
  });
  it('other income: Cr Other Income and Output GST; exempt income has no tax', () => {
    const p = postIncome({
      id: 'n1',
      expenseDate: '2026-11-01',
      amount: 10000,
      taxAmount: 1800,
      paymentMode: 'bank',
      paidAmount: 5000,
      payeePartyId: 'c1',
    });
    expect([
      sum(p, ACC.OTHER_INCOME, 'credit'),
      sum(p, ACC.OUT_CGST, 'credit'),
      sum(p, ACC.BANK_UNASSIGNED, 'debit'),
      sum(p, ACC.RECEIVABLE, 'debit'),
    ]).toEqual([10000, 900, 5000, 6800]);
    const ex = postIncome({
      id: 'n2',
      expenseDate: '2026-11-01',
      amount: 1200,
      taxAmount: 0,
      exempt: true,
      paymentMode: 'bank',
    });
    expect(sum(ex, ACC.OTHER_INCOME, 'credit')).toBe(1200);
  });
});

describe('cash and bank documents, loans, cheques, openings, journals', () => {
  it('transfer bank→cash is two lines', () => {
    const p = postTransfer({
      id: 't1',
      date: '2026-11-01',
      from: '1101',
      to: ACC.CASH,
      amount: 5000,
    });
    expect(p[0].lines).toEqual([
      { account: ACC.CASH, debit: 5000 },
      { account: '1101', credit: 5000 },
    ]);
  });
  it('loan disbursal and EMI (four lines)', () => {
    expect(
      postLoanDisbursal({
        id: 'l1',
        date: '2026-11-01',
        loanAccount: '2301',
        bankAccount: '1101',
        amount: 100000,
      })[0].lines,
    ).toHaveLength(2);
    const emi = postLoanPayment({
      id: 'l2',
      date: '2026-12-01',
      loanAccount: '2301',
      bankAccount: '1101',
      principal: 8000,
      interest: 1000,
      fees: 50,
    });
    expect(emi[0].lines).toHaveLength(4);
    expect(sum(emi, '1101', 'credit')).toBe(9050);
  });
  it('cheques: received, issued, cleared, bounced with charges', () => {
    const c = { id: 'c1', date: '2026-11-01', amount: 8000, partyId: 'p1', bankAccount: '1101' };
    expect(
      net(postChequeEvent({ ...c, direction: 'received', event: 'created' }), ACC.CHEQUES_IN_HAND),
    ).toBe(8000);
    expect(postChequeEvent({ ...c, direction: 'received', event: 'deposited' })).toEqual([]);
    expect(net(postChequeEvent({ ...c, direction: 'received', event: 'cleared' }), '1101')).toBe(
      8000,
    );
    const b = postChequeEvent({
      ...c,
      direction: 'received',
      event: 'bounced',
      bounceCharges: 300,
      chargeTo: 'bank',
    });
    expect([
      net(b, ACC.RECEIVABLE),
      sum(b, ACC.BANK_CHARGES, 'debit'),
      sum(b, '1101', 'credit'),
    ]).toEqual([8000, 300, 300]);
    expect(
      net(postChequeEvent({ ...c, direction: 'issued', event: 'created' }), ACC.CHEQUES_ISSUED),
    ).toBe(-8000);
    expect(net(postChequeEvent({ ...c, direction: 'issued', event: 'cleared' }), '1101')).toBe(
      -8000,
    );
  });
  it('adjustments and openings post against Opening Balance Equity', () => {
    expect(
      net(
        postAdjustment({
          id: 'a1',
          date: '2026-04-01',
          account: ACC.CASH,
          amount: 500,
          direction: 'increase',
        }),
        ACC.OPENING_EQUITY,
      ),
    ).toBe(-500);
    expect(
      net(
        postAdjustment({
          id: 'a2',
          date: '2026-04-01',
          account: ACC.CASH,
          amount: 500,
          direction: 'reduce',
        }),
        ACC.OPENING_EQUITY,
      ),
    ).toBe(500);
    const o = postOpening({
      id: 'o1',
      date: '2026-04-01',
      account: ACC.PAYABLE,
      amount: 4500,
      side: 'Cr',
      partyId: 's1',
    });
    expect([net(o, ACC.PAYABLE), net(o, ACC.OPENING_EQUITY)]).toEqual([-4500, 4500]);
  });
  it('a manual journal must balance', () => {
    const rows = [
      { account: '5300', debit: 2000 },
      { account: ACC.FIXED_ASSETS, credit: 2000 },
    ];
    expect(
      postJournal({ id: 'j1', date: '2026-11-06', narration: 'Depreciation', rows })[0].lines[0]
        .narration,
    ).toBe('Depreciation');
    expect(() =>
      postJournal({
        id: 'j2',
        date: '2026-11-06',
        rows: [
          { account: '5300', debit: 2000 },
          { account: ACC.FIXED_ASSETS, credit: 1999 },
        ],
      }),
    ).toThrow(PostingError);
  });
  it('voucher() refuses an unbalanced posting, flips negative amounts, drops zeros', () => {
    expect(() =>
      voucher('2026-01-01', 'x', '1', [
        { account: '1000', dr: 10 },
        { account: '2000', cr: 9 },
      ]),
    ).toThrow(/debit 10 ≠ credit 9/);
    expect(
      voucher('2026-01-01', 'x', '1', [
        { account: '1000', dr: 10 },
        { account: '2000', cr: 20 },
        { account: '3000', dr: 10 },
        { account: '4000', cr: 0 },
      ]).lines,
    ).toHaveLength(3);
    expect(voucher('2026-01-01', 'x', '1', [{ account: '1000', dr: 0 }])).toBeNull();
    expect(
      postingTotals({
        lines: [
          { account: 'a', debit: 5 },
          { account: 'b', credit: 5 },
        ],
      }),
    ).toEqual({ debit: 5, credit: 5 });
  });
});

// ---- the property test: 500 random documents always balance --------------------------------------------------------------
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
describe('property: 500 random documents balance', () => {
  it('invoices, credit notes, purchases, debit notes, payments, expenses and income', () => {
    const rand = rng(20261110);
    const money = (max) => r2(rand() * max);
    const pick = (a) => a[Math.floor(rand() * a.length)];
    const modes = ['cash', 'upi', 'bank', 'cheque', 'card'];
    let posted = 0;
    for (let i = 0; i < 500; i++) {
      const taxable = money(100000);
      const rate = pick([0, 5, 12, 18, 28]);
      const inter = rand() < 0.4;
      const tax = r2((taxable * rate) / 100);
      const heads = inter
        ? { cgst: 0, sgst: 0, igst: tax }
        : { cgst: r2(tax / 2), sgst: r2(tax - r2(tax / 2)), igst: 0 };
      const cess = rand() < 0.2 ? money(500) : 0;
      const tcs = rand() < 0.15 ? money(300) : 0;
      const ro = rand() < 0.5 ? r2(rand() - 0.5) : 0;
      const charges = rand() < 0.3 ? money(Math.min(taxable, 500)) : 0;
      const total = r2(taxable + tax + cess + tcs + ro);
      const pays = Array.from({ length: Math.floor(rand() * 4) }, () => ({
        amount: money(total),
        mode: pick(modes),
        date: '2026-11-07',
      }));
      const docs = [];
      switch (i % 7) {
        case 0:
          docs.push(
            postInvoice({
              id: `i${i}`,
              invoiceType: pick(['tax-invoice', 'bill-of-supply', 'composition']),
              invoiceDate: '2026-11-05',
              partyId: 'p',
              ...heads,
              cess,
              total,
              taxableAmount: taxable,
              tcsAmount: tcs,
              roundOff: ro,
              chargesTaxable: charges,
              payments: pays,
            }),
          );
          break;
        case 1:
          docs.push(
            postInvoice({
              id: `c${i}`,
              invoiceType: 'credit-note',
              invoiceDate: '2026-11-05',
              partyId: 'p',
              ...heads,
              cess,
              total,
              taxableAmount: taxable,
              roundOff: ro,
              refunds: pays,
            }),
          );
          break;
        case 2: {
          const claim = rand();
          const elig = (h) => ({
            cgst: r2(h.cgst * claim),
            sgst: r2(h.sgst * claim),
            igst: r2(h.igst * claim),
            cess: r2(cess * claim),
          });
          const e = elig(heads);
          const ine = {
            cgst: r2(heads.cgst - e.cgst),
            sgst: r2(heads.sgst - e.sgst),
            igst: r2(heads.igst - e.igst),
            cess: r2(cess - e.cess),
          };
          const ptotal = r2(taxable + tax + cess + ro);
          docs.push(
            postPurchase({
              id: `b${i}`,
              docType: 'bill',
              purchaseDate: '2026-11-05',
              supplierId: 's',
              ...heads,
              cess,
              taxableAmount: taxable,
              total: ptotal,
              tdsAmount: rand() < 0.2 ? money(100) : 0,
              reverseCharge: rand() < 0.2,
              itc: { eligible: e, ineligible: ine },
              payments: pays.map((p) => ({ ...p, amount: Math.min(p.amount, ptotal) })),
            }),
          );
          break;
        }
        case 3:
          docs.push(
            postPurchase({
              id: `d${i}`,
              docType: 'debit-note',
              purchaseDate: '2026-11-05',
              supplierId: 's',
              ...heads,
              cess,
              taxableAmount: taxable,
              total: r2(taxable + tax + cess + ro),
              refundMode: pick(['adjust', 'cash', 'bank']),
            }),
          );
          break;
        case 4:
          docs.push(
            postPayment({
              id: `p${i}`,
              direction: pick(['in', 'out']),
              source: 'receipt',
              partyId: 'p',
              amount: money(50000) + 1,
              tdsAmount: rand() < 0.4 ? money(500) : 0,
              discountAmount: rand() < 0.4 ? money(300) : 0,
              mode: pick(modes),
              paymentDate: '2026-11-06',
            }),
          );
          break;
        case 5:
          docs.push(
            postExpense({
              id: `e${i}`,
              expenseDate: '2026-11-06',
              amount: taxable + 1,
              taxAmount: tax,
              interstate: inter,
              itcEligible: rand() < 0.6,
              paidAmount: rand() < 0.5 ? null : money(taxable),
              paymentMode: pick(modes),
              payeePartyId: 'x',
            }),
          );
          break;
        default:
          docs.push(
            postIncome({
              id: `n${i}`,
              expenseDate: '2026-11-06',
              amount: taxable + 1,
              taxAmount: tax,
              interstate: inter,
              exempt: rand() < 0.2,
              paidAmount: rand() < 0.5 ? null : money(taxable),
              paymentMode: pick(modes),
            }),
          );
      }
      for (const p of docs[0]) {
        expect(isBalanced(p), `${p.refType} ${p.refId}`).toBe(true);
        for (const l of p.lines) expect(!!l.debit !== !!l.credit, `${p.refId} one side`).toBe(true);
        posted++;
      }
    }
    expect(posted).toBeGreaterThan(500);
  });
});
