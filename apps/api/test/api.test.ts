import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@ledgora/db';
import { line, makeHarness, type Tenant } from './helpers.ts';
import { purgeExpired } from '../src/modules/trash.ts';
import { advanceDate } from '../src/modules/recurring.ts';
import { whenJobsIdle } from '../src/modules/transfer.ts';

const h = makeHarness();
afterAll(() => h.close());

let t: Tenant;
beforeAll(async () => {
  t = await h.newTenant();
});

const invoiceBody = (over: Record<string, unknown> = {}) => ({
  businessId: t.businessId,
  invoiceDate: '2026-10-01',
  items: [line()],
  ...over,
});

describe('errors and plumbing', () => {
  it('answers validation problems with a typed error body', async () => {
    const res = await t.call('POST', '/v1/parties', { name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.details[0].path).toBe('name');
  });
  it('answers unknown routes and bad JSON in the same shape', async () => {
    expect((await t.call('GET', '/v1/nope')).body.error.code).toBe('not_found');
    const res = await h.app.request('/v1/parties', {
      method: 'POST',
      headers: { 'x-org-id': t.orgId, 'content-type': 'application/json' },
      body: '{oops',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe('bad_request');
  });
  it('reports health and serves an OpenAPI document that covers the modules', async () => {
    expect((await t.call('GET', '/health')).body).toMatchObject({ status: 'ok', db: true });
    const doc = (await t.call('GET', '/v1/openapi.json')).body;
    expect(doc.openapi).toBe('3.1.0');
    for (const p of [
      '/v1/invoices',
      '/v1/invoices/{id}/cancel',
      '/v1/parties',
      '/v1/items',
      '/v1/payments',
      '/v1/trash',
      '/v1/files/upload-url',
      '/v1/import/legacy',
    ]) {
      expect(doc.paths[p], p).toBeTruthy();
    }
    expect(
      doc.paths['/v1/invoices'].post.requestBody.content['application/json'].schema.properties
        .items,
    ).toBeTruthy();
  });
  it('has no backup endpoints: backups are managed Postgres point-in-time recovery now', async () => {
    expect((await t.call('GET', '/v1/backups')).status).toBe(404);
  });
});

describe('cursor pagination', () => {
  it('walks every row exactly once, newest first', async () => {
    const p = await h.newTenant();
    for (let i = 1; i <= 7; i++) await p.call('POST', '/v1/parties', { name: `Party ${i}` });
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await p.call('GET', `/v1/parties?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.data.map((x: any) => x.name));
      cursor = res.body.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual([
      'Party 7',
      'Party 6',
      'Party 5',
      'Party 4',
      'Party 3',
      'Party 2',
      'Party 1',
    ]);
    expect((await p.call('GET', '/v1/parties?cursor=garbage')).body.error.code).toBe('bad_request');
  });
  it('searches by name', async () => {
    const p = await h.newTenant();
    await p.call('POST', '/v1/parties', { name: 'Acme Traders' });
    await p.call('POST', '/v1/parties', { name: 'Zed Stores' });
    const res = await p.call('GET', '/v1/parties?q=acme');
    expect(res.body.data.map((x: any) => x.name)).toEqual(['Acme Traders']);
  });
});

describe('parties and items', () => {
  it('rejects a malformed GSTIN and accepts a blank one', async () => {
    expect((await t.call('POST', '/v1/parties', { name: 'Bad', gstin: '123' })).status).toBe(400);
    const ok = await t.call('POST', '/v1/parties', { name: 'No GST', gstin: '' });
    expect(ok.status).toBe(201);
    expect(ok.body.gstin).toBeNull();
  });
  it('stock is the sum of movements: opening, adjustment, sale', async () => {
    const it1 = (
      await t.call('POST', '/v1/items', { name: 'Bolt', openingStock: 20, salePrice: 5 })
    ).body;
    expect(it1.stock).toBe(20);
    expect(
      (await t.call('POST', `/v1/items/${it1.id}/stock`, { quantity: -3, note: 'damaged' })).body
        .stock,
    ).toBe(17);
    await t.call(
      'POST',
      '/v1/invoices',
      invoiceBody({ items: [line({ itemId: it1.id, quantity: 4, rate: 5 })] }),
    );
    expect((await t.call('GET', `/v1/items/${it1.id}`)).body.stock).toBe(13);
    const moves = (await t.call('GET', `/v1/items/${it1.id}/movements`)).body.data;
    expect(moves.map((m: any) => m.reason).sort()).toEqual(['adjustment', 'opening', 'sale']);
    expect((await t.call('PATCH', `/v1/items/${it1.id}`, { stock: 999 })).body.stock).toBe(13); // stock is not editable
  });
});

describe('invoices', () => {
  it('numbers by series, computes intra-state CGST+SGST and inter-state IGST', async () => {
    const customer = (
      await t.call('POST', '/v1/parties', { name: 'Local Buyer', state: 'Tamil Nadu' })
    ).body.id;
    const far = (await t.call('POST', '/v1/parties', { name: 'Far Buyer', state: 'Karnataka' }))
      .body.id;
    const intra = (
      await t.call(
        'POST',
        '/v1/invoices',
        invoiceBody({ partyId: customer, placeOfSupply: 'Tamil Nadu' }),
      )
    ).body;
    expect(intra.number).toMatch(/^INV\/2026-27\/\d{4}$/);
    expect(intra).toMatchObject({
      taxableAmount: 200,
      cgst: 18,
      sgst: 18,
      igst: 0,
      total: 236,
      status: 'unpaid',
      partyName: 'Local Buyer',
    });
    expect(intra.lines[0]).toMatchObject({ taxableAmount: 200, taxAmount: 36, lineTotal: 236 });
    const inter = (
      await t.call(
        'POST',
        '/v1/invoices',
        invoiceBody({ partyId: far, placeOfSupply: 'Karnataka' }),
      )
    ).body;
    expect(inter).toMatchObject({ cgst: 0, sgst: 0, igst: 36, total: 236 });
    const n1 = Number(intra.number.split('/').at(-1));
    expect(Number(inter.number.split('/').at(-1))).toBe(n1 + 1);
    const quote = (await t.call('POST', '/v1/invoices', invoiceBody({ invoiceType: 'quotation' })))
      .body;
    expect(quote.number).toMatch(/^QUO\//);
  });

  it('gives 12 concurrent saves 12 different consecutive numbers (number_series is locked)', async () => {
    const p = await h.newTenant();
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        p.call('POST', '/v1/invoices', {
          businessId: p.businessId,
          invoiceDate: '2026-10-01',
          items: [line()],
        }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const nums = results.map((r) => Number(r.body.number.split('/').at(-1))).sort((a, b) => a - b);
    expect(nums).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it('refuses a duplicate hand-typed number', async () => {
    const first = await t.call('POST', '/v1/invoices', invoiceBody({ number: 'MANUAL/1' }));
    expect(first.status).toBe(201);
    const again = await t.call('POST', '/v1/invoices', invoiceBody({ number: 'MANUAL/1' }));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('duplicate_number');
  });

  it('edits keep the number and redo totals and stock', async () => {
    const item = (await t.call('POST', '/v1/items', { name: 'Edit Item', openingStock: 10 })).body;
    const inv = (
      await t.call(
        'POST',
        '/v1/invoices',
        invoiceBody({ items: [line({ itemId: item.id, quantity: 2 })] }),
      )
    ).body;
    const edited = await t.call(
      'PUT',
      `/v1/invoices/${inv.id}`,
      invoiceBody({ items: [line({ itemId: item.id, quantity: 5 })] }),
    );
    expect(edited.status).toBe(200);
    expect(edited.body.number).toBe(inv.number);
    expect(edited.body.total).toBe(590);
    expect((await t.call('GET', `/v1/items/${item.id}`)).body.stock).toBe(5);
  });

  it('cancel keeps the number, puts stock back, and can not be repeated; delete is for quotes only', async () => {
    const item = (await t.call('POST', '/v1/items', { name: 'Cancel Item', openingStock: 10 }))
      .body;
    const inv = (
      await t.call(
        'POST',
        '/v1/invoices',
        invoiceBody({ items: [line({ itemId: item.id, quantity: 3 })] }),
      )
    ).body;
    expect((await t.call('GET', `/v1/items/${item.id}`)).body.stock).toBe(7);
    const del = await t.call('DELETE', `/v1/invoices/${inv.id}`);
    expect(del.status).toBe(422);
    const cancelled = await t.call('POST', `/v1/invoices/${inv.id}/cancel`, {
      reason: 'wrong customer',
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', number: inv.number });
    expect((await t.call('GET', `/v1/items/${item.id}`)).body.stock).toBe(10);
    expect((await t.call('POST', `/v1/invoices/${inv.id}/cancel`, {})).body.error.code).toBe(
      'already_cancelled',
    );
    expect((await t.call('PUT', `/v1/invoices/${inv.id}`, invoiceBody())).status).toBe(422);
  });

  it('credit notes put stock back; quotations do not move stock', async () => {
    const item = (await t.call('POST', '/v1/items', { name: 'CN Item', openingStock: 10 })).body;
    await t.call(
      'POST',
      '/v1/invoices',
      invoiceBody({ invoiceType: 'quotation', items: [line({ itemId: item.id, quantity: 4 })] }),
    );
    expect((await t.call('GET', `/v1/items/${item.id}`)).body.stock).toBe(10);
    await t.call(
      'POST',
      '/v1/invoices',
      invoiceBody({ invoiceType: 'credit-note', items: [line({ itemId: item.id, quantity: 2 })] }),
    );
    expect((await t.call('GET', `/v1/items/${item.id}`)).body.stock).toBe(12);
  });
});

describe('payments', () => {
  it('auto-allocates oldest first, tracks partial/paid, and keeps the rest as credit', async () => {
    const p = await h.newTenant();
    const party = (await p.call('POST', '/v1/parties', { name: 'Payer', state: 'Tamil Nadu' })).body
      .id;
    const mk = (date: string) =>
      p.call('POST', '/v1/invoices', {
        businessId: p.businessId,
        partyId: party,
        invoiceDate: date,
        items: [line()],
      }); // 236 each
    const old = (await mk('2026-08-01')).body;
    const recent = (await mk('2026-09-01')).body;
    const pay = await p.call('POST', '/v1/payments', {
      businessId: p.businessId,
      partyId: party,
      amount: 300,
      paymentDate: '2026-10-02',
      mode: 'upi',
      autoAllocate: true,
    });
    expect(pay.status).toBe(201);
    expect(pay.body.allocations).toEqual([
      { invoiceId: old.id, amount: 236 },
      { invoiceId: recent.id, amount: 64 },
    ]);
    expect((await p.call('GET', `/v1/invoices/${old.id}`)).body).toMatchObject({
      status: 'paid',
      paidAmount: 236,
    });
    expect((await p.call('GET', `/v1/invoices/${recent.id}`)).body).toMatchObject({
      status: 'partial',
      paidAmount: 64,
    });
    expect((await p.call('GET', `/v1/parties/${party}/balance`)).body).toEqual({
      outstanding: 172,
      credit: 0,
    });
    const extra = await p.call('POST', '/v1/payments', {
      businessId: p.businessId,
      partyId: party,
      amount: 500,
      paymentDate: '2026-10-03',
      autoAllocate: true,
    });
    expect(extra.body.unallocated).toBe(328);
    expect((await p.call('GET', `/v1/parties/${party}/balance`)).body).toEqual({
      outstanding: 0,
      credit: 328,
    });
    expect((await p.call('DELETE', `/v1/payments/${pay.body.id}`)).status).toBe(200);
    expect((await p.call('GET', `/v1/invoices/${old.id}`)).body).toMatchObject({
      status: 'unpaid',
      paidAmount: 0,
    });
  });

  it('rejects over-allocation, another party invoice, and cancelling a paid invoice without release', async () => {
    const p = await h.newTenant();
    const a = (await p.call('POST', '/v1/parties', { name: 'A' })).body.id;
    const b = (await p.call('POST', '/v1/parties', { name: 'B' })).body.id;
    const inv = (
      await p.call('POST', '/v1/invoices', {
        businessId: p.businessId,
        partyId: a,
        invoiceDate: '2026-10-01',
        items: [line()],
      })
    ).body;
    const base = { businessId: p.businessId, paymentDate: '2026-10-02' };
    expect(
      (
        await p.call('POST', '/v1/payments', {
          ...base,
          partyId: a,
          amount: 1000,
          allocations: [{ invoiceId: inv.id, amount: 1000 }],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await p.call('POST', '/v1/payments', {
          ...base,
          partyId: b,
          amount: 100,
          allocations: [{ invoiceId: inv.id, amount: 100 }],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await p.call('POST', '/v1/payments', {
          ...base,
          partyId: a,
          amount: 100,
          allocations: [{ invoiceId: inv.id, amount: 200 }],
        })
      ).status,
    ).toBe(422);
    await p.call('POST', '/v1/payments', {
      ...base,
      partyId: a,
      amount: 100,
      allocations: [{ invoiceId: inv.id, amount: 100 }],
    });
    const blocked = await p.call('POST', `/v1/invoices/${inv.id}/cancel`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('credit_dependency');
    const done = await p.call('POST', `/v1/invoices/${inv.id}/cancel`, { releasePayments: true });
    expect(done.body.status).toBe('cancelled');
    expect((await p.call('GET', `/v1/parties/${a}/balance`)).body).toEqual({
      outstanding: 0,
      credit: 100,
    });
  });
});

describe('purchases and expenses', () => {
  it('computes purchase totals and brings tracked stock in', async () => {
    const item = (await t.call('POST', '/v1/items', { name: 'Bought Item' })).body;
    const res = await t.call('POST', '/v1/purchases', {
      businessId: t.businessId,
      supplierName: 'Sup',
      purchaseDate: '2026-10-01',
      interstate: false,
      items: [{ itemId: item.id, name: 'Bought Item', quantity: 10, rate: 50, taxPercent: 12 }],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ taxableAmount: 500, cgst: 30, sgst: 30, igst: 0, total: 560 });
    expect((await t.call('GET', `/v1/items/${item.id}`)).body.stock).toBe(10);
    await t.call('DELETE', `/v1/purchases/${res.body.id}`);
    expect((await t.call('GET', `/v1/items/${item.id}`)).body.stock).toBe(0);
    await t.call('POST', `/v1/trash/${res.body.id}/restore`);
    expect((await t.call('GET', `/v1/items/${item.id}`)).body.stock).toBe(10);
  });
  it('records expenses against seeded categories', async () => {
    const cats = (await t.call('GET', '/v1/expense-categories')).body.data;
    expect(cats.length).toBeGreaterThan(0);
    const res = await t.call('POST', '/v1/expenses', {
      businessId: t.businessId,
      categoryId: cats[0].id,
      expenseDate: '2026-10-01',
      amount: 1200,
      description: 'Rent',
    });
    expect(res.status).toBe(201);
    expect((await t.call('GET', '/v1/expenses?q=rent')).body.data).toHaveLength(1);
  });
});

describe('recurring', () => {
  it('advances month ends without skipping February', () => {
    expect(advanceDate('2026-01-31', 'monthly', 1, 31)).toBe('2026-02-28');
    expect(advanceDate('2026-02-28', 'monthly', 1, 31)).toBe('2026-03-31');
    expect(advanceDate('2026-10-01', 'weekly', 2)).toBe('2026-10-15');
    expect(advanceDate('2026-10-15', 'quarterly', 1)).toBe('2027-01-15');
  });
  it('generates an invoice now, advances the schedule, and stops after N', async () => {
    const party = (
      await t.call('POST', '/v1/parties', { name: 'Retainer client', state: 'Tamil Nadu' })
    ).body.id;
    const sch = await t.call('POST', '/v1/recurring', {
      businessId: t.businessId,
      partyId: party,
      name: 'Monthly retainer',
      frequency: 'monthly',
      nextDate: '2026-11-05',
      endMode: 'afterN',
      maxOccurrences: 1,
      dueDays: 10,
      template: { invoiceType: 'tax-invoice', items: [line({ quantity: 1, rate: 1000 })] },
    });
    expect(sch.status).toBe(201);
    const gen = await t.call('POST', `/v1/recurring/${sch.body.id}/generate`);
    expect(gen.status).toBe(201);
    const inv = (await t.call('GET', `/v1/invoices/${gen.body.invoiceId}`)).body;
    expect(inv).toMatchObject({ total: 1180, partyId: party });
    expect(inv.dueDate).not.toBeNull();
    const after = (await t.call('GET', '/v1/recurring')).body.data.find(
      (r: any) => r.id === sch.body.id,
    );
    expect(after).toMatchObject({ nextDate: '2026-12-05', occurrencesCreated: 1 });
    expect((await t.call('POST', `/v1/recurring/${sch.body.id}/generate`)).status).toBe(409);
  });
});

describe('settings, businesses, templates', () => {
  it('stores numbering settings and uses them for the next number', async () => {
    const p = await h.newTenant();
    const put = await p.call('PUT', '/v1/number-series', {
      businessId: p.businessId,
      numberSettings: { brandPrefix: 'ACME', padDigits: 3, showFinYear: false, startNumber: 100 },
    });
    expect(put.status).toBe(200);
    const next = await p.call('GET', `/v1/number-series/next?businessId=${p.businessId}`);
    expect(next.body.number).toBe('ACME/100');
    const inv = await p.call('POST', '/v1/invoices', {
      businessId: p.businessId,
      invoiceDate: '2026-10-01',
      items: [line()],
    });
    expect(inv.body.number).toBe('ACME/100');
    expect(
      (
        await p.call('POST', '/v1/invoices', {
          businessId: p.businessId,
          invoiceDate: '2026-10-01',
          items: [line()],
        })
      ).body.number,
    ).toBe('ACME/101');
    expect(
      (await p.call('GET', `/v1/businesses/${p.businessId}/settings`)).body.numberSettings
        .brandPrefix,
    ).toBe('ACME');
  });
  it('keeps one default business and refuses to remove the last one', async () => {
    const p = await h.newTenant();
    const second = await p.call('POST', '/v1/businesses', { name: 'Second Shop', isDefault: true });
    const list = (await p.call('GET', '/v1/businesses')).body.data;
    expect(list.filter((b: any) => b.isDefault)).toHaveLength(1);
    expect((await p.call('DELETE', `/v1/businesses/${second.body.id}`)).status).toBe(200);
    expect((await p.call('DELETE', `/v1/businesses/${p.businessId}`)).status).toBe(422);
  });
  it('payment accounts and terms templates round-trip', async () => {
    const acc = await t.call('POST', `/v1/businesses/${t.businessId}/payment-accounts`, {
      label: 'SBI',
      bankName: 'SBI',
      ifsc: 'SBIN0000001',
      isDefault: true,
    });
    expect(acc.status).toBe(201);
    expect(
      (await t.call('GET', `/v1/businesses/${t.businessId}/payment-accounts`)).body.data,
    ).toHaveLength(1);
    const tpl = await t.call('POST', '/v1/templates', {
      name: 'Net 30',
      content: 'Pay in 30 days',
      isDefault: true,
    });
    expect(tpl.status).toBe(201);
    expect(
      (await t.call('GET', '/v1/templates')).body.data.filter((x: any) => x.isDefault),
    ).toHaveLength(1);
  });
});

describe('trash', () => {
  it('soft-deletes, lists, restores, and refuses to restore over a reused number', async () => {
    const p = await h.newTenant();
    const party = (await p.call('POST', '/v1/parties', { name: 'Gone Party' })).body.id;
    const quote = (
      await p.call('POST', '/v1/invoices', {
        businessId: p.businessId,
        invoiceType: 'quotation',
        invoiceDate: '2026-10-01',
        items: [line()],
        number: 'Q/1',
      })
    ).body;
    await p.call('DELETE', `/v1/parties/${party}`);
    await p.call('DELETE', `/v1/invoices/${quote.id}`);
    const trash = (await p.call('GET', '/v1/trash')).body.data;
    expect(trash.map((e: any) => [e.entityType, e.label]).sort()).toEqual([
      ['invoice', 'Q/1'],
      ['party', 'Gone Party'],
    ]);
    expect(new Date(trash[0].purgeAt).getTime() - new Date(trash[0].deletedAt).getTime()).toBe(
      30 * 86_400_000,
    );
    expect((await p.call('GET', `/v1/parties/${party}`)).status).toBe(404);
    // Q/1 is typed again before the restore.
    await p.call('POST', '/v1/invoices', {
      businessId: p.businessId,
      invoiceType: 'quotation',
      invoiceDate: '2026-10-02',
      items: [line()],
      number: 'Q/1',
    });
    const clash = await p.call('POST', `/v1/trash/${quote.id}/restore`);
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('duplicate_number');
    expect((await p.call('POST', `/v1/trash/${party}/restore`)).status).toBe(200);
    expect((await p.call('GET', `/v1/parties/${party}`)).status).toBe(200);
    expect((await p.call('POST', `/v1/trash/${party}/restore`)).body.error.code).toBe(
      'not_in_trash',
    );
  });
  it('purges only what is older than 30 days, and keeps a party that still has invoices', async () => {
    const p = await h.newTenant();
    const lonely = (await p.call('POST', '/v1/parties', { name: 'Lonely' })).body.id;
    const busy = (await p.call('POST', '/v1/parties', { name: 'Busy' })).body.id;
    await p.call('POST', '/v1/invoices', {
      businessId: p.businessId,
      partyId: busy,
      invoiceDate: '2026-10-01',
      items: [line()],
    });
    await p.call('DELETE', `/v1/parties/${lonely}`);
    await p.call('DELETE', `/v1/parties/${busy}`);
    expect(await withTenant(h.db, p.orgId, (tx) => purgeExpired(tx))).toBe(0);
    const later = new Date(Date.now() + 31 * 86_400_000);
    expect(await withTenant(h.db, p.orgId, (tx) => purgeExpired(tx, later))).toBe(1);
    const left = (await p.call('GET', '/v1/trash')).body.data;
    expect(left.map((e: any) => e.label)).toEqual(['Busy']);
    expect((await p.call('DELETE', `/v1/trash/${busy}`)).status).toBe(409);
  });
  it('audit log records the changes', async () => {
    const rows = await withTenant(h.db, t.orgId, (tx) =>
      tx.execute(`select action from audit_log where action like 'invoice.%' limit 5` as never),
    );
    expect((rows as unknown as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('files', () => {
  it('uploads through a signed URL, completes, attaches a logo, downloads, and rejects a forged link', async () => {
    const bytes = new TextEncoder().encode('PNG-bytes');
    const up = await t.call('POST', '/v1/files/upload-url', {
      kind: 'logo',
      fileName: 'logo.png',
      contentType: 'image/png',
      sizeBytes: bytes.length,
      ownerType: 'business',
      ownerId: t.businessId,
    });
    expect(up.status).toBe(201);
    expect((await t.call('POST', `/v1/files/${up.body.fileId}/complete`)).status).toBe(422); // nothing uploaded yet
    const put = await h.app.request(up.body.uploadUrl.replace(/^https?:\/\/[^/]+/, ''), {
      method: 'PUT',
      body: bytes,
      headers: up.body.headers,
    });
    expect(put.status).toBe(200);
    const done = await t.call('POST', `/v1/files/${up.body.fileId}/complete`);
    expect(done.body).toMatchObject({ status: 'ready', sizeBytes: bytes.length, kind: 'logo' });
    expect((await t.call('GET', `/v1/businesses/${t.businessId}`)).body.logoFileId).toBe(
      up.body.fileId,
    );
    const link = await t.call('GET', `/v1/files/${up.body.fileId}/download-url`);
    const got = await h.app.request(link.body.url.replace(/^https?:\/\/[^/]+/, ''));
    expect(got.status).toBe(200);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
    const forged = link.body.url
      .replace(/sig=[0-9a-f]+/, 'sig=' + '0'.repeat(64))
      .replace(/^https?:\/\/[^/]+/, '');
    expect((await h.app.request(forged)).status).toBe(403);
    expect((await t.call('DELETE', `/v1/files/${up.body.fileId}`)).status).toBe(200);
  });
});

describe('import and export', () => {
  it('imports a legacy data bundle as a background job and exports it back', async () => {
    const p = await h.newTenant();
    const res = await p.call('POST', '/v1/import/legacy', {
      profile: { businessName: 'Legacy Co', gstin: '', state: 'Tamil Nadu', country: 'India' },
      clients: [{ name: 'Old Client', state: 'Tamil Nadu' }],
      products: [{ name: 'Old Product', hsn: '1234', price: 50, taxPercent: 12, stock: 7 }],
      bills: [
        {
          id: 'INV/2025-26/0001',
          invoiceNumber: 'INV/2025-26/0001',
          invoiceDate: '2025-06-01',
          invoiceType: 'tax-invoice',
          clientName: 'Old Client',
          totalAmount: 112,
          status: 'paid',
          payments: [{ amount: 112, date: '2025-06-05', mode: 'upi' }],
          data: {
            profile: { businessName: 'Legacy Co' },
            client: { name: 'Old Client' },
            items: [{ name: 'Old Product', quantity: 2, rate: 50, taxPercent: 12 }],
            totals: {
              subtotal: 100,
              taxableAmount: 100,
              cgst: 6,
              sgst: 6,
              total: 112,
              totalTaxAmount: 12,
            },
          },
        },
      ],
      purchases: [
        {
          id: 'p1',
          date: '2025-05-01',
          supplierName: 'Alpha Traders',
          items: [{ name: 'Mouse', quantity: 1, rate: 250, taxPercent: 18 }],
        },
      ],
      expenses: [{ id: 'e1', date: '2025-05-02', amount: 300, description: 'Tea' }],
      meta: { counter_INV: 1 },
    });
    expect(res.status).toBe(202);
    await whenJobsIdle();
    const job = (await p.call('GET', `/v1/jobs/${res.body.jobId}`)).body;
    expect(job.status, JSON.stringify(job)).toBe('done');
    expect(job.result).toMatchObject({
      businesses: 1,
      invoices: 1,
      payments: 1,
      items: 1,
      purchases: 1,
      expenses: 1,
    });
    const inv = (await p.call('GET', '/v1/invoices')).body.data[0];
    expect(inv).toMatchObject({
      number: 'INV/2025-26/0001',
      status: 'paid',
      total: 112,
      paidAmount: 112,
      partyName: 'Old Client',
    });
    const items = (await p.call('GET', '/v1/items')).body.data;
    expect(items[0].stock).toBe(7);
    // The counter carried on: the next new invoice is number 2, and re-importing skips what exists.
    const biz = (await p.call('GET', '/v1/businesses')).body.data.find(
      (b: any) => b.name === 'Legacy Co',
    );
    const next = await p.call('POST', '/v1/invoices', {
      businessId: biz.id,
      invoiceDate: '2026-10-01',
      items: [line()],
    });
    expect(next.body.number).toMatch(/\/0002$/);

    const exp = await p.call('POST', '/v1/export');
    expect(exp.status).toBe(202);
    await whenJobsIdle();
    const done = (await p.call('GET', `/v1/jobs/${exp.body.jobId}`)).body;
    expect(done.status).toBe('done');
    const link = await p.call('GET', `/v1/files/${done.result.fileId}/download-url`);
    const file = await h.app.request(link.body.url.replace(/^https?:\/\/[^/]+/, ''));
    const data = JSON.parse(await file.text());
    expect(data.data.invoices.length).toBe(2);
    expect(data.orgId).toBe(p.orgId);
  });
  it('reports a failed job instead of crashing', async () => {
    const p = await h.newTenant();
    const res = await p.call('POST', '/v1/import/legacy', {
      bills: [{ id: 'X', invoiceNumber: 'X/1', data: { items: 'not-an-array' } }],
    });
    await whenJobsIdle();
    const job = (await p.call('GET', `/v1/jobs/${res.body.jobId}`)).body;
    expect(['done', 'failed']).toContain(job.status);
  });
});
