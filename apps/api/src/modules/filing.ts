// File-ready returns (docs/FILE_READY_PLAN.md, Phase 1): filing packs, their review by a CA, the return register and
// the CA's practice view across client organizations. The app never files: a person uploads the pack on the portal and
// records the ARN here. The server re-runs every check on save (tax-engine filing.ts), so what the browser claimed about
// a file never decides whether it is ready.
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { schema, withTenant, type Tx } from '@ledgora/db';
import {
  acknowledgeBody,
  commentBody,
  createFilingPackBody,
  filingCalendarQuery,
  filingPackQuery,
  recordFiledBody,
  reopenBody,
  requestChangesBody,
  reviewNoteBody,
  trackFromBody,
  buildGstr1aBody,
  buildGstr9Body,
  buildCmp08Body,
  uuid,
} from '@ledgora/contracts';
import {
  FILING_KIND_LABELS,
  arnProblem,
  canonicalJson,
  gstDuesForPeriod,
  initialStatus,
  nextStatus,
  periodBoundsOf,
  readiness,
  retPeriodMonths,
  retPeriodOf,
  validateAnyPack,
  packMonths,
  buildGstr9,
  buildCmp08,
  gstr1aPack,
  type FilingAction,
  type FilingIssue,
  type FilingKind,
  type FilingStatus,
} from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import type { Deps, Registrar } from '../http.ts';
import type { OrgContext } from '../middleware/context.ts';
import { rulesOfRole } from '../middleware/permission.ts';
import { sendMail } from '../mail/index.ts';
import { loadBusiness } from './businesses.ts';
import { settingValue } from './settingsStore.ts';

const { filingPacks, filingEvents, businesses, businessSettings, member, user, organizations } =
  schema;
type Pack = typeof filingPacks.$inferSelect;

/** The largest return kept in a pack (a GSTR-1 of a busy month is a few hundred KB). */
const MAX_BYTES = 5 * 1024 * 1024;
const idParams = z.object({ id: uuid });
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const actorName = (a: OrgContext) => a.user.name || a.user.email || a.user.phoneNumber || 'Someone';
/** Which months a filed return locks in Settings > Transaction (sales and purchases of a filed month). */
const LOCKS_MONTHS: readonly FilingKind[] = ['gstr1', 'gstr3b'];

/** A member given a date window (Share with CA) sees only the returns whose period ends inside it. */
const inWindow = (a: Pick<OrgContext, 'dataFrom' | 'dataTo'>, periodTo: string) =>
  (!a.dataFrom || periodTo >= a.dataFrom) && (!a.dataTo || periodTo <= a.dataTo);

async function loadPack(tx: Tx, id: string, a: OrgContext) {
  const [row] = await tx
    .select()
    .from(filingPacks)
    .where(and(eq(filingPacks.id, id), isNull(filingPacks.deletedAt)));
  // Same answer outside the window as for a pack that does not exist.
  if (!row || !inWindow(a, row.periodTo)) throw notFound('Filing pack');
  return row;
}
const isCurrent = (p: Pack) => !p.supersededAt;
const ready = (p: Pack) => readiness(p.issues as FilingIssue[], p.acknowledged as string[]).ready;

async function event(
  tx: Tx,
  a: OrgContext,
  pack: Pack,
  e: { kind: 'comment' | 'status'; body?: string; from?: string | null; to?: string | null },
) {
  await tx.insert(filingEvents).values({
    orgId: a.orgId,
    businessId: pack.businessId,
    packId: pack.id,
    kind: e.kind,
    actorId: a.user.id,
    actorName: actorName(a),
    actorRole: a.role,
    fromStatus: e.from ?? null,
    toStatus: e.to ?? null,
    body: e.body ?? '',
  });
}

/** A pack without its (possibly large) file, for lists. */
const summary = (p: Pack) => ({
  id: p.id,
  businessId: p.businessId,
  kind: p.kind,
  kindLabel: FILING_KIND_LABELS[p.kind as FilingKind] ?? p.kind,
  period: p.period,
  quarterly: p.quarterly,
  periodFrom: p.periodFrom,
  periodTo: p.periodTo,
  version: p.version,
  status: p.status,
  sha256: p.sha256,
  sizeBytes: p.sizeBytes,
  errors: (p.issues as FilingIssue[]).filter((i) => i.severity === 'error').length,
  warnings: (p.issues as FilingIssue[]).filter((i) => i.severity === 'warning').length,
  ready: ready(p),
  reviewRequired: !!p.reviewRequestedAt,
  reviewedBy: p.reviewedBy,
  reviewedAt: p.reviewedAt,
  approvedSha256: p.approvedSha256,
  arn: p.arn,
  filedOn: p.filedOn,
  filedBy: p.filedBy,
  ackFileId: p.ackFileId,
  preparedBy: p.preparedBy,
  current: isCurrent(p),
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

/** Moves a pack along the status rules (tax-engine nextStatus) or answers 409 with the reason. */
function move(p: Pack, action: FilingAction): FilingStatus {
  if (!isCurrent(p))
    throw new AppError('conflict', 'A newer version of this return exists; open that one');
  const to = nextStatus(p.status as FilingStatus, action, {
    ready: ready(p),
    reviewed: !!p.reviewRequestedAt,
    approved: !!p.approvedSha256 && p.approvedSha256 === p.sha256,
  });
  if (typeof to !== 'string') throw new AppError('conflict', to.error);
  return to;
}

/** The GSTR-1 pack of the same period, for the 3B comparison. */
/** The period's GSTR-1 for the 3B comparison: as amended by GSTR-1A when one is saved (3B is locked from 1 + 1A). */
async function gstr1Of(tx: Tx, businessId: string, period: string) {
  const rows = await tx
    .select({ kind: filingPacks.kind, payload: filingPacks.payload })
    .from(filingPacks)
    .where(
      and(
        eq(filingPacks.businessId, businessId),
        inArray(filingPacks.kind, ['gstr1', 'gstr1a']),
        eq(filingPacks.period, period),
        isNull(filingPacks.supersededAt),
        isNull(filingPacks.deletedAt),
      ),
    );
  const amended = rows.find((r) => r.kind === 'gstr1a')?.payload as
    { gstr1_after?: unknown } | undefined;
  return amended?.gstr1_after ?? rows.find((r) => r.kind === 'gstr1')?.payload;
}

/** Adds or removes months from Settings > Transaction "filed months", the lock the save guards read. */
async function setFiledMonths(
  tx: Tx,
  orgId: string,
  businessId: string,
  months: string[],
  on: boolean,
) {
  const [row] = await tx
    .select()
    .from(businessSettings)
    .where(eq(businessSettings.businessId, businessId));
  const prefs = (row?.preferences ?? {}) as { transaction?: { filedMonths?: string[] } };
  const have = new Set(prefs.transaction?.filedMonths ?? []);
  for (const m of months) {
    if (on) have.add(m);
    else have.delete(m);
  }
  const next = {
    ...prefs,
    transaction: { ...(prefs.transaction ?? {}), filedMonths: [...have].sort() },
  };
  if (row)
    await tx
      .update(businessSettings)
      .set({ preferences: next, updatedAt: new Date() })
      .where(eq(businessSettings.id, row.id));
  else await tx.insert(businessSettings).values({ orgId, businessId, preferences: next });
}

/** Months still covered by another filed GST pack of the business (reopening one must not unlock those). */
async function monthsStillFiled(tx: Tx, businessId: string, exceptId: string) {
  const rows = await tx
    .select({ id: filingPacks.id, period: filingPacks.period, quarterly: filingPacks.quarterly })
    .from(filingPacks)
    .where(
      and(
        eq(filingPacks.businessId, businessId),
        eq(filingPacks.status, 'filed'),
        inArray(filingPacks.kind, [...LOCKS_MONTHS]),
        isNull(filingPacks.supersededAt),
        isNull(filingPacks.deletedAt),
      ),
    );
  return new Set(
    rows.filter((r) => r.id !== exceptId).flatMap((r) => retPeriodMonths(r.period, r.quarterly)),
  );
}

/**
 * Tells everyone who may approve the pack that it waits for them: the CA when the business prepared it, the owner (and
 * admins) when the CA prepared it. Never the person who sent it or who prepared it (they can not approve their own).
 * Best effort: a mail failure never fails the request.
 */
async function mailReviewers(deps: Deps, a: OrgContext, pack: Pack, businessName: string) {
  try {
    const rows = await deps.db
      .select({ role: member.role, email: user.email, userId: user.id })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, a.orgId));
    const link = `${deps.env.APP_URL.replace(/\/$/, '')}/filing/${pack.id}`;
    for (const r of rows) {
      if (r.userId === a.user.id || r.userId === pack.preparedBy) continue;
      const rules = await rulesOfRole(deps.db, a.orgId, r.role);
      if (!rules.permissions.includes('filing:approve')) continue;
      const what = `${FILING_KIND_LABELS[pack.kind as FilingKind]} ${pack.period}`;
      await sendMail(deps.env, {
        to: r.email,
        subject: `${businessName}: ${what} is waiting for your review`,
        text: `${actorName(a)} sent ${what} of ${businessName} for your review.\n\nOpen it: ${link}\n\nApprove it, or send it back with what needs to change. Nothing is filed until someone uploads it on the portal.`,
      });
    }
  } catch {
    /* the pack is saved either way; the reviewer also sees it in Practice */
  }
}

// ---- R1 builders --------------------------------------------------------------------------------------------------

/** The live pack of a return, or undefined. */
async function packOf(tx: Tx, businessId: string, kind: FilingKind, period: string) {
  const [p] = await tx
    .select()
    .from(filingPacks)
    .where(
      and(
        eq(filingPacks.businessId, businessId),
        eq(filingPacks.kind, kind),
        eq(filingPacks.period, period),
        isNull(filingPacks.supersededAt),
        isNull(filingPacks.deletedAt),
      ),
    );
  return p;
}

/** GSTR-1A is open only after the period's GSTR-1 is filed and until its GSTR-3B is filed. */
async function assertGstr1aWindow(tx: Tx, businessId: string, period: string) {
  const r1 = await packOf(tx, businessId, 'gstr1', period);
  if (r1?.status !== 'filed')
    throw new AppError(
      'conflict',
      'GSTR-1A opens after GSTR-1 for the period is filed. Record GSTR-1 as filed first',
    );
  const r3 = await packOf(tx, businessId, 'gstr3b', period);
  if (r3?.status === 'filed')
    throw new AppError(
      'conflict',
      'GSTR-3B for the period is filed, so GSTR-1A is closed. Correct it in a later GSTR-1 (amendment tables)',
    );
  return r1;
}

// ---- the return calendar -------------------------------------------------------------------------------------------

/** The month the business chose to start tracking returns from, if it chose one. */
async function trackFromOf(tx: Tx, businessId: string) {
  const [row] = await tx
    .select({ preferences: businessSettings.preferences })
    .from(businessSettings)
    .where(eq(businessSettings.businessId, businessId));
  const v = (row?.preferences as { filing?: { trackFrom?: unknown } } | undefined)?.filing
    ?.trackFrom;
  return typeof v === 'string' && /^\d{4}-\d{2}$/.test(v) ? v : null;
}

const FORM_KIND: Record<string, FilingKind> = {
  'GSTR-1': 'gstr1',
  'GSTR-3B': 'gstr3b',
  'CMP-08': 'cmp08',
};

/** Every GST return due in the financial year starting `fy`, with the pack (if any) and whether it is overdue. */
async function calendarOf(tx: Tx, businessId: string, fy: number) {
  const biz = await loadBusiness(tx, businessId);
  const frequency = await settingValue(tx, businessId, 'gst.frequency');
  const regType = await settingValue(tx, businessId, 'gst.regType');
  const stateCode = (biz.gstin ?? '').slice(0, 2) || null;
  const packs = await tx
    .select()
    .from(filingPacks)
    .where(
      and(
        eq(filingPacks.businessId, businessId),
        isNull(filingPacks.supersededAt),
        isNull(filingPacks.deletedAt),
      ),
    );
  const byKey = new Map(packs.map((p) => [`${p.kind}:${p.period}`, p]));
  const now = today();
  // Returns of months before the business started using the app were most likely filed elsewhere: they are listed,
  // never counted as overdue. Tracking starts with the month before the business was added.
  const added = new Date(biz.createdAt.getTime() + 5.5 * 3_600_000);
  const fallback = new Date(Date.UTC(added.getUTCFullYear(), added.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7);
  // The business may move the start (Return Register › "Track from"), e.g. to the month it moved its books here.
  const tracked = (await trackFromOf(tx, businessId)) ?? fallback;
  const rows = [];
  for (let i = 0; i < 12; i += 1) {
    const m = ((3 + i) % 12) + 1;
    const month = `${m >= 4 ? fy : fy + 1}-${String(m).padStart(2, '0')}`;
    for (const due of gstDuesForPeriod(month, { frequency, regType, stateCode })) {
      const kind = FORM_KIND[due.form] ?? null;
      const pack = kind ? byKey.get(`${kind}:${retPeriodOf(month)}`) : undefined;
      const status = pack?.status ?? 'not_started';
      rows.push({
        form: due.form,
        label: due.label,
        month,
        period: retPeriodOf(month),
        quarterly: kind === 'cmp08' || (frequency === 'qrmp' && !!kind),
        due: due.due,
        optional: !!due.optional,
        kind,
        packId: pack?.id ?? null,
        status,
        arn: pack?.arn ?? null,
        filedOn: pack?.filedOn ?? null,
        beforeTracking: month < tracked,
        overdue: !due.optional && month >= tracked && due.due < now && status !== 'filed',
      });
    }
  }
  return { businessId, gstin: biz.gstin, frequency, regType, fy, trackedFrom: tracked, rows };
}

export function filingModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/filing-packs',
    tag: 'Filing',
    summary: 'The live filing packs (newest period first), without their files',
    permission: 'filing:read',
    query: filingPackQuery,
    handler: async ({ tx, auth, query }) => {
      const where = [isNull(filingPacks.supersededAt), isNull(filingPacks.deletedAt)];
      if (query.businessId) where.push(eq(filingPacks.businessId, query.businessId));
      if (query.kind) where.push(eq(filingPacks.kind, query.kind));
      if (query.status) where.push(eq(filingPacks.status, query.status));
      const rows = await tx
        .select()
        .from(filingPacks)
        .where(and(...where))
        .orderBy(desc(filingPacks.periodTo), asc(filingPacks.kind))
        .limit(500);
      const list = rows.filter((p) => inWindow(auth, p.periodTo)).map(summary);
      return {
        data: query.fy
          ? list.filter(
              (p) => p.periodTo >= `${query.fy}-04-01` && p.periodTo <= `${query.fy! + 1}-03-31`,
            )
          : list,
      };
    },
  });

  route({
    method: 'get',
    path: '/v1/filing-packs/:id',
    tag: 'Filing',
    summary: 'One pack: its file, the checks, what is still open, the timeline and every version',
    permission: 'filing:read',
    params: idParams,
    handler: async ({ tx, auth, params }) => {
      const p = await loadPack(tx, params.id, auth);
      const events = await tx
        .select()
        .from(filingEvents)
        .where(eq(filingEvents.packId, p.id))
        .orderBy(asc(filingEvents.createdAt));
      const versions = await tx
        .select()
        .from(filingPacks)
        .where(
          and(
            eq(filingPacks.businessId, p.businessId),
            eq(filingPacks.kind, p.kind),
            eq(filingPacks.period, p.period),
            isNull(filingPacks.deletedAt),
          ),
        )
        .orderBy(desc(filingPacks.version));
      const biz = await loadBusiness(tx, p.businessId);
      const r = readiness(p.issues as FilingIssue[], p.acknowledged as string[]);
      return {
        ...summary(p),
        business: { id: biz.id, name: biz.name, gstin: biz.gstin },
        payload: p.payload,
        issues: p.issues,
        acknowledged: p.acknowledged,
        open: { errors: r.errors.length, warnings: r.openWarnings.length },
        events: events.map((e) => ({
          id: e.id,
          kind: e.kind,
          at: e.createdAt,
          actorName: e.actorName,
          actorRole: e.actorRole,
          from: e.fromStatus,
          to: e.toStatus,
          body: e.body,
        })),
        versions: versions.map((v) => ({
          id: v.id,
          version: v.version,
          status: v.status,
          sha256: v.sha256,
          createdAt: v.createdAt,
          current: isCurrent(v),
        })),
      };
    },
  });

  route({
    method: 'get',
    path: '/v1/filing-packs/:id/download',
    tag: 'Filing',
    summary: "The pack's file, exactly as checked and approved, to upload on the portal",
    permission: 'filing:read',
    params: idParams,
    handler: async ({ tx, auth, params, c }) => {
      const p = await loadPack(tx, params.id, auth);
      const biz = await loadBusiness(tx, p.businessId);
      const name = `${FILING_KIND_LABELS[p.kind as FilingKind].replace(/[^A-Za-z0-9]+/g, '')}_${biz.gstin || 'business'}_${p.period}_v${p.version}.json`;
      return c.body(JSON.stringify(p.payload, null, 2), 200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
        'X-Content-SHA256': p.sha256,
      });
    },
  });

  route({
    method: 'post',
    path: '/v1/filing-packs',
    tag: 'Filing',
    summary:
      'Save a return as a pack: the server checks it, and a re-save makes a new version (a filed pack must be reopened first)',
    permission: 'filing:prepare',
    body: createFilingPackBody,
    status: 201,
    handler: async ({ tx, orgId, auth, body }) => {
      const biz = await loadBusiness(tx, body.businessId);
      if (!biz.gstin)
        throw new AppError(
          'unprocessable',
          'Add the GSTIN of this business before preparing returns',
        );
      const text = canonicalJson(body.payload);
      if (Buffer.byteLength(text) > MAX_BYTES)
        throw new AppError('unprocessable', 'This return is larger than 5 MB');
      const months = packMonths(body.kind, body.period, body.quarterly);
      const bounds = periodBoundsOf(months);
      if (!bounds)
        throw new AppError(
          'unprocessable',
          body.kind === 'gstr9'
            ? 'GSTR-9 is saved for March of the year it ends (e.g. 032027 for FY 2026-27)'
            : 'A quarterly return period must be the last month of a quarter',
        );
      if (body.kind === 'gstr1a') await assertGstr1aWindow(tx, biz.id, body.period);
      const issues = validateAnyPack(
        body.kind,
        body.payload,
        { gstin: biz.gstin, retPeriod: body.period, quarterly: body.quarterly },
        {
          gstr1: body.kind === 'gstr3b' ? await gstr1Of(tx, biz.id, body.period) : undefined,
          itc2b: body.itc2b ?? null,
        },
      );
      const ids = new Set(issues.map((i) => i.id));
      const acknowledged = [...new Set(body.acknowledged)].filter((id) => ids.has(id));
      const [prev] = await tx
        .select()
        .from(filingPacks)
        .where(
          and(
            eq(filingPacks.businessId, biz.id),
            eq(filingPacks.kind, body.kind),
            eq(filingPacks.period, body.period),
            isNull(filingPacks.supersededAt),
            isNull(filingPacks.deletedAt),
          ),
        )
        .for('update');
      if (prev?.status === 'filed')
        throw new AppError(
          'conflict',
          'This return is recorded as filed. Reopen it first if the record is wrong; corrections to a filed return go in GSTR-1A or the next period',
        );
      const hash = sha256(text);
      if (prev && prev.sha256 === hash && prev.quarterly === body.quarterly) {
        // The same file again: keep the version (and any approval), only take new acknowledgements.
        const merged = [...new Set([...(prev.acknowledged as string[]), ...acknowledged])];
        const [row] = await tx
          .update(filingPacks)
          .set({ acknowledged: merged, updatedAt: new Date() })
          .where(eq(filingPacks.id, prev.id))
          .returning();
        const r = row!;
        if (r.status === 'draft' && ready(r)) {
          const [up] = await tx
            .update(filingPacks)
            .set({ status: 'ready' })
            .where(eq(filingPacks.id, r.id))
            .returning();
          await event(tx, auth, up!, {
            kind: 'status',
            from: 'draft',
            to: 'ready',
            body: 'Warnings acknowledged',
          });
          return { ...summary(up!), unchanged: true };
        }
        return { ...summary(r), unchanged: true };
      }
      if (prev)
        await tx
          .update(filingPacks)
          .set({ supersededAt: new Date(), updatedAt: new Date() })
          .where(eq(filingPacks.id, prev.id));
      const isReady = readiness(issues, acknowledged).ready;
      const [row] = await tx
        .insert(filingPacks)
        .values({
          orgId,
          businessId: biz.id,
          kind: body.kind,
          period: body.period,
          quarterly: body.quarterly,
          periodFrom: bounds.from,
          periodTo: bounds.to,
          version: (prev?.version ?? 0) + 1,
          status: initialStatus(isReady),
          payload: body.payload,
          sha256: hash,
          sizeBytes: Buffer.byteLength(text),
          issues,
          acknowledged,
          itc2b: body.itc2b ?? null,
          preparedBy: auth.user.id,
          // Once a return went to review, every later version of it needs an approval too.
          reviewRequestedAt: prev?.reviewRequestedAt ?? null,
        })
        .returning();
      const pack = row!;
      await event(tx, auth, pack, {
        kind: 'status',
        from: null,
        to: pack.status,
        body: [
          prev ? `Version ${pack.version} replaces version ${prev.version}` : 'Prepared',
          body.note ?? '',
        ]
          .filter(Boolean)
          .join('. '),
      });
      await audit(tx, orgId, 'filing.prepare', 'filing_pack', pack.id, {
        after: {
          kind: pack.kind,
          period: pack.period,
          version: pack.version,
          status: pack.status,
          sha256: hash,
        },
      });
      return summary(pack);
    },
  });

  route({
    method: 'post',
    path: '/v1/filing-packs/:id/acknowledge',
    tag: 'Filing',
    summary:
      'Accept warnings after reading them; a pack with no errors and no open warnings becomes ready',
    permission: 'filing:prepare',
    params: idParams,
    body: acknowledgeBody,
    handler: async ({ tx, auth, params, body }) => {
      const p = await loadPack(tx, params.id, auth);
      if (!isCurrent(p)) throw new AppError('conflict', 'A newer version of this return exists');
      if (!['draft', 'ready', 'changes_requested'].includes(p.status))
        throw new AppError('conflict', 'Warnings can be accepted only before review or filing');
      const ids = new Set(
        (p.issues as FilingIssue[]).filter((i) => i.severity === 'warning').map((i) => i.id),
      );
      const acknowledged = [...new Set(body.acknowledged)].filter((id) => ids.has(id));
      const isReady = readiness(p.issues as FilingIssue[], acknowledged).ready;
      const status = p.status === 'changes_requested' ? p.status : initialStatus(isReady);
      const [row] = await tx
        .update(filingPacks)
        .set({ acknowledged, status, updatedAt: new Date() })
        .where(eq(filingPacks.id, p.id))
        .returning();
      if (status !== p.status)
        await event(tx, auth, row!, {
          kind: 'status',
          from: p.status,
          to: status,
          body: 'Warnings acknowledged',
        });
      return summary(row!);
    },
  });

  const transition = (
    path: string,
    action: FilingAction,
    permission: 'filing:prepare' | 'filing:approve',
    summaryText: string,
    body: z.ZodType<{ note?: string }>,
  ) =>
    route({
      method: 'post',
      path: `/v1/filing-packs/:id/${path}`,
      tag: 'Filing',
      summary: summaryText,
      permission,
      params: idParams,
      body,
      handler: async ({ tx, orgId, auth, params, body: b, deps }) => {
        const p = await loadPack(tx, params.id, auth);
        const to = move(p, action);
        if (action !== 'submit_review' && p.preparedBy === auth.user.id)
          throw new AppError('forbidden', 'The person who prepared a return can not review it');
        const now = new Date();
        const set: Partial<Pack> = { status: to, updatedAt: now };
        if (action === 'submit_review') set.reviewRequestedAt = p.reviewRequestedAt ?? now;
        if (action === 'approve' || action === 'request_changes') {
          set.reviewedBy = auth.user.id;
          set.reviewedAt = now;
          set.approvedSha256 = action === 'approve' ? p.sha256 : null;
        }
        const [row] = await tx
          .update(filingPacks)
          .set(set)
          .where(eq(filingPacks.id, p.id))
          .returning();
        await event(tx, auth, row!, { kind: 'status', from: p.status, to, body: b.note ?? '' });
        await audit(tx, orgId, `filing.${action}`, 'filing_pack', p.id, {
          before: { status: p.status },
          after: { status: to, sha256: p.sha256 },
        });
        if (action === 'submit_review') {
          const biz = await loadBusiness(tx, p.businessId);
          await mailReviewers(deps, auth, row!, biz.name);
        }
        return summary(row!);
      },
    });

  transition(
    'submit-review',
    'submit_review',
    'filing:prepare',
    'Send a ready pack to the CA for review (from then on it needs approval before it is filed)',
    reviewNoteBody,
  );
  transition(
    'approve',
    'approve',
    'filing:approve',
    'Approve the exact file in review (the reviewer must not be its preparer); a later change voids the approval',
    reviewNoteBody,
  );
  transition(
    'request-changes',
    'request_changes',
    'filing:approve',
    'Send the pack back with what needs to change',
    requestChangesBody,
  );

  route({
    method: 'post',
    path: '/v1/filing-packs/:id/comments',
    tag: 'Filing',
    summary: 'Comment on a pack (anyone who can see it: the owner, the accountant, the CA)',
    permission: 'filing:read',
    params: idParams,
    body: commentBody,
    status: 201,
    handler: async ({ tx, auth, params, body }) => {
      const p = await loadPack(tx, params.id, auth);
      await event(tx, auth, p, { kind: 'comment', body: body.body });
      return { ok: true };
    },
  });

  route({
    method: 'post',
    path: '/v1/filing-packs/:id/record-filed',
    tag: 'Filing',
    summary:
      'Record that the pack was uploaded and filed on the portal: the ARN, the date and the acknowledgement; locks its months',
    permission: 'filing:record',
    params: idParams,
    body: recordFiledBody,
    handler: async ({ tx, orgId, auth, params, body }) => {
      const p = await loadPack(tx, params.id, auth);
      const to = move(p, 'record_filed');
      if (p.approvedSha256 && p.approvedSha256 !== p.sha256)
        throw new AppError(
          'conflict',
          'The file changed after it was approved; send it for review again',
        );
      const biz = await loadBusiness(tx, p.businessId);
      if (p.kind !== 'ims') {
        const problem = arnProblem(body.arn ?? '', biz.gstin ?? '');
        if (problem) throw new AppError('unprocessable', problem, { field: 'arn' });
      }
      if (body.filedOn > today())
        throw new AppError('unprocessable', 'The filing date is in the future');
      if (body.filedOn < p.periodTo)
        throw new AppError('unprocessable', 'A return is filed after its period ends');
      const [row] = await tx
        .update(filingPacks)
        .set({
          status: to,
          arn: p.kind === 'ims' ? null : body.arn!,
          filedOn: body.filedOn,
          filedBy: auth.user.id,
          ackFileId: body.ackFileId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(filingPacks.id, p.id))
        .returning();
      if (LOCKS_MONTHS.includes(p.kind as FilingKind))
        await setFiledMonths(tx, orgId, p.businessId, retPeriodMonths(p.period, p.quarterly), true);
      await event(tx, auth, row!, {
        kind: 'status',
        from: p.status,
        to,
        body:
          p.kind === 'ims'
            ? `Actions taken on IMS on ${body.filedOn}`
            : `ARN ${body.arn}, filed on ${body.filedOn}`,
      });
      await audit(tx, orgId, 'filing.filed', 'filing_pack', p.id, {
        after: { arn: body.arn, filedOn: body.filedOn, sha256: p.sha256 },
      });
      return summary(row!);
    },
  });

  route({
    method: 'post',
    path: '/v1/filing-packs/:id/reopen',
    tag: 'Filing',
    summary:
      'Undo a wrong "filed" record (owner or admin, with a reason). It does not un-file anything on the portal',
    permission: 'filing:record',
    params: idParams,
    body: reopenBody,
    handler: async ({ tx, orgId, auth, params, body }) => {
      if (auth.role !== 'owner' && auth.role !== 'admin')
        throw new AppError('forbidden', 'Only the owner or an admin can reopen a filed return');
      const p = await loadPack(tx, params.id, auth);
      const to = move(p, 'reopen');
      const [row] = await tx
        .update(filingPacks)
        .set({
          status: to,
          arn: null,
          filedOn: null,
          filedBy: null,
          ackFileId: null,
          updatedAt: new Date(),
        })
        .where(eq(filingPacks.id, p.id))
        .returning();
      if (LOCKS_MONTHS.includes(p.kind as FilingKind)) {
        const still = await monthsStillFiled(tx, p.businessId, p.id);
        const free = retPeriodMonths(p.period, p.quarterly).filter((m) => !still.has(m));
        if (free.length) await setFiledMonths(tx, orgId, p.businessId, free, false);
      }
      await event(tx, auth, row!, {
        kind: 'status',
        from: p.status,
        to,
        body: `Reopened: ${body.reason}`,
      });
      await audit(tx, orgId, 'filing.reopen', 'filing_pack', p.id, {
        before: { status: p.status, arn: p.arn, filedOn: p.filedOn },
        after: { status: to, reason: body.reason },
      });
      return summary(row!);
    },
  });

  route({
    method: 'post',
    path: '/v1/filing-packs/build/gstr1a',
    tag: 'Filing',
    summary:
      'GSTR-1A: what changed since the filed GSTR-1 (send today’s GSTR-1 file); only between GSTR-1 and GSTR-3B. Returns the file to save',
    permission: 'filing:prepare',
    body: buildGstr1aBody,
    handler: async ({ tx, body }) => {
      const biz = await loadBusiness(tx, body.businessId);
      const filed = await assertGstr1aWindow(tx, biz.id, body.period);
      return {
        kind: 'gstr1a',
        period: body.period,
        payload: gstr1aPack(biz.gstin ?? '', body.period, filed!.payload, body.current),
      };
    },
  });

  route({
    method: 'post',
    path: '/v1/filing-packs/build/gstr9',
    tag: 'Filing',
    summary:
      'GSTR-9 worked out from the financial year’s filed GSTR-1 and GSTR-3B packs (and 2B for Table 8A). Returns the file to save',
    permission: 'filing:prepare',
    body: buildGstr9Body,
    handler: async ({ tx, body }) => {
      const biz = await loadBusiness(tx, body.businessId);
      const filed = await tx
        .select({
          kind: filingPacks.kind,
          payload: filingPacks.payload,
          quarterly: filingPacks.quarterly,
        })
        .from(filingPacks)
        .where(
          and(
            eq(filingPacks.businessId, biz.id),
            eq(filingPacks.status, 'filed'),
            inArray(filingPacks.kind, ['gstr1', 'gstr3b']),
            isNull(filingPacks.supersededAt),
            isNull(filingPacks.deletedAt),
            gte(filingPacks.periodTo, `${body.fy}-04-01`),
            lte(filingPacks.periodTo, `${body.fy + 1}-03-31`),
          ),
        );
      const payload = buildGstr9({
        gstin: biz.gstin ?? '',
        fy: body.fy,
        gstr1: filed.filter((p) => p.kind === 'gstr1').map((p) => p.payload),
        gstr3b: filed.filter((p) => p.kind === 'gstr3b').map((p) => p.payload),
        itc2b: body.itc2b ?? null,
      });
      return { kind: 'gstr9', period: `03${body.fy + 1}`, payload };
    },
  });

  route({
    method: 'post',
    path: '/v1/filing-packs/build/cmp08',
    tag: 'Filing',
    summary:
      'CMP-08 for a quarter at the business’s composition rate (Settings › GST). Returns the file to save',
    permission: 'filing:prepare',
    body: buildCmp08Body,
    handler: async ({ tx, body }) => {
      const biz = await loadBusiness(tx, body.businessId);
      const regType = await settingValue(tx, biz.id, 'gst.regType');
      if (regType !== 'composition')
        throw new AppError(
          'unprocessable',
          'CMP-08 is for composition dealers (Settings › GST › Registration type)',
        );
      const rate = await settingValue(tx, biz.id, 'gst.compRate');
      return {
        kind: 'cmp08',
        period: body.period,
        payload: buildCmp08(biz.gstin ?? '', body.period, body.turnover, rate, body.rcm ?? {}),
      };
    },
  });

  route({
    method: 'put',
    path: '/v1/filing-calendar/track-from',
    tag: 'Filing',
    summary:
      'Set the first month whose returns the register tracks (earlier months are listed, never overdue); null resets it',
    permission: 'filing:prepare',
    body: trackFromBody,
    handler: async ({ tx, orgId, body }) => {
      await loadBusiness(tx, body.businessId);
      const [row] = await tx
        .select()
        .from(businessSettings)
        .where(eq(businessSettings.businessId, body.businessId));
      const prefs = (row?.preferences ?? {}) as { filing?: { trackFrom?: string | null } };
      const next = { ...prefs, filing: { ...(prefs.filing ?? {}), trackFrom: body.month } };
      if (row)
        await tx
          .update(businessSettings)
          .set({ preferences: next, updatedAt: new Date() })
          .where(eq(businessSettings.id, row.id));
      else
        await tx
          .insert(businessSettings)
          .values({ orgId, businessId: body.businessId, preferences: next });
      await audit(tx, orgId, 'filing.track_from', 'business', body.businessId, {
        before: { trackFrom: prefs.filing?.trackFrom ?? null },
        after: { trackFrom: body.month },
      });
      return { businessId: body.businessId, trackFrom: body.month };
    },
  });

  route({
    method: 'get',
    path: '/v1/filing-calendar',
    tag: 'Filing',
    summary:
      'Every GST return due in a financial year, with its pack, status and whether it is overdue',
    permission: 'filing:read',
    query: filingCalendarQuery,
    handler: async ({ tx, query }) => calendarOf(tx, query.businessId, query.fy),
  });

  route({
    method: 'get',
    path: '/v1/practice/clients',
    tag: 'Filing',
    summary:
      "The CA's practice view: every organization where this person reviews returns, with what waits for them and what is overdue",
    access: 'session',
    handler: async ({ auth, deps }) => {
      const rows = await deps.db
        .select({
          orgId: member.organizationId,
          memberId: member.id,
          role: member.role,
          dataFrom: member.dataFrom,
          dataTo: member.dataTo,
          orgName: organizations.name,
        })
        .from(member)
        .innerJoin(organizations, eq(organizations.id, member.organizationId))
        .where(eq(member.userId, auth.user.id));
      const now = today();
      const fy =
        Number(now.slice(5, 7)) >= 4 ? Number(now.slice(0, 4)) : Number(now.slice(0, 4)) - 1;
      const clients = [];
      for (const m of rows) {
        if (m.role === 'owner') continue;
        const rules = await rulesOfRole(deps.db, m.orgId, m.role);
        if (!rules.permissions.includes('filing:approve')) continue;
        const scoped = await withTenant(deps.db, m.orgId, (tx) =>
          tx
            .select({ businessId: schema.memberBusinesses.businessId })
            .from(schema.memberBusinesses)
            .where(eq(schema.memberBusinesses.memberId, m.memberId)),
        );
        const businessIds = scoped.length ? scoped.map((s) => s.businessId) : null;
        const view = await withTenant(
          deps.db,
          m.orgId,
          async (tx) => {
            const bizRows = await tx
              .select({ id: businesses.id, name: businesses.name, gstin: businesses.gstin })
              .from(businesses)
              .where(isNull(businesses.deletedAt));
            const packs = await tx
              .select()
              .from(filingPacks)
              .where(and(isNull(filingPacks.supersededAt), isNull(filingPacks.deletedAt)));
            const out = [];
            for (const b of bizRows) {
              const mine = packs.filter((p) => p.businessId === b.id && inWindow(m, p.periodTo));
              let overdue: { form: string; label: string; due: string }[] = [];
              if (b.gstin) {
                const [cur, prev] = await Promise.all([
                  calendarOf(tx, b.id, fy),
                  calendarOf(tx, b.id, fy - 1),
                ]);
                overdue = [...prev.rows, ...cur.rows]
                  .filter((r) => r.overdue)
                  .map((r) => ({ form: r.form, label: r.label, due: r.due }));
              }
              out.push({
                ...b,
                // Sent for review and not prepared by this CA: theirs to approve.
                waiting: mine
                  .filter((p) => p.status === 'in_review' && p.preparedBy !== auth.user.id)
                  .map((p) => ({ ...summary(p), businessName: b.name })),
                // Prepared by this CA and sent to the business: waiting for the client's approval.
                withClient: mine
                  .filter((p) => p.status === 'in_review' && p.preparedBy === auth.user.id)
                  .map((p) => ({ ...summary(p), businessName: b.name })),
                // Sent back by the business, or approved and not yet recorded as filed.
                toAct: mine
                  .filter(
                    (p) =>
                      (p.status === 'changes_requested' && p.preparedBy === auth.user.id) ||
                      p.status === 'approved',
                  )
                  .map((p) => ({ ...summary(p), businessName: b.name })),
                counts: Object.fromEntries(
                  ['draft', 'ready', 'in_review', 'changes_requested', 'approved', 'filed'].map(
                    (s) => [s, mine.filter((p) => p.status === s).length],
                  ),
                ),
                overdue,
              });
            }
            return out;
          },
          { businessIds, actorId: auth.user.id, ip: auth.ip },
        );
        clients.push({
          orgId: m.orgId,
          orgName: m.orgName,
          role: m.role,
          businesses: view,
          waiting: view.reduce((s, b) => s + b.waiting.length, 0),
          withClient: view.reduce((s, b) => s + b.withClient.length, 0),
          toAct: view.reduce((s, b) => s + b.toAct.length, 0),
          overdue: view.reduce((s, b) => s + b.overdue.length, 0),
        });
      }
      clients.sort(
        (a, b) =>
          b.waiting - a.waiting || b.overdue - a.overdue || a.orgName.localeCompare(b.orgName),
      );
      return { data: clients };
    },
  });
}
