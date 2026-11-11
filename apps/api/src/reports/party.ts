// Vyapar parity P6-S3, the party reports that read documents: All Parties (with what each owes or is owed), Party-wise
// P&L, Party Report by Item, Sale / Purchase by Party and by Party Group (children rolled up).
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import { uuid } from '@ledgora/contracts';
import { descendantIds } from '@ledgora/tax-engine';
import { documentBalances } from '../modules/ledgerBackfill.ts';
import { billProfit, partyNames, saleDocs, saleLines, saleSign } from './documents.ts';
import { commonParams, defineReport } from './registry.ts';
import { fyStartOf, r2, today } from './shared.ts';

const { parties, partyGroups, purchases, purchaseLines } = schema;
const side = z.enum(['sale', 'purchase']).default('sale');
const period = (p: { from?: string; to?: string }) => ({
  from: p.from ?? fyStartOf(p.to ?? today()),
  to: p.to ?? today(),
});
const sum = (rows: Record<string, unknown>[], k: string) =>
  r2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));

/** A group and every group under it (the engine's `descendantIds` leaves the group itself out). */
const withDescendants = (nodes: ReturnType<typeof treeOf>, id: string) =>
  new Set([id, ...descendantIds(nodes, id)]);

/** The party-group tree as the tax engine's helpers read it. */
const treeOf = (groups: { id: string; name: string; parentId: string | null }[]) =>
  groups.map((g) => ({ id: g.id, name: g.name, parentId: g.parentId }));

async function groupNames(tx: Tx) {
  return new Map(
    (
      await tx
        .select({ id: partyGroups.id, name: partyGroups.name })
        .from(partyGroups)
        .where(isNull(partyGroups.deletedAt))
    ).map((g) => [g.id, g.name]),
  );
}

export const allParties = defineReport({
  id: 'all-parties',
  title: 'All Parties',
  group: 'party',
  description:
    'Every party with contact details, group, what they owe you (to collect) and what you owe them (to pay).',
  params: commonParams.extend({
    groupId: uuid.optional(),
    balance: z.enum(['all', 'receivable', 'payable']).default('all'),
    kind: z.enum(['all', 'customer', 'supplier', 'both']).default('all'),
  }),
  run: async (tx, p) => {
    const list = await tx
      .select()
      .from(parties)
      .where(
        and(isNull(parties.deletedAt), p.kind === 'all' ? undefined : eq(parties.kind, p.kind)),
      )
      .orderBy(asc(parties.name));
    const inGroup = p.groupId
      ? withDescendants(
          treeOf(await tx.select().from(partyGroups).where(isNull(partyGroups.deletedAt))),
          p.groupId,
        )
      : null;
    const bal = await documentBalances(tx, p.businessId);
    const groups = await groupNames(tx);
    const rows = list
      .filter((x) => !inGroup || (x.groupId && inGroup.has(x.groupId)))
      .map((x) => ({
        id: x.id,
        name: x.name,
        email: x.email,
        phone: x.phone,
        group: x.groupId ? (groups.get(x.groupId) ?? '') : '',
        address: [x.address, x.city, x.state, x.pin].filter(Boolean).join(', '),
        gstin: x.gstin ?? '',
        toCollect: bal.recv.get(x.id) ?? 0,
        toPay: bal.payable.get(x.id) ?? 0,
        creditLimit: x.creditLimit ?? null,
      }))
      .filter((r) =>
        p.balance === 'receivable'
          ? r.toCollect > 0.005
          : p.balance === 'payable'
            ? r.toPay > 0.005
            : true,
      );
    return {
      rows,
      totals: { toCollect: sum(rows, 'toCollect'), toPay: sum(rows, 'toPay'), count: rows.length },
      meta: {},
    };
  },
});

export const partyPnl = defineReport({
  id: 'party-pnl',
  title: 'Party-wise Profit & Loss',
  group: 'party',
  description:
    'Sale value, what the goods cost and the profit for each customer, from Bill Wise Profit.',
  profit: true,
  params: commonParams.extend({ groupId: uuid.optional() }),
  run: async (tx, p) => {
    const { from, to } = period(p);
    const inGroup = p.groupId
      ? withDescendants(
          treeOf(await tx.select().from(partyGroups).where(isNull(partyGroups.deletedAt))),
          p.groupId,
        )
      : null;
    const list = await billProfit(tx, p.businessId, from, to);
    const by = new Map<string, { sale: number; cost: number; profit: number }>();
    for (const x of list) {
      const k = x.d.partyId ?? 'none';
      const v = by.get(k) ?? { sale: 0, cost: 0, profit: 0 };
      by.set(k, {
        sale: r2(v.sale + x.sale),
        cost: r2(v.cost + x.cost),
        profit: r2(v.profit + x.profit),
      });
    }
    const people = await tx
      .select()
      .from(parties)
      .where(
        inArray(
          parties.id,
          [...by.keys()].filter((k) => k !== 'none'),
        ),
      );
    const rows = [...by.entries()]
      .map(([k, v]) => {
        const who = people.find((x) => x.id === k);
        return {
          id: k,
          name: who?.name ?? 'No party',
          phone: who?.phone ?? '',
          groupId: who?.groupId ?? null,
          ...v,
        };
      })
      .filter((r) => !inGroup || (r.groupId && inGroup.has(r.groupId)))
      .map(({ groupId: _g, ...r }) => r)
      .sort((a, b) => b.profit - a.profit);
    return {
      rows,
      totals: { sale: sum(rows, 'sale'), cost: sum(rows, 'cost'), profit: sum(rows, 'profit') },
      meta: { from, to },
    };
  },
});

export const partyByItem = defineReport({
  id: 'party-by-item',
  title: 'Party Report by Item',
  group: 'party',
  description: 'Quantity and value of each item sold to and bought from each party in the period.',
  params: commonParams.extend({ partyId: uuid.optional(), itemId: uuid.optional() }),
  run: async (tx, p) => {
    const { from, to } = period(p);
    const acc = new Map<
      string,
      {
        party: string;
        item: string;
        saleQty: number;
        saleAmt: number;
        purchaseQty: number;
        purchaseAmt: number;
      }
    >();
    const slot = (party: string, item: string) => {
      const k = `${party}|${item}`;
      const v = acc.get(k) ?? {
        party,
        item,
        saleQty: 0,
        saleAmt: 0,
        purchaseQty: 0,
        purchaseAmt: 0,
      };
      acc.set(k, v);
      return v;
    };
    const docs = await saleDocs(tx, p.businessId, from, to, { partyId: p.partyId });
    const sign = new Map(docs.map((d) => [d.id, saleSign(d.invoiceType)]));
    const who = new Map(docs.map((d) => [d.id, d.partyId ?? '']));
    for (const l of await saleLines(
      tx,
      docs.map((d) => d.id),
    )) {
      if (p.itemId && l.itemId !== p.itemId) continue;
      const v = slot(who.get(l.invoiceId) ?? '', l.name);
      const sg = sign.get(l.invoiceId) ?? 1;
      v.saleQty += sg * l.quantity;
      v.saleAmt += sg * l.taxableAmount;
    }
    const bills = await tx
      .select()
      .from(purchases)
      .where(
        and(
          eq(purchases.businessId, p.businessId),
          isNull(purchases.deletedAt),
          inArray(purchases.docType, ['bill', 'debit-note']),
          gte(purchases.purchaseDate, from),
          lte(purchases.purchaseDate, to),
          p.partyId ? eq(purchases.supplierId, p.partyId) : undefined,
        ),
      );
    const bySign = new Map(bills.map((b) => [b.id, b.docType === 'debit-note' ? -1 : 1]));
    const bySupplier = new Map(bills.map((b) => [b.id, b.supplierId ?? b.supplierName]));
    if (bills.length)
      for (const l of await tx
        .select()
        .from(purchaseLines)
        .where(
          and(
            inArray(
              purchaseLines.purchaseId,
              bills.map((b) => b.id),
            ),
            isNull(purchaseLines.deletedAt),
          ),
        )) {
        if (p.itemId && l.itemId !== p.itemId) continue;
        const v = slot(bySupplier.get(l.purchaseId) ?? '', l.name);
        const sg = bySign.get(l.purchaseId) ?? 1;
        v.purchaseQty += sg * l.quantity;
        v.purchaseAmt += sg * l.taxableAmount;
      }
    const names = await partyNames(
      tx,
      [...acc.values()].map((v) => v.party),
    );
    const rows = [...acc.entries()]
      .map(([k, v]) => ({
        id: k,
        ...v,
        party: names.get(v.party) ?? (/^[0-9a-f-]{36}$/.test(v.party) ? '' : v.party),
        saleQty: Math.round(v.saleQty * 1000) / 1000,
        saleAmt: r2(v.saleAmt),
        purchaseQty: Math.round(v.purchaseQty * 1000) / 1000,
        purchaseAmt: r2(v.purchaseAmt),
      }))
      .sort((a, b) => a.party.localeCompare(b.party) || a.item.localeCompare(b.item));
    return {
      rows,
      totals: {
        saleQty: sum(rows, 'saleQty'),
        saleAmt: sum(rows, 'saleAmt'),
        purchaseQty: sum(rows, 'purchaseQty'),
        purchaseAmt: sum(rows, 'purchaseAmt'),
      },
      meta: { from, to },
    };
  },
});

/** Sale or purchase per party over a period: total value (before GST) net of returns, and the party's group. */
async function amountsByParty(
  tx: Tx,
  businessId: string,
  from: string,
  to: string,
  s: 'sale' | 'purchase',
) {
  const out = new Map<string, number>();
  if (s === 'sale') {
    for (const d of await saleDocs(tx, businessId, from, to))
      out.set(
        d.partyId ?? 'none',
        r2((out.get(d.partyId ?? 'none') ?? 0) + saleSign(d.invoiceType) * d.taxableAmount),
      );
  } else {
    for (const d of await tx
      .select()
      .from(purchases)
      .where(
        and(
          eq(purchases.businessId, businessId),
          isNull(purchases.deletedAt),
          inArray(purchases.docType, ['bill', 'debit-note']),
          gte(purchases.purchaseDate, from),
          lte(purchases.purchaseDate, to),
        ),
      )) {
      const k = d.supplierId ?? 'none';
      out.set(k, r2((out.get(k) ?? 0) + (d.docType === 'debit-note' ? -1 : 1) * d.taxableAmount));
    }
  }
  return out;
}

export const byParty = defineReport({
  id: 'by-party',
  title: 'Sale / Purchase by Party',
  group: 'party',
  description:
    'Value of sales (or purchases) per party in the period, before GST and net of returns.',
  params: commonParams.extend({ side }),
  run: async (tx, p) => {
    const { from, to } = period(p);
    const amounts = await amountsByParty(tx, p.businessId, from, to, p.side);
    const names = await partyNames(tx, [...amounts.keys()]);
    const rows = [...amounts.entries()]
      .map(([id, amount]) => ({ id, party: names.get(id) ?? 'No party', amount }))
      .sort((a, b) => b.amount - a.amount);
    return { rows, totals: { amount: sum(rows, 'amount') }, meta: { from, to, side: p.side } };
  },
});

export const byPartyGroup = defineReport({
  id: 'by-party-group',
  title: 'Sale / Purchase by Party Group',
  group: 'party',
  description: 'Value per party group, with the groups under it rolled up into it.',
  params: commonParams.extend({ side }),
  run: async (tx, p) => {
    const { from, to } = period(p);
    const amounts = await amountsByParty(tx, p.businessId, from, to, p.side);
    const people = await tx.select({ id: parties.id, groupId: parties.groupId }).from(parties);
    const groupOf = new Map(people.map((x) => [x.id, x.groupId]));
    const groups = await tx
      .select()
      .from(partyGroups)
      .where(isNull(partyGroups.deletedAt))
      .orderBy(asc(partyGroups.name));
    const nodes = treeOf(groups);
    const own = new Map<string, number>();
    let ungrouped = 0;
    for (const [party, amount] of amounts) {
      const g = groupOf.get(party);
      if (g) own.set(g, r2((own.get(g) ?? 0) + amount));
      else ungrouped = r2(ungrouped + amount);
    }
    const depth = (id: string): number => {
      const g = groups.find((x) => x.id === id);
      return g?.parentId ? 1 + depth(g.parentId) : 0;
    };
    const rows = groups
      .map((g) => {
        const ids = withDescendants(nodes, g.id);
        const amount = r2([...ids].reduce((s, id) => s + (own.get(id) ?? 0), 0));
        return { id: g.id, group: g.name, depth: depth(g.id), own: own.get(g.id) ?? 0, amount };
      })
      .filter((r) => Math.abs(r.amount) >= 0.005 || Math.abs(r.own) >= 0.005);
    if (Math.abs(ungrouped) >= 0.005)
      rows.push({ id: 'none', group: 'No group', depth: 0, own: ungrouped, amount: ungrouped });
    // The grand total counts each party once: top-level rows only (a child is already inside its parent).
    const top = rows.filter((r) => r.depth === 0);
    return { rows, totals: { amount: sum(top, 'amount') }, meta: { from, to, side: p.side } };
  },
});

export const PARTY_REPORTS = [allParties, partyPnl, partyByItem, byParty, byPartyGroup];
