// Vyapar parity P5-S4: the cheque state machine and what each state posts ("Phase 5 test plan": cheque state machine 10).
import { describe, it, expect } from 'vitest';
import {
  ACC,
  ChequeError,
  chequeActions,
  chequeFinal,
  chequeTransition,
  chequeValidTill,
  chequesDue,
  isBalanced,
  isStaleCheque,
  section138,
  isPostDated,
  postCheque,
} from '../src/index.ts';

const BANK = '1101';
const net = (ps, account, party) =>
  Math.round(
    ps
      .flatMap((p) => p.lines)
      .filter((l) => l.account === account && (party === undefined || l.partyId === party))
      .reduce((s, l) => s + (l.debit ?? 0) - (l.credit ?? 0), 0) * 100,
  ) / 100;
const chq = (over = {}) => ({
  id: 'c1',
  direction: 'received',
  status: 'open',
  amount: 8000,
  partyId: 'p1',
  receivedDate: '2026-11-01',
  paymentId: 'pay1',
  number: '000123',
  ...over,
});

describe('cheque state machine', () => {
  it('received: open → deposited → cleared', () => {
    expect(chequeTransition('received', 'open', 'deposit')).toBe('deposited');
    expect(chequeTransition('received', 'deposited', 'clear')).toBe('cleared');
  });
  it('received: deposited → bounced, open → cancelled', () => {
    expect(chequeTransition('received', 'deposited', 'bounce')).toBe('bounced');
    expect(chequeTransition('received', 'open', 'cancel')).toBe('cancelled');
  });
  it('received: an open cheque may be marked cleared or bounced directly (deposited and settled the same day)', () => {
    expect(chequeTransition('received', 'open', 'clear')).toBe('cleared');
    expect(chequeTransition('received', 'open', 'bounce')).toBe('bounced');
  });
  it('a deposited cheque can not be cancelled', () => {
    expect(() => chequeTransition('received', 'deposited', 'cancel')).toThrow(ChequeError);
  });
  it('issued: open → cleared, bounced or cancelled; never deposited', () => {
    expect(chequeTransition('issued', 'open', 'clear')).toBe('cleared');
    expect(chequeTransition('issued', 'open', 'bounce')).toBe('bounced');
    expect(chequeTransition('issued', 'open', 'cancel')).toBe('cancelled');
    expect(() => chequeTransition('issued', 'open', 'deposit')).toThrow(ChequeError);
  });
  it('final states allow nothing', () => {
    for (const s of ['cleared', 'bounced', 'cancelled']) {
      expect(chequeFinal(s)).toBe(true);
      expect(chequeActions('received', s)).toEqual([]);
      expect(chequeActions('issued', s)).toEqual([]);
      for (const a of ['deposit', 'clear', 'bounce', 'cancel'])
        expect(() => chequeTransition('received', s, a)).toThrow(ChequeError);
    }
  });
  it('buttons by status', () => {
    expect(chequeActions('received', 'open')).toEqual(['deposit', 'clear', 'bounce', 'cancel']);
    expect(chequeActions('received', 'deposited')).toEqual(['clear', 'bounce']);
    expect(chequeActions('issued', 'open')).toEqual(['clear', 'bounce', 'cancel']);
  });
});

describe('cheque postings', () => {
  it('with its payment: open and deposited post nothing; the bank moves only on cleared', () => {
    expect(postCheque(chq(), BANK)).toEqual([]);
    expect(postCheque(chq({ status: 'deposited', statusDate: '2026-11-02' }), BANK)).toEqual([]);
    const c = postCheque(chq({ status: 'cleared', statusDate: '2026-11-04' }), BANK);
    expect(c).toHaveLength(1);
    expect(c[0].date).toBe('2026-11-04');
    expect(net(c, BANK)).toBe(8000);
    expect(net(c, ACC.CHEQUES_IN_HAND)).toBe(-8000);
  });
  it('bounced with charges to the party: Dr Receivable / Cr Other Income; to us: Dr Bank Charges / Cr Bank', () => {
    const party = postCheque(
      chq({ status: 'bounced', statusDate: '2026-11-05', bounceCharges: 250 }),
      BANK,
    );
    expect(net(party, ACC.RECEIVABLE, 'p1')).toBe(250);
    expect(net(party, ACC.OTHER_INCOME)).toBe(-250);
    expect(net(party, BANK)).toBe(0);
    const us = postCheque(
      chq({ status: 'bounced', statusDate: '2026-11-05', bounceCharges: 250, chargeTo: 'us' }),
      BANK,
    );
    expect(net(us, ACC.BANK_CHARGES)).toBe(250);
    expect(net(us, BANK)).toBe(-250);
    expect(postCheque(chq({ status: 'bounced', statusDate: '2026-11-05' }), BANK)).toEqual([]);
  });
  it('without a payment the cheque posts its own receipt, and bounce/cancel reverse it (net zero on the party)', () => {
    const open = postCheque(chq({ paymentId: null }), BANK);
    expect(net(open, ACC.CHEQUES_IN_HAND)).toBe(8000);
    expect(net(open, ACC.RECEIVABLE, 'p1')).toBe(-8000);
    for (const status of ['bounced', 'cancelled']) {
      const p = postCheque(chq({ paymentId: null, status, statusDate: '2026-11-06' }), BANK);
      expect(net(p, ACC.CHEQUES_IN_HAND)).toBe(0);
      expect(net(p, ACC.RECEIVABLE, 'p1')).toBe(0);
    }
  });
  it('issued mirrors: created Dr Payable / Cr Cheques Issued; cleared Dr Cheques Issued / Cr Bank; charges always ours', () => {
    const base = { direction: 'issued', paymentId: null, partyId: 's1' };
    const created = postCheque(chq(base), BANK);
    expect(net(created, ACC.PAYABLE, 's1')).toBe(8000);
    expect(net(created, ACC.CHEQUES_ISSUED)).toBe(-8000);
    const cleared = postCheque(chq({ ...base, status: 'cleared', statusDate: '2026-11-03' }), BANK);
    expect(net(cleared, ACC.CHEQUES_ISSUED)).toBe(0);
    expect(net(cleared, BANK)).toBe(-8000);
    const bounced = postCheque(
      chq({
        ...base,
        status: 'bounced',
        statusDate: '2026-11-03',
        bounceCharges: 100,
        chargeTo: 'party',
      }),
      BANK,
    );
    expect(net(bounced, ACC.PAYABLE, 's1')).toBe(0);
    expect(net(bounced, ACC.BANK_CHARGES)).toBe(100);
  });
  it('every state, both directions, with and without payment, balances', () => {
    for (const direction of ['received', 'issued'])
      for (const status of ['open', 'deposited', 'cleared', 'bounced', 'cancelled'])
        for (const paymentId of ['pay1', null])
          for (const p of postCheque(
            chq({ direction, status, paymentId, statusDate: '2026-11-09', bounceCharges: 75 }),
            BANK,
          ))
            expect(isBalanced(p), `${direction} ${status} ${paymentId}`).toBe(true);
  });
});

describe('cheques due and post-dated', () => {
  it('due = open or deposited, dated on or before today + reminder days', () => {
    const list = [
      { id: 'a', status: 'open', chequeDate: '2026-11-12', reminderDays: 3 },
      { id: 'b', status: 'deposited', chequeDate: '2026-11-01' },
      { id: 'c', status: 'open', chequeDate: '2026-11-20', reminderDays: 3 },
      { id: 'd', status: 'cleared', chequeDate: '2026-11-01' },
      { id: 'e', status: 'open', chequeDate: '2026-11-20', reminderDays: 10 },
    ];
    expect(chequesDue(list, '2026-11-10').map((c) => c.id)).toEqual(['a', 'b', 'e']);
  });
  it('a cheque dated after today is post-dated', () => {
    expect(isPostDated('2026-11-11', '2026-11-10')).toBe(true);
    expect(isPostDated('2026-11-10', '2026-11-10')).toBe(false);
  });
});

describe('India: cheque validity (RBI, three months) and the NI Act §138 clock', () => {
  it('a cheque is valid until the day before three months from its date', () => {
    expect(chequeValidTill('2026-01-01')).toBe('2026-03-31');
    expect(chequeValidTill('2026-11-30')).toBe('2027-02-27');
    expect(isStaleCheque('2026-01-01', '2026-03-31')).toBe(false);
    expect(isStaleCheque('2026-01-01', '2026-04-01')).toBe(true);
  });
  it('notice within 30 days of the bounce; then 15 days to pay; then one month to file', () => {
    expect(section138({ bounceDate: '2026-11-05', today: '2026-11-10' })).toMatchObject({
      stage: 'send_notice',
      noticeBy: '2026-12-05',
      daysLeft: 25,
      payBy: null,
    });
    expect(section138({ bounceDate: '2026-11-05', today: '2026-12-06' }).stage).toBe(
      'notice_overdue',
    );
    const served = { bounceDate: '2026-11-05', noticeServedOn: '2026-11-20' };
    expect(section138({ ...served, today: '2026-11-25' })).toMatchObject({
      stage: 'awaiting_payment',
      payBy: '2026-12-05',
      complaintFrom: '2026-12-06',
      complaintBy: '2027-01-05',
      daysLeft: 10,
    });
    expect(section138({ ...served, today: '2026-12-06' }).stage).toBe('complaint_window');
    expect(section138({ ...served, today: '2027-01-06' }).stage).toBe('complaint_lapsed');
  });
});
