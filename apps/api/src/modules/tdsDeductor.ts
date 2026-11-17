// R3 (docs/FEATURE_GAPS_2026-11.md): the deductor's side of TDS on top of the TDS ledger (verify.ts, tdsRules.ts): the quarterly
// register (what a 26Q-type statement reports, with challans, interest and the 234E exposure) and "what should I deduct on this
// payment", which tracks the year's payments to the same payee. It prepares data; it does not produce the department's FVU file.
import { and, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { schema } from '@ledgora/db';
import { tdsComputeQuery, tdsStatementQuery } from '@ledgora/contracts';
import {
  DEDUCTOR_SECTIONS,
  quarterBounds,
  quarterRegister,
  registerCsv,
  tdsQuarter,
  tdsToDeduct,
  type RegisterEntry,
} from '@ledgora/tax-engine';
import { notFound } from '../errors.ts';
import type { Registrar } from '../http.ts';
import { loadBusiness } from './businesses.ts';
import { panFromGstin } from './tdsRules.ts';

const { tdsEntries, parties, payments } = schema;
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

export function tdsDeductorModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/tds/statement',
    tag: 'Tax',
    summary:
      "A quarter's TDS register: deductions by payee and by challan, interest to date, the late-statement fee and what to fix before the statement is prepared",
    query: tdsStatementQuery,
    handler: async ({ tx, query }) => {
      await loadBusiness(tx, query.businessId);
      const fy = `${query.fy}-${String((query.fy + 1) % 100).padStart(2, '0')}`;
      const { from, to } = quarterBounds(query.fy, query.quarter);
      const rows = await tx
        .select()
        .from(tdsEntries)
        .where(
          and(
            eq(tdsEntries.businessId, query.businessId),
            eq(tdsEntries.direction, 'deducted_by_us'),
            gte(tdsEntries.date, from),
            lte(tdsEntries.date, to),
          ),
        );
      const entries: RegisterEntry[] = rows.map((e) => ({
        id: e.id,
        partyName: e.partyName,
        pan: e.pan,
        section: e.section,
        baseAmount: e.baseAmount,
        rate: e.rate,
        tdsAmount: e.tdsAmount,
        date: String(e.date),
        status: e.status as 'accrued' | 'deposited',
        challanNo: e.challanNo,
        bsrCode: e.bsrCode,
        challanDate: e.challanDate ? String(e.challanDate) : null,
      }));
      const register = quarterRegister(entries, {
        fy,
        quarter: query.quarter,
        asOf: today(),
        filedOn: query.filedOn ?? null,
      });
      return {
        ...register,
        csv: registerCsv(register),
        notice:
          "This is the data a statement is prepared from. It is not the department's FVU file and has not been checked by the FVU utility: prepare and validate the statement in the department's utility, or give this to your CA.",
      };
    },
  });

  route({
    method: 'get',
    path: '/v1/tds/compute',
    tag: 'Tax',
    summary:
      'How much TDS to deduct on a payment, given what was already paid to the same payee this financial year (limits, PAN rate, lower-deduction certificate)',
    query: tdsComputeQuery,
    handler: async ({ tx, query }) => {
      await loadBusiness(tx, query.businessId);
      let pan = query.pan ?? '';
      let partyName = '';
      if (query.partyId) {
        const [p] = await tx
          .select({ name: parties.name, gstin: parties.gstin })
          .from(parties)
          .where(eq(parties.id, query.partyId));
        if (!p) throw notFound('Party');
        partyName = p.name;
        pan = pan || panFromGstin(p.gstin);
      }
      const q = tdsQuarter(query.date);
      const fyStart = `${q.fy.slice(0, 4)}-04-01`;
      const fyEnd = `${Number(q.fy.slice(0, 4)) + 1}-03-31`;
      // What the same payee was paid, and what was deducted from it, under this section in the financial year so far.
      const same = query.partyId
        ? eq(tdsEntries.partyId, query.partyId)
        : pan
          ? eq(tdsEntries.pan, pan)
          : sql`false`;
      const [ded] = await tx
        .select({
          paid: sql<number>`coalesce(sum(${tdsEntries.baseAmount}), 0)::float`,
          deducted: sql<number>`coalesce(sum(${tdsEntries.tdsAmount}), 0)::float`,
        })
        .from(tdsEntries)
        .where(
          and(
            eq(tdsEntries.businessId, query.businessId),
            eq(tdsEntries.direction, 'deducted_by_us'),
            eq(tdsEntries.section, query.section),
            gte(tdsEntries.date, fyStart),
            lte(tdsEntries.date, fyEnd),
            sql`${tdsEntries.date} < ${query.date}`,
            same,
          ),
        );
      // A payment made without TDS leaves no TDS entry, but it still counts towards the year's limit: for a chosen party the
      // payments themselves (cash out plus any TDS kept, under this section or none) are the year's total.
      let paidBefore = ded?.paid ?? 0;
      if (query.partyId) {
        const [pay] = await tx
          .select({
            paid: sql<number>`coalesce(sum(${payments.amount} + ${payments.tdsAmount}), 0)::float`,
          })
          .from(payments)
          .where(
            and(
              eq(payments.businessId, query.businessId),
              eq(payments.partyId, query.partyId),
              eq(payments.direction, 'out'),
              isNull(payments.deletedAt),
              gte(payments.paymentDate, fyStart),
              lte(payments.paymentDate, fyEnd),
              sql`${payments.paymentDate} < ${query.date}`,
              or(isNull(payments.tdsSection), eq(payments.tdsSection, query.section)),
            ),
          );
        paidBefore = Math.max(paidBefore, pay?.paid ?? 0);
      }
      const prior = { paid: paidBefore, deducted: ded?.deducted ?? 0 };
      const result = tdsToDeduct({
        section: query.section,
        amount: query.amount,
        paidBefore: prior?.paid ?? 0,
        deductedBefore: prior?.deducted ?? 0,
        pan,
        lowerRate: query.lowerRate ?? null,
      });
      return {
        ...result,
        partyName,
        pan,
        paidBefore: prior?.paid ?? 0,
        deductedBefore: prior?.deducted ?? 0,
        section: query.section,
        sections: DEDUCTOR_SECTIONS.map((s) => ({ code: s.code, label: s.label })),
        note: 'Rates and limits as in force from 1 April 2025. Confirm with your CA before relying on them.',
      };
    },
  });
}
