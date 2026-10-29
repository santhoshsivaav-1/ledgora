import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { schema, withTenant, type Tx } from '@ledgora/db';
import { idParam, job, legacyBundle, type LegacyBundle } from '@ledgora/contracts';
import { INVOICE_TYPES } from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { notFound } from '../errors.ts';
import type { Deps, Registrar } from '../http.ts';

const s = schema;
type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- legacy JSON is untyped by nature

const str = (v: unknown, fallback = '') =>
  typeof v === 'string' ? v : v == null ? fallback : String(v);
const num = (v: unknown, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const day = (v: unknown, fallback: string) =>
  /^\d{4}-\d{2}-\d{2}/.test(str(v)) ? str(v).slice(0, 10) : fallback;
const today = () => new Date().toISOString().slice(0, 10);

// ---- background jobs (change 1.24) -------------------------------------------------------------------------------------
// In-process for now: the job row is the contract, so moving this to a queue worker (BullMQ, Phase 5) changes no endpoint.

const pending = new Set<Promise<void>>();
/** Resolves when every started job has finished. Tests use it; so does graceful shutdown. */
export const whenJobsIdle = async () => {
  while (pending.size) await Promise.allSettled([...pending]);
};

async function startJob(
  deps: Deps,
  orgId: string,
  kind: 'import.legacy' | 'export.full',
  work: (tx: Tx) => Promise<unknown>,
) {
  const jobId = await withTenant(deps.db, orgId, async (tx) => {
    const [row] = await tx.insert(s.jobs).values({ orgId, kind }).returning({ id: s.jobs.id });
    await audit(tx, orgId, `${kind}.start`, 'job', row.id);
    return row.id;
  });
  const run = (async () => {
    const set = (patch: Partial<typeof s.jobs.$inferInsert>) =>
      withTenant(deps.db, orgId, (tx) =>
        tx
          .update(s.jobs)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(s.jobs.id, jobId)),
      );
    try {
      await set({ status: 'running', progress: 10 });
      const result = await withTenant(deps.db, orgId, work);
      await set({ status: 'done', progress: 100, result: result as object });
    } catch (e) {
      await set({ status: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  })();
  pending.add(run);
  run.finally(() => pending.delete(run));
  return jobId;
}

// ---- legacy importer ---------------------------------------------------------------------------------------------------

export async function importLegacy(tx: Tx, orgId: string, bundle: LegacyBundle) {
  const counts = {
    businesses: 0,
    parties: 0,
    items: 0,
    invoices: 0,
    payments: 0,
    purchases: 0,
    expenses: 0,
    recurring: 0,
    templates: 0,
    skipped: 0,
  };

  // Businesses: the active profile plus saved profiles, de-duplicated by GSTIN or name.
  const profiles = [bundle.profile, ...(bundle.profiles ?? [])].filter(
    (p): p is Rec => !!p && !!str((p as Rec).businessName),
  );
  const bizByKey = new Map<string, string>();
  const keyOf = (p: Rec) =>
    str(p.gstin).trim().toUpperCase() || `NAME:${str(p.businessName).trim().toLowerCase()}`;
  const existing = await tx.select().from(s.businesses).where(isNull(s.businesses.deletedAt));
  for (const b of existing)
    bizByKey.set(b.gstin ? b.gstin : `NAME:${b.name.trim().toLowerCase()}`, b.id);
  let defaultBiz = existing.find((b) => b.isDefault)?.id ?? existing[0]?.id;
  const metaSettings = (bundle.meta?.invoiceNumberSettings ?? {}) as Record<string, unknown>;
  for (const p of profiles) {
    const k = keyOf(p);
    if (bizByKey.has(k)) continue;
    const gstin = str(p.gstin).trim().toUpperCase();
    const [b] = await tx
      .insert(s.businesses)
      .values({
        orgId,
        name: str(p.businessName),
        gstin: gstin || null,
        pan: str(p.pan) || null,
        address: str(p.address),
        city: str(p.city),
        pin: str(p.pin),
        state: str(p.state),
        country: str(p.country, 'India'),
        email: str(p.email),
        phone: str(p.phone),
        isDefault: !defaultBiz && p === profiles[0],
      })
      .returning();
    await tx
      .insert(s.businessSettings)
      .values({ orgId, businessId: b.id, numberSettings: metaSettings });
    for (const a of (p.paymentAccounts ?? []) as Rec[]) {
      await tx.insert(s.paymentAccounts).values({
        orgId,
        businessId: b.id,
        label: str(a.label, 'Account'),
        bankName: str(a.bankName),
        accountHolderName: str(a.accountHolderName),
        accountNumber: str(a.accountNumber),
        accountType: str(a.accountType),
        ifsc: str(a.ifsc),
        swift: str(a.swift),
        upiId: str(a.upiId),
        notes: str(a.notes),
        isDefault: !!a.isDefault,
        isActive: a.isActive !== false,
      });
    }
    bizByKey.set(k, b.id);
    defaultBiz ??= b.id;
    counts.businesses += 1;
  }
  if (!defaultBiz) {
    const [b] = await tx
      .insert(s.businesses)
      .values({ orgId, name: 'My Business', isDefault: true })
      .returning();
    await tx
      .insert(s.businessSettings)
      .values({ orgId, businessId: b.id, numberSettings: metaSettings });
    defaultBiz = b.id;
  }
  // Records that name no business belong to the active profile of the old app, not to whatever business the org already had.
  const primaryBiz = profiles[0] ? (bizByKey.get(keyOf(profiles[0])) ?? defaultBiz) : defaultBiz;
  const bizFor = (p: Rec | undefined) =>
    p && str(p.businessName) ? (bizByKey.get(keyOf(p)) ?? primaryBiz) : primaryBiz;

  // Parties
  const partyByName = new Map<string, string>();
  for (const p of await tx
    .select({ id: s.parties.id, name: s.parties.name })
    .from(s.parties)
    .where(isNull(s.parties.deletedAt)))
    partyByName.set(p.name.toLowerCase(), p.id);
  const ensureParty = async (c: Rec, kind: 'customer' | 'supplier') => {
    const name = str(c.name ?? c.clientName ?? c.supplierName).trim();
    if (!name) return null;
    const hit = partyByName.get(name.toLowerCase());
    if (hit) return hit;
    const [row] = await tx
      .insert(s.parties)
      .values({
        orgId,
        kind,
        name,
        gstin:
          str(c.gstin ?? c.supplierGstin)
            .trim()
            .toUpperCase() || null,
        address: str(c.address ?? c.supplierAddress),
        city: str(c.city),
        pin: str(c.pin),
        state: str(c.state),
        country: str(c.country, 'India'),
        email: str(c.email),
        phone: str(c.phone),
        isSez: !!c.isSEZ,
      })
      .returning({ id: s.parties.id });
    partyByName.set(name.toLowerCase(), row.id);
    counts.parties += 1;
    return row.id;
  };
  for (const c of bundle.clients ?? []) await ensureParty(c, 'customer');

  // Items (legacy "products"): `stock` becomes the opening stock movement.
  const itemByName = new Map<string, string>();
  for (const p of bundle.products ?? []) {
    const name = str(p.name).trim();
    if (!name) continue;
    const [row] = await tx
      .insert(s.items)
      .values({
        orgId,
        name,
        hsn: str(p.hsn),
        unit: str(p.unit, 'PCS'),
        salePrice: num(p.price ?? p.rate ?? p.salePrice),
        purchasePrice: num(p.purchasePrice),
        taxPercent: num(p.taxPercent),
        cessPercent: num(p.cessPercent),
      })
      .returning({ id: s.items.id });
    itemByName.set(name.toLowerCase(), row.id);
    if (num(p.stock) !== 0)
      await tx.insert(s.stockMovements).values({
        orgId,
        itemId: row.id,
        quantity: num(p.stock),
        reason: 'opening',
        note: 'Imported',
      });
    counts.items += 1;
  }

  // Invoices (legacy "bills") with their embedded payments.
  for (const b of bundle.bills ?? []) {
    const d: Rec = b.data ?? {};
    const number = str(b.invoiceNumber ?? b.id);
    if (!number) {
      counts.skipped += 1;
      continue;
    }
    const businessId = bizFor(d.profile);
    const [dupe] = await tx
      .select({ id: s.invoices.id })
      .from(s.invoices)
      .where(
        and(
          eq(s.invoices.businessId, businessId),
          eq(s.invoices.number, number),
          isNull(s.invoices.deletedAt),
        ),
      );
    if (dupe) {
      counts.skipped += 1;
      continue;
    }
    const type = str(b.invoiceType, 'tax-invoice');
    const partyId = await ensureParty(
      { ...(d.client ?? {}), name: d.client?.name ?? b.clientName },
      'customer',
    );
    const t: Rec = d.totals ?? {};
    const total = num(t.total ?? b.totalAmount);
    const paidRaw = (b.payments ?? []) as Rec[];
    const paying = paidRaw.filter((p) => p?.mode !== 'credit-applied' && num(p?.amount) > 0);
    const paid = Math.min(
      total,
      paying.reduce((x, p) => x + num(p.amount), 0),
    );
    const status =
      b.status === 'cancelled'
        ? 'cancelled'
        : paid >= total - 0.005 && total > 0
          ? 'paid'
          : paid > 0
            ? 'partial'
            : 'unpaid';
    const date = day(b.invoiceDate ?? d.details?.invoiceDate, today());
    const [inv] = await tx
      .insert(s.invoices)
      .values({
        orgId,
        businessId,
        partyId,
        invoiceType: INVOICE_TYPES[type] ? type : 'tax-invoice',
        number,
        invoiceDate: date,
        dueDate: /^\d{4}-\d{2}-\d{2}/.test(str(d.details?.dueDate))
          ? str(d.details.dueDate).slice(0, 10)
          : null,
        status,
        currency: str(b.currency, 'INR'),
        placeOfSupply: str(d.details?.placeOfSupply),
        subtotal: num(t.subtotal),
        taxableAmount: num(t.taxableAmount),
        cgst: num(t.cgst),
        sgst: num(t.sgst) + num(t.utgst),
        igst: num(t.igst),
        cess: num(t.cess),
        totalTax: num(t.totalTaxAmount ?? b.totalTaxAmount),
        total,
        paidAmount: status === 'cancelled' ? 0 : paid,
        data: {
          totals: t,
          legacyId: str(b.id),
          terms: str(d.customTerms),
          notes: str(d.customNotes),
          options: d.invoiceOptions ?? {},
        },
      })
      .returning({ id: s.invoices.id });
    const lines = ((d.items ?? []) as Rec[]).map((l, i) => {
      const q = num(l.quantity, 1),
        r = num(l.rate),
        taxable = Math.round(q * r * 100) / 100,
        taxPct = num(l.taxPercent);
      return {
        orgId,
        invoiceId: inv.id,
        position: i,
        itemId: itemByName.get(str(l.name).toLowerCase()) ?? null,
        name: str(l.name ?? l.description, 'Item'),
        hsn: str(l.hsn),
        unit: str(l.unit, 'PCS'),
        quantity: q,
        rate: r,
        discount: num(l.discount),
        taxPercent: taxPct,
        cessPercent: num(l.cessPercent),
        taxableAmount: taxable,
        taxAmount: Math.round(((taxable * taxPct) / 100) * 100) / 100,
        lineTotal: Math.round(taxable * (1 + taxPct / 100) * 100) / 100,
        extra: { discountType: str(l.discountType, 'amount') },
      };
    });
    if (lines.length) await tx.insert(s.invoiceLines).values(lines);
    if (partyId && status !== 'cancelled') {
      for (const p of paying) {
        const [pay] = await tx
          .insert(s.payments)
          .values({
            orgId,
            businessId,
            partyId,
            amount: num(p.amount),
            mode: ['cash', 'upi', 'bank', 'cheque', 'card'].includes(str(p.mode))
              ? str(p.mode)
              : 'other',
            paymentDate: day(p.date, date),
            reference: str(p.reference),
          })
          .returning({ id: s.payments.id });
        await tx
          .insert(s.paymentAllocations)
          .values({ orgId, paymentId: pay.id, invoiceId: inv.id, amount: num(p.amount) });
        counts.payments += 1;
      }
    }
    counts.invoices += 1;
  }

  // Receipts that are not tied to a bill: kept as party credit.
  for (const r of bundle.receipts ?? []) {
    const partyId = await ensureParty(
      { name: r.clientName ?? r.partyName ?? r.client },
      'customer',
    );
    if (!partyId || num(r.amount) <= 0) {
      counts.skipped += 1;
      continue;
    }
    await tx.insert(s.payments).values({
      orgId,
      businessId: primaryBiz,
      partyId,
      amount: num(r.amount),
      mode: 'other',
      paymentDate: day(r.date, today()),
      reference: str(r.reference ?? r.id),
      notes: 'Imported receipt',
    });
    counts.payments += 1;
  }

  for (const p of bundle.purchases ?? []) {
    const items = (p.items ?? []) as Rec[];
    let taxable = 0,
      tax = 0,
      cess = 0;
    const lines = items.map((l) => {
      const q = num(l.quantity, 1),
        r = num(l.rate),
        tx1 = Math.round(q * r * 100) / 100,
        t1 = Math.round(((tx1 * num(l.taxPercent)) / 100) * 100) / 100,
        c1 = Math.round(((tx1 * num(l.cessPercent)) / 100) * 100) / 100;
      taxable += tx1;
      tax += t1;
      cess += c1;
      return {
        name: str(l.name, 'Item'),
        hsn: str(l.hsn),
        quantity: q,
        rate: r,
        taxPercent: num(l.taxPercent),
        cessPercent: num(l.cessPercent),
        taxableAmount: tx1,
        taxAmount: t1 + c1,
        lineTotal: Math.round((tx1 + t1 + c1) * 100) / 100,
      };
    });
    const inter = !!p.interstate;
    const [row] = await tx
      .insert(s.purchases)
      .values({
        orgId,
        businessId: primaryBiz,
        supplierName: str(p.supplierName),
        supplierGstin: str(p.supplierGstin),
        supplierAddress: str(p.supplierAddress),
        invoiceNumber: str(p.invoiceNumber),
        purchaseDate: day(p.date, today()),
        interstate: inter,
        paymentStatus: str(p.paymentStatus, 'Unpaid'),
        taxableAmount: taxable,
        cgst: inter ? 0 : tax / 2,
        sgst: inter ? 0 : tax / 2,
        igst: inter ? tax : 0,
        cess,
        total: taxable + tax + cess,
        data: { legacyId: str(p.id) },
      })
      .returning({ id: s.purchases.id });
    if (lines.length)
      await tx
        .insert(s.purchaseLines)
        .values(lines.map((l) => ({ ...l, orgId, purchaseId: row.id })));
    counts.purchases += 1;
  }

  for (const e of bundle.expenses ?? []) {
    if (num(e.amount) <= 0) {
      counts.skipped += 1;
      continue;
    }
    await tx.insert(s.expenses).values({
      orgId,
      businessId: primaryBiz,
      expenseDate: day(e.date, today()),
      description: str(e.description ?? e.title ?? e.category),
      vendor: str(e.vendor ?? e.payee),
      amount: num(e.amount),
      taxAmount: num(e.taxAmount),
      paymentMode: str(e.paymentMode, 'cash'),
      data: { category: str(e.category), legacyId: str(e.id) },
    });
    counts.expenses += 1;
  }

  for (const r of bundle.recurring ?? []) {
    await tx.insert(s.recurringSchedules).values({
      orgId,
      businessId: primaryBiz,
      partyId: await ensureParty(
        { name: r.clientName, state: r.clientState, gstin: r.clientGstin },
        'customer',
      ),
      name: str(r.name ?? r.clientName, 'Recurring invoice'),
      invoiceType: str(r.invoiceType, 'tax-invoice'),
      frequency: ['weekly', 'monthly', 'quarterly', 'yearly'].includes(str(r.frequency))
        ? str(r.frequency)
        : 'monthly',
      interval: Math.max(1, num(r.interval, 1)),
      nextDate: day(r.nextDate, today()),
      endMode: str(r.endMode, 'never'),
      endDate: /^\d{4}/.test(str(r.endDate)) ? str(r.endDate).slice(0, 10) : null,
      maxOccurrences: r.maxOccurrences ? num(r.maxOccurrences) : null,
      occurrencesCreated: num(r.occurrencesCreated),
      dueDays: r.dueDays === '' || r.dueDays == null ? null : num(r.dueDays),
      active: r.active !== false,
      template: {
        invoiceType: str(r.invoiceType, 'tax-invoice'),
        items: r.items ?? [],
        options: r.invoiceOptions ?? {},
        terms: str(r.customTerms),
        notes: str(r.customNotes),
        taxInclusive: !!r.taxInclusive,
        placeOfSupply: str(r.placeOfSupply),
      },
    });
    counts.recurring += 1;
  }

  for (const t of bundle.templates ?? []) {
    await tx.insert(s.termsTemplates).values({
      orgId,
      name: str(t.name, 'Terms'),
      content: str(t.content),
      isDefault: str(t.id) === 'default',
    });
    counts.templates += 1;
  }

  // Counters carry on where the old app stopped.
  for (const [key, value] of Object.entries(bundle.meta ?? {})) {
    if (!key.startsWith('counter_') || key.includes('@')) continue;
    await tx
      .insert(s.numberSeries)
      .values({ orgId, businessId: primaryBiz, counterKey: key, lastValue: Math.floor(num(value)) })
      .onConflictDoUpdate({
        target: [s.numberSeries.orgId, s.numberSeries.businessId, s.numberSeries.counterKey],
        set: { lastValue: Math.floor(num(value)) },
      });
  }
  return counts;
}

// ---- full export ----------------------------------------------------------------------------------------------------

const EXPORT_TABLES = [
  'businesses',
  'businessSettings',
  'paymentAccounts',
  'parties',
  'units',
  'items',
  'stockMovements',
  'numberSeries',
  'invoices',
  'invoiceLines',
  'payments',
  'paymentAllocations',
  'purchases',
  'purchaseLines',
  'expenseCategories',
  'expenses',
  'recurringSchedules',
  'termsTemplates',
] as const;

async function exportAll(tx: Tx, orgId: string, deps: Deps) {
  const data: Record<string, unknown[]> = {};
  for (const name of EXPORT_TABLES) data[name] = await tx.select().from(s[name]);
  const body = new TextEncoder().encode(
    JSON.stringify({ exportedAt: new Date().toISOString(), orgId, data }),
  );
  const id = randomUUID();
  const key = `${orgId}/export/${id}.json`;
  await deps.storage.put(key, body);
  await tx.insert(s.files).values({
    id,
    orgId,
    kind: 'export',
    storageKey: key,
    fileName: `ledgora-export-${today()}.json`,
    contentType: 'application/json',
    sizeBytes: body.length,
    status: 'ready',
  });
  return {
    fileId: id,
    rows: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
  };
}

const toJob = (j: typeof s.jobs.$inferSelect): z.infer<typeof job> => ({
  id: j.id,
  kind: j.kind as z.infer<typeof job>['kind'],
  status: j.status as z.infer<typeof job>['status'],
  progress: j.progress,
  result: j.result ?? null,
  error: j.error,
  createdAt: j.createdAt.toISOString(),
});

export function transferModule({ route }: Registrar) {
  route({
    method: 'post',
    path: '/v1/import/legacy',
    tag: 'Import / export',
    summary:
      'Import the old single-user app data (clients, products, bills, ...) as a background job',
    body: legacyBundle,
    response: z.object({ jobId: z.string().uuid() }),
    status: 202,
    handler: async ({ orgId, body, deps }) => ({
      jobId: await startJob(deps, orgId, 'import.legacy', (tx) => importLegacy(tx, orgId, body)),
    }),
  });

  route({
    method: 'post',
    path: '/v1/export',
    tag: 'Import / export',
    summary: 'Export everything in this organization to one JSON file, as a background job',
    response: z.object({ jobId: z.string().uuid() }),
    status: 202,
    handler: async ({ orgId, deps }) => ({
      jobId: await startJob(deps, orgId, 'export.full', (tx) => exportAll(tx, orgId, deps)),
    }),
  });

  route({
    method: 'get',
    path: '/v1/jobs/:id',
    tag: 'Import / export',
    summary:
      'Progress and result of a background job (an export result holds the fileId to download)',
    params: idParam,
    response: job,
    handler: async ({ tx, params }) => {
      const [j] = await tx
        .select()
        .from(s.jobs)
        .where(and(eq(s.jobs.id, params.id), isNull(s.jobs.deletedAt)));
      if (!j) throw notFound('Job');
      return toJob(j);
    },
  });
}
