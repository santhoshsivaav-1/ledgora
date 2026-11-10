import { and, asc, eq, gte, isNull, lte, ne } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import {
  idParam,
  okBody,
  performanceQuery,
  staffInput,
  staffListQuery,
  staffMember,
  staffPatch,
  staffPerformance,
  type StaffMember,
} from '@ledgora/contracts';
import { salesmanPerformance } from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import { stamps, type Registrar } from '../http.ts';

// Vyapar parity P2-S1: salesmen ("Track Your Salesman"). Soft delete keeps their invoices' history; deactivating
// hides them from the pickers.
const { staff, invoices } = schema;

const toStaff = (r: typeof staff.$inferSelect): StaffMember => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  userId: r.userId,
  commissionPct: r.commissionPct,
  monthlyTarget: r.monthlyTarget,
  active: r.active,
  ...stamps(r),
});

async function load(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(staff)
    .where(and(eq(staff.id, id), isNull(staff.deletedAt)));
  if (!row) throw notFound('Salesman');
  return row;
}

/** One staff row per login: that link is what scopes a Salesman member to their own invoices. */
async function checkUser(tx: Tx, userId: string | null | undefined, selfId?: string) {
  if (!userId) return;
  const [taken] = await tx
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(
      and(
        eq(staff.userId, userId),
        isNull(staff.deletedAt),
        selfId ? ne(staff.id, selfId) : undefined,
      ),
    );
  if (taken)
    throw new AppError('conflict', `That login is already linked to ${taken.name}`, [
      { path: 'userId', message: 'Already linked to another salesman' },
    ]);
}

export function staffModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/staff',
    tag: 'Staff',
    summary: 'Salesmen, by name',
    query: staffListQuery,
    response: z.object({ data: z.array(staffMember) }),
    handler: async ({ tx, query }) => {
      const rows = await tx
        .select()
        .from(staff)
        .where(
          and(
            isNull(staff.deletedAt),
            query.active !== undefined ? eq(staff.active, query.active) : undefined,
          ),
        )
        .orderBy(asc(staff.name));
      return { data: rows.map(toStaff) };
    },
  });

  route({
    method: 'get',
    path: '/v1/staff/:id',
    tag: 'Staff',
    summary: 'One salesman',
    params: idParam,
    response: staffMember,
    handler: async ({ tx, params }) => toStaff(await load(tx, params.id)),
  });

  route({
    method: 'post',
    path: '/v1/staff',
    tag: 'Staff',
    summary: 'Add a salesman',
    body: staffInput,
    response: staffMember,
    status: 201,
    handler: async ({ tx, orgId, body }) => {
      await checkUser(tx, body.userId);
      const [row] = await tx
        .insert(staff)
        .values({ ...body, userId: body.userId ?? null, orgId })
        .returning();
      await audit(tx, orgId, 'staff.create', 'staff', row.id, { after: row });
      return toStaff(row);
    },
  });

  route({
    method: 'patch',
    path: '/v1/staff/:id',
    tag: 'Staff',
    summary: 'Change a salesman (deactivate with active: false)',
    params: idParam,
    body: staffPatch,
    response: staffMember,
    handler: async ({ tx, orgId, params, body }) => {
      const before = await load(tx, params.id);
      await checkUser(tx, body.userId, params.id);
      const [row] = await tx
        .update(staff)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(staff.id, params.id))
        .returning();
      await audit(tx, orgId, 'staff.update', 'staff', row.id, { before, after: row });
      return toStaff(row);
    },
  });

  route({
    method: 'delete',
    path: '/v1/staff/:id',
    tag: 'Staff',
    summary: 'Remove a salesman (their invoices keep the name)',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, params }) => {
      const row = await load(tx, params.id);
      await tx.update(staff).set({ deletedAt: new Date() }).where(eq(staff.id, params.id));
      await audit(tx, orgId, 'staff.delete', 'staff', row.id, { before: { name: row.name } });
      return { ok: true };
    },
  });

  route({
    method: 'get',
    path: '/v1/staff/:id/performance',
    tag: 'Staff',
    summary: 'Sales, collections, outstanding and commission of a salesman over a period',
    params: idParam,
    query: performanceQuery,
    response: staffPerformance,
    handler: async ({ tx, params, query }) => {
      const s = await load(tx, params.id);
      const rows = await tx
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.salesmanId, s.id),
            isNull(invoices.deletedAt),
            gte(invoices.invoiceDate, query.from),
            lte(invoices.invoiceDate, query.to),
          ),
        )
        .orderBy(asc(invoices.invoiceDate));
      const perf = salesmanPerformance(rows, {
        pct: s.commissionPct,
        basis: query.basis,
        monthlyTarget: s.monthlyTarget,
      });
      return {
        ...perf,
        invoices: rows.map((r) => ({
          id: r.id,
          number: r.number,
          invoiceType: r.invoiceType,
          invoiceDate: r.invoiceDate,
          taxableAmount: r.taxableAmount,
          total: r.total,
          paidAmount: r.paidAmount,
          status: r.status,
        })),
      };
    },
  });
}
