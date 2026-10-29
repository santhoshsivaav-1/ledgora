import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@ledgora/db';
import {
  idParam,
  page,
  pageQuery,
  okBody,
  party,
  partyInput,
  partyListQuery,
  partyPatch,
  type Party,
} from '@ledgora/contracts';
import { audit } from '../audit.ts';
import { notFound } from '../errors.ts';
import { listPage, stamps, type Registrar } from '../http.ts';

const { parties, invoices, payments, paymentAllocations } = schema;

export const toParty = (r: typeof parties.$inferSelect): Party => ({
  id: r.id,
  kind: r.kind as Party['kind'],
  name: r.name,
  gstin: r.gstin,
  pan: r.pan,
  address: r.address,
  city: r.city,
  pin: r.pin,
  state: r.state,
  country: r.country,
  email: r.email,
  phone: r.phone,
  isSez: r.isSez,
  openingBalance: r.openingBalance,
  extra: r.extra as Record<string, unknown>,
  ...stamps(r),
});

const values = <T extends { gstin?: string | null }>(i: T) => ({
  ...i,
  gstin: i.gstin === '' ? null : i.gstin,
});

export function partiesModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/parties',
    tag: 'Parties',
    summary: 'List or search customers and suppliers',
    query: pageQuery.extend(partyListQuery.shape),
    response: page(party),
    handler: async ({ tx, query }) => {
      const res = await listPage(tx, parties, {
        ...query,
        searchColumns: [parties.name, parties.gstin, parties.phone, parties.email],
        where: query.kind
          ? inArray(parties.kind, query.kind === 'both' ? ['both'] : [query.kind, 'both'])
          : undefined,
      });
      return { data: res.data.map(toParty), nextCursor: res.nextCursor };
    },
  });

  route({
    method: 'get',
    path: '/v1/parties/:id',
    tag: 'Parties',
    summary: 'One party',
    params: idParam,
    response: party,
    handler: async ({ tx, params }) => {
      const [row] = await tx
        .select()
        .from(parties)
        .where(and(eq(parties.id, params.id), isNull(parties.deletedAt)));
      if (!row) throw notFound('Party');
      return toParty(row);
    },
  });

  route({
    method: 'post',
    path: '/v1/parties',
    tag: 'Parties',
    summary: 'Create a party',
    body: partyInput,
    response: party,
    status: 201,
    handler: async ({ tx, orgId, body }) => {
      const [row] = await tx
        .insert(parties)
        .values({ ...values(body), orgId })
        .returning();
      await audit(tx, orgId, 'party.create', 'party', row.id, { after: row });
      return toParty(row);
    },
  });

  route({
    method: 'patch',
    path: '/v1/parties/:id',
    tag: 'Parties',
    summary: 'Change a party',
    params: idParam,
    body: partyPatch,
    response: party,
    handler: async ({ tx, orgId, params, body }) => {
      const [before] = await tx
        .select()
        .from(parties)
        .where(and(eq(parties.id, params.id), isNull(parties.deletedAt)));
      if (!before) throw notFound('Party');
      const [row] = await tx
        .update(parties)
        .set({ ...values(body), updatedAt: new Date() })
        .where(eq(parties.id, params.id))
        .returning();
      await audit(tx, orgId, 'party.update', 'party', row.id, { before, after: row });
      return toParty(row);
    },
  });

  route({
    method: 'delete',
    path: '/v1/parties/:id',
    tag: 'Parties',
    summary: 'Move a party to the trash',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, params }) => {
      const [row] = await tx
        .update(parties)
        .set({ deletedAt: new Date() })
        .where(and(eq(parties.id, params.id), isNull(parties.deletedAt)))
        .returning();
      if (!row) throw notFound('Party');
      await audit(tx, orgId, 'party.delete', 'party', row.id, { before: row });
      return { ok: true };
    },
  });

  route({
    method: 'get',
    path: '/v1/parties/:id/balance',
    tag: 'Parties',
    summary: 'What the party owes, and the credit it holds',
    params: idParam,
    response: z.object({ outstanding: z.number(), credit: z.number() }),
    handler: async ({ tx, params }) => {
      const [p] = await tx
        .select({ id: parties.id })
        .from(parties)
        .where(and(eq(parties.id, params.id), isNull(parties.deletedAt)));
      if (!p) throw notFound('Party');
      const [due] = await tx
        .select({
          v: sql<number>`coalesce(sum(${invoices.total} - ${invoices.paidAmount}), 0)::float8`,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.partyId, params.id),
            isNull(invoices.deletedAt),
            ne(invoices.status, 'cancelled'),
            inArray(invoices.invoiceType, ['tax-invoice', 'bill-of-supply', 'composition']),
          ),
        );
      const [paid] = await tx
        .select({ v: sql<number>`coalesce(sum(${payments.amount}), 0)::float8` })
        .from(payments)
        .where(and(eq(payments.partyId, params.id), isNull(payments.deletedAt)));
      const [alloc] = await tx
        .select({ v: sql<number>`coalesce(sum(${paymentAllocations.amount}), 0)::float8` })
        .from(paymentAllocations)
        .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
        .where(and(eq(payments.partyId, params.id), isNull(payments.deletedAt)));
      return {
        outstanding: Math.round(due.v * 100) / 100,
        credit: Math.round((paid.v - alloc.v) * 100) / 100,
      };
    },
  });
}
