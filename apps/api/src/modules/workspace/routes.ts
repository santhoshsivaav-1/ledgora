import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@ledgora/db';
import {
  INVOICE_TYPES,
  businessKeyOf,
  counterKeyFor,
  formatDocNumber,
  nextCounterValue,
  numberSeriesFor,
} from '@ledgora/tax-engine';
import { audit } from '../../audit.ts';
import { AppError } from '../../errors.ts';
import type { Registrar } from '../../http.ts';
import { generateFromTemplate } from './generate.ts';
import {
  COLLECTIONS,
  DEFAULT_PROFILE,
  DEFAULT_TEMPLATE,
  ID_PREFIX,
  META,
  SORT,
  allMeta,
  bumpCounter,
  getDoc,
  getKv,
  listDocs,
  putDoc,
  setKv,
  trashedDocs,
  type Collection,
  type Doc,
} from './store.ts';

const { documents } = schema;
const collection = z.enum(COLLECTIONS);
const anyDoc = z.record(z.string(), z.unknown());
const ok = z.object({ success: z.literal(true) }).passthrough();
const flag = z.enum(['1', 'true', '0', 'false']).optional();
const isOn = (v: string | undefined) => v === '1' || v === 'true';

/**
 * The document API the billing screens use (change 3.23). It keeps the shapes of the old single-user server's /api
 * routes, so the screens did not have to change, but every call now runs inside the signed-in organization:
 * row-level security, roles and the audit log all apply.
 */
export function workspaceModule({ route }: Registrar) {
  // ---- collections: bills, clients, products, expenses, recurring, receipts, purchases, profiles, templates ----
  route({
    method: 'get',
    path: '/v1/workspace/collections/:collection',
    tag: 'Workspace',
    summary: 'All documents of one collection, in the order the screen lists them',
    params: z.object({ collection }),
    response: z.array(anyDoc),
    handler: async ({ tx, orgId, params }) => {
      let docs = await listDocs(tx, params.collection);
      if (params.collection === 'templates' && docs.length === 0) {
        await putDoc(tx, orgId, 'templates', DEFAULT_TEMPLATE.id, DEFAULT_TEMPLATE);
        docs = [DEFAULT_TEMPLATE];
      }
      return docs.sort(SORT[params.collection]);
    },
  });

  route({
    method: 'post',
    path: '/v1/workspace/collections/:collection',
    tag: 'Workspace',
    summary: 'Save one document. A bill that already exists needs ?overwrite=1 (an edit), else 409',
    params: z.object({ collection }),
    query: z.object({ overwrite: flag }),
    body: anyDoc,
    response: ok.extend({ id: z.string() }),
    handler: async ({ tx, orgId, params, query, body }) => {
      const doc: Doc = { ...body };
      if (!doc.id) {
        if (params.collection === 'bills')
          throw new AppError('bad_request', 'Bill must have an id');
        doc.id = `${ID_PREFIX[params.collection]}${Date.now()}`;
      }
      const key = String(doc.id);
      // The invoice number is free text on the client, so a typo could silently replace a saved bill. Editing says so.
      if (
        params.collection === 'bills' &&
        !isOn(query.overwrite) &&
        (await getDoc(tx, 'bills', key))
      ) {
        throw new AppError('duplicate_number', 'A bill with this invoice number already exists', {
          invoiceNumber: key,
        });
      }
      const created = await putDoc(tx, orgId, params.collection, key, doc);
      await audit(
        tx,
        orgId,
        `${params.collection}.${created ? 'create' : 'update'}`,
        params.collection,
        null,
        { after: { id: key } },
      );
      return { success: true as const, id: key };
    },
  });

  route({
    method: 'delete',
    path: '/v1/workspace/collections/:collection/:id',
    tag: 'Workspace',
    summary:
      'Delete a document. Bills go to the trash for 30 days (?permanent=1 skips it) and are kept while another bill relies on them',
    params: z.object({ collection, id: z.string() }),
    query: z.object({ force: flag, permanent: flag }),
    response: ok.passthrough(),
    handler: async ({ tx, orgId, params, query }) => {
      const doc = await getDoc(tx, params.collection, params.id);
      if (!doc) return { success: true as const };
      if (params.collection === 'bills') {
        if (!isOn(query.force)) {
          // A bill that was the credit source of another live bill can not vanish: that bill would stay "paid" by nothing.
          const dependents: { id: unknown; invoiceNumber: unknown; amount: unknown }[] = [];
          for (const other of await listDocs(tx, 'bills')) {
            if (other.id === params.id) continue;
            const payments =
              ((other.payments ?? (other.data as Doc | undefined)?.payments) as
                Doc[] | undefined) ?? [];
            const hit = payments.find(
              (p) =>
                p?.mode === 'credit-applied' &&
                ((p.creditSourceBillIds as string[] | undefined) ?? []).includes(params.id),
            );
            if (hit)
              dependents.push({
                id: other.id,
                invoiceNumber: other.invoiceNumber,
                amount: hit.amount,
              });
          }
          if (dependents.length) {
            throw new AppError(
              'credit_dependency',
              'This bill was used as a client-credit source on another invoice. Deleting it would leave that invoice paid via credit that no longer has a real source.',
              { dependents },
            );
          }
        }
        if (!isOn(query.permanent)) {
          await tx.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, doc.id));
          await audit(tx, orgId, 'bills.trash', 'bills', null, { before: { id: params.id } });
          return { success: true as const, trashed: true };
        }
      }
      await tx.delete(documents).where(eq(documents.id, doc.id));
      await audit(tx, orgId, `${params.collection}.delete`, params.collection, null, {
        before: { id: params.id },
      });
      return {
        success: true as const,
        ...(params.collection === 'bills' ? { permanent: true } : {}),
      };
    },
  });

  // ---- the active business profile ----
  route({
    method: 'get',
    path: '/v1/workspace/profile',
    tag: 'Workspace',
    summary: 'The active business profile',
    response: anyDoc,
    handler: async ({ tx }) => (await getKv<Doc>(tx, 'profile')) ?? DEFAULT_PROFILE,
  });
  route({
    method: 'post',
    path: '/v1/workspace/profile',
    tag: 'Workspace',
    summary: 'Replace the active business profile',
    body: anyDoc,
    response: ok,
    handler: async ({ tx, orgId, body }) => {
      await setKv(tx, orgId, 'profile', body);
      await audit(tx, orgId, 'profile.update', 'profile', null, {
        after: { businessName: body.businessName },
      });
      return { success: true as const };
    },
  });

  // ---- settings: one value per key, counters, per-person preferences ----
  route({
    method: 'get',
    path: '/v1/workspace/meta/:key',
    tag: 'Workspace',
    summary: 'One setting',
    params: z.object({ key: z.string().max(120) }),
    response: z.object({ value: z.unknown() }),
    handler: async ({ tx, params }) => ({ value: (await getKv(tx, META + params.key)) ?? null }),
  });
  route({
    method: 'post',
    path: '/v1/workspace/meta/:key',
    tag: 'Workspace',
    summary: 'Set one setting',
    params: z.object({ key: z.string().max(120) }),
    body: z.object({ value: z.unknown() }),
    response: ok,
    handler: async ({ tx, orgId, params, body }) => {
      await setKv(tx, orgId, META + params.key, body.value ?? null);
      return { success: true as const };
    },
  });
  route({
    method: 'post',
    path: '/v1/workspace/meta/:key/increment',
    tag: 'Workspace',
    summary: 'Take the next number of a counter, atomically; `start` lets a counter begin at 1001',
    params: z.object({ key: z.string().max(120) }),
    body: z.object({ start: z.unknown().optional() }),
    response: z.object({ value: z.number() }),
    handler: async ({ tx, orgId, params, body }) => ({
      value: await bumpCounter(tx, orgId, META + params.key, (cur) =>
        nextCounterValue(cur as number, body.start as number),
      ),
    }),
  });

  // Browser preferences (print settings, region, features) belong to the person, not the organization.
  route({
    method: 'get',
    path: '/v1/workspace/local-prefs',
    tag: 'Workspace',
    summary: 'My saved screen preferences',
    response: z.object({ value: z.record(z.string(), z.string()) }),
    handler: async ({ tx, auth }) => ({
      value: (await getKv<Record<string, string>>(tx, `prefs:${auth.user.id}`)) ?? {},
    }),
  });
  route({
    method: 'post',
    path: '/v1/workspace/local-prefs',
    tag: 'Workspace',
    summary: 'Merge into my saved screen preferences',
    body: z.object({
      set: z.record(z.string(), z.string()).default({}),
      remove: z.array(z.string()).default([]),
    }),
    response: ok,
    handler: async ({ tx, orgId, auth, body }) => {
      const key = `prefs:${auth.user.id}`;
      const prefs = { ...((await getKv<Record<string, string>>(tx, key)) ?? {}), ...body.set };
      for (const k of body.remove) delete prefs[k];
      await setKv(tx, orgId, key, prefs);
      return { success: true as const };
    },
  });

  // ---- numbering follows a renamed business ----
  route({
    method: 'post',
    path: '/v1/workspace/number-series/rename',
    tag: 'Workspace',
    summary: 'Move a business number series and its counters to a new GSTIN or name',
    body: z.object({ from: z.string().min(1), to: z.string().min(1) }),
    response: z.object({ moved: z.boolean() }),
    handler: async ({ tx, orgId, body }) => {
      if (body.from === body.to) throw new AppError('bad_request', 'Nothing to rename');
      const series = ((await getKv<Record<string, unknown>>(tx, `${META}invoiceNumberSeries`)) ??
        {}) as Record<string, unknown>;
      if (!series[body.from] || series[body.to]) return { moved: false };
      series[body.to] = series[body.from];
      delete series[body.from];
      await setKv(tx, orgId, `${META}invoiceNumberSeries`, series);
      const meta = await allMeta(tx);
      for (const [key, value] of Object.entries(meta)) {
        if (!key.startsWith('counter_') || !key.endsWith(`@${body.from}`)) continue;
        const target = `${key.slice(0, -body.from.length)}${body.to}`;
        await setKv(
          tx,
          orgId,
          META + target,
          Math.max(Number(meta[target]) || 0, Number(value) || 0),
        );
        await tx.execute(sql`delete from workspace_kv where key = ${META + key}`);
      }
      return { moved: true };
    },
  });

  // ---- the bill trash (30 days) ----
  route({
    method: 'get',
    path: '/v1/workspace/trash',
    tag: 'Workspace',
    summary: 'Bills deleted in the last 30 days',
    response: z.array(anyDoc),
    handler: async ({ tx }) =>
      (await trashedDocs(tx, 'bills')).map((r) => ({
        ...(r.data as Doc),
        _trashedAt: r.deletedAt!.toISOString(),
      })),
  });
  route({
    method: 'post',
    path: '/v1/workspace/trash/:id/restore',
    tag: 'Workspace',
    summary: 'Put a deleted bill back',
    params: z.object({ id: z.string() }),
    response: ok,
    handler: async ({ tx, orgId, params }) => {
      const [row] = await tx
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.collection, 'bills'),
            eq(documents.key, params.id),
            isNotNull(documents.deletedAt),
          ),
        );
      if (!row) throw new AppError('not_in_trash', 'Not in trash');
      if (await getDoc(tx, 'bills', params.id))
        throw new AppError(
          'duplicate_number',
          'An invoice with this number exists again. Rename or delete it first.',
        );
      await tx.update(documents).set({ deletedAt: null }).where(eq(documents.id, row.id));
      await audit(tx, orgId, 'bills.restore', 'bills', null, { after: { id: params.id } });
      return { success: true as const };
    },
  });
  route({
    method: 'delete',
    path: '/v1/workspace/trash/:id',
    tag: 'Workspace',
    summary: 'Delete a trashed bill for good',
    params: z.object({ id: z.string() }),
    response: ok,
    handler: async ({ tx, orgId, params }) => {
      await tx
        .delete(documents)
        .where(
          and(
            eq(documents.collection, 'bills'),
            eq(documents.key, params.id),
            isNotNull(documents.deletedAt),
          ),
        );
      await audit(tx, orgId, 'bills.purge', 'bills', null, { before: { id: params.id } });
      return { success: true as const };
    },
  });

  // ---- recurring ----
  route({
    method: 'post',
    path: '/v1/workspace/recurring/:id/generate',
    tag: 'Workspace',
    summary: '"Generate now": one invoice from a recurring template, and the template moves on',
    params: z.object({ id: z.string() }),
    response: ok.extend({ invoiceNumber: z.string() }),
    status: 200,
    handler: async ({ tx, orgId, params }) => {
      const tpl = await getDoc(tx, 'recurring', params.id);
      if (!tpl) throw new AppError('not_found', 'Recurring template not found');
      const invoiceNumber = await generateFromTemplate(tx, orgId, tpl.data as Doc);
      await audit(tx, orgId, 'recurring.generate', 'recurring', null, {
        after: { id: params.id, invoiceNumber },
      });
      return { success: true as const, invoiceNumber };
    },
  });

  // ---- backup file the user keeps: export and import ----
  route({
    method: 'get',
    path: '/v1/workspace/export',
    tag: 'Workspace',
    summary: 'Everything in the workspace as one JSON file (the shape the old app exported)',
    response: anyDoc,
    handler: async ({ tx }) => ({
      bills: await listDocs(tx, 'bills'),
      profile: (await getKv(tx, 'profile')) ?? DEFAULT_PROFILE,
      clients: await listDocs(tx, 'clients'),
      termsTemplates: await listDocs(tx, 'templates'),
      products: await listDocs(tx, 'products'),
      expenses: await listDocs(tx, 'expenses'),
      recurring: await listDocs(tx, 'recurring'),
      receipts: await listDocs(tx, 'receipts'),
      profiles: await listDocs(tx, 'profiles'),
      purchases: await listDocs(tx, 'purchases'),
      meta: await allMeta(tx),
      exportedAt: new Date().toISOString(),
    }),
  });

  route({
    method: 'post',
    path: '/v1/workspace/import',
    tag: 'Workspace',
    summary: 'Import a backup file. Without ?overwrite=1 nothing that already exists is replaced',
    query: z.object({ overwrite: flag }),
    body: anyDoc,
    response: anyDoc,
    handler: async ({ tx, orgId, query, body }) => {
      const overwrite = isOn(query.overwrite);
      const counts: Record<string, number> = {};
      const map: [string, Collection, string][] = [
        ['bills', 'bills', 'bill'],
        ['clients', 'clients', 'client'],
        ['termsTemplates', 'templates', 'template'],
        ['products', 'products', 'product'],
        ['expenses', 'expenses', 'expense'],
        ['recurring', 'recurring', 'recurring'],
        ['receipts', 'receipts', 'receipt'],
        ['profiles', 'profiles', 'profile'],
        ['purchases', 'purchases', 'purchase'],
      ];
      for (const [field, coll, label] of map) {
        counts[`${label}Count`] = 0;
        counts[`${label}Skipped`] = 0;
        for (const d of (body[field] as Doc[] | undefined) ?? []) {
          if (!d?.id) continue;
          const key = String(d.id);
          if (!overwrite && (await getDoc(tx, coll, key))) {
            counts[`${label}Skipped`]++;
            continue;
          }
          await putDoc(tx, orgId, coll, key, d);
          counts[`${label}Count`]++;
        }
      }
      const profile = body.profile as Doc | undefined;
      if (profile && (overwrite || !(await getKv(tx, 'profile'))))
        await setKv(tx, orgId, 'profile', profile);

      const incoming = body.meta as Record<string, unknown> | undefined;
      if (incoming) {
        const { appLock: _pin, ...clean } = incoming; // a backup from before the PIN lock was removed may carry a hash
        const current = await allMeta(tx);
        if (overwrite || Object.keys(current).length === 0) {
          for (const [k, v] of Object.entries(clean)) await setKv(tx, orgId, META + k, v);
        } else {
          // A merge keeps what is here, adds the backup's number series and the higher of each counter, so no number is reused.
          const series = {
            ...((clean.invoiceNumberSeries as Doc) ?? {}),
            ...((current.invoiceNumberSeries as Doc) ?? {}),
          };
          if (Object.keys(series).length)
            await setKv(tx, orgId, `${META}invoiceNumberSeries`, series);
          for (const [k, v] of Object.entries(clean))
            if (k.startsWith('counter_') && Number(v) > (Number(current[k]) || 0))
              await setKv(tx, orgId, META + k, Number(v));
        }
      }
      await reconcileCounters(tx, orgId);
      await audit(tx, orgId, 'workspace.import', 'workspace', null, { after: counts });
      return { ...counts, hasProfile: !!profile };
    },
  });
}

/** After an import, make every counter at least the highest number already used, so the next invoice can not collide. */
async function reconcileCounters(tx: Parameters<typeof listDocs>[0], orgId: string) {
  const meta = await allMeta(tx);
  const maxByKey: Record<string, number> = {};
  for (const bill of await listDocs(tx, 'bills')) {
    const num = String(bill.invoiceNumber ?? bill.id ?? '');
    const m = num.match(/^([A-Z]+)[\W_].*?(\d+)\s*$/i);
    if (!m) continue;
    const suffix = parseInt(m[2], 10);
    if (!Number.isFinite(suffix)) continue;
    const prefixKey = `counter_${m[1].toUpperCase()}`;
    maxByKey[prefixKey] = Math.max(maxByKey[prefixKey] ?? 0, suffix);
    const data = (bill.data as Doc | undefined) ?? {};
    const typePrefix =
      INVOICE_TYPES[String(bill.invoiceType ?? data.invoiceType ?? 'tax-invoice')]?.prefix;
    if (typePrefix) {
      const biz = businessKeyOf(
        (data.profile as Doc) ?? { gstin: bill.ownerGstin, businessName: bill.ownerName },
      );
      const series = numberSeriesFor(
        meta.invoiceNumberSettings as Doc,
        meta.invoiceNumberSeries as Doc,
        biz,
      );
      const head = formatDocNumber({
        settings: { ...series, format: 'sequential', showFinYear: false },
        typePrefix,
        next: 0,
      }).replace(/0+$/, '');
      if (num.toUpperCase().startsWith(head.toUpperCase())) {
        const key = counterKeyFor(typePrefix, series, biz);
        maxByKey[key] = Math.max(maxByKey[key] ?? 0, suffix);
      }
    }
  }
  for (const [key, max] of Object.entries(maxByKey))
    if (max > (Number(meta[key]) || 0)) await setKv(tx, orgId, META + key, max);
}
