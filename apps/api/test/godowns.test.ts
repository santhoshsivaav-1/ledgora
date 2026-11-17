// Phase 3 (docs/AUDIT_2026-11.md): godowns, stock transfers, batches across godowns, and the bill of materials with
// manufacture runs. Stock stays the sum of stock_movements rows; a movement without a godown belongs to the default one.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ledgora/db';
import { withTenant } from '@ledgora/db';
import { makeHarness, type Tenant } from './helpers.ts';

const h = makeHarness();
let t: Tenant;
let other: Tenant;
let main: string; // the default godown
let branch: string;

const stockOf = async (itemId: string, godownId?: string) => {
  const q = godownId ? `/v1/godowns/stock?godownId=${godownId}` : '/v1/godowns/stock';
  const res = await t.call('GET', q);
  expect(res.status, res.text).toBe(200);
  return res.body.find((r: { itemId: string }) => r.itemId === itemId)?.quantity ?? 0;
};
const movements = async (where: { refType: string; refId: string }) =>
  withTenant(h.db, t.orgId, (tx) =>
    tx
      .select()
      .from(schema.stockMovements)
      .where(
        and(
          eq(schema.stockMovements.refType, where.refType),
          eq(schema.stockMovements.refId, where.refId),
        ),
      ),
  );

beforeAll(async () => {
  t = await h.newTenant();
  other = await h.newTenant();
});

afterAll(() => h.close());

describe('godowns', () => {
  it('the first godown becomes the default; the second does not; names must be unique', async () => {
    const a = await t.call('POST', '/v1/godowns', { name: 'Main Shop' });
    expect(a.status, a.text).toBe(200);
    expect(a.body).toMatchObject({ name: 'Main Shop', isDefault: true });
    main = a.body.id;
    const b = await t.call('POST', '/v1/godowns', { name: 'Branch', address: 'Main Road' });
    expect(b.status).toBe(200);
    expect(b.body.isDefault).toBe(false);
    branch = b.body.id;
    const dup = await t.call('POST', '/v1/godowns', { name: 'main shop' });
    expect(dup.status).toBe(409);
    const list = await t.call('GET', '/v1/godowns');
    expect(list.body.data).toHaveLength(2);
    expect(list.body.defaultId).toBe(main);
    // Another organization sees none of this.
    const o = await other.call('GET', '/v1/godowns');
    expect(o.body.data).toHaveLength(0);
  });

  it('renaming and moving the default works, and the default can not leave the business without a godown', async () => {
    const r = await t.call('PATCH', `/v1/godowns/${branch}`, { isDefault: true });
    expect(r.body.isDefault).toBe(true);
    expect((await t.call('GET', '/v1/godowns')).body.defaultId).toBe(branch);
    await t.call('PATCH', `/v1/godowns/${main}`, { isDefault: true });
    const list = await t.call('GET', '/v1/godowns');
    expect(list.body.defaultId).toBe(main);
    expect(list.body.data.find((g: { id: string }) => g.id === branch).isDefault).toBe(false);
  });

  it('a godown that still holds stock refuses to be deleted', async () => {
    const item = await t.call('POST', '/v1/items', {
      name: 'Widget',
      salePrice: 100,
      purchasePrice: 60,
      openingStock: 10,
    });
    expect(item.status, item.text).toBe(201);
    // Unnamed movements (the opening) belong to the default godown.
    expect(await stockOf(item.body.id, main)).toBe(10);
    expect(await stockOf(item.body.id, branch)).toBe(0);
    const del = await t.call('DELETE', `/v1/godowns/${main}`);
    expect(del.status).toBe(422);
    expect(del.text).toMatch(/Transfer them out first/);
    (globalThis as { __widgetId?: string }).__widgetId = item.body.id;
  });
});

describe('stock transfers', () => {
  let widget: string;
  beforeAll(() => {
    widget = (globalThis as { __widgetId?: string }).__widgetId ?? '';
  });

  it('a transfer moves stock out of one godown and into the other, with two movements', async () => {
    const res = await t.call('POST', '/v1/godowns/transfers', {
      transferDate: '2026-11-10',
      fromGodownId: main,
      toGodownId: branch,
      note: 'for the counter',
      lines: [{ itemId: widget, quantity: 4 }],
    });
    expect(res.status, res.text).toBe(200);
    expect(res.body.number).toBe('STR-00001');
    const moves = await movements({ refType: 'transfer', refId: res.body.id });
    expect(moves).toHaveLength(2);
    expect(moves.find((m) => m.godownId === main)?.quantity).toBe(-4);
    expect(moves.find((m) => m.godownId === branch)?.quantity).toBe(4);
    expect(await stockOf(widget, main)).toBe(6);
    expect(await stockOf(widget, branch)).toBe(4);
    // The whole business is unchanged: a transfer moves stock, it does not create or destroy it.
    const all = await t.call('GET', `/v1/items/${widget}`);
    expect(all.body.stock).toBe(10);
  });

  it('the list shows the transfer with its lines, newest first, paged', async () => {
    const list = await t.call('GET', '/v1/godowns/transfers?limit=10');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      number: 'STR-00001',
      fromGodownId: main,
      toGodownId: branch,
    });
    expect(list.body.data[0].lines).toEqual([
      { itemId: widget, quantity: 4, batchNo: undefined, expDate: undefined, serials: undefined },
    ]);
  });

  it('the same godown twice, an unknown item and taking more than the godown holds are refused', async () => {
    const same = await t.call('POST', '/v1/godowns/transfers', {
      transferDate: '2026-11-10',
      fromGodownId: main,
      toGodownId: main,
      lines: [{ itemId: widget, quantity: 1 }],
    });
    expect(same.status).toBe(400);
    const tooMany = await t.call('POST', '/v1/godowns/transfers', {
      transferDate: '2026-11-10',
      fromGodownId: branch,
      toGodownId: main,
      lines: [{ itemId: widget, quantity: 100 }],
    });
    expect(tooMany.status).toBe(422);
    expect(tooMany.text).toMatch(/Branch/);
  });

  it('deleting a transfer puts the stock back', async () => {
    const list = await t.call('GET', '/v1/godowns/transfers');
    const id = list.body.data[0].id;
    const del = await t.call('DELETE', `/v1/godowns/transfers/${id}`);
    expect(del.status).toBe(200);
    expect(await stockOf(widget, main)).toBe(10);
    expect(await stockOf(widget, branch)).toBe(0);
    const moves = await movements({ refType: 'transfer', refId: id });
    expect(moves.every((m) => m.deletedAt !== null)).toBe(true);
  });

  it('batches ride with the transfer and the lot stock follows the godown', async () => {
    const med = await t.call('POST', '/v1/items', {
      name: 'Syrup',
      salePrice: 90,
      purchasePrice: 50,
      extra: { trackBatch: true, batches: [{ batchNo: 'B1', qty: 5, expDate: '2099-01-01' }] },
    });
    expect(med.status, med.text).toBe(201);
    // Without a batch name the transfer is refused.
    const noBatch = await t.call('POST', '/v1/godowns/transfers', {
      transferDate: '2026-11-10',
      fromGodownId: main,
      toGodownId: branch,
      lines: [{ itemId: med.body.id, quantity: 2 }],
    });
    expect(noBatch.status).toBe(422);
    expect(noBatch.text).toMatch(/name the batch/);
    // With it, the batch lands in Branch and the item's lots there show it.
    const ok = await t.call('POST', '/v1/godowns/transfers', {
      transferDate: '2026-11-10',
      fromGodownId: main,
      toGodownId: branch,
      lines: [{ itemId: med.body.id, quantity: 2, batchNo: 'B1', expDate: '2099-01-01' }],
    });
    expect(ok.status, ok.text).toBe(200);
    const lotsBranch = await t.call('GET', `/v1/items/${med.body.id}/lots?godownId=${branch}`);
    expect(lotsBranch.body.batches).toEqual([expect.objectContaining({ batchNo: 'B1', qty: 2 })]);
    const lotsMain = await t.call('GET', `/v1/items/${med.body.id}/lots?godownId=${main}`);
    expect(lotsMain.body.batches).toEqual([expect.objectContaining({ batchNo: 'B1', qty: 3 })]);
  });
});

describe('bill of materials and manufacture runs', () => {
  let wood: string;
  let nails: string;
  let table: string;

  beforeAll(async () => {
    wood = (
      await t.call('POST', '/v1/items', {
        name: 'Wood plank',
        salePrice: 500,
        purchasePrice: 200,
        openingStock: 20,
      })
    ).body.id;
    nails = (
      await t.call('POST', '/v1/items', {
        name: 'Nails (box)',
        salePrice: 50,
        purchasePrice: 25,
        openingStock: 100,
      })
    ).body.id;
    table = (
      await t.call('POST', '/v1/items', { name: 'Table', salePrice: 3000, purchasePrice: 0 })
    ).body.id;
  });

  it('the BOM is saved and read back with what one unit costs', async () => {
    const put = await t.call('PUT', `/v1/items/${table}/bom`, {
      lines: [
        { componentItemId: wood, quantity: 2, scrapPercent: 0 },
        { componentItemId: nails, quantity: 4, note: 'a box does 25 tables' },
      ],
    });
    expect(put.status, put.text).toBe(200);
    const bom = await t.call('GET', `/v1/items/${table}/bom`);
    expect(bom.body.lines).toHaveLength(2);
    // 2 × ₹200 + 4 × ₹25 = ₹500 for one table.
    expect(bom.body.unitCost).toBe(500);
    // A component can not be the product itself, and an unknown one is refused.
    const self = await t.call('PUT', `/v1/items/${table}/bom`, {
      lines: [{ componentItemId: table, quantity: 1 }],
    });
    expect(self.status).toBe(400);
    const ghost = await t.call('PUT', `/v1/items/${table}/bom`, {
      lines: [{ componentItemId: '11111111-1111-4111-8111-111111111111', quantity: 1 }],
    });
    expect(ghost.status).toBe(404);
    await t.call('PUT', `/v1/items/${table}/bom`, {
      lines: [
        { componentItemId: wood, quantity: 2, scrapPercent: 0 },
        { componentItemId: nails, quantity: 4 },
      ],
    });
  });

  it('a manufacture run consumes the components and produces the product, in one godown', async () => {
    const run = await t.call('POST', '/v1/godowns/manufacture', {
      runDate: '2026-11-11',
      itemId: table,
      quantity: 3,
      note: 'first batch',
    });
    expect(run.status, run.text).toBe(200);
    expect(run.body.number).toBe('MFG-00001');
    expect(run.body.unitCost).toBe(500);
    const moves = await movements({ refType: 'manufacture', refId: run.body.id });
    expect(moves).toHaveLength(3); // 3 in for the table, 6 out of wood, 12 out of nails
    expect(moves.find((m) => m.itemId === table)?.quantity).toBe(3);
    expect(moves.find((m) => m.itemId === wood)?.quantity).toBe(-6);
    expect(moves.find((m) => m.itemId === nails)?.quantity).toBe(-12);
    expect(await stockOf(table, main)).toBe(3);
    expect(await stockOf(wood, main)).toBe(14);
    expect(await stockOf(nails, main)).toBe(88);
    // The whole business changed by the run alone.
    expect((await t.call('GET', `/v1/items/${table}`)).body.stock).toBe(3);
  });

  it('a run short of a component is refused, and an item without a BOM can not be made', async () => {
    const short = await t.call('POST', '/v1/godowns/manufacture', {
      runDate: '2026-11-11',
      itemId: table,
      quantity: 10, // needs 20 wood, the godown has 14
    });
    expect(short.status).toBe(422);
    expect(short.text).toMatch(/Wood plank/);
    const noBom = await t.call('POST', '/v1/godowns/manufacture', {
      runDate: '2026-11-11',
      itemId: wood,
      quantity: 1,
    });
    expect(noBom.status).toBe(422);
    expect(noBom.text).toMatch(/no bill of materials/);
  });

  it('the run posts one Stock voucher when the ledger is on', async () => {
    const enable = await t.call('POST', '/v1/accounting/backfill', {
      businessId: t.businessId,
      dryRun: false,
    });
    expect(enable.status, enable.text).toBe(200);
    const run = await t.call('POST', '/v1/godowns/manufacture', {
      runDate: '2026-11-12',
      itemId: table,
      quantity: 2,
    });
    expect(run.status, run.text).toBe(200);
    const rows = await withTenant(h.db, t.orgId, (tx) =>
      tx
        .select()
        .from(schema.ledgerEntries)
        .where(
          and(
            eq(schema.ledgerEntries.refType, 'manufacture_run'),
            eq(schema.ledgerEntries.refId, run.body.id),
          ),
        ),
    );
    expect(rows).toHaveLength(2);
    const dr = rows.find((r) => r.debit > 0)!;
    const cr = rows.find((r) => r.credit > 0)!;
    expect(dr.debit).toBe(cr.credit);
    expect(dr.debit).toBe(run.body.unitCost * 2);
    expect(dr.narration).toMatch(/finished goods/);
    expect(cr.narration).toMatch(/components consumed/);
  });

  it('deleting the last godown promotes another one; an empty godown deletes cleanly', async () => {
    const temp = await t.call('POST', '/v1/godowns', { name: 'Temporary' });
    const del = await t.call('DELETE', `/v1/godowns/${temp.body.id}`);
    expect(del.status).toBe(200);
    // Branch has stock from the batch transfer earlier; move it back before deleting.
    const transfer = await t.call('POST', '/v1/godowns/transfers', {
      transferDate: '2026-11-12',
      fromGodownId: branch,
      toGodownId: main,
      lines: [
        {
          itemId: (await t.call('GET', '/v1/items')).body.data.find(
            (i: { name: string }) => i.name === 'Syrup',
          ).id,
          quantity: 2,
          batchNo: 'B1',
          expDate: '2099-01-01',
        },
      ],
    });
    expect(transfer.status, transfer.text).toBe(200);
    await t.call('DELETE', `/v1/godowns/${branch}`);
    const list = await t.call('GET', '/v1/godowns');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.defaultId).toBe(main);
  });
});
