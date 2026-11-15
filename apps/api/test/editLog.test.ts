import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withTenant } from '@ledgora/db';
import { makeHarness } from './helpers.ts';

// R1.5 Companies (Accounts) Rules, Rule 3(1): every change to the books is logged with its date, and the log can not be
// changed, deleted or switched off.
const h = makeHarness();
afterAll(() => h.close());

const sale = (t: any, extra: Record<string, unknown> = {}) =>
  t.call('POST', '/v1/invoices', {
    businessId: t.businessId,
    invoiceDate: '2026-11-05',
    items: [{ name: 'Widget', quantity: 1, rate: 1000, taxPercent: 18 }],
    ...extra,
  });

describe('edit log', () => {
  it('logs the insert, every change (with the changed fields) and the delete, with who did it', async () => {
    const t = await h.newTenant();
    const made = await sale(t);
    expect(made.status, made.text).toBe(201);
    const id = made.body.id;
    const put = await t.call('PUT', `/v1/invoices/${id}`, {
      businessId: t.businessId,
      invoiceDate: '2026-11-06',
      items: [{ name: 'Widget', quantity: 2, rate: 1000, taxPercent: 18 }],
    });
    expect(put.status, put.text).toBeLessThan(300);
    const log = await t.call('GET', `/v1/edit-log?table=invoices&rowId=${id}`);
    expect(log.status, log.text).toBe(200);
    const actions = log.body.data.map((r: any) => r.action);
    expect(actions).toContain('INSERT');
    expect(actions).toContain('UPDATE');
    const upd = log.body.data.find(
      (r: any) => r.action === 'UPDATE' && r.changed.includes('invoice_date'),
    );
    expect(upd, JSON.stringify(log.body.data.map((r: any) => r.changed))).toBeTruthy();
    expect(upd.before.invoice_date).toBe('2026-11-05');
    expect(upd.after.invoice_date).toBe('2026-11-06');
    expect(upd.actorId).toBe(t.userId);
    expect(upd.what).toBe('Sale document');
    // Invoices are cancelled, never deleted: the cancel is logged as a change with the values before it.
    expect(
      (await t.call('POST', `/v1/invoices/${id}/cancel`, { reason: 'Wrong customer' })).status,
    ).toBeLessThan(300);
    const after = (await t.call('GET', `/v1/edit-log?table=invoices&rowId=${id}`)).body.data;
    expect(after.filter((r: any) => r.action === 'UPDATE').length).toBeGreaterThanOrEqual(2);
    // A row removed at the database level is logged as DELETE with its last values.
    const [line] = (await withTenant(h.db, t.orgId, (tx) =>
      tx.execute(sql`delete from invoice_lines where invoice_id = ${id} returning id`),
    )) as unknown as { id: string }[];
    const gone = (
      await t.call('GET', `/v1/edit-log?table=invoice_lines&rowId=${line!.id}&action=DELETE`)
    ).body.data;
    expect(gone).toHaveLength(1);
    expect(gone[0].before.invoice_id).toBe(id);
    // Lines are logged too.
    expect(
      (await t.call('GET', '/v1/edit-log?table=invoice_lines')).body.data.length,
    ).toBeGreaterThan(0);
  });

  it('a touch of updated_at alone is not a change', async () => {
    const t = await h.newTenant();
    const id = (await sale(t)).body.id;
    const before = (await t.call('GET', `/v1/edit-log?table=invoices&rowId=${id}`)).body.data
      .length;
    await withTenant(h.db, t.orgId, (tx) =>
      tx.execute(sql`update invoices set updated_at = now() where id = ${id}`),
    );
    expect((await t.call('GET', `/v1/edit-log?table=invoices&rowId=${id}`)).body.data.length).toBe(
      before,
    );
  });

  it('the app can not change, delete or empty the log, and has no way to turn it off', async () => {
    const t = await h.newTenant();
    await sale(t);
    for (const stmt of [
      sql`update edit_log set action = 'X'`,
      sql`delete from edit_log`,
      sql`truncate edit_log`,
      sql`insert into edit_log (org_id, table_name, row_id, action) values (${t.orgId}, 'invoices', gen_random_uuid(), 'INSERT')`,
      sql`alter table invoices disable trigger edit_log`,
    ])
      await expect(withTenant(h.db, t.orgId, (tx) => tx.execute(stmt))).rejects.toThrow();
    // Even the owning role (the migration user, outside row-level security) can not rewrite history.
    await expect(h.sql`delete from edit_log`).rejects.toThrow(/append-only/);
    await expect(h.sql`update edit_log set action = 'X'`).rejects.toThrow(/append-only/);
  });

  it('each organization sees only its own log; a biller can not read it', async () => {
    const a = await h.newTenant();
    const b = await h.newTenant();
    const id = (await sale(a)).body.id;
    expect((await b.call('GET', `/v1/edit-log?rowId=${id}`)).body.data).toEqual([]);
    const biller = await h.addMember(a, 'biller');
    expect((await biller.call('GET', '/v1/edit-log')).status).toBe(403);
  });

  it('pages by id and exports CSV for the auditor', async () => {
    const t = await h.newTenant();
    for (let i = 0; i < 3; i += 1) await sale(t);
    const first = await t.call('GET', '/v1/edit-log?table=invoices&limit=2');
    expect(first.body.data).toHaveLength(2);
    expect(first.body.nextBefore).toBe(first.body.data[1].id);
    const next = await t.call(
      'GET',
      `/v1/edit-log?table=invoices&limit=2&before=${first.body.nextBefore}`,
    );
    expect(next.body.data[0].id).toBeLessThan(first.body.data[1].id);
    const csv = await t.call('GET', '/v1/edit-log/export?table=invoices');
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toMatch(/text\/csv/);
    expect(csv.text).toMatch(/When \(IST\),Record,Record id,Action,By,IP,Changes/);
    expect(csv.text.split('\r\n').filter(Boolean).length).toBeGreaterThanOrEqual(4);
  });
});
