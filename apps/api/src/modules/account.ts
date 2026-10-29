import { and, desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { schema, withTenant } from '@ledgora/db';
import {
  auditRow,
  me as meSchema,
  okBody,
  page,
  pageQuery,
  ROLE_PERMISSIONS,
  sessionRow,
  type Role,
} from '@ledgora/contracts';
import { AppError, notFound } from '../errors.ts';
import { deviceLabel } from '../auth/device.ts';
import { listPage, type Registrar } from '../http.ts';

const { member, organizations, session, memberBusinesses, subscriptions, auditLog } = schema;

export function accountModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/me',
    tag: 'Account',
    summary: 'Who you are, your organizations, role, permissions and plan',
    access: 'session',
    response: meSchema,
    handler: async ({ auth, deps }) => {
      const rows = await deps.db
        .select({ id: organizations.id, name: organizations.name, role: member.role })
        .from(member)
        .innerJoin(organizations, eq(organizations.id, member.organizationId))
        .where(eq(member.userId, auth.user.id))
        .orderBy(member.createdAt);
      const current = rows.find((r) => r.id === auth.activeOrganizationId) ?? rows[0];
      if (!current) throw new AppError('forbidden', 'This account has no organization yet');
      const role = current.role as Role;
      const [m] = await deps.db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.userId, auth.user.id), eq(member.organizationId, current.id)));
      const { limits, sub } = await withTenant(deps.db, current.id, async (tx) => ({
        limits: await tx
          .select({ b: memberBusinesses.businessId })
          .from(memberBusinesses)
          .where(eq(memberBusinesses.memberId, m!.id)),
        sub: (
          await tx.select().from(subscriptions).orderBy(desc(subscriptions.createdAt)).limit(1)
        )[0],
      }));
      return {
        user: {
          id: auth.user.id,
          name: auth.user.name,
          email: auth.user.email.endsWith('.invalid') ? '' : auth.user.email,
          phoneNumber: auth.user.phoneNumber,
          twoFactorEnabled: auth.user.twoFactorEnabled,
        },
        organization: { id: current.id, name: current.name },
        role,
        permissions: [...ROLE_PERMISSIONS[role]],
        businessIds: role !== 'owner' && limits.length ? limits.map((l) => l.b) : null,
        organizations: rows.map((r) => ({ id: r.id, name: r.name, role: r.role as Role })),
        subscription: sub
          ? {
              plan: sub.plan,
              status: sub.status,
              trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
            }
          : null,
      };
    },
  });

  route({
    method: 'post',
    path: '/v1/me/organization',
    tag: 'Account',
    summary: 'Switch the organization this session works in',
    access: 'session',
    body: z.object({ organizationId: z.string().uuid() }),
    response: okBody,
    handler: async ({ auth, body, deps }) => {
      const [m] = await deps.db
        .select({ id: member.id })
        .from(member)
        .where(
          and(eq(member.userId, auth.user.id), eq(member.organizationId, body.organizationId)),
        );
      if (!m) throw new AppError('forbidden', 'You are not a member of this organization');
      await deps.db
        .update(session)
        .set({ activeOrganizationId: body.organizationId })
        .where(eq(session.id, auth.sessionId));
      return { ok: true };
    },
  });

  // ---- sessions (change 2.12) ----
  route({
    method: 'get',
    path: '/v1/sessions',
    tag: 'Account',
    summary: 'Devices signed in to your account',
    access: 'session',
    response: z.object({ data: z.array(sessionRow) }),
    handler: async ({ auth, deps }) => {
      const rows = await deps.db
        .select()
        .from(session)
        .where(eq(session.userId, auth.user.id))
        .orderBy(desc(session.createdAt));
      return {
        data: rows
          .filter((r) => r.expiresAt.getTime() > Date.now())
          .map((r) => ({
            id: r.id,
            current: r.id === auth.sessionId,
            device: deviceLabel(r.userAgent),
            ipAddress: r.ipAddress,
            createdAt: r.createdAt.toISOString(),
            expiresAt: r.expiresAt.toISOString(),
          })),
      };
    },
  });

  route({
    method: 'delete',
    path: '/v1/sessions/:id',
    tag: 'Account',
    summary: 'Log one device out',
    access: 'session',
    params: z.object({ id: z.string() }),
    response: okBody,
    handler: async ({ auth, params, deps }) => {
      const gone = await deps.db
        .delete(session)
        .where(and(eq(session.id, params.id), eq(session.userId, auth.user.id)))
        .returning({ id: session.id });
      if (!gone.length) throw notFound('Session');
      return { ok: true };
    },
  });

  route({
    method: 'post',
    path: '/v1/sessions/revoke-all',
    tag: 'Account',
    summary: 'Log out everywhere (this device stays signed in unless includeCurrent is true)',
    access: 'session',
    body: z.object({ includeCurrent: z.boolean().default(false) }),
    response: z.object({ revoked: z.number().int() }),
    handler: async ({ auth, body, deps }) => {
      const where = body.includeCurrent
        ? eq(session.userId, auth.user.id)
        : and(eq(session.userId, auth.user.id), ne(session.id, auth.sessionId));
      const gone = await deps.db.delete(session).where(where).returning({ id: session.id });
      return { revoked: gone.length };
    },
  });

  // ---- audit trail (change 2.14) ----
  route({
    method: 'get',
    path: '/v1/audit',
    tag: 'Account',
    summary: 'Who changed what, newest first',
    query: pageQuery.extend({
      entityType: z.string().optional(),
      entityId: z.string().uuid().optional(),
    }),
    response: page(auditRow),
    handler: async ({ tx, query }) => {
      const res = await listPage(tx, auditLog, {
        ...query,
        searchColumns: [auditLog.action],
        where: and(
          query.entityType ? eq(auditLog.entityType, query.entityType) : undefined,
          query.entityId ? eq(auditLog.entityId, query.entityId) : undefined,
        ),
      });
      return {
        data: res.data.map((r) => ({
          id: r.id,
          at: r.createdAt.toISOString(),
          actorId: r.actorId,
          ip: r.ip,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          before: r.before ?? null,
          after: r.after ?? null,
        })),
        nextCursor: res.nextCursor,
      };
    },
  });
}
