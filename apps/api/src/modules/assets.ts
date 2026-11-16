// R4.1 (docs/FEATURE_GAPS_2026-11.md): the fixed-asset register. Assets and block openings are stored; the depreciation (income
// tax blocks and Companies Act books) is computed by the tax engine from them every time, so a corrected date, cost or sale
// is always reflected. ITR-3 reads the same schedule (modules/itr3.ts).
import { createHash } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import {
  assetDepreciationBody,
  assetOpeningBody,
  assetOpeningQuery,
  assetScheduleQuery,
  fixedAssetBody,
  fixedAssetPatch,
  fixedAssetQuery,
  uuid,
} from '@ledgora/contracts';
import {
  BLOCKS,
  SCHEDULE_II_LIVES,
  bookRegister,
  computeBlocks,
  fyBounds,
  postJournal,
  type BlockCode,
  type BlockOpening,
  type FixedAsset,
} from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import type { Registrar } from '../http.ts';
import { loadBusiness } from './businesses.ts';
import { accountsByCode, ledgerEnabled, nextCode, repost } from './ledgerRules.ts';
import { guardPeriod } from './saleRules.ts';
import { nextSeriesNumber } from './series.ts';

const { fixedAssets, assetBlockOpenings, accounts, ledgerEntries } = schema;
const idParams = z.object({ id: uuid });
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

const toEngine = (r: typeof fixedAssets.$inferSelect): FixedAsset => ({
  id: r.id,
  name: r.name,
  block: r.block as BlockCode,
  cost: Number(r.cost),
  putToUse: String(r.putToUse),
  ...(r.lifeYears != null ? { lifeYears: r.lifeYears } : {}),
  ...(r.residualPct != null ? { residualPct: Number(r.residualPct) } : {}),
  ...(r.disposalDate
    ? {
        disposal: {
          date: String(r.disposalDate),
          proceeds: Number(r.disposalProceeds ?? 0),
          expenses: Number(r.disposalExpenses ?? 0),
        },
      }
    : {}),
});

const view = (r: typeof fixedAssets.$inferSelect) => ({
  ...toEngine(r),
  note: r.note,
  lifeYears: r.lifeYears,
  residualPct: r.residualPct == null ? null : Number(r.residualPct),
  disposal: toEngine(r).disposal ?? null,
});

/** The register as the engine reads it; also what the ITR-3 builder loads. */
export async function loadAssetRegister(tx: Tx, businessId: string) {
  const rows = await tx
    .select()
    .from(fixedAssets)
    .where(and(eq(fixedAssets.businessId, businessId), isNull(fixedAssets.deletedAt)))
    .orderBy(asc(fixedAssets.putToUse), asc(fixedAssets.createdAt));
  const opens = await tx
    .select()
    .from(assetBlockOpenings)
    .where(
      and(eq(assetBlockOpenings.businessId, businessId), isNull(assetBlockOpenings.deletedAt)),
    );
  const openings: BlockOpening[] = opens.map((o) => ({
    block: o.block as BlockCode,
    fy: o.fy,
    wdv: Number(o.wdv),
    trackedAll: o.trackedAll,
  }));
  return { assets: rows.map(toEngine), openings, rows };
}

/** Everything the depreciation screens and ITR-3 need for one year. */
export async function assetScheduleOf(tx: Tx, businessId: string, fy: string) {
  const { assets, openings } = await loadAssetRegister(tx, businessId);
  const blocks = computeBlocks(fy, assets, openings);
  const book = bookRegister(
    assets.filter((a) => a.putToUse <= fyBounds(fy).end),
    fy,
  );
  const taxDepreciation = blocks.reduce((s, b) => s + b.NetAggregateDepreciation, 0);
  const capitalGain = blocks.reduce((s, b) => s + b.CapGainUs50, 0);
  return { fy, blocks, book, taxDepreciation, capitalGain, openings };
}

export function assetsModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/fixed-assets',
    tag: 'Assets',
    summary:
      'The fixed-asset register, oldest first, with the income-tax blocks and the Companies Act lives it uses',
    permission: 'filing:read',
    query: fixedAssetQuery,
    handler: async ({ tx, query }) => {
      await loadBusiness(tx, query.businessId);
      const { rows, openings } = await loadAssetRegister(tx, query.businessId);
      return {
        data: rows.map(view),
        openings,
        blocks: BLOCKS,
        lives: SCHEDULE_II_LIVES,
      };
    },
  });

  const check = (b: { putToUse?: string; disposal?: { date: string } | null }) => {
    if (b.putToUse && b.putToUse > today())
      throw new AppError('unprocessable', 'The asset is put to use in the future');
    if (b.putToUse && b.disposal && b.disposal.date < b.putToUse)
      throw new AppError('unprocessable', 'The asset is sold before it was put to use');
  };

  route({
    method: 'post',
    path: '/v1/fixed-assets',
    tag: 'Assets',
    summary: 'Add an asset to the register',
    permission: 'filing:prepare',
    body: fixedAssetBody,
    status: 201,
    handler: async ({ tx, orgId, body }) => {
      await loadBusiness(tx, body.businessId);
      check(body);
      const [row] = await tx
        .insert(fixedAssets)
        .values({
          orgId,
          businessId: body.businessId,
          name: body.name,
          block: body.block,
          cost: body.cost,
          putToUse: body.putToUse,
          lifeYears: body.lifeYears,
          residualPct: body.residualPct == null ? null : String(body.residualPct),
          note: body.note,
          disposalDate: body.disposal?.date ?? null,
          disposalProceeds: body.disposal?.proceeds ?? null,
          disposalExpenses: body.disposal ? body.disposal.expenses : null,
        })
        .returning();
      await audit(tx, orgId, 'asset.create', 'fixed_asset', row!.id, {
        after: { name: body.name, cost: body.cost },
      });
      return view(row!);
    },
  });

  route({
    method: 'patch',
    path: '/v1/fixed-assets/:id',
    tag: 'Assets',
    summary: 'Correct an asset, or record its sale (disposal) or clear it',
    permission: 'filing:prepare',
    params: idParams,
    body: fixedAssetPatch,
    handler: async ({ tx, params, body }) => {
      const [cur] = await tx
        .select()
        .from(fixedAssets)
        .where(and(eq(fixedAssets.id, params.id), isNull(fixedAssets.deletedAt)));
      if (!cur) throw notFound('Asset');
      const putToUse = body.putToUse ?? String(cur.putToUse);
      const disposal =
        body.disposal !== undefined
          ? body.disposal
          : cur.disposalDate
            ? { date: String(cur.disposalDate) }
            : null;
      check({ putToUse, disposal });
      const [row] = await tx
        .update(fixedAssets)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.block !== undefined ? { block: body.block } : {}),
          ...(body.cost !== undefined ? { cost: body.cost } : {}),
          ...(body.putToUse !== undefined ? { putToUse: body.putToUse } : {}),
          ...(body.lifeYears !== undefined ? { lifeYears: body.lifeYears } : {}),
          ...(body.residualPct !== undefined
            ? { residualPct: body.residualPct == null ? null : String(body.residualPct) }
            : {}),
          ...(body.note !== undefined ? { note: body.note } : {}),
          ...(body.disposal !== undefined
            ? {
                disposalDate: body.disposal?.date ?? null,
                disposalProceeds: body.disposal?.proceeds ?? null,
                disposalExpenses: body.disposal ? body.disposal.expenses : null,
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(fixedAssets.id, params.id))
        .returning();
      return view(row!);
    },
  });

  route({
    method: 'delete',
    path: '/v1/fixed-assets/:id',
    tag: 'Assets',
    summary: 'Remove an asset added by mistake (the edit log keeps what it was)',
    permission: 'filing:prepare',
    params: idParams,
    handler: async ({ tx, orgId, params }) => {
      const [cur] = await tx
        .select({ id: fixedAssets.id })
        .from(fixedAssets)
        .where(and(eq(fixedAssets.id, params.id), isNull(fixedAssets.deletedAt)));
      if (!cur) throw notFound('Asset');
      await tx
        .update(fixedAssets)
        .set({ deletedAt: new Date() })
        .where(eq(fixedAssets.id, params.id));
      await audit(tx, orgId, 'asset.delete', 'fixed_asset', params.id, {});
      return { ok: true };
    },
  });

  route({
    method: 'get',
    path: '/v1/asset-block-openings',
    tag: 'Assets',
    summary: 'Written-down values brought forward for blocks bought before the register began',
    permission: 'filing:read',
    query: assetOpeningQuery,
    handler: async ({ tx, query }) => {
      await loadBusiness(tx, query.businessId);
      const { openings } = await loadAssetRegister(tx, query.businessId);
      return { data: openings };
    },
  });

  route({
    method: 'put',
    path: '/v1/asset-block-openings',
    tag: 'Assets',
    summary: 'Set the written-down value of a block on 1 April of a year (replaces the one there)',
    permission: 'filing:prepare',
    body: assetOpeningBody,
    handler: async ({ tx, orgId, body }) => {
      await loadBusiness(tx, body.businessId);
      fyBounds(body.fy);
      await tx
        .update(assetBlockOpenings)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(assetBlockOpenings.businessId, body.businessId),
            eq(assetBlockOpenings.fy, body.fy),
            eq(assetBlockOpenings.block, body.block),
            isNull(assetBlockOpenings.deletedAt),
          ),
        );
      const [row] = await tx
        .insert(assetBlockOpenings)
        .values({
          orgId,
          businessId: body.businessId,
          fy: body.fy,
          block: body.block,
          wdv: body.wdv,
          trackedAll: body.trackedAll,
        })
        .returning();
      return { fy: row!.fy, block: row!.block, wdv: Number(row!.wdv), trackedAll: row!.trackedAll };
    },
  });

  route({
    method: 'get',
    path: '/v1/asset-schedule',
    tag: 'Assets',
    summary:
      "The year's depreciation: income-tax blocks (Schedules DPM, DOA, DEP) and the Companies Act books depreciation",
    permission: 'filing:read',
    query: assetScheduleQuery,
    handler: async ({ tx, query }) => {
      await loadBusiness(tx, query.businessId);
      try {
        fyBounds(query.fy);
      } catch (e) {
        throw new AppError('unprocessable', (e as Error).message);
      }
      return assetScheduleOf(tx, query.businessId, query.fy);
    },
  });
  /** A stable id for the year's depreciation journal, so posting again replaces it instead of adding a second. */
  const journalIdOf = (businessId: string, fy: string) => {
    const h = createHash('sha1').update(`depreciation:${businessId}:${fy}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };
  /** The chart account of that name (case does not matter), created in its group the first time it is needed. */
  async function accountNamed(
    tx: Tx,
    orgId: string,
    businessId: string,
    name: string,
    group: string,
    kind: 'asset' | 'expense',
    range: [number, number],
  ) {
    const found = [...(await accountsByCode(tx, businessId)).values()].find(
      (a) => a.name.toLowerCase() === name.toLowerCase() && a.kind === kind,
    );
    if (found) return found;
    const code = await nextCode(tx, businessId, range[0], range[1]);
    const [row] = await tx
      .insert(accounts)
      .values({ orgId, businessId, code, name, group, kind })
      .returning();
    return row!;
  }

  route({
    method: 'post',
    path: '/v1/fixed-assets/post-depreciation',
    tag: 'Assets',
    summary:
      "Post the year's depreciation from the register to the books as one journal (Dr Depreciation, Cr Accumulated Depreciation, dated the last day of the year). Posting again for the same year replaces it",
    permission: 'filing:prepare',
    body: assetDepreciationBody,
    handler: async ({ tx, orgId, auth, body, c }) => {
      await loadBusiness(tx, body.businessId);
      if (!(await ledgerEnabled(tx, body.businessId)))
        throw new AppError(
          'conflict',
          'The ledger is off for this business. Turn it on in Accounting first.',
        );
      let end: string;
      try {
        end = fyBounds(body.fy).end;
      } catch (e) {
        throw new AppError('unprocessable', (e as Error).message);
      }
      await guardPeriod(tx, orgId, auth, body.businessId, end, c.req.header('x-override-reason'));
      const { assets } = await loadAssetRegister(tx, body.businessId);
      const amount = Math.round(
        bookRegister(
          assets.filter((a) => a.putToUse <= end),
          body.fy,
        ).depreciation,
      );
      const id = journalIdOf(body.businessId, body.fy);
      const existing = await tx
        .select({ narration: ledgerEntries.narration })
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.refType, 'journal'), eq(ledgerEntries.refId, id)))
        .limit(1);
      if (amount <= 0) {
        // Nothing to charge: take back a journal posted earlier for this year, if there is one.
        if (existing.length)
          await repost(tx, orgId, {
            businessId: body.businessId,
            refType: 'journal',
            refId: id,
            postings: [],
          });
        return { amount: 0, posted: false, date: end, number: null };
      }
      const expense = await accountNamed(
        tx,
        orgId,
        body.businessId,
        'Depreciation',
        'Indirect expense',
        'expense',
        [5300, 5999],
      );
      const contra = await accountNamed(
        tx,
        orgId,
        body.businessId,
        'Accumulated Depreciation',
        'Fixed assets',
        'asset',
        [1710, 1799],
      );
      const number =
        /^(JV-\d+) · /.exec(existing[0]?.narration ?? '')?.[1] ??
        (await nextSeriesNumber(tx, orgId, body.businessId, 'JV'));
      await repost(tx, orgId, {
        businessId: body.businessId,
        refType: 'journal',
        refId: id,
        postings: postJournal({
          id,
          date: end,
          narration: `${number} · Depreciation for FY ${body.fy} (asset register)`,
          rows: [
            { account: expense.code, debit: amount },
            { account: contra.code, credit: amount },
          ],
        }),
      });
      await audit(tx, orgId, 'asset.depreciation', 'fixed_asset', id, {
        after: { fy: body.fy, amount },
      });
      return { amount, posted: true, date: end, number };
    },
  });
}
