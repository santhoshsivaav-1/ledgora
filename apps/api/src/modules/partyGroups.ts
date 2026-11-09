import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema, type Tx } from '@ledgora/db';
import {
  idParam,
  okBody,
  page,
  partyGroup,
  partyGroupDeleteQuery,
  partyGroupInput,
  partyGroupPatch,
  type PartyGroup,
} from '@ledgora/contracts';
import { descendantIds, wouldCycle } from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import { stamps, type Registrar } from '../http.ts';

const { partyGroups, parties, documents } = schema;

// Vyapar parity P1-S1. A party is in a group in either of two places: the typed `parties` table (group_id) or, for
// the billing screens still on the workspace bridge, the `groupId` field of a `clients` document. Counting, the
// delete guard and "move to" cover both, so the Parties screen sees the same numbers whichever store it uses.

export const toPartyGroup = (
  r: typeof partyGroups.$inferSelect,
  partyCount?: number,
): PartyGroup => ({
  id: r.id,
  name: r.name,
  parentId: r.parentId,
  ...(partyCount === undefined ? {} : { partyCount }),
  ...stamps(r),
});

const live = () => isNull(partyGroups.deletedAt);
const clientDocs = (groupIds: string[]) =>
  and(
    eq(documents.collection, 'clients'),
    isNull(documents.deletedAt),
    inArray(sql<string>`${documents.data}->>'groupId'`, groupIds),
  );

/** The same shape as a zod error, so the form can put the message under the right field. */
const invalid = (path: string, message: string) =>
  new AppError('unprocessable', message, [{ path, message }]);

async function liveGroups(tx: Tx) {
  return tx.select().from(partyGroups).where(live()).orderBy(asc(partyGroups.name));
}

async function getGroup(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(partyGroups)
    .where(and(eq(partyGroups.id, id), live()));
  return row;
}

/** Live parties in each group, both stores added together. */
async function partyCounts(tx: Tx, groupIds: string[]) {
  const out = new Map<string, number>();
  if (!groupIds.length) return out;
  const typed = await tx
    .select({ id: parties.groupId, n: sql<number>`count(*)::int` })
    .from(parties)
    .where(and(inArray(parties.groupId, groupIds), isNull(parties.deletedAt)))
    .groupBy(parties.groupId);
  const docs = await tx
    .select({ id: sql<string>`${documents.data}->>'groupId'`, n: sql<number>`count(*)::int` })
    .from(documents)
    .where(clientDocs(groupIds))
    .groupBy(sql`${documents.data}->>'groupId'`);
  for (const r of [...typed, ...docs]) if (r.id) out.set(r.id, (out.get(r.id) ?? 0) + r.n);
  return out;
}

/** A parent must be a live group of this organization (RLS hides the others) and must not create a loop. */
async function checkParent(tx: Tx, id: string | undefined, parentId: string | null | undefined) {
  if (!parentId) return;
  const all = await liveGroups(tx);
  if (!all.some((g) => g.id === parentId)) throw invalid('parentId', 'Parent group not found');
  if (wouldCycle(all, id, parentId))
    throw invalid('parentId', 'A group can not be placed inside itself or one of its own groups');
}

export function partyGroupsModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/party-groups',
    tag: 'Parties',
    summary: 'Every party group, flat, with how many parties each holds',
    response: page(partyGroup),
    handler: async ({ tx }) => {
      const rows = await liveGroups(tx);
      const counts = await partyCounts(
        tx,
        rows.map((r) => r.id),
      );
      return { data: rows.map((r) => toPartyGroup(r, counts.get(r.id) ?? 0)), nextCursor: null };
    },
  });

  route({
    method: 'post',
    path: '/v1/party-groups',
    tag: 'Parties',
    summary: 'Create a party group',
    body: partyGroupInput,
    response: partyGroup,
    status: 201,
    handler: async ({ tx, orgId, body }) => {
      await checkParent(tx, undefined, body.parentId);
      const [row] = await tx
        .insert(partyGroups)
        .values({ orgId, name: body.name, parentId: body.parentId ?? null })
        .returning();
      await audit(tx, orgId, 'party_group.create', 'party_group', row.id, { after: row });
      return toPartyGroup(row, 0);
    },
  });

  route({
    method: 'patch',
    path: '/v1/party-groups/:id',
    tag: 'Parties',
    summary: 'Rename a party group or move it under another',
    params: idParam,
    body: partyGroupPatch,
    response: partyGroup,
    handler: async ({ tx, orgId, params, body }) => {
      const before = await getGroup(tx, params.id);
      if (!before) throw notFound('Party group');
      await checkParent(tx, params.id, body.parentId);
      const [row] = await tx
        .update(partyGroups)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(partyGroups.id, params.id))
        .returning();
      await audit(tx, orgId, 'party_group.update', 'party_group', row.id, { before, after: row });
      const counts = await partyCounts(tx, [row.id]);
      return toPartyGroup(row, counts.get(row.id) ?? 0);
    },
  });

  route({
    method: 'delete',
    path: '/v1/party-groups/:id',
    tag: 'Parties',
    summary:
      'Delete a party group, optionally moving its parties and child groups to another group first',
    params: idParam,
    query: partyGroupDeleteQuery,
    response: okBody,
    handler: async ({ tx, orgId, params, query }) => {
      const before = await getGroup(tx, params.id);
      if (!before) throw notFound('Party group');
      const all = await liveGroups(tx);
      const partyCount = (await partyCounts(tx, [params.id])).get(params.id) ?? 0;
      const childCount = all.filter((g) => g.parentId === params.id).length;
      const { moveTo } = query;

      if (moveTo) {
        if (moveTo === params.id || descendantIds(all, params.id).has(moveTo))
          throw invalid('moveTo', 'Pick a group outside the one being deleted');
        if (!all.some((g) => g.id === moveTo))
          throw invalid('moveTo', 'Group to move to not found');
        await tx
          .update(parties)
          .set({ groupId: moveTo, updatedAt: new Date() })
          .where(and(eq(parties.groupId, params.id), isNull(parties.deletedAt)));
        await tx
          .update(documents)
          .set({
            data: sql`jsonb_set(${documents.data}, '{groupId}', to_jsonb(${moveTo}::text))`,
            updatedAt: new Date(),
          })
          .where(clientDocs([params.id]));
        await tx
          .update(partyGroups)
          .set({ parentId: moveTo, updatedAt: new Date() })
          .where(and(eq(partyGroups.parentId, params.id), live()));
      } else if (partyCount || childCount) {
        const used = [
          partyCount && `${partyCount} ${partyCount === 1 ? 'party' : 'parties'}`,
          childCount && `${childCount} ${childCount === 1 ? 'group' : 'groups'}`,
        ].filter(Boolean);
        const verb = partyCount + childCount === 1 ? 'uses' : 'use';
        throw new AppError(
          'conflict',
          `${used.join(' and ')} ${verb} this group. Move them first`,
          {
            partyCount,
            childCount,
          },
        );
      }

      // Trashed parties may still point here; clear that so the group really goes and a restored party has no dead link.
      await tx.update(parties).set({ groupId: null }).where(eq(parties.groupId, params.id));
      const [row] = await tx
        .update(partyGroups)
        .set({ deletedAt: new Date() })
        .where(eq(partyGroups.id, params.id))
        .returning();
      await audit(tx, orgId, 'party_group.delete', 'party_group', row.id, {
        before,
        after: moveTo ? { movedTo: moveTo, partyCount, childCount } : undefined,
      });
      return { ok: true };
    },
  });
}
