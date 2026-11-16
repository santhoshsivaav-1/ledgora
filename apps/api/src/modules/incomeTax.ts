// R2 (docs/FEATURE_GAPS_2026-11.md): income tax for the person behind a business: their taxpayer details, the inputs of a
// return, tax challans, the advance-tax plan, AIS / TIS reconciliation and the ITR-4 file. The maths and the checks are the
// engine's (packages/tax-engine); this loads what they need from the database, seals what is sensitive and answers.
// Nothing here files anything: the person uploads the file on the portal and records the acknowledgement on the pack.
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import {
  advanceTaxQuery,
  aisFormatReportBody,
  aisImportBody,
  aisPreviewBody,
  buildItr3Body,
  buildItr4Body,
  itrDraftBody,
  itrDraftData,
  itrQuery,
  taxChallanBody,
  taxChallanPatch,
  taxChallanQuery,
  taxpayerProfileBody,
  uuid,
  type ItrDraftData,
} from '@ledgora/contracts';
import {
  advanceTaxDates,
  challanKind,
  computeItr4,
  countsAsSales,
  fyBounds,
  gstReturnsModel,
  computeBlocks,
  computeItr3,
  itr3InputChecks,
  itr3Json,
  itr4Eligibility,
  itr4InputChecks,
  itr4Json,
  itrRulesFor as engineRulesFor,
  parseAis,
  formatFingerprint,
  planAdvanceTax,
  projectAnnualProfit,
  reconcileAis,
  tdsBookByCustomer,
  validateItr3Rules,
  validateItr4Rules,
  type AisRow,
  type FilingIssue,
  type Itr3Input,
  type Itr4Input,
} from '@ledgora/tax-engine';
import { ITR3_SCHEMAS, validateItr3Schema } from '@ledgora/tax-engine/itr3-schema';
import { ITR4_SCHEMAS, validateItr4Schema } from '@ledgora/tax-engine/itr4-schema';
import { audit } from '../audit.ts';
import { openField, sealField } from '../crypto.ts';
import { AppError, notFound } from '../errors.ts';
import type { Registrar } from '../http.ts';
import { loadAssetRegister } from './assets.ts';
import { loadBusiness } from './businesses.ts';
import { itr3BooksOf } from './itr3Books.ts';
import { returnDocsOf } from './filing.ts';

const { taxpayerProfiles, itrDrafts, taxChallans, aisImports, filingPacks } = schema;
const idParams = z.object({ id: uuid });
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const n = (v: unknown) => Number(v) || 0;
/** The year's rules; a year the software has none for is the caller's to correct, not a server fault. */
const itrRulesFor = (fy: string) => {
  try {
    return engineRulesFor(fy);
  } catch (e) {
    throw new AppError('unprocessable', (e as Error).message);
  }
};

interface StoredBank {
  id: string;
  ifsc: string;
  bankName: string;
  accountNoSealed: string;
  last4: string;
  accountType: string;
  useForRefund: boolean;
}

async function profileRow(tx: Tx, businessId: string) {
  const [row] = await tx
    .select()
    .from(taxpayerProfiles)
    .where(and(eq(taxpayerProfiles.businessId, businessId), isNull(taxpayerProfiles.deletedAt)));
  return row;
}

/** What a screen may see of the profile: nothing secret, the last digits of the Aadhaar and of each account. */
function profileView(
  env: Parameters<typeof openField>[0],
  orgId: string,
  r: typeof taxpayerProfiles.$inferSelect,
) {
  const aadhaar = openField(env, orgId, r.aadhaarSealed);
  return {
    businessId: r.businessId,
    pan: r.pan,
    firstName: r.firstName,
    middleName: r.middleName,
    surname: r.surname,
    fatherName: r.fatherName,
    dob: r.dob,
    residenceNo: r.residenceNo,
    residenceName: r.residenceName,
    roadOrStreet: r.roadOrStreet,
    locality: r.locality,
    city: r.city,
    stateCode: r.stateCode,
    pinCode: r.pinCode,
    mobile: r.mobile,
    email: r.email,
    hasAadhaar: !!r.aadhaarSealed,
    aadhaarMasked: aadhaar ? `•••• •••• ${aadhaar.slice(-4)}` : '',
    employerCategory: r.employerCategory,
    place: r.place,
    bankAccounts: (r.bankAccounts as StoredBank[]).map((b) => ({
      id: b.id,
      ifsc: b.ifsc,
      bankName: b.bankName,
      accountNoMasked: `•••• ${b.last4}`,
      accountType: b.accountType,
      useForRefund: b.useForRefund,
    })),
    form10Iea: r.form10Iea as { ack: string; filedOn: string } | null,
    updatedAt: r.updatedAt,
  };
}

async function draftOf(tx: Tx, businessId: string, fy: string): Promise<ItrDraftData> {
  const [row] = await tx
    .select()
    .from(itrDrafts)
    .where(
      and(eq(itrDrafts.businessId, businessId), eq(itrDrafts.fy, fy), isNull(itrDrafts.deletedAt)),
    );
  const parsed = itrDraftData.safeParse(row?.data ?? {});
  return parsed.success ? parsed.data : itrDraftData.parse({});
}

/** The books of the year, in the terms an income-tax return needs (see `booksOf` for what each figure means). */
async function booksOf(tx: Tx, biz: Awaited<ReturnType<typeof loadBusiness>>, fy: string) {
  const { start, end } = fyBounds(fy);
  const docs = await returnDocsOf(tx, biz.gstin ?? '');
  const m = gstReturnsModel(docs, { mode: 'fy', fy: { value: fy, from: start, to: end } });
  const a = m.supplies31a as { taxable: number };
  const z = m.zeroRated31b as { taxable: number };
  // Turnover: taxable supplies, exports and exempt supplies of the year. GST is not turnover.
  const turnover = Math.round(n(a.taxable) + n(z.taxable) + n(m.exempt31c));
  // How it was received. The payments on each bill carry their mode; what is not yet received counts with cash, because
  // 6% applies only to what came through a bank or electronic mode (the higher rate is the safe suggestion).
  const sales = (
    m.allFilteredBills as {
      totalAmount?: number;
      payments?: { amount?: number; mode?: string }[];
    }[]
  ).filter((b) => countsAsSales(b as never));
  let invoiced = 0;
  let digital = 0;
  for (const b of sales) {
    invoiced += n(b.totalAmount);
    for (const p of b.payments ?? [])
      if (String(p.mode ?? '').toLowerCase() !== 'cash') digital += n(p.amount);
  }
  const share = invoiced > 0 ? Math.min(1, Math.max(0, digital / invoiced)) : 0;
  const digitalReceipts = Math.round(turnover * share);
  const inYear = (d: unknown) => String(d ?? '') >= start && String(d ?? '') <= end;
  let interestSavings = 0;
  let interestDeposits = 0;
  let dividend = 0;
  for (const i of docs.otherIncome as { date?: string; category?: string; amount?: number }[]) {
    if (!inYear(i.date)) continue;
    const cat = String(i.category ?? '').toLowerCase();
    if (/dividend/.test(cat)) dividend += n(i.amount);
    else if (/saving/.test(cat) && /interest/.test(cat)) interestSavings += n(i.amount);
    else if (/interest/.test(cat)) interestDeposits += n(i.amount);
  }
  const receipts = (docs.receipts as { date?: string }[]).filter((r) => inYear(r.date));
  return {
    fy,
    turnover,
    digitalReceipts,
    cashReceipts: turnover - digitalReceipts,
    digitalShare: Math.round(share * 1000) / 10,
    gstTurnover: biz.gstin ? [{ gstin: biz.gstin, amount: turnover }] : [],
    interestSavings: Math.round(interestSavings),
    interestDeposits: Math.round(interestDeposits),
    dividend: Math.round(dividend),
    tdsFromBooks: tdsBookByCustomer(m.allFilteredBills, receipts) as {
      deductor: string;
      tds: number;
    }[],
  };
}

/** The year's challans, oldest first. */
async function challansOf(tx: Tx, businessId: string, fy: string) {
  return tx
    .select()
    .from(taxChallans)
    .where(
      and(
        eq(taxChallans.businessId, businessId),
        eq(taxChallans.fy, fy),
        isNull(taxChallans.deletedAt),
      ),
    )
    .orderBy(asc(taxChallans.challanDate), asc(taxChallans.serialNo));
}
const challanView = (c: typeof taxChallans.$inferSelect) => ({
  id: c.id,
  businessId: c.businessId,
  fy: c.fy,
  bsr: c.bsrCode,
  date: c.challanDate,
  serial: c.serialNo,
  amount: c.amount,
  note: c.note,
  kind: challanKind(c.challanDate, c.fy),
});

/** The taxpayer as both returns take them: the profile with the sealed bank accounts and Aadhaar opened. */
function taxpayerOf(
  deps: { env: Parameters<typeof openField>[0] },
  orgId: string,
  profile: typeof taxpayerProfiles.$inferSelect,
) {
  const accounts = (profile.bankAccounts as StoredBank[]).map((b) => ({
    ifsc: b.ifsc,
    bankName: b.bankName,
    accountNo: openField(deps.env, orgId, b.accountNoSealed) ?? '',
    accountType: b.accountType as 'SB',
    useForRefund: b.useForRefund,
  }));
  return {
    unreadable: accounts.some((a) => !a.accountNo),
    taxpayer: {
      pan: profile.pan,
      firstName: profile.firstName || undefined,
      middleName: profile.middleName || undefined,
      surname: profile.surname,
      fatherName: profile.fatherName,
      dob: profile.dob,
      residenceNo: profile.residenceNo,
      residenceName: profile.residenceName || undefined,
      roadOrStreet: profile.roadOrStreet || undefined,
      locality: profile.locality,
      city: profile.city,
      stateCode: profile.stateCode,
      pinCode: profile.pinCode,
      mobile: profile.mobile,
      email: profile.email,
      aadhaar: openField(deps.env, orgId, profile.aadhaarSealed) || undefined,
      employerCategory: profile.employerCategory as Itr4Input['taxpayer']['employerCategory'],
      bankAccounts: accounts,
      place: profile.place,
    },
  };
}

export function incomeTaxModule({ route }: Registrar) {
  // ---- taxpayer profile ---------------------------------------------------------------------------------------------
  route({
    method: 'get',
    path: '/v1/taxpayer-profile',
    tag: 'Income tax',
    summary:
      'The taxpayer behind a business: PAN, address, bank accounts (numbers masked), Form 10-IEA; null before it is filled',
    permission: 'filing:prepare',
    query: z.object({ businessId: uuid }),
    handler: async ({ tx, orgId, deps, query }) => {
      await loadBusiness(tx, query.businessId);
      const row = await profileRow(tx, query.businessId);
      return { profile: row ? profileView(deps.env, orgId, row) : null };
    },
  });

  route({
    method: 'put',
    path: '/v1/taxpayer-profile',
    tag: 'Income tax',
    summary:
      'Save the taxpayer details. A blank Aadhaar or account number keeps the one saved; both are sealed at rest',
    permission: 'filing:prepare',
    body: taxpayerProfileBody,
    handler: async ({ tx, orgId, deps, body }) => {
      const biz = await loadBusiness(tx, body.businessId);
      const existing = await profileRow(tx, body.businessId);
      const stored = (existing?.bankAccounts ?? []) as StoredBank[];
      if (body.bankAccounts.filter((b) => b.useForRefund).length > 1)
        throw new AppError('unprocessable', 'Mark only one bank account for refunds');
      const banks: StoredBank[] = body.bankAccounts.map((b) => {
        const old = b.id ? stored.find((s) => s.id === b.id) : undefined;
        const number = (b.accountNo ?? '').trim();
        if (!number && !old)
          throw new AppError('unprocessable', `Enter the account number for ${b.bankName}`);
        if (number && !/^[A-Za-z0-9][A-Za-z0-9/-]{0,19}$/.test(number))
          throw new AppError(
            'unprocessable',
            `The account number for ${b.bankName} has characters a bank account number can not have`,
          );
        return {
          id: old?.id ?? randomUUID(),
          ifsc: b.ifsc,
          bankName: b.bankName,
          accountNoSealed: number ? sealField(deps.env, orgId, number) : old!.accountNoSealed,
          last4: number ? number.slice(-4) : old!.last4,
          accountType: b.accountType,
          useForRefund: b.useForRefund,
        };
      });
      const aadhaarSealed = body.clearAadhaar
        ? ''
        : body.aadhaar
          ? sealField(deps.env, orgId, body.aadhaar)
          : (existing?.aadhaarSealed ?? '');
      const values = {
        pan: body.pan,
        firstName: body.firstName,
        middleName: body.middleName,
        surname: body.surname,
        fatherName: body.fatherName,
        dob: body.dob,
        residenceNo: body.residenceNo,
        residenceName: body.residenceName,
        roadOrStreet: body.roadOrStreet,
        locality: body.locality,
        city: body.city,
        stateCode: body.stateCode,
        pinCode: body.pinCode,
        mobile: body.mobile,
        email: body.email,
        aadhaarSealed,
        employerCategory: body.employerCategory,
        place: body.place,
        bankAccounts: banks,
        form10Iea: body.form10Iea,
      };
      let row: typeof taxpayerProfiles.$inferSelect;
      if (existing)
        [row] = (await tx
          .update(taxpayerProfiles)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(taxpayerProfiles.id, existing.id))
          .returning()) as [typeof row];
      else
        [row] = (await tx
          .insert(taxpayerProfiles)
          .values({ orgId, businessId: body.businessId, ...values })
          .returning()) as [typeof row];
      // The audit row says that the details changed and which fields, never what they were (PAN, Aadhaar, accounts).
      await audit(
        tx,
        orgId,
        existing ? 'taxpayer.update' : 'taxpayer.create',
        'taxpayer_profile',
        row.id,
        {
          after: {
            businessId: body.businessId,
            accounts: banks.length,
            hasAadhaar: !!aadhaarSealed,
          },
        },
      );
      const warnings: string[] = [];
      if (biz.gstin && biz.gstin.slice(2, 12) !== body.pan)
        warnings.push(
          `The PAN inside the business’s GSTIN is ${biz.gstin.slice(2, 12)}; this PAN differs. A proprietor’s GSTIN carries the proprietor’s own PAN`,
        );
      return { profile: profileView(deps.env, orgId, row), warnings };
    },
  });

  // ---- the return's inputs ------------------------------------------------------------------------------------------
  route({
    method: 'get',
    path: '/v1/itr-drafts',
    tag: 'Income tax',
    summary: 'What has been entered for the year’s return (defaults before anything is saved)',
    permission: 'filing:prepare',
    query: itrQuery,
    handler: async ({ tx, query }) => {
      await loadBusiness(tx, query.businessId);
      itrRulesFor(query.fy);
      const [row] = await tx
        .select({ updatedAt: itrDrafts.updatedAt })
        .from(itrDrafts)
        .where(
          and(
            eq(itrDrafts.businessId, query.businessId),
            eq(itrDrafts.fy, query.fy),
            isNull(itrDrafts.deletedAt),
          ),
        );
      return {
        data: await draftOf(tx, query.businessId, query.fy),
        savedAt: row?.updatedAt ?? null,
      };
    },
  });

  route({
    method: 'put',
    path: '/v1/itr-drafts',
    tag: 'Income tax',
    summary: 'Save what has been entered for the year’s return',
    permission: 'filing:prepare',
    body: itrDraftBody,
    handler: async ({ tx, orgId, auth, body }) => {
      await loadBusiness(tx, body.businessId);
      itrRulesFor(body.fy);
      const [row] = await tx
        .select()
        .from(itrDrafts)
        .where(
          and(
            eq(itrDrafts.businessId, body.businessId),
            eq(itrDrafts.fy, body.fy),
            isNull(itrDrafts.deletedAt),
          ),
        );
      if (row)
        await tx
          .update(itrDrafts)
          .set({ data: body.data, updatedBy: auth.user.id, updatedAt: new Date() })
          .where(eq(itrDrafts.id, row.id));
      else
        await tx.insert(itrDrafts).values({
          orgId,
          businessId: body.businessId,
          fy: body.fy,
          data: body.data,
          updatedBy: auth.user.id,
        });
      return { ok: true };
    },
  });

  route({
    method: 'get',
    path: '/v1/itr-books',
    tag: 'Income tax',
    summary:
      'The year’s figures from the books, to start a return from: turnover and how it was received, GST turnover, interest, dividend and the TDS customers deducted',
    permission: 'filing:prepare',
    query: itrQuery,
    handler: async ({ tx, query }) => {
      const biz = await loadBusiness(tx, query.businessId);
      itrRulesFor(query.fy);
      return booksOf(tx, biz, query.fy);
    },
  });

  // ---- challans -----------------------------------------------------------------------------------------------------
  route({
    method: 'get',
    path: '/v1/tax-challans',
    tag: 'Income tax',
    summary:
      'The challans paid for a year (advance tax, then self-assessment tax), each marked by its date',
    permission: 'filing:read',
    query: taxChallanQuery,
    handler: async ({ tx, query }) => {
      await loadBusiness(tx, query.businessId);
      const where = [eq(taxChallans.businessId, query.businessId), isNull(taxChallans.deletedAt)];
      if (query.fy) where.push(eq(taxChallans.fy, query.fy));
      const rows = await tx
        .select()
        .from(taxChallans)
        .where(and(...where))
        .orderBy(desc(taxChallans.challanDate), desc(taxChallans.serialNo));
      return { data: rows.map(challanView) };
    },
  });

  const checkChallan = (b: { fy: string; date: string }) => {
    itrRulesFor(b.fy);
    if (b.date < fyBounds(b.fy).start)
      throw new AppError(
        'unprocessable',
        `A challan dated ${b.date} can not be tax for FY ${b.fy}, which began on ${fyBounds(b.fy).start}`,
      );
    if (b.date > today()) throw new AppError('unprocessable', 'The challan is dated in the future');
  };
  const duplicate = (e: unknown) => {
    if (
      /tax_challans_identity|duplicate key/.test(
        String((e as { message?: string; cause?: { message?: string } })?.message ?? '') +
          String((e as { cause?: { message?: string } })?.cause?.message ?? ''),
      )
    )
      throw new AppError(
        'conflict',
        'This challan (BSR code, date and serial number) is already recorded',
      );
    throw e;
  };

  route({
    method: 'post',
    path: '/v1/tax-challans',
    tag: 'Income tax',
    summary:
      'Record a challan paid on the portal. BSR code, date and serial number identify it; a repeat is refused',
    permission: 'filing:prepare',
    body: taxChallanBody,
    status: 201,
    handler: async ({ tx, orgId, body }) => {
      await loadBusiness(tx, body.businessId);
      checkChallan(body);
      const [dup] = await tx
        .select({ id: taxChallans.id })
        .from(taxChallans)
        .where(
          and(
            eq(taxChallans.businessId, body.businessId),
            eq(taxChallans.bsrCode, body.bsr),
            eq(taxChallans.challanDate, body.date),
            eq(taxChallans.serialNo, body.serial),
            isNull(taxChallans.deletedAt),
          ),
        );
      if (dup) duplicate({ message: 'tax_challans_identity' });
      const [row] = await tx
        .insert(taxChallans)
        .values({
          orgId,
          businessId: body.businessId,
          fy: body.fy,
          bsrCode: body.bsr,
          challanDate: body.date,
          serialNo: body.serial,
          amount: body.amount,
          note: body.note,
        })
        .returning();
      return challanView(row!);
    },
  });

  route({
    method: 'patch',
    path: '/v1/tax-challans/:id',
    tag: 'Income tax',
    summary: 'Correct a challan',
    permission: 'filing:prepare',
    params: idParams,
    body: taxChallanPatch,
    handler: async ({ tx, params, body }) => {
      const [cur] = await tx
        .select()
        .from(taxChallans)
        .where(and(eq(taxChallans.id, params.id), isNull(taxChallans.deletedAt)));
      if (!cur) throw notFound('Challan');
      const next = { fy: body.fy ?? cur.fy, date: body.date ?? cur.challanDate };
      checkChallan(next);
      try {
        const [row] = await tx
          .update(taxChallans)
          .set({
            fy: next.fy,
            challanDate: next.date,
            ...(body.bsr !== undefined ? { bsrCode: body.bsr } : {}),
            ...(body.serial !== undefined ? { serialNo: body.serial } : {}),
            ...(body.amount !== undefined ? { amount: body.amount } : {}),
            ...(body.note !== undefined ? { note: body.note } : {}),
            updatedAt: new Date(),
          })
          .where(eq(taxChallans.id, params.id))
          .returning();
        return challanView(row!);
      } catch (e) {
        return duplicate(e);
      }
    },
  });

  route({
    method: 'delete',
    path: '/v1/tax-challans/:id',
    tag: 'Income tax',
    summary: 'Remove a challan recorded by mistake (the edit log keeps what it was)',
    permission: 'filing:prepare',
    params: idParams,
    handler: async ({ tx, params }) => {
      const [cur] = await tx
        .select({ id: taxChallans.id })
        .from(taxChallans)
        .where(and(eq(taxChallans.id, params.id), isNull(taxChallans.deletedAt)));
      if (!cur) throw notFound('Challan');
      await tx
        .update(taxChallans)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(taxChallans.id, params.id));
      return { ok: true };
    },
  });

  // ---- advance tax --------------------------------------------------------------------------------------------------
  route({
    method: 'get',
    path: '/v1/advance-tax',
    tag: 'Income tax',
    summary:
      'Advance tax for the year: the projected tax, the instalments, what has been paid, what to pay now and the interest if nothing more is paid',
    permission: 'filing:prepare',
    query: advanceTaxQuery,
    handler: async ({ tx, query }) => {
      const biz = await loadBusiness(tx, query.businessId);
      const rules = itrRulesFor(query.fy);
      const asOf = query.asOf ?? today();
      const { start, end } = fyBounds(query.fy);
      const profile = await profileRow(tx, query.businessId);
      const draft = await draftOf(tx, query.businessId, query.fy);
      const books = await booksOf(tx, biz, query.fy);
      // The year's receipts: what the person entered for the return if they did, else the books, annualised while the year runs.
      const entered = n(draft.business?.digitalReceipts) + n(draft.business?.cashReceipts);
      const whole = asOf >= end;
      const annual = (v: number) => (whole ? v : projectAnnualProfit(v, start, asOf));
      const digital =
        entered > 0 ? n(draft.business?.digitalReceipts) : annual(books.digitalReceipts);
      const cash = entered > 0 ? n(draft.business?.cashReceipts) : annual(books.cashReceipts);
      const section = draft.business?.section ?? (books.turnover > 0 ? '44AD' : undefined);
      const salary = n(draft.salary?.gross);
      const other =
        n(draft.otherSources.savingsInterest) +
        n(draft.otherSources.depositInterest) +
        n(draft.otherSources.refundInterest) +
        draft.otherSources.dividend.reduce((s, v) => s + n(v), 0) +
        draft.otherSources.other.reduce((s, o) => s + n(o.amount), 0);
      const tds =
        draft.tds.reduce((s, r) => s + n(r.tdsClaimed), 0) +
        (draft.salary?.tds ?? []).reduce((s, r) => s + n(r.tds), 0) +
        draft.tcs.reduce((s, r) => s + n(r.claimed), 0);
      const challans = (await challansOf(tx, query.businessId, query.fy)).map((c) => ({
        bsr: c.bsrCode,
        serial: c.serialNo,
        date: c.challanDate,
        amount: c.amount,
      }));
      const plan = planAdvanceTax({
        fy: query.fy,
        regime: draft.regime,
        dob: profile?.dob ?? '1990-01-01',
        business: section
          ? { section: section as '44AD' | '44ADA', digitalReceipts: digital, cashReceipts: cash }
          : undefined,
        salary,
        otherIncome: other,
        tdsExpected: tds,
        challans,
        asOf,
      });
      return {
        ...plan,
        asOf,
        dueDates: advanceTaxDates(query.fy),
        basis: {
          receiptsFrom: entered > 0 ? 'return' : 'books',
          annualised: !whole && entered === 0,
          digitalReceipts: Math.round(digital),
          cashReceipts: Math.round(cash),
          section: section ?? null,
          regime: draft.regime,
          profileMissing: !profile,
          confidence: rules.confidence.slabs,
        },
      };
    },
  });

  // ---- AIS / TIS ----------------------------------------------------------------------------------------------------
  route({
    method: 'post',
    path: '/v1/ais-imports/preview',
    tag: 'Income tax',
    summary: 'Read an AIS or TIS file (CSV or JSON) and show what was understood; nothing is saved',
    permission: 'filing:prepare',
    body: aisPreviewBody,
    handler: async ({ body }) => {
      const p = parseAis(body.text);
      return { rows: p.rows, errors: p.errors, skipped: p.skipped, mapping: p.mapping };
    },
  });

  route({
    method: 'post',
    path: '/v1/ais-imports/format-report',
    tag: 'Income tax',
    summary:
      'A file did not read well: show, then (send: true) pass on only its column headings to the people who maintain the importer. No values, names or numbers leave',
    permission: 'filing:prepare',
    body: aisFormatReportBody,
    handler: async ({ body }) => {
      const f = formatFingerprint(body.text);
      if (body.send)
        console.info('[ais-format]', JSON.stringify({ at: new Date().toISOString(), ...f }));
      return { ...f, sent: body.send };
    },
  });

  route({
    method: 'post',
    path: '/v1/ais-imports',
    tag: 'Income tax',
    summary:
      'Save the rows of an AIS or TIS file as the person confirmed them (a file of the same kind for the year is replaced)',
    permission: 'filing:prepare',
    body: aisImportBody,
    status: 201,
    handler: async ({ tx, orgId, auth, body }) => {
      await loadBusiness(tx, body.businessId);
      itrRulesFor(body.fy);
      await tx
        .update(aisImports)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(aisImports.businessId, body.businessId),
            eq(aisImports.fy, body.fy),
            eq(aisImports.kind, body.kind),
            isNull(aisImports.deletedAt),
          ),
        );
      const [row] = await tx
        .insert(aisImports)
        .values({
          orgId,
          businessId: body.businessId,
          fy: body.fy,
          kind: body.kind,
          fileName: body.fileName,
          rows: body.rows,
          importedBy: auth.user.id,
        })
        .returning();
      await audit(tx, orgId, 'ais.import', 'ais_import', row!.id, {
        after: { fy: body.fy, kind: body.kind, rows: body.rows.length },
      });
      return { id: row!.id, kind: row!.kind, fy: row!.fy, rows: body.rows.length };
    },
  });

  route({
    method: 'get',
    path: '/v1/ais-imports',
    tag: 'Income tax',
    summary: 'The AIS / TIS files read in for a year, without their rows',
    permission: 'filing:prepare',
    query: itrQuery,
    handler: async ({ tx, query }) => {
      await loadBusiness(tx, query.businessId);
      const rows = await tx
        .select()
        .from(aisImports)
        .where(
          and(
            eq(aisImports.businessId, query.businessId),
            eq(aisImports.fy, query.fy),
            isNull(aisImports.deletedAt),
          ),
        )
        .orderBy(desc(aisImports.createdAt));
      return {
        data: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          fileName: r.fileName,
          rows: (r.rows as unknown[]).length,
          createdAt: r.createdAt,
        })),
      };
    },
  });

  // Static path before `:id`.
  route({
    method: 'get',
    path: '/v1/ais-imports/reconcile',
    tag: 'Income tax',
    summary:
      'AIS / TIS against the books and the return: income lines that differ, TDS by deductor, the receipts against GST turnover, and rows to give feedback on',
    permission: 'filing:prepare',
    query: itrQuery,
    handler: async ({ tx, query }) => {
      const biz = await loadBusiness(tx, query.businessId);
      itrRulesFor(query.fy);
      const files = await tx
        .select()
        .from(aisImports)
        .where(
          and(
            eq(aisImports.businessId, query.businessId),
            eq(aisImports.fy, query.fy),
            isNull(aisImports.deletedAt),
          ),
        );
      if (!files.length) return { imported: false as const };
      const rows = files.flatMap((f) => f.rows as AisRow[]);
      const books = await booksOf(tx, biz, query.fy);
      const draft = await draftOf(tx, query.businessId, query.fy);
      const draftIncome = {
        interestSavings: n(draft.otherSources.savingsInterest) || books.interestSavings,
        interestDeposits: n(draft.otherSources.depositInterest) || books.interestDeposits,
        dividend: draft.otherSources.dividend.reduce((s, v) => s + n(v), 0) || books.dividend,
      };
      const declared =
        n(draft.business?.digitalReceipts) + n(draft.business?.cashReceipts) || books.turnover;
      const tds = draft.tds.length
        ? draft.tds.map((r) => ({ deductor: r.name, tan: r.tan, tds: n(r.tdsClaimed) }))
        : books.tdsFromBooks.map((r) => ({ deductor: r.deductor, tds: r.tds }));
      const r = reconcileAis(rows, {
        gstTurnover: books.turnover,
        declaredReceipts: declared,
        ...draftIncome,
        tds,
      });
      return {
        imported: true as const,
        files: files.map((f) => ({ id: f.id, kind: f.kind, fileName: f.fileName })),
        ...r,
      };
    },
  });

  route({
    method: 'delete',
    path: '/v1/ais-imports/:id',
    tag: 'Income tax',
    summary: 'Remove an imported AIS / TIS file',
    permission: 'filing:prepare',
    params: idParams,
    handler: async ({ tx, params }) => {
      const [cur] = await tx
        .select({ id: aisImports.id })
        .from(aisImports)
        .where(and(eq(aisImports.id, params.id), isNull(aisImports.deletedAt)));
      if (!cur) throw notFound('Import');
      await tx
        .update(aisImports)
        .set({ deletedAt: new Date() })
        .where(eq(aisImports.id, params.id));
      return { ok: true };
    },
  });

  // ---- the ITR-4 file -----------------------------------------------------------------------------------------------
  route({
    method: 'post',
    path: '/v1/filing-packs/build/itr4',
    tag: 'Filing',
    summary:
      'Build the ITR-4 file from the taxpayer details, the entered inputs, the challans and the books, and check it against the department’s rules and schema. ok: false lists what to fix; ok: true returns the file to save as a pack',
    permission: 'filing:prepare',
    body: buildItr4Body,
    handler: async ({ tx, deps, orgId, body }) => {
      const biz = await loadBusiness(tx, body.businessId);
      const rules = itrRulesFor(body.fy);
      const profile = await profileRow(tx, body.businessId);
      if (!profile)
        return {
          ok: false as const,
          issues: [
            {
              id: 'PROFILE',
              severity: 'error',
              code: 'PROFILE_MISSING',
              message: 'Fill in the taxpayer details first (PAN, address, bank account)',
              path: 'profile',
            },
          ] as FilingIssue[],
          computation: null,
          payload: null,
        };
      const draft = await draftOf(tx, body.businessId, body.fy);
      const books = await booksOf(tx, biz, body.fy);
      const { taxpayer, unreadable } = taxpayerOf(deps, orgId, profile);
      const challans = (await challansOf(tx, body.businessId, body.fy)).map((c) => ({
        bsr: c.bsrCode,
        date: c.challanDate,
        serial: c.serialNo,
        amount: c.amount,
      }));
      const d = draft.business;
      // Receipts the person did not enter come from the books.
      const entered = d ? n(d.digitalReceipts) + n(d.cashReceipts) > 0 : false;
      const input: Itr4Input = {
        fy: body.fy,
        filedOn: body.filedOn,
        regime: draft.regime,
        taxpayer,
        business: d
          ? {
              section: d.section,
              code: d.code,
              name: d.name,
              description: d.description || undefined,
              digitalReceipts: entered ? n(d.digitalReceipts) : books.digitalReceipts,
              cashReceipts: entered ? n(d.cashReceipts) : books.cashReceipts,
              declaredIncome: d.declaredIncome,
              gstTurnover: books.gstTurnover,
              particulars: d.particulars,
            }
          : undefined,
        salary: draft.salary ?? undefined,
        otherSources: draft.otherSources,
        deductions: draft.deductions,
        tds: draft.tds,
        tcs: draft.tcs,
        challans,
        form10IEA: (profile.form10Iea as { ack: string; filedOn: string } | null) ?? undefined,
        declarations: draft.declarations,
        swCode: deps.env.ITR_SW_CODE,
      };
      const issues: FilingIssue[] = [...itr4Eligibility(input, rules), ...itr4InputChecks(input)];
      if (unreadable)
        issues.push({
          id: 'ACCOUNT_UNREADABLE',
          severity: 'error',
          code: 'ACCOUNT_UNREADABLE',
          message:
            'A saved bank account number can not be read back; enter it again on the taxpayer details',
          path: 'taxpayer.bankAccounts',
        });
      const blocked = issues.some((i) => i.severity === 'error');
      if (blocked) return { ok: false as const, issues, computation: null, payload: null };
      const computation = computeItr4(input, rules);
      const payload = itr4Json(input, computation, rules);
      issues.push(...validateItr4Rules(payload, rules));
      if (rules.itr4SchemaAy && ITR4_SCHEMAS[rules.itr4SchemaAy])
        issues.push(...validateItr4Schema(payload, rules.itr4SchemaAy));
      if (!deps.env.ITR_SW_CODE)
        issues.push({
          id: 'SW_CODE_UNREGISTERED',
          severity: 'warning',
          code: 'SW_CODE_UNREGISTERED',
          message:
            'This software has no registration code from the Income Tax Department yet (ITR_SW_CODE), so the file carries a placeholder. The portal may refuse the upload: try the file on the portal and tell the software’s owner what it says',
          path: 'CreationInfo',
        });
      if (!rules.itr4SchemaAy)
        issues.push({
          id: 'ITR4_NO_SCHEMA',
          severity: 'error',
          code: 'ITR4_NO_SCHEMA',
          message: `The ITR-4 format for ${rules.label} is not published yet`,
          path: '',
        });
      const ok = !issues.some((i) => i.severity === 'error');
      return {
        ok,
        kind: 'itr4' as const,
        period: `03${Number(body.fy.slice(0, 4)) + 1}`,
        issues,
        computation,
        payload: ok ? payload : null,
      };
    },
  });

  // ---- the ITR-3 file ------------------------------------------------------------------------------------------------
  route({
    method: 'post',
    path: '/v1/filing-packs/build/itr3',
    tag: 'Filing',
    summary:
      'Build the ITR-3 file (business income from the books) from the ledger, the asset register, the taxpayer details and the entered inputs, and check it against the department’s rules and schema. ok: false lists what to fix; ok: true returns the file to save as a pack',
    permission: 'filing:prepare',
    body: buildItr3Body,
    handler: async ({ tx, deps, orgId, body }) => {
      const biz = await loadBusiness(tx, body.businessId);
      const rules = itrRulesFor(body.fy);
      const fail = (issues: FilingIssue[]) => ({
        ok: false as const,
        issues,
        computation: null,
        payload: null,
        statements: null,
      });
      const profile = await profileRow(tx, body.businessId);
      if (!profile)
        return fail([
          {
            id: 'PROFILE',
            severity: 'error',
            code: 'PROFILE_MISSING',
            message: 'Fill in the taxpayer details first (PAN, address, bank account)',
            path: 'profile',
          },
        ]);
      const draft = await draftOf(tx, body.businessId, body.fy);
      const d3 = draft.itr3;
      if (!d3)
        return fail([
          {
            id: 'ITR3_DRAFT',
            severity: 'error',
            code: 'ITR3_DRAFT',
            message:
              'Fill in the business details for the ITR-3 first (the nature of business, the accounting method and the questions)',
            path: 'itr3',
          },
        ]);
      const { taxpayer, unreadable } = taxpayerOf(deps, orgId, profile);
      const register = await loadAssetRegister(tx, body.businessId);
      const blocks = computeBlocks(body.fy, register.assets, register.openings);
      const ledger = await itr3BooksOf(tx, body.businessId, body.fy, {
        servicesTurnover: d3.servicesTurnover,
        loansAreSecured: d3.loansAreSecured,
        assets: register.assets,
      });
      const booked = await booksOf(tx, biz, body.fy);
      const challans = (await challansOf(tx, body.businessId, body.fy)).map((c) => ({
        bsr: c.bsrCode,
        date: c.challanDate,
        serial: c.serialNo,
        amount: c.amount,
      }));
      const input: Itr3Input = {
        fy: body.fy,
        filedOn: body.filedOn,
        regime: draft.regime,
        taxpayer,
        business: {
          name: d3.business.name,
          code: d3.business.code,
          description: d3.business.description || undefined,
          commencedOn: d3.business.commencedOn,
          method: d3.business.method,
          gstTurnover: booked.gstTurnover,
        },
        books: ledger.books,
        balanceSheet: ledger.balanceSheet,
        adjustments: d3.adjustments,
        blocks,
        audit: d3.audit,
        salary: draft.salary
          ? {
              ...draft.salary,
              employer: d3.employer
                ? { ...d3.employer, nature: taxpayer.employerCategory }
                : undefined,
            }
          : undefined,
        // Interest, dividend and rent in the ledger are included from the books; this holds only income that is not in them.
        otherSources: draft.otherSources,
        deductions: draft.deductions,
        tds: draft.tds,
        tcs: draft.tcs,
        challans,
        form10IEA: (profile.form10Iea as { ack: string; filedOn: string } | null) ?? undefined,
        declarations: d3.declarations,
        swCode: deps.env.ITR_SW_CODE,
      };
      const computation = computeItr3(input, rules);
      const issues: FilingIssue[] = [...ledger.issues, ...itr3InputChecks(input, computation)];
      if (Math.abs(computation.calc.profitBeforeTax - ledger.ledgerNetProfit) > 1)
        issues.push({
          id: 'ITR3_PL_RECONCILE',
          severity: 'error',
          code: 'ITR3_PL_RECONCILE',
          message: `The profit before tax of the return (₹${computation.calc.profitBeforeTax.toLocaleString('en-IN')}) differs from the books' profit and loss account (₹${Math.round(ledger.ledgerNetProfit).toLocaleString('en-IN')}); some account could not be placed. Open the Profit & Loss report and check the accounts`,
          path: 'books',
        });
      if (unreadable)
        issues.push({
          id: 'ACCOUNT_UNREADABLE',
          severity: 'error',
          code: 'ACCOUNT_UNREADABLE',
          message:
            'A saved bank account number can not be read back; enter it again on the taxpayer details',
          path: 'taxpayer.bankAccounts',
        });
      const statements = {
        books: ledger.books,
        balanceSheet: ledger.balanceSheet,
        blocks,
        calc: computation.calc,
      };
      if (issues.some((i) => i.severity === 'error')) return { ...fail(issues), statements };
      const payload = itr3Json(input, computation, rules);
      issues.push(...validateItr3Rules(payload));
      if (rules.itr4SchemaAy && ITR3_SCHEMAS[rules.itr4SchemaAy])
        issues.push(...validateItr3Schema(payload, rules.itr4SchemaAy));
      else
        issues.push({
          id: 'ITR3_NO_SCHEMA',
          severity: 'error',
          code: 'ITR3_NO_SCHEMA',
          message: `The ITR-3 format for ${rules.label} is not published yet`,
          path: '',
        });
      if (!deps.env.ITR_SW_CODE)
        issues.push({
          id: 'SW_CODE_UNREGISTERED',
          severity: 'warning',
          code: 'SW_CODE_UNREGISTERED',
          message:
            'This software has no registration code from the Income Tax Department yet (ITR_SW_CODE), so the file carries a placeholder. The portal may refuse the upload: try the file on the portal and tell the software’s owner what it says',
          path: 'CreationInfo',
        });
      const ok = !issues.some((i) => i.severity === 'error');
      return {
        ok,
        kind: 'itr3' as const,
        period: `03${Number(body.fy.slice(0, 4)) + 1}`,
        issues,
        computation,
        payload: ok ? payload : null,
        statements,
      };
    },
  });

  // ---- the register's income-tax half -------------------------------------------------------------------------------
  route({
    method: 'get',
    path: '/v1/income-tax-calendar',
    tag: 'Income tax',
    summary:
      'The year’s income-tax dates: the advance-tax instalments with what is paid, and the ITR with its pack and status',
    permission: 'filing:read',
    query: itrQuery,
    handler: async ({ tx, query }) => {
      await loadBusiness(tx, query.businessId);
      const rules = itrRulesFor(query.fy);
      const now = today();
      const form = (await draftOf(tx, query.businessId, query.fy)).form;
      const challans = (await challansOf(tx, query.businessId, query.fy)).filter(
        (c) => challanKind(c.challanDate, c.fy) === 'advance',
      );
      const [pack] = await tx
        .select()
        .from(filingPacks)
        .where(
          and(
            eq(filingPacks.businessId, query.businessId),
            eq(filingPacks.kind, form),
            eq(filingPacks.period, `03${Number(query.fy.slice(0, 4)) + 1}`),
            isNull(filingPacks.supersededAt),
            isNull(filingPacks.deletedAt),
          ),
        );
      return {
        fy: query.fy,
        label: rules.label,
        advanceTax: rules.advanceTax.map((a) => ({
          ...a,
          paidByDate: Math.round(
            challans.filter((c) => c.challanDate <= a.dueDate).reduce((s, c) => s + n(c.amount), 0),
          ),
          passed: a.dueDate < now,
        })),
        itr: {
          form: form === 'itr3' ? 'ITR-3' : 'ITR-4',
          dueDate: rules.itr4DueDate,
          confidence: rules.confidence.itr4DueDate,
          schemaAvailable: !!rules.itr4SchemaAy,
          packId: pack?.id ?? null,
          status: pack?.status ?? 'not_started',
          ack: pack?.arn ?? null,
          filedOn: pack?.filedOn ?? null,
          overdue: !pack || pack.status !== 'filed' ? rules.itr4DueDate < now : false,
        },
      };
    },
  });
}
