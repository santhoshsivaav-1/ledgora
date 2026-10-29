import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@ledgora/db';
import {
  idParam,
  invitation as invitationOut,
  invitationInput,
  member as memberOut,
  memberPatch,
  okBody,
  ROLES,
  type Role,
} from '@ledgora/contracts';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import type { Registrar } from '../http.ts';
import { sendMail, sendSms } from '../mail/index.ts';
import { invitationMail } from '../mail/templates.ts';

const { member, user, invitation, memberBusinesses, businesses, organizations, session } = schema;
const WEEK = 7 * 86_400_000;
const rank = (r: string) => (r === 'owner' ? 3 : r === 'admin' ? 2 : 1);

/** An owner can manage anyone; an admin can manage everyone below admin; nobody manages their own level or above. */
function assertMayAssign(actor: Role, target: string, next?: string) {
  if (actor === 'owner') return;
  if (rank(target) >= rank(actor) || (next && rank(next) >= rank(actor))) {
    throw new AppError('forbidden', 'You can only manage members below your own role');
  }
}

export function membersModule({ route, documented: _d }: Registrar) {
  route({
    method: 'get',
    path: '/v1/members',
    tag: 'Team',
    summary: 'Members of the organization with their roles and business limits',
    response: z.object({ data: z.array(memberOut) }),
    handler: async ({ tx, orgId, deps }) => {
      const rows = await deps.db
        .select({ m: member, u: user })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, orgId))
        .orderBy(member.createdAt);
      const limits = await tx.select().from(memberBusinesses);
      return {
        data: rows.map(({ m, u }) => {
          const ids = limits.filter((l) => l.memberId === m.id).map((l) => l.businessId);
          return {
            id: m.id,
            userId: u.id,
            name: u.name,
            email: u.email.endsWith('.invalid') ? '' : u.email,
            phoneNumber: u.phoneNumber,
            role: m.role as Role,
            businessIds: ids.length ? ids : null,
            joinedAt: m.createdAt.toISOString(),
          };
        }),
      };
    },
  });

  route({
    method: 'patch',
    path: '/v1/members/:id',
    tag: 'Team',
    summary: 'Change a member role or the businesses they can see',
    params: idParam.extend({ id: z.string() }),
    body: memberPatch,
    response: okBody,
    handler: async ({ tx, orgId, auth, params, body, deps }) => {
      const [target] = await deps.db
        .select()
        .from(member)
        .where(and(eq(member.id, params.id), eq(member.organizationId, orgId)));
      if (!target) throw notFound('Member');
      if (target.userId === auth.user.id && body.role && body.role !== target.role)
        throw new AppError('forbidden', 'You can not change your own role');
      assertMayAssign(auth.role, target.role, body.role);
      if (body.role && target.role === 'owner' && body.role !== 'owner') {
        const owners = await deps.db
          .select({ id: member.id })
          .from(member)
          .where(and(eq(member.organizationId, orgId), eq(member.role, 'owner')));
        if (owners.length <= 1)
          throw new AppError('unprocessable', 'An organization needs at least one owner');
      }
      if (body.role)
        await deps.db.update(member).set({ role: body.role }).where(eq(member.id, target.id));
      if (body.businessIds !== undefined) {
        const ids = body.businessIds ?? [];
        if (ids.length) {
          const found = await tx
            .select({ id: businesses.id })
            .from(businesses)
            .where(inArray(businesses.id, ids));
          if (found.length !== new Set(ids).size) throw notFound('Business');
        }
        await tx.delete(memberBusinesses).where(eq(memberBusinesses.memberId, target.id));
        if (ids.length)
          await tx
            .insert(memberBusinesses)
            .values(
              [...new Set(ids)].map((businessId) => ({ orgId, memberId: target.id, businessId })),
            );
      }
      await audit(tx, orgId, 'member.update', 'member', null, {
        before: { role: target.role },
        after: { memberId: target.id, ...body },
      });
      return { ok: true };
    },
  });

  route({
    method: 'delete',
    path: '/v1/members/:id',
    tag: 'Team',
    summary: 'Remove a member (their sessions in this organization end)',
    params: idParam.extend({ id: z.string() }),
    response: okBody,
    handler: async ({ tx, orgId, auth, params, deps }) => {
      const [target] = await deps.db
        .select()
        .from(member)
        .where(and(eq(member.id, params.id), eq(member.organizationId, orgId)));
      if (!target) throw notFound('Member');
      if (target.userId === auth.user.id)
        throw new AppError('forbidden', 'You can not remove yourself');
      assertMayAssign(auth.role, target.role);
      if (target.role === 'owner') {
        const owners = await deps.db
          .select({ id: member.id })
          .from(member)
          .where(and(eq(member.organizationId, orgId), eq(member.role, 'owner')));
        if (owners.length <= 1)
          throw new AppError('unprocessable', 'An organization needs at least one owner');
      }
      await tx.delete(memberBusinesses).where(eq(memberBusinesses.memberId, target.id));
      await deps.db.delete(member).where(eq(member.id, target.id));
      // Sessions that were working in this organization fall back to "no active organization".
      await deps.db
        .update(session)
        .set({ activeOrganizationId: null })
        .where(and(eq(session.userId, target.userId), eq(session.activeOrganizationId, orgId)));
      await audit(tx, orgId, 'member.remove', 'member', null, {
        before: { memberId: target.id, role: target.role },
      });
      return { ok: true };
    },
  });

  // ---- invitations ----
  const toInvitation = (i: typeof invitation.$inferSelect) => ({
    id: i.id,
    email: i.email,
    phone: i.phone,
    role: i.role as Role,
    businessIds: (i.businessIds as string[]) ?? [],
    status: (i.expiresAt.getTime() < Date.now() && i.status === 'pending'
      ? 'revoked'
      : i.status) as 'pending' | 'accepted' | 'revoked',
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
  });

  route({
    method: 'get',
    path: '/v1/invitations',
    tag: 'Team',
    summary: 'Invitations that have not been accepted yet',
    response: z.object({ data: z.array(invitationOut) }),
    handler: async ({ orgId, deps }) => {
      const rows = await deps.db
        .select()
        .from(invitation)
        .where(and(eq(invitation.organizationId, orgId), eq(invitation.status, 'pending')))
        .orderBy(invitation.createdAt);
      return { data: rows.map(toInvitation).filter((i) => i.status === 'pending') };
    },
  });

  route({
    method: 'post',
    path: '/v1/invitations',
    tag: 'Team',
    summary: 'Invite someone by e-mail or phone',
    body: invitationInput,
    response: invitationOut.extend({ acceptUrl: z.string() }),
    status: 201,
    handler: async ({ tx, orgId, auth, body, deps }) => {
      assertMayAssign(auth.role, 'viewer', body.role);
      const ids = [...new Set(body.businessIds)];
      if (ids.length) {
        const found = await tx
          .select({ id: businesses.id })
          .from(businesses)
          .where(inArray(businesses.id, ids));
        if (found.length !== ids.length) throw notFound('Business');
      }
      const email = body.email?.trim().toLowerCase() ?? '';
      const open = await deps.db
        .select()
        .from(invitation)
        .where(and(eq(invitation.organizationId, orgId), eq(invitation.status, 'pending')));
      if (
        open.some(
          (i) =>
            i.expiresAt.getTime() > Date.now() &&
            ((email && i.email === email) || (body.phone && i.phone === body.phone)),
        )
      ) {
        throw new AppError('conflict', 'This person already has a pending invitation');
      }
      const members = await deps.db
        .select({ email: user.email, phone: user.phoneNumber })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, orgId));
      if (
        members.some((m) => (email && m.email === email) || (body.phone && m.phone === body.phone))
      )
        throw new AppError('conflict', 'This person is already a member');
      const [row] = await deps.db
        .insert(invitation)
        .values({
          id: randomUUID(),
          organizationId: orgId,
          email,
          phone: body.phone ?? null,
          role: body.role,
          businessIds: ids,
          expiresAt: new Date(Date.now() + WEEK),
          inviterId: auth.user.id,
        })
        .returning();
      const [org] = await deps.db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, orgId));
      const base = deps.env.API_URL ?? `http://localhost:${deps.env.API_LISTEN_PORT}`;
      const acceptUrl = `${base}/v1/console?invitation=${row.id}`;
      if (email)
        await sendMail(
          deps.env,
          invitationMail(
            email,
            auth.user.name,
            org?.name ?? 'an organization',
            body.role,
            acceptUrl,
          ),
        );
      if (body.phone)
        await sendSms(deps.env, {
          to: body.phone,
          text: `${auth.user.name} invited you to ${org?.name ?? 'Ledgora'} as ${body.role}. Accept: ${acceptUrl}`,
        });
      await audit(tx, orgId, 'invitation.create', 'invitation', null, {
        after: { invitationId: row.id, email, phone: body.phone, role: body.role },
      });
      return { ...toInvitation(row), acceptUrl };
    },
  });

  route({
    method: 'delete',
    path: '/v1/invitations/:id',
    tag: 'Team',
    summary: 'Withdraw an invitation',
    params: z.object({ id: z.string() }),
    response: okBody,
    handler: async ({ tx, orgId, params, deps }) => {
      const [row] = await deps.db
        .update(invitation)
        .set({ status: 'revoked' })
        .where(
          and(
            eq(invitation.id, params.id),
            eq(invitation.organizationId, orgId),
            eq(invitation.status, 'pending'),
          ),
        )
        .returning();
      if (!row) throw notFound('Invitation');
      await audit(tx, orgId, 'invitation.revoke', 'invitation', null, {
        before: { invitationId: row.id },
      });
      return { ok: true };
    },
  });

  const mine = (
    i: typeof invitation.$inferSelect,
    u: {
      email: string;
      emailVerified: boolean;
      phoneNumber: string | null;
      phoneNumberVerified: boolean;
    },
  ) =>
    (!!i.email && u.emailVerified && u.email.toLowerCase() === i.email) ||
    (!!i.phone && u.phoneNumberVerified && u.phoneNumber === i.phone);

  route({
    method: 'get',
    path: '/v1/invitations/:id',
    tag: 'Team',
    summary: 'Preview an invitation addressed to you',
    params: z.object({ id: z.string() }),
    access: 'session',
    response: z.object({
      organization: z.string(),
      role: z.string(),
      inviter: z.string(),
      expiresAt: z.string(),
    }),
    handler: async ({ auth, params, deps }) => {
      const [row] = await deps.db.select().from(invitation).where(eq(invitation.id, params.id));
      // The same answer whether it does not exist or is not yours.
      if (
        !row ||
        row.status !== 'pending' ||
        row.expiresAt.getTime() < Date.now() ||
        !mine(row, auth.user)
      )
        throw notFound('Invitation');
      const [org] = await deps.db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, row.organizationId));
      const [inviter] = await deps.db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, row.inviterId));
      return {
        organization: org?.name ?? '',
        role: row.role,
        inviter: inviter?.name ?? '',
        expiresAt: row.expiresAt.toISOString(),
      };
    },
  });

  route({
    method: 'post',
    path: '/v1/invitations/:id/accept',
    tag: 'Team',
    summary: 'Accept an invitation: you become a member and it becomes your active organization',
    params: z.object({ id: z.string() }),
    access: 'session',
    response: z.object({ organizationId: z.string(), role: z.enum(ROLES) }),
    handler: async ({ auth, params, deps }) => {
      const [row] = await deps.db.select().from(invitation).where(eq(invitation.id, params.id));
      if (
        !row ||
        row.status !== 'pending' ||
        row.expiresAt.getTime() < Date.now() ||
        !mine(row, auth.user)
      )
        throw notFound('Invitation');
      const ids = (row.businessIds as string[]) ?? [];
      const [existing] = await deps.db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, row.organizationId), eq(member.userId, auth.user.id)));
      if (existing) throw new AppError('conflict', 'You are already a member of this organization');
      const memberId = randomUUID();
      await deps.db.insert(member).values({
        id: memberId,
        organizationId: row.organizationId,
        userId: auth.user.id,
        role: row.role,
      });
      await deps.db.update(invitation).set({ status: 'accepted' }).where(eq(invitation.id, row.id));
      await deps.db
        .update(session)
        .set({ activeOrganizationId: row.organizationId })
        .where(eq(session.id, auth.sessionId));
      const { withTenant } = await import('@ledgora/db');
      await withTenant(
        deps.db,
        row.organizationId,
        async (tx) => {
          if (ids.length)
            await tx
              .insert(memberBusinesses)
              .values(
                ids.map((businessId) => ({ orgId: row.organizationId, memberId, businessId })),
              );
          await audit(tx, row.organizationId, 'invitation.accept', 'member', null, {
            after: { memberId, role: row.role },
          });
        },
        { actorId: auth.user.id, ip: auth.ip },
      );
      return { organizationId: row.organizationId, role: row.role as Role };
    },
  });
}
