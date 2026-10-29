import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import type { TRASH_ENTITIES } from '@ledgora/contracts';
import {
  TRASH_RETENTION_DAYS,
  idParam,
  okBody,
  trashEntry,
  trashQuery,
  type TrashEntry,
} from '@ledgora/contracts';
import { audit } from '../audit.ts';
import { AppError } from '../errors.ts';
import type { Registrar } from '../http.ts';

const s = schema;
type Entity = (typeof TRASH_ENTITIES)[number];

/** Each trashable table, and the text shown for a row in the Trash list. */
const KINDS = {
  invoice: { table: s.invoices, label: sql<string>`${s.invoices.number}` },
  party: { table: s.parties, label: sql<string>`${s.parties.name}` },
  item: { table: s.items, label: sql<string>`${s.items.name}` },
  purchase: {
    table: s.purchases,
    label: sql<string>`coalesce(nullif(${s.purchases.invoiceNumber}, ''), ${s.purchases.supplierName})`,
  },
  expense: {
    table: s.expenses,
    label: sql<string>`coalesce(nullif(${s.expenses.description}, ''), ${s.expenses.vendor})`,
  },
  recurring: { table: s.recurringSchedules, label: sql<string>`${s.recurringSchedules.name}` },
  template: { table: s.termsTemplates, label: sql<string>`${s.termsTemplates.name}` },
} as const satisfies Record<string, { table: unknown; label: unknown }>;
const TYPES = Object.keys(KINDS) as (keyof typeof KINDS)[];

const purgeAt = (deletedAt: Date) =>
  new Date(deletedAt.getTime() + TRASH_RETENTION_DAYS * 86_400_000).toISOString();

async function find(tx: Tx, id: string) {
  for (const type of TYPES) {
    const { table } = KINDS[type];
    const [row] = await tx
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, id), isNotNull(table.deletedAt)));
    if (row) return type;
  }
  throw new AppError('not_in_trash', 'Nothing with this id is in the trash');
}

/** Permanently removes one trashed row and the rows that only exist because of it. */
async function purgeOne(tx: Tx, type: keyof typeof KINDS, id: string) {
  if (type === 'invoice') {
    await tx.delete(s.paymentAllocations).where(eq(s.paymentAllocations.invoiceId, id));
    await tx
      .delete(s.stockMovements)
      .where(and(eq(s.stockMovements.refType, 'invoice'), eq(s.stockMovements.refId, id)));
    await tx.delete(s.invoiceLines).where(eq(s.invoiceLines.invoiceId, id));
  }
  if (type === 'purchase') {
    await tx
      .delete(s.stockMovements)
      .where(and(eq(s.stockMovements.refType, 'purchase'), eq(s.stockMovements.refId, id)));
    await tx.delete(s.purchaseLines).where(eq(s.purchaseLines.purchaseId, id));
  }
  if (type === 'item') await tx.delete(s.stockMovements).where(eq(s.stockMovements.itemId, id));
  const { table } = KINDS[type];
  await tx.delete(table).where(eq(table.id, id));
}

/** Empties everything that has been in the trash longer than the retention period. Safe to call repeatedly. */
export async function purgeExpired(tx: Tx, now = new Date()) {
  const cutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * 86_400_000);
  let purged = 0;
  for (const type of TYPES) {
    const { table } = KINDS[type];
    const rows = await tx
      .select({ id: table.id })
      .from(table)
      .where(and(isNotNull(table.deletedAt), lt(table.deletedAt, cutoff)));
    for (const { id } of rows) {
      try {
        // A savepoint, so a row that is still referenced (a party with invoices) is skipped instead of failing the sweep.
        await tx.transaction((sp) => purgeOne(sp, type, id));
        purged += 1;
      } catch {
        /* still referenced: it stays in the trash */
      }
    }
  }
  // Workspace bills (change 3.23) are trashed the same way and leave with the same 30 days.
  const gone = await tx
    .delete(s.documents)
    .where(and(isNotNull(s.documents.deletedAt), lt(s.documents.deletedAt, cutoff)))
    .returning({ id: s.documents.id });
  purged += gone.length;
  return purged;
}

export function trashModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/trash',
    tag: 'Trash',
    summary: 'Everything deleted in the last 30 days',
    query: trashQuery,
    response: z.object({ data: z.array(trashEntry) }),
    handler: async ({ tx, query }) => {
      const out: TrashEntry[] = [];
      for (const type of TYPES) {
        if (query.type && query.type !== type) continue;
        const { table, label } = KINDS[type];
        const rows = await tx
          .select({ id: table.id, label, deletedAt: table.deletedAt })
          .from(table)
          .where(isNotNull(table.deletedAt));
        for (const r of rows)
          out.push({
            id: r.id,
            entityType: type as Entity,
            label: r.label,
            deletedAt: r.deletedAt!.toISOString(),
            purgeAt: purgeAt(r.deletedAt!),
          });
      }
      out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
      return { data: out };
    },
  });

  route({
    method: 'post',
    path: '/v1/trash/:id/restore',
    tag: 'Trash',
    summary: 'Put a deleted record back',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, params }) => {
      const type = await find(tx, params.id);
      const { table } = KINDS[type];
      if (type === 'invoice') {
        const [inv] = await tx.select().from(s.invoices).where(eq(s.invoices.id, params.id));
        const [clash] = await tx
          .select({ id: s.invoices.id })
          .from(s.invoices)
          .where(
            and(
              eq(s.invoices.businessId, inv.businessId),
              eq(s.invoices.number, inv.number),
              sql`${s.invoices.deletedAt} is null`,
            ),
          );
        if (clash)
          throw new AppError(
            'duplicate_number',
            'An invoice with this number exists again. Rename or delete it first.',
          );
      }
      await tx.update(table).set({ deletedAt: null }).where(eq(table.id, params.id));
      if (type === 'purchase') {
        await tx
          .update(s.stockMovements)
          .set({ deletedAt: null })
          .where(
            and(eq(s.stockMovements.refType, 'purchase'), eq(s.stockMovements.refId, params.id)),
          );
      }
      await audit(tx, orgId, `${type}.restore`, type, params.id);
      return { ok: true };
    },
  });

  route({
    method: 'delete',
    path: '/v1/trash/:id',
    tag: 'Trash',
    summary: 'Delete a trashed record for good',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, params }) => {
      const type = await find(tx, params.id);
      try {
        await tx.transaction((sp) => purgeOne(sp, type, params.id));
      } catch {
        throw new AppError(
          'conflict',
          'Other records still refer to this one, so it can not be deleted for good',
        );
      }
      await audit(tx, orgId, `${type}.purge`, type, params.id);
      return { ok: true };
    },
  });

  route({
    method: 'post',
    path: '/v1/trash/purge',
    tag: 'Trash',
    summary: `Remove records that have been in the trash for more than ${TRASH_RETENTION_DAYS} days`,
    response: z.object({ purged: z.number().int() }),
    handler: async ({ tx }) => ({ purged: await purgeExpired(tx) }),
  });
}
