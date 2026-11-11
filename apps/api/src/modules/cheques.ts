// Vyapar parity P5-S4: the cheque register on the API. A cheque is added with its payment (Payment In for a received
// cheque, Payment Out for an issued one, mode cheque), which posts Dr Cheques in Hand / Cr Receivable (or the issued
// mirror) and settles the documents it pays. The state machine is tax-engine cheque.ts; each status change reposts the
// cheque (cashbankRules.ts syncCashbank). Bounce and cancel void the payment, which reopens the invoices it paid.
// India: a stale cheque (more than three months from its date, RBI) can not be deposited or cleared, and a bounced
// received cheque carries the NI Act §138 dates so the owner does not miss the 30-day notice.
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import {
  cheque,
  chequeActionInput,
  chequeInput,
  chequeListQuery,
  chequePatch,
  idParam,
  paymentInput,
} from '@ledgora/contracts';
import {
  ChequeError,
  chequeActions,
  chequeTransition,
  chequeValidTill,
  chequeVoid,
  chequesDue,
  isPostDated,
  isStaleCheque,
  section138,
  type ChequeDirection,
  type ChequeStatus,
} from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import type { Registrar } from '../http.ts';
import { guardPeriod } from './saleRules.ts';
import { recordPayment, voidPayment } from './payments.ts';
import { bankOf, registerCheque, requireCashbank, syncCashbank } from './cashbankRules.ts';

const { cheques, parties } = schema;
const today = () => new Date().toISOString().slice(0, 10);

async function chequeRow(tx: Tx, id: string) {
  const [r] = await tx
    .select({ c: cheques, partyName: parties.name })
    .from(cheques)
    .innerJoin(parties, eq(parties.id, cheques.partyId))
    .where(and(eq(cheques.id, id), isNull(cheques.deletedAt)));
  if (!r) throw notFound('Cheque');
  return r;
}

const toCheque = ({ c, partyName }: { c: typeof cheques.$inferSelect; partyName: string }) => {
  const direction = c.direction as ChequeDirection;
  const status = c.status as ChequeStatus;
  return {
    id: c.id,
    businessId: c.businessId,
    direction,
    partyId: c.partyId,
    partyName,
    number: c.number,
    amount: c.amount,
    chequeDate: c.chequeDate,
    receivedDate: c.receivedDate,
    bankAccountId: c.bankAccountId,
    status,
    statusDate: c.statusDate,
    bounceCharges: c.bounceCharges,
    chargeTo: c.chargeTo as 'party' | 'us',
    paymentId: c.paymentId,
    reminderDays: c.reminderDays,
    notes: c.notes,
    actions: chequeActions(direction, status),
    postDated: isPostDated(c.chequeDate, today()),
    due:
      chequesDue([{ status, chequeDate: c.chequeDate, reminderDays: c.reminderDays }], today())
        .length > 0,
    validTill: chequeValidTill(c.chequeDate),
    stale: (status === 'open' || status === 'deposited') && isStaleCheque(c.chequeDate, today()),
    noticeServedOn: c.noticeServedOn,
    section138:
      direction === 'received' && status === 'bounced' && c.statusDate
        ? section138({ bounceDate: c.statusDate, noticeServedOn: c.noticeServedOn, today: today() })
        : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
};

export function chequesModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/cheques',
    tag: 'Cash & Bank',
    summary: 'The cheque register: received or issued, by status and cheque date',
    query: chequeListQuery,
    response: z.object({ data: z.array(cheque) }),
    handler: async ({ tx, query }) => {
      await requireCashbank(tx, query.businessId);
      const rows = await tx
        .select({ c: cheques, partyName: parties.name })
        .from(cheques)
        .innerJoin(parties, eq(parties.id, cheques.partyId))
        .where(
          and(
            eq(cheques.businessId, query.businessId),
            isNull(cheques.deletedAt),
            query.direction ? eq(cheques.direction, query.direction) : undefined,
            query.status ? eq(cheques.status, query.status) : undefined,
            query.from ? gte(cheques.chequeDate, query.from) : undefined,
            query.to ? lte(cheques.chequeDate, query.to) : undefined,
          ),
        )
        .orderBy(asc(cheques.chequeDate), asc(cheques.createdAt));
      return { data: rows.map(toCheque) };
    },
  });

  route({
    method: 'get',
    path: '/v1/cheques/:id',
    tag: 'Cash & Bank',
    summary: 'One cheque, with the actions its status allows',
    params: idParam,
    response: cheque,
    handler: async ({ tx, params }) => {
      const r = await chequeRow(tx, params.id);
      await requireCashbank(tx, r.c.businessId);
      return toCheque(r);
    },
  });

  route({
    method: 'post',
    path: '/v1/cheques',
    tag: 'Cash & Bank',
    summary:
      'Add a cheque: its payment (mode cheque) is recorded with it and settles the linked documents; the bank moves only when it clears',
    body: chequeInput,
    response: cheque,
    status: 201,
    handler: async ({ tx, orgId, auth, body, c }) => {
      await requireCashbank(tx, body.businessId);
      await guardPeriod(
        tx,
        orgId,
        auth,
        body.businessId,
        body.receivedDate,
        c.req.header('x-override-reason'),
      );
      if (body.bankAccountId) await bankOf(tx, body.businessId, body.bankAccountId);
      const { row } = await recordPayment(
        tx,
        orgId,
        paymentInput.parse({
          businessId: body.businessId,
          partyId: body.partyId,
          amount: body.amount,
          mode: 'cheque',
          paymentDate: body.receivedDate,
          chequeDate: body.chequeDate,
          reference: body.number,
          notes: body.notes,
          direction: body.direction === 'issued' ? 'out' : 'in',
          accountId: body.bankAccountId ?? null,
          allocations: body.allocations,
          autoAllocate: body.autoAllocate,
        }),
      );
      const ch = await registerCheque(tx, orgId, row, {
        number: body.number,
        reminderDays: body.reminderDays,
        notes: body.notes,
      });
      await audit(tx, orgId, 'cheque.create', 'cheque', ch.id, {
        after: { number: ch.number, amount: ch.amount, direction: ch.direction },
      });
      return toCheque(await chequeRow(tx, ch.id));
    },
  });

  route({
    method: 'post',
    path: '/v1/cheques/:id/actions',
    tag: 'Cash & Bank',
    summary:
      'Deposit, clear, bounce or cancel a cheque. Cleared moves the bank; bounced and cancelled void its payment (the invoices reopen) and bounce charges post',
    params: idParam,
    body: chequeActionInput,
    response: cheque,
    handler: async ({ tx, orgId, auth, params, body, c }) => {
      // Two people acting on one cheque at once: the second waits here and then sees the first one's status.
      await tx
        .select({ id: cheques.id })
        .from(cheques)
        .where(eq(cheques.id, params.id))
        .for('update');
      const { c: ch } = await chequeRow(tx, params.id);
      await requireCashbank(tx, ch.businessId);
      let next: ChequeStatus;
      try {
        next = chequeTransition(
          ch.direction as ChequeDirection,
          ch.status as ChequeStatus,
          body.action,
        );
      } catch (e) {
        if (e instanceof ChequeError) throw new AppError('conflict', e.message);
        throw e;
      }
      if (body.date < ch.receivedDate)
        throw new AppError('unprocessable', 'The date can not be before the cheque was received');
      if ((body.action === 'clear' || body.action === 'deposit') && body.date < ch.chequeDate)
        throw new AppError(
          'unprocessable',
          `This cheque is dated ${ch.chequeDate}: it can not be presented before then`,
        );
      if (
        (body.action === 'clear' || body.action === 'deposit') &&
        isStaleCheque(ch.chequeDate, body.date)
      )
        throw new AppError(
          'conflict',
          `This cheque was valid till ${chequeValidTill(ch.chequeDate)} (three months from its date). A stale cheque can not be presented: cancel it and ask for a fresh one.`,
        );
      await guardPeriod(
        tx,
        orgId,
        auth,
        ch.businessId,
        body.date,
        c.req.header('x-override-reason'),
      );
      const bankAccountId = body.bankAccountId ?? ch.bankAccountId;
      if (bankAccountId) await bankOf(tx, ch.businessId, bankAccountId);
      if ((body.action === 'deposit' || body.action === 'clear') && !bankAccountId)
        throw new AppError('unprocessable', 'Choose the bank account', [
          { path: 'bankAccountId', message: 'Choose the bank account' },
        ]);
      const bounce = body.action === 'bounce';
      await tx
        .update(cheques)
        .set({
          status: next,
          statusDate: body.date,
          bankAccountId,
          ...(bounce
            ? {
                bounceCharges: body.bounceCharges,
                chargeTo: ch.direction === 'issued' ? 'us' : body.chargeTo,
              }
            : {}),
          notes: body.note ? [ch.notes, body.note].filter(Boolean).join('\n') : ch.notes,
          updatedAt: new Date(),
        })
        .where(eq(cheques.id, ch.id));
      if (chequeVoid(next) && ch.paymentId) await voidPayment(tx, orgId, ch.paymentId);
      await syncCashbank(tx, orgId, 'cheque', ch.id);
      await audit(tx, orgId, `cheque.${body.action}`, 'cheque', ch.id, {
        before: { status: ch.status },
        after: { status: next, date: body.date, charges: bounce ? body.bounceCharges : undefined },
      });
      return toCheque(await chequeRow(tx, ch.id));
    },
  });

  route({
    method: 'patch',
    path: '/v1/cheques/:id',
    tag: 'Cash & Bank',
    summary:
      'Record when the §138 demand notice reached the drawer of a bounced cheque (starts their 15 days), or change reminder days and notes',
    params: idParam,
    body: chequePatch,
    response: cheque,
    handler: async ({ tx, orgId, params, body }) => {
      const { c: ch } = await chequeRow(tx, params.id);
      await requireCashbank(tx, ch.businessId);
      if (body.noticeServedOn !== undefined && body.noticeServedOn !== null) {
        if (ch.direction !== 'received' || ch.status !== 'bounced')
          throw new AppError(
            'unprocessable',
            'A §138 notice is for a received cheque that bounced',
          );
        if (ch.statusDate && body.noticeServedOn < ch.statusDate)
          throw new AppError('unprocessable', 'The notice can not be before the cheque bounced');
      }
      await tx
        .update(cheques)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(cheques.id, ch.id));
      await audit(tx, orgId, 'cheque.update', 'cheque', ch.id, {
        before: { noticeServedOn: ch.noticeServedOn },
        after: body,
      });
      return toCheque(await chequeRow(tx, ch.id));
    },
  });
}
