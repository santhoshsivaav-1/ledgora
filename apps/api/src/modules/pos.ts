// Vyapar parity P12 (Point of Sale). A counter bill is an ordinary tax invoice saved through createInvoice, so its
// stock movements, inline payments, guards (period lock, negative stock, credit limit, §269ST) and ledger posting are
// the same code as every other sale. What is added here: the settings, the counter's item and customer lookups, the
// tender (cash change, split payment, credit) and loyalty points.
import { and, asc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { schema, type Tx } from '@ledgora/db';
import {
  posCustomerQuery,
  posCustomers,
  posItemQuery,
  posItems,
  posSaleInput,
  posSaleResult,
  posSettingsInput,
  posSettingsQuery,
  posSettings as posSettingsSchema,
} from '@ledgora/contracts';
import {
  PosError,
  maxRedeemable,
  pointsEarned,
  posInvoiceLines,
  posSettings,
  posTotals,
  settleTender,
  type PosBill,
} from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError } from '../errors.ts';
import type { Registrar } from '../http.ts';
import { loadBusiness } from './businesses.ts';
import { createInvoice } from './invoices.ts';

const { items, parties, invoices, loyaltyPoints, businessSettings, stockMovements } = schema;
const r2 = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

type Prefs = { pos?: unknown } & Record<string, unknown>;

export async function loadPosSettings(tx: Tx, businessId: string) {
  const [s] = await tx
    .select({ p: businessSettings.preferences })
    .from(businessSettings)
    .where(eq(businessSettings.businessId, businessId));
  return posSettings(((s?.p as Prefs | undefined)?.pos ?? {}) as Record<string, unknown>);
}

/** Points a customer has: earned less redeemed, on bills that are still live (a cancelled bill gives its points back). */
export async function loyaltyBalances(tx: Tx, partyIds: string[]) {
  const out = new Map<string, number>();
  if (!partyIds.length) return out;
  const rows = await tx
    .select({
      partyId: loyaltyPoints.partyId,
      p: sql<number>`sum(${loyaltyPoints.points})::float8`,
    })
    .from(loyaltyPoints)
    .innerJoin(invoices, eq(invoices.id, loyaltyPoints.invoiceId))
    .where(
      and(
        inArray(loyaltyPoints.partyId, partyIds),
        isNull(loyaltyPoints.deletedAt),
        isNull(invoices.deletedAt),
        sql`${invoices.status} <> 'cancelled'`,
      ),
    )
    .groupBy(loyaltyPoints.partyId);
  for (const r of rows) out.set(r.partyId, Math.max(0, Math.floor(r.p)));
  return out;
}

async function stockFor(tx: Tx, ids: string[]) {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const rows = await tx
    .select({
      itemId: stockMovements.itemId,
      q: sql<number>`sum(${stockMovements.quantity})::float8`,
    })
    .from(stockMovements)
    .where(and(isNull(stockMovements.deletedAt), inArray(stockMovements.itemId, ids)))
    .groupBy(stockMovements.itemId);
  for (const r of rows) out.set(r.itemId, Math.round(r.q * 1000) / 1000);
  return out;
}

export function posModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/pos/settings',
    tag: 'POS',
    summary: 'The POS settings of a business',
    query: posSettingsQuery,
    response: posSettingsSchema,
    handler: async ({ tx, query }) => {
      await loadBusiness(tx, query.businessId);
      return loadPosSettings(tx, query.businessId);
    },
  });

  route({
    method: 'put',
    path: '/v1/pos/settings',
    tag: 'POS',
    summary: 'Change POS settings (only the ones sent)',
    body: posSettingsInput,
    response: posSettingsSchema,
    handler: async ({ tx, orgId, body }) => {
      await loadBusiness(tx, body.businessId);
      const [s] = await tx
        .select()
        .from(businessSettings)
        .where(eq(businessSettings.businessId, body.businessId));
      const prev = (s?.preferences ?? {}) as Prefs;
      const before = posSettings((prev.pos ?? {}) as Record<string, unknown>);
      const { loyalty, ...rest } = body.settings;
      const next = posSettings({
        ...before,
        ...rest,
        loyalty: { ...before.loyalty, ...(loyalty ?? {}) },
      });
      const preferences = { ...prev, pos: next };
      if (s)
        await tx
          .update(businessSettings)
          .set({ preferences, updatedAt: new Date() })
          .where(eq(businessSettings.id, s.id));
      else
        await tx
          .insert(businessSettings)
          .values({ orgId, businessId: body.businessId, preferences });
      await audit(tx, orgId, 'pos.settings', 'business', body.businessId, { before, after: next });
      return next;
    },
  });

  route({
    method: 'get',
    path: '/v1/pos/items',
    tag: 'POS',
    summary:
      'Scan or search: an exact barcode or item code first, then names. Returns price, GST and stock for the counter',
    query: posItemQuery,
    response: posItems,
    handler: async ({ tx, query }) => {
      const q = query.q.trim();
      const barcode = sql`${items.extra}->>'barcode'`;
      const hit = q
        ? or(
            sql`lower(${barcode}) = lower(${q})`,
            sql`lower(${items.sku}) = lower(${q})`,
            ilike(items.name, `%${q}%`),
            ilike(items.sku, `%${q}%`),
            ilike(items.hsn, `${q}%`),
          )
        : undefined;
      const rows = await tx
        .select({ r: items })
        .from(items)
        .where(and(isNull(items.deletedAt), hit))
        .orderBy(
          sql`(lower(${barcode}) = lower(${q}) or lower(${items.sku}) = lower(${q})) desc`,
          asc(items.name),
        )
        .limit(query.limit);
      const stock = await stockFor(
        tx,
        rows.map(({ r }) => r.id),
      );
      return {
        data: rows.map(({ r }) => {
          const extra = r.extra as Record<string, unknown>;
          const bc = typeof extra.barcode === 'string' && extra.barcode ? extra.barcode : null;
          const lower = q.toLowerCase();
          return {
            id: r.id,
            name: r.name,
            sku: r.sku,
            barcode: bc,
            hsn: r.hsn,
            unit: r.unit,
            salePrice: r.salePrice,
            priceInclTax: extra.salePriceInclTax === true,
            taxPercent: r.taxPercent,
            cessPercent: r.cessPercent,
            trackStock: r.trackStock,
            stock: r.trackStock ? (stock.get(r.id) ?? 0) : 0,
            exact: !!q && (bc?.toLowerCase() === lower || (r.sku ?? '').toLowerCase() === lower),
          };
        }),
      };
    },
  });

  route({
    method: 'get',
    path: '/v1/pos/customers',
    tag: 'POS',
    summary: 'Find a customer by name or phone, with loyalty points and what they owe',
    query: posCustomerQuery,
    response: posCustomers,
    handler: async ({ tx, query }) => {
      const q = query.q.trim();
      const rows = await tx
        .select()
        .from(parties)
        .where(
          and(
            isNull(parties.deletedAt),
            sql`${parties.kind} in ('customer', 'both')`,
            sql`lower(${parties.name}) <> 'cash sale'`,
            q ? or(ilike(parties.name, `%${q}%`), ilike(parties.phone, `%${q}%`)) : undefined,
          ),
        )
        .orderBy(asc(parties.name))
        .limit(15);
      const ids = rows.map((p) => p.id);
      const points = await loyaltyBalances(tx, ids);
      const due = new Map<string, number>();
      if (ids.length)
        for (const d of await tx
          .select({
            partyId: invoices.partyId,
            owed: sql<number>`sum(case when ${invoices.invoiceType} = 'credit-note' then -${invoices.total} else ${invoices.total} - ${invoices.paidAmount} end)::float8`,
          })
          .from(invoices)
          .where(
            and(
              inArray(invoices.partyId, ids),
              isNull(invoices.deletedAt),
              sql`${invoices.status} <> 'cancelled'`,
              sql`${invoices.invoiceType} in ('tax-invoice', 'bill-of-supply', 'composition', 'credit-note')`,
            ),
          )
          .groupBy(invoices.partyId))
          if (d.partyId) due.set(d.partyId, r2(d.owed));
      return {
        data: rows.map((p) => ({
          id: p.id,
          name: p.name,
          phone: p.phone || null,
          state: p.state || null,
          gstin: p.gstin,
          points: points.get(p.id) ?? 0,
          due: due.get(p.id) ?? 0,
        })),
      };
    },
  });

  route({
    method: 'post',
    path: '/v1/pos/sales',
    tag: 'POS',
    summary:
      'Save a counter bill: an invoice with its payments, stock, ledger and loyalty points, in one transaction',
    body: posSaleInput,
    response: posSaleResult,
    status: 201,
    handler: async ({ tx, orgId, body, auth }) => {
      // A retry of a bill the counter already sent (it lost the answer) returns that bill, it does not sell twice.
      if (body.clientKey) {
        const [prior] = await tx
          .select()
          .from(invoices)
          .where(
            and(
              isNull(invoices.deletedAt),
              sql`${invoices.data}->'pos'->>'clientKey' = ${body.clientKey}`,
            ),
          );
        if (prior) {
          const [earned] = await tx
            .select({
              p: sql<number>`coalesce(sum(${loyaltyPoints.points}) filter (where ${loyaltyPoints.kind} = 'earn'), 0)::float8`,
            })
            .from(loyaltyPoints)
            .where(eq(loyaltyPoints.invoiceId, prior.id));
          const bal = prior.partyId
            ? ((await loyaltyBalances(tx, [prior.partyId])).get(prior.partyId) ?? 0)
            : 0;
          const pos = (prior.data as { pos?: { change?: number } }).pos;
          return {
            invoiceId: prior.id,
            number: prior.number,
            total: prior.total,
            paid: prior.paidAmount,
            change: pos?.change ?? 0,
            credit: r2(prior.total - prior.paidAmount),
            pointsEarned: earned?.p ?? 0,
            pointsBalance: bal,
            replayed: true,
          };
        }
      }

      const biz = await loadBusiness(tx, body.businessId);
      const settings = await loadPosSettings(tx, body.businessId);
      const bill: PosBill = {
        lines: body.lines.map((l, i) => ({
          key: String(i),
          itemId: l.itemId ?? null,
          name: l.name,
          hsn: l.hsn,
          unit: l.unit,
          quantity: l.quantity,
          freeQty: l.freeQty,
          rate: l.rate,
          discount: l.discount,
          discountType: l.discountType,
          taxPercent: l.taxPercent,
          cessPercent: l.cessPercent,
        })),
        billDiscount: body.billDiscount ?? undefined,
        billTaxPercent: body.billTaxPercent ?? null,
        charges: body.charges.map((c) => ({ name: c.name, amount: c.amount, gstRate: c.gstRate })),
        redeemPoints: body.redeemPoints,
      };
      if (body.billDiscount && !settings.billDiscount)
        throw new AppError('unprocessable', 'Bill discount is off in POS settings');
      if (body.lines.some((l) => l.freeQty > 0) && !settings.freeQty)
        throw new AppError('unprocessable', 'Free item quantity is off in POS settings');
      if (body.billTaxPercent != null && !settings.billTax)
        throw new AppError('unprocessable', 'Bill tax is off in POS settings');
      for (const t of body.tenders)
        if (!settings.paymentModes.includes(t.mode))
          throw new AppError('unprocessable', `${t.mode} is not a POS payment mode`, [
            { path: 'tenders', message: 'Turn this mode on in POS settings' },
          ]);

      // Loyalty: redeem only what the customer has and the rule allows.
      if (body.redeemPoints > 0) {
        if (!settings.loyalty.enabled)
          throw new AppError('unprocessable', 'Loyalty points are off in POS settings');
        if (!body.partyId) throw new AppError('unprocessable', 'Pick a customer to redeem points');
        const balance = (await loyaltyBalances(tx, [body.partyId])).get(body.partyId) ?? 0;
        const before = posTotals({ ...bill, redeemPoints: 0 }, settings, {
          businessState: biz.state,
        });
        const most = maxRedeemable(balance, before.total, settings.loyalty);
        if (body.redeemPoints > most)
          throw new AppError(
            'unprocessable',
            `At most ${most} points can be redeemed on this bill`,
          );
      }

      let party: typeof parties.$inferSelect | undefined;
      if (body.partyId) {
        [party] = await tx
          .select()
          .from(parties)
          .where(and(eq(parties.id, body.partyId), isNull(parties.deletedAt)));
        if (!party) throw new AppError('not_found', 'Customer not found');
      }
      const ctx = {
        businessState: biz.state,
        partyState: party?.state ?? '',
        partyGstin: party?.gstin ?? '',
      };
      const totals = posTotals(bill, settings, ctx);
      let tender;
      try {
        tender = settleTender(totals.total, body.tenders, !!party);
      } catch (e) {
        if (e instanceof PosError) throw new AppError('unprocessable', e.message);
        throw e;
      }
      if (!party && tender.credit > 0.004)
        throw new AppError('unprocessable', 'Pick a customer to sell on credit');

      const lines = posInvoiceLines(bill, settings);
      const { row } = await createInvoice(
        tx,
        orgId,
        {
          businessId: body.businessId,
          partyId: body.partyId ?? null,
          invoiceType: 'tax-invoice',
          invoiceDate: body.invoiceDate ?? today(),
          placeOfSupply: party?.state || biz.state || '',
          taxInclusive: settings.pricing === 'with-tax',
          items: lines,
          options:
            settings.roundOff === 'none'
              ? { showRoundOff: false }
              : { showRoundOff: true, roundOffMode: settings.roundOff },
          terms: '',
          notes: body.remarks,
          salesmanId: body.salesmanId ?? null,
          payments: tender.payments.map((p) => ({
            mode: p.mode,
            accountId: p.accountId ?? settings.modeAccounts[p.mode] ?? null,
            amount: p.amount,
            reference: p.reference ?? '',
          })),
          charges: body.charges,
          confirm: {
            ...body.confirm,
            ...(settings.allowNegativeStock ? { negativeStock: true } : {}),
          } as never,
        },
        { auth },
      );
      if (row.total !== totals.total)
        throw new AppError(
          'conflict',
          `The bill total changed (${row.total} on the server, ${totals.total} on the counter)`,
        );

      await tx
        .update(invoices)
        .set({
          data: sql`${invoices.data} || ${JSON.stringify({
            pos: {
              clientKey: body.clientKey ?? null,
              change: tender.change,
              redeemPoints: body.redeemPoints,
              billDiscount: body.billDiscount ?? null,
            },
          })}::jsonb`,
        })
        .where(eq(invoices.id, row.id));

      let earned = 0;
      let balance = 0;
      if (party && settings.loyalty.enabled) {
        if (body.redeemPoints > 0)
          await tx.insert(loyaltyPoints).values({
            orgId,
            businessId: body.businessId,
            partyId: party.id,
            invoiceId: row.id,
            kind: 'redeem',
            points: -body.redeemPoints,
            value: totals.pointsValue,
          });
        earned = pointsEarned(row.total, settings.loyalty);
        if (earned > 0)
          await tx.insert(loyaltyPoints).values({
            orgId,
            businessId: body.businessId,
            partyId: party.id,
            invoiceId: row.id,
            kind: 'earn',
            points: earned,
            value: 0,
          });
        balance = (await loyaltyBalances(tx, [party.id])).get(party.id) ?? 0;
      }
      await audit(tx, orgId, 'pos.sale', 'invoice', row.id, {
        after: { number: row.number, total: row.total, change: tender.change },
      });
      return {
        invoiceId: row.id,
        number: row.number,
        total: row.total,
        paid: tender.paid,
        change: tender.change,
        credit: tender.credit,
        pointsEarned: earned,
        pointsBalance: balance,
        replayed: false,
      };
    },
  });
}
