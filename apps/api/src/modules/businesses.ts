import { and, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import {
  business,
  businessInput,
  businessPatch,
  idParam,
  okBody,
  paymentAccount,
  paymentAccountInput,
  settingsBody,
  type Business,
} from '@ledgora/contracts';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import { stamps, type Registrar } from '../http.ts';

const { businesses, businessSettings, paymentAccounts } = schema;

const toBusiness = (r: typeof businesses.$inferSelect): Business => ({
  id: r.id,
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
  logoFileId: r.logoFileId,
  signatureFileId: r.signatureFileId,
  stampFileId: r.stampFileId,
  isDefault: r.isDefault,
  ...stamps(r),
});
const clean = <T extends { gstin?: string | null }>(i: T) => ({
  ...i,
  gstin: i.gstin === '' ? null : i.gstin,
});

export async function loadBusiness(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(businesses)
    .where(and(eq(businesses.id, id), isNull(businesses.deletedAt)));
  if (!row) throw notFound('Business');
  return row;
}

async function onlyOneDefault(tx: Tx, id: string) {
  await tx
    .update(businesses)
    .set({ isDefault: false })
    .where(and(ne(businesses.id, id), isNull(businesses.deletedAt)));
}

export function businessesModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/businesses',
    tag: 'Businesses',
    summary: 'The businesses (GSTINs) of this organization',
    response: z.object({ data: z.array(business) }),
    handler: async ({ tx }) => {
      const rows = await tx
        .select()
        .from(businesses)
        .where(isNull(businesses.deletedAt))
        .orderBy(businesses.name);
      return { data: rows.map(toBusiness) };
    },
  });

  route({
    method: 'post',
    path: '/v1/businesses',
    tag: 'Businesses',
    summary: 'Add a business',
    body: businessInput,
    response: business,
    status: 201,
    handler: async ({ tx, orgId, body }) => {
      const [row] = await tx
        .insert(businesses)
        .values({ ...clean(body), orgId })
        .returning();
      await tx.insert(businessSettings).values({ orgId, businessId: row.id });
      if (row.isDefault) await onlyOneDefault(tx, row.id);
      await audit(tx, orgId, 'business.create', 'business', row.id, { after: row });
      return toBusiness(row);
    },
  });

  route({
    method: 'get',
    path: '/v1/businesses/:id',
    tag: 'Businesses',
    summary: 'One business',
    params: idParam,
    response: business,
    handler: async ({ tx, params }) => toBusiness(await loadBusiness(tx, params.id)),
  });

  route({
    method: 'patch',
    path: '/v1/businesses/:id',
    tag: 'Businesses',
    summary: 'Change a business',
    params: idParam,
    body: businessPatch,
    response: business,
    handler: async ({ tx, orgId, params, body }) => {
      const before = await loadBusiness(tx, params.id);
      const [row] = await tx
        .update(businesses)
        .set({ ...clean(body), updatedAt: new Date() })
        .where(eq(businesses.id, params.id))
        .returning();
      if (body.isDefault) await onlyOneDefault(tx, row.id);
      await audit(tx, orgId, 'business.update', 'business', row.id, { before, after: row });
      return toBusiness(row);
    },
  });

  route({
    method: 'delete',
    path: '/v1/businesses/:id',
    tag: 'Businesses',
    summary: 'Remove a business (not the last one)',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, params }) => {
      const before = await loadBusiness(tx, params.id);
      const live = await tx
        .select({ id: businesses.id })
        .from(businesses)
        .where(isNull(businesses.deletedAt));
      if (live.length <= 1)
        throw new AppError('unprocessable', 'An organization needs at least one business');
      await tx
        .update(businesses)
        .set({ deletedAt: new Date() })
        .where(eq(businesses.id, params.id));
      await audit(tx, orgId, 'business.delete', 'business', params.id, { before });
      return { ok: true };
    },
  });

  // ---- typed settings replace the key-value /api/meta and /api/local-prefs (change 1.20) ----
  route({
    method: 'get',
    path: '/v1/businesses/:id/settings',
    tag: 'Settings',
    summary: 'Numbering, print and preference settings of a business',
    params: idParam,
    response: settingsBody,
    handler: async ({ tx, orgId, params }) => {
      await loadBusiness(tx, params.id);
      const [row] = await tx
        .select()
        .from(businessSettings)
        .where(eq(businessSettings.businessId, params.id));
      if (row)
        return {
          numberSettings: row.numberSettings,
          printSettings: row.printSettings,
          preferences: row.preferences,
        };
      await tx.insert(businessSettings).values({ orgId, businessId: params.id });
      return { numberSettings: {}, printSettings: {}, preferences: {} };
    },
  });

  route({
    method: 'put',
    path: '/v1/businesses/:id/settings',
    tag: 'Settings',
    summary: 'Replace the settings of a business',
    params: idParam,
    body: settingsBody,
    response: settingsBody,
    handler: async ({ tx, orgId, params, body }) => {
      await loadBusiness(tx, params.id);
      await tx
        .insert(businessSettings)
        .values({ orgId, businessId: params.id, ...body })
        .onConflictDoUpdate({
          target: [businessSettings.orgId, businessSettings.businessId],
          set: { ...body, updatedAt: new Date() },
        });
      await audit(tx, orgId, 'settings.update', 'business', params.id, { after: body });
      return body;
    },
  });

  // ---- payment accounts ----
  const accountOut = (a: typeof paymentAccounts.$inferSelect) => ({
    id: a.id,
    businessId: a.businessId,
    label: a.label,
    bankName: a.bankName,
    accountHolderName: a.accountHolderName,
    accountNumber: a.accountNumber,
    accountType: a.accountType,
    ifsc: a.ifsc,
    swift: a.swift,
    upiId: a.upiId,
    notes: a.notes,
    isDefault: a.isDefault,
    isActive: a.isActive,
  });

  route({
    method: 'get',
    path: '/v1/businesses/:id/payment-accounts',
    tag: 'Businesses',
    summary: 'Bank and UPI accounts printed on invoices',
    params: idParam,
    response: z.object({ data: z.array(paymentAccount) }),
    handler: async ({ tx, params }) => {
      await loadBusiness(tx, params.id);
      const rows = await tx
        .select()
        .from(paymentAccounts)
        .where(and(eq(paymentAccounts.businessId, params.id), isNull(paymentAccounts.deletedAt)))
        .orderBy(paymentAccounts.createdAt);
      return { data: rows.map(accountOut) };
    },
  });

  route({
    method: 'post',
    path: '/v1/businesses/:id/payment-accounts',
    tag: 'Businesses',
    summary: 'Add a payment account',
    params: idParam,
    body: paymentAccountInput,
    response: paymentAccount,
    status: 201,
    handler: async ({ tx, orgId, params, body }) => {
      await loadBusiness(tx, params.id);
      if (body.isDefault) {
        await tx
          .update(paymentAccounts)
          .set({ isDefault: false })
          .where(and(eq(paymentAccounts.businessId, params.id), isNull(paymentAccounts.deletedAt)));
      }
      const [row] = await tx
        .insert(paymentAccounts)
        .values({ ...body, orgId, businessId: params.id })
        .returning();
      await audit(tx, orgId, 'payment_account.create', 'payment_account', row.id, {
        after: { label: row.label },
      });
      return accountOut(row);
    },
  });

  route({
    method: 'delete',
    path: '/v1/payment-accounts/:id',
    tag: 'Businesses',
    summary: 'Remove a payment account',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, params }) => {
      const [row] = await tx
        .update(paymentAccounts)
        .set({ deletedAt: new Date() })
        .where(and(eq(paymentAccounts.id, params.id), isNull(paymentAccounts.deletedAt)))
        .returning();
      if (!row) throw notFound('Payment account');
      await audit(tx, orgId, 'payment_account.delete', 'payment_account', row.id, {
        before: { label: row.label },
      });
      return { ok: true };
    },
  });
}
