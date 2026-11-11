// Vyapar parity P5-S4: the cheque register's state machine and what each state posts. Pure functions
// (docs/VYAPAR_IMPLEMENTATION_PHASES.md, P5-S4). The API keeps the cheque row and calls `postCheque` for the ledger.
//
//            ┌─────────┐ deposit  ┌───────────┐ clear   ┌─────────┐
//  create ──► │  open   │ ───────► │ deposited │ ──────► │ cleared │      (received)
//             └────┬────┘          └─────┬─────┘         └─────────┘
//                  │ cancel              │ bounce
//                  ▼                     ▼
//             ┌───────────┐         ┌──────────┐
//             │ cancelled │         │ bounced  │
//             └───────────┘         └──────────┘
//
// An issued cheque is never "deposited" by us: it goes open → cleared when our bank pays it, open → bounced when it
// does not, or open → cancelled. A received cheque may also be marked cleared or bounced straight from open (deposited
// and settled the same day, the way most shops record it).
//
// India-specific rules here: a cheque is valid for three months from its date (RBI, CTS-2010), so a stale cheque can
// not be presented; and a bounced cheque starts the Negotiable Instruments Act §138 / §142 clock (`section138`).

import type { Numeric } from './types.ts';
import { r2 } from './money.ts';
import { ACC, voucher, type Posting } from './posting.ts';
import { addMonths } from './loan.ts';

export const CHEQUE_STATUSES = ['open', 'deposited', 'cleared', 'bounced', 'cancelled'] as const;
export type ChequeStatus = (typeof CHEQUE_STATUSES)[number];
export const CHEQUE_ACTIONS = ['deposit', 'clear', 'bounce', 'cancel'] as const;
export type ChequeAction = (typeof CHEQUE_ACTIONS)[number];
export type ChequeDirection = 'received' | 'issued';

const MACHINE: Record<
  ChequeDirection,
  Partial<Record<ChequeStatus, Partial<Record<ChequeAction, ChequeStatus>>>>
> = {
  received: {
    open: { deposit: 'deposited', clear: 'cleared', bounce: 'bounced', cancel: 'cancelled' },
    deposited: { clear: 'cleared', bounce: 'bounced' },
  },
  issued: {
    open: { clear: 'cleared', bounce: 'bounced', cancel: 'cancelled' },
  },
};

export class ChequeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChequeError';
  }
}

/** The actions a cheque in `status` allows (what the register shows as buttons). Final states allow none. */
export const chequeActions = (direction: ChequeDirection, status: ChequeStatus): ChequeAction[] =>
  Object.keys(MACHINE[direction][status] ?? {}) as ChequeAction[];

/** The status after `action`; throws ChequeError when the cheque can not do that from where it is. */
export function chequeTransition(
  direction: ChequeDirection,
  status: ChequeStatus,
  action: ChequeAction,
) {
  const next = MACHINE[direction][status]?.[action];
  if (!next)
    throw new ChequeError(
      `A ${direction} cheque that is ${status} can not be ${
        { deposit: 'deposited', clear: 'cleared', bounce: 'bounced', cancel: 'cancelled' }[action]
      }`,
    );
  return next;
}

/** States after which the cheque no longer settles anything: its payment is void. */
export const chequeVoid = (status: ChequeStatus) => status === 'bounced' || status === 'cancelled';
/** States that are final: nothing more can happen to the cheque. */
export const chequeFinal = (status: ChequeStatus) =>
  status === 'cleared' || status === 'bounced' || status === 'cancelled';

export interface ChequeDoc {
  id: string;
  direction: ChequeDirection;
  status: ChequeStatus;
  amount: Numeric;
  partyId?: string | null;
  /** When it was received or handed over (the "created" posting date when there is no payment). */
  receivedDate: string;
  /** When the status last changed (the clear / bounce / cancel posting date). */
  statusDate?: string | null;
  /** The payment recorded with the cheque. It posts Dr Cheques in Hand / Cr Receivable (or the issued mirror) itself. */
  paymentId?: string | null;
  bounceCharges?: Numeric;
  /** Received cheques only: charge the bounce fee to the party (default) or bear it ourselves. */
  chargeTo?: 'party' | 'us';
  number?: string;
}

/**
 * Everything a cheque's current state means in the ledger, as `refType: 'cheque'` vouchers (repost replaces what was
 * there before, so a status change is just posting again).
 * - The cheque coming in or going out is posted by its payment when it has one, here only when it has none.
 * - Cleared: Dr Bank / Cr Cheques in Hand (received); Dr Cheques Issued / Cr Bank (issued).
 * - Bounced or cancelled: the party owes again. With a payment that is done by voiding the payment (the caller deletes
 *   it, which reverses its posting and reopens the invoices it paid); without one, here.
 * - Bounce charges: a received cheque's fee charged to the party is Dr Receivable / Cr Other Income; otherwise the bank
 *   took it from us: Dr Bank Charges / Cr Bank.
 * `bankAccount` is the chart code of the bank the cheque was deposited into or drawn on.
 */
export function postCheque(c: ChequeDoc, bankAccount: string): Posting[] {
  const amt = r2(Number(c.amount) || 0);
  if (!(amt > 0)) return [];
  const recv = c.direction === 'received';
  const clearing = recv ? ACC.CHEQUES_IN_HAND : ACC.CHEQUES_ISSUED;
  const control = recv ? ACC.RECEIVABLE : ACC.PAYABLE;
  const party = c.partyId ?? null;
  const on = c.statusDate || c.receivedDate;
  const label = c.number ? `Cheque ${c.number}` : 'Cheque';
  const out: (Posting | null)[] = [];
  if (!c.paymentId) {
    out.push(
      voucher(
        c.receivedDate,
        'cheque',
        c.id,
        recv
          ? [
              { account: clearing, dr: amt, narration: `${label} received` },
              { account: control, cr: amt, partyId: party },
            ]
          : [
              { account: control, dr: amt, partyId: party, narration: `${label} issued` },
              { account: clearing, cr: amt },
            ],
      ),
    );
    if (chequeVoid(c.status))
      out.push(
        voucher(
          on,
          'cheque',
          c.id,
          recv
            ? [
                { account: control, dr: amt, partyId: party, narration: `${label} ${c.status}` },
                { account: clearing, cr: amt },
              ]
            : [
                { account: clearing, dr: amt, narration: `${label} ${c.status}` },
                { account: control, cr: amt, partyId: party },
              ],
        ),
      );
  }
  if (c.status === 'cleared')
    out.push(
      voucher(
        on,
        'cheque',
        c.id,
        recv
          ? [
              { account: bankAccount, dr: amt, narration: `${label} cleared` },
              { account: clearing, cr: amt },
            ]
          : [
              { account: clearing, dr: amt, narration: `${label} cleared` },
              { account: bankAccount, cr: amt },
            ],
      ),
    );
  const fee = r2(Number(c.bounceCharges) || 0);
  if (c.status === 'bounced' && fee > 0)
    out.push(
      voucher(
        on,
        'cheque',
        c.id,
        recv && c.chargeTo !== 'us'
          ? [
              {
                account: ACC.RECEIVABLE,
                dr: fee,
                partyId: party,
                narration: `${label} bounce charges`,
              },
              { account: ACC.OTHER_INCOME, cr: fee },
            ]
          : [
              { account: ACC.BANK_CHARGES, dr: fee, narration: `${label} bounce charges` },
              { account: bankAccount, cr: fee },
            ],
      ),
    );
  return out.filter((p): p is Posting => !!p);
}

/** Days from `a` to `b` ('YYYY-MM-DD'), negative when b is earlier. */
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Cheques due for action (the dashboard's "Cheques due"): still open or deposited, and dated on or before
 * today + their reminder days.
 */
export function chequesDue<
  T extends { status: ChequeStatus; chequeDate: string; reminderDays?: number | null },
>(list: T[], today: string) {
  return list.filter(
    (c) =>
      (c.status === 'open' || c.status === 'deposited') &&
      daysBetween(today, c.chequeDate) <= (c.reminderDays ?? 3),
  );
}

// ---- India: cheque validity and the §138 clock -------------------------------------------------------------------------

const plusDays = (date: string, d: number) => {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};

/** The last day a cheque can be presented: three months from its date, less a day (RBI, from 1 April 2012). */
export const chequeValidTill = (chequeDate: string) => plusDays(addMonths(chequeDate, 3), -1);
/** A cheque presented after its validity is stale: the bank returns it unpaid. */
export const isStaleCheque = (chequeDate: string, on: string) => on > chequeValidTill(chequeDate);

export type Section138Stage =
  'send_notice' | 'notice_overdue' | 'awaiting_payment' | 'complaint_window' | 'complaint_lapsed';

/**
 * The Negotiable Instruments Act clock for a received cheque that bounced (insufficient funds and the like):
 * - the payee must send a written demand notice within 30 days of the bank's return memo (§138(b));
 * - the drawer then has 15 days from receiving the notice to pay (§138(c));
 * - if they do not, a complaint may be filed within one month of that cause of action (§142(1)(b)).
 * Dates are calendar dates; `noticeServedOn` is when the drawer received the notice (when known).
 * This is a reminder, not legal advice: delay in service or a court's condonation can change the dates.
 */
export function section138(o: {
  bounceDate: string;
  noticeServedOn?: string | null;
  today: string;
}) {
  const noticeBy = plusDays(o.bounceDate, 30);
  if (!o.noticeServedOn) {
    const overdue = o.today > noticeBy;
    return {
      stage: (overdue ? 'notice_overdue' : 'send_notice') as Section138Stage,
      noticeBy,
      daysLeft: overdue ? 0 : daysBetween(o.today, noticeBy),
      payBy: null,
      complaintFrom: null,
      complaintBy: null,
    };
  }
  const payBy = plusDays(o.noticeServedOn, 15);
  const complaintFrom = plusDays(payBy, 1);
  const complaintBy = plusDays(addMonths(complaintFrom, 1), -1);
  const stage: Section138Stage =
    o.today <= payBy
      ? 'awaiting_payment'
      : o.today <= complaintBy
        ? 'complaint_window'
        : 'complaint_lapsed';
  return {
    stage,
    noticeBy,
    daysLeft:
      stage === 'awaiting_payment'
        ? daysBetween(o.today, payBy)
        : stage === 'complaint_window'
          ? daysBetween(o.today, complaintBy)
          : 0,
    payBy,
    complaintFrom,
    complaintBy,
  };
}

/**
 * When a payment counts as paid for the GST 180-day rule (CGST Act s.16(2), second proviso; P10-S4): a payment by a
 * cheque in the register counts on the day the cheque cleared, not the day it was handed over; until it clears (open,
 * deposited) it has not paid anything, and a bounced or cancelled cheque never does. Without a register entry the
 * payment's own date stands (D-12). Returns null when it does not count (yet).
 */
export function chequePaidOn(
  paymentDate: string,
  cheque?: { status: ChequeStatus; statusDate?: string | null } | null,
) {
  if (!cheque) return paymentDate;
  if (cheque.status === 'cleared') return cheque.statusDate || paymentDate;
  return null;
}
