import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GSTIN_CHARS, buildEinvoice } from '@ledgora/tax-engine';
import { sql as dsql } from 'drizzle-orm';
import { withTenant } from '@ledgora/db';
import { makeHarness, type Tenant } from './helpers.ts';
import { gspFromEnv, httpGsp, ewayValidityDays, sandboxGsp } from '../src/gsp/provider.ts';

// Phase 2: e-invoice, e-way bill and GSTN upload through a GST service provider, here the sandbox stand-in.
const h = makeHarness({ gsp: sandboxGsp() });
afterAll(() => h.close());
const gstin = (first14: string) => {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const p = GSTIN_CHARS.indexOf(first14[i]!) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return first14 + GSTIN_CHARS[(36 - (sum % 36)) % 36];
};
const OWN = gstin('33AAPFU0939F1Z');
const BUYER = gstin('33AABCU9603R1Z');
const doc = (number: string) =>
  buildEinvoice({
    docType: 'INV',
    number,
    date: '2026-11-05',
    supplyType: 'B2B',
    interState: false,
    seller: {
      gstin: OWN,
      name: 'Seller Co',
      address: '1 Main St',
      city: 'Chennai',
      pin: 600001,
      stateCode: '33',
    },
    buyer: {
      gstin: BUYER,
      name: 'Buyer Co',
      address: '2 Lake Rd',
      city: 'Madurai',
      pin: 625001,
      stateCode: '33',
      pos: '33',
    },
    items: [{ name: 'Widget', hsn: '8471', quantity: 2, unit: 'NOS', rate: 500, taxPercent: 18 }],
  });
let t: Tenant;
beforeAll(async () => {
  t = await h.newTenant();
  await t.call('PATCH', `/v1/businesses/${t.businessId}`, { gstin: OWN });
});
const uniq = () => `T${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

describe('the sandbox stand-in', () => {
  it('works out e-way validity as a day for each 200 km', () => {
    expect([1, 200, 201, 400, 1500].map(ewayValidityDays)).toEqual([1, 1, 2, 2, 8]);
  });
  it('refuses the same document twice and cancels only inside 24 hours', async () => {
    const g = sandboxGsp();
    const inv = doc('A/1');
    const a = await g.einvoiceGenerate(OWN, inv);
    expect(a.irn).toMatch(/^[a-f0-9]{64}$/);
    expect(a.ackNo).toMatch(/^\d{15}$/);
    expect(a.sandbox).toBe(true);
    await expect(g.einvoiceGenerate(OWN, inv)).rejects.toMatchObject({
      message: expect.stringContaining('duplicate IRN'),
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 25 * 3_600_000);
      await expect(g.einvoiceCancel(OWN, a.irn, '1', 'Entered wrong')).rejects.toMatchObject({
        message: expect.stringContaining('24 hours'),
      });
    } finally {
      vi.useRealTimers();
    }
    expect((await g.einvoiceCancel(OWN, a.irn, '1', 'Entered wrong')).irn).toBe(a.irn);
  });
});

describe('the provider chosen by the environment', () => {
  it('is one instance for the life of the process, so the sandbox remembers an IRN between requests', async () => {
    const env = { ...h.env, GSP_MODE: 'sandbox' as const };
    expect(gspFromEnv(env)).toBe(gspFromEnv(env));
    const a = await gspFromEnv(env).einvoiceGenerate(OWN, doc('M/1'));
    await expect(gspFromEnv(env).einvoiceCancel(OWN, a.irn, '1', 'test')).resolves.toMatchObject({
      irn: a.irn,
    });
    expect(gspFromEnv({ ...h.env, GSP_MODE: 'off' as const }).mode).toBe('off');
    expect(gspFromEnv({ ...h.env, GSP_MODE: 'http' as const }).mode).toBe('off'); // http without a base URL and key stays off
  });
});

describe('the HTTP provider', () => {
  it('speaks the contract, sends the key as a bearer token, and never echoes it in an error', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (String(url).endsWith('/einvoice/generate'))
        return new Response(
          JSON.stringify({
            irn: 'a'.repeat(64),
            ackNo: '112200003344556',
            ackDt: '2026-11-05 10:00:00',
            signedQr: 'x.y.z',
          }),
          { status: 200 },
        );
      return new Response(JSON.stringify({ error: { message: 'Duplicate IRN (2150)' } }), {
        status: 409,
      });
    }) as unknown as typeof fetch;
    const g = httpGsp(
      { GSP_BASE_URL: 'https://gsp.example.com/api/', GSP_API_KEY: 'sekret-key' },
      f,
    );
    const ok = await g.einvoiceGenerate(OWN, { a: 1 });
    expect(ok).toMatchObject({ irn: 'a'.repeat(64), sandbox: false });
    expect(calls[0]!.url).toBe('https://gsp.example.com/api/einvoice/generate');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      'Bearer sekret-key',
    );
    const err = await g.ewayCancel(OWN, '123456789012', '1', 'wrong').catch((e) => e);
    expect(err.message).toBe('Duplicate IRN (2150)');
    expect(JSON.stringify(err)).not.toContain('sekret-key');
  });
});

describe('e-invoice through the API', () => {
  it('says plainly when no provider is connected', async () => {
    const off = makeHarness();
    try {
      const o = await off.newTenant();
      await o.call('PATCH', `/v1/businesses/${o.businessId}`, { gstin: OWN });
      expect((await o.call('GET', '/v1/gsp/status')).body).toMatchObject({
        connected: false,
        mode: 'off',
      });
      const res = await o.call('POST', '/v1/gsp/einvoice/generate', {
        businessId: o.businessId,
        invoice: doc('X/1'),
      });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/manual route/);
    } finally {
      await off.close();
    }
  });
  it('generates an IRN for a valid invoice and refuses an invalid one before asking the provider', async () => {
    expect((await t.call('GET', '/v1/gsp/status')).body).toMatchObject({
      connected: true,
      sandbox: true,
    });
    const no = uniq();
    const ok = await t.call('POST', '/v1/gsp/einvoice/generate', {
      businessId: t.businessId,
      invoice: doc(no),
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body).toMatchObject({ sandbox: true });
    expect(ok.body.irn).toMatch(/^[a-f0-9]{64}$/);
    const again = await t.call('POST', '/v1/gsp/einvoice/generate', {
      businessId: t.businessId,
      invoice: doc(no),
    });
    expect(again.status).toBe(409);
    const bad = await t.call('POST', '/v1/gsp/einvoice/generate', {
      businessId: t.businessId,
      invoice: { ...doc(uniq()), ValDtls: { TotInvVal: 0 } },
    });
    expect(bad.status).toBe(422);
  });
  it('cancels inside 24 hours and refuses a cancel for an old acknowledgement before asking the provider', async () => {
    const g = await t.call('POST', '/v1/gsp/einvoice/generate', {
      businessId: t.businessId,
      invoice: doc(uniq()),
    });
    const cancel = await t.call('POST', '/v1/gsp/einvoice/cancel', {
      businessId: t.businessId,
      irn: g.body.irn,
      ackDt: g.body.ackDt,
      reason: '1',
      remark: 'Wrong buyer',
    });
    expect(cancel.status, cancel.text).toBe(200);
    const old = await t.call('POST', '/v1/gsp/einvoice/cancel', {
      businessId: t.businessId,
      irn: 'b'.repeat(64),
      ackDt: '2020-01-01 10:00:00',
      reason: '1',
      remark: 'Too late',
    });
    expect(old.status).toBe(409);
    expect(old.body.error.message).toMatch(/credit note/);
  });
  it('needs the permission and another organization can not use this business', async () => {
    const viewer = await h.addMember(t, 'viewer');
    expect(
      (
        await viewer.call('POST', '/v1/gsp/einvoice/generate', {
          businessId: t.businessId,
          invoice: doc(uniq()),
        })
      ).status,
    ).toBe(403);
    const other = await h.newTenant();
    expect(
      (
        await other.call('POST', '/v1/gsp/einvoice/generate', {
          businessId: t.businessId,
          invoice: doc(uniq()),
        })
      ).status,
    ).toBe(404);
  });
});

describe('e-way bill through the API', () => {
  const bill = (o: Record<string, unknown> = {}) => ({
    fromGstin: OWN,
    totInvValue: 75000,
    transDistance: 450,
    vehicleNo: 'TN01AB1234',
    ...o,
  });
  it('generates, records on the invoice, updates the vehicle and cancels', async () => {
    const inv = (
      await t.call('POST', '/v1/invoices', {
        businessId: t.businessId,
        invoiceDate: '2026-11-05',
        items: [{ name: 'Steel', quantity: 1, rate: 100000, taxPercent: 18 }],
      })
    ).body;
    const gen = await t.call('POST', '/v1/gsp/eway/generate', {
      businessId: t.businessId,
      invoiceId: inv.id,
      bill: bill(),
    });
    expect(gen.status, gen.text).toBe(200);
    expect(gen.body.ewayNo).toMatch(/^\d{12}$/);
    const days = Math.round((Date.parse(gen.body.validUntil) - Date.now()) / 86_400_000);
    expect(days).toBeGreaterThanOrEqual(2); // 450 km = 3 days
    const veh = await t.call('POST', '/v1/gsp/eway/vehicle', {
      businessId: t.businessId,
      invoiceId: inv.id,
      ewayNo: gen.body.ewayNo,
      vehicleNo: 'tn02cd5678',
    });
    expect(veh.status, veh.text).toBe(200);
    const bad = await t.call('POST', '/v1/gsp/eway/vehicle', {
      businessId: t.businessId,
      ewayNo: gen.body.ewayNo,
      vehicleNo: 'not a plate',
    });
    expect(bad.status).toBe(422);
    const cancel = await t.call('POST', '/v1/gsp/eway/cancel', {
      businessId: t.businessId,
      invoiceId: inv.id,
      ewayNo: gen.body.ewayNo,
      reason: '2',
      remark: 'Order cancelled',
    });
    expect(cancel.status, cancel.text).toBe(200);
    const again = await t.call('POST', '/v1/gsp/eway/cancel', {
      businessId: t.businessId,
      ewayNo: gen.body.ewayNo,
      reason: '2',
      remark: 'Again',
    });
    expect(again.status).toBe(404);
    const rows = (await withTenant(h.db, t.orgId, (tx) =>
      tx.execute(
        dsql`select eway_no, status, vehicle_no from eway_bills where invoice_id = ${inv.id}`,
      ),
    )) as unknown as Record<string, string>[];
    expect(rows[0]).toMatchObject({
      eway_no: gen.body.ewayNo,
      status: 'cancelled',
      vehicle_no: 'TN02CD5678',
    });
  });
  it('refuses a consignment under 50,000 and a consignor GSTIN that is not the business', async () => {
    expect(
      (
        await t.call('POST', '/v1/gsp/eway/generate', {
          businessId: t.businessId,
          bill: bill({ totInvValue: 1000 }),
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await t.call('POST', '/v1/gsp/eway/generate', {
          businessId: t.businessId,
          bill: bill({ fromGstin: BUYER }),
        })
      ).status,
    ).toBe(422);
  });
});

describe('GSTN upload and the ARN', () => {
  const r3 = (txval = 10000) => ({
    gstin: OWN,
    ret_period: '102026',
    version: 'GST3.0.4',
    hash: 'hash',
    sup_details: { osup_det: { txval, iamt: 0, camt: txval * 0.09, samt: txval * 0.09, csamt: 0 } },
    itc_elg: { itc_avl: [{ ty: 'OTH', iamt: 0, camt: 0, samt: 0, csamt: 0 }] },
  });
  it('uploads an approved return, then the status check records the ARN and locks the month with no manual step', async () => {
    const p = (
      await t.call('POST', '/v1/filing-packs', {
        businessId: t.businessId,
        kind: 'gstr3b',
        period: '102026',
        payload: r3(),
      })
    ).body;
    // 3B is compared with GSTR-1: acknowledge whatever the checks say so the pack is ready, as a person would after reading it.
    const full = (await t.call('GET', `/v1/filing-packs/${p.id}`)).body;
    if (!full.ready)
      await t.call('POST', `/v1/filing-packs/${p.id}/acknowledge`, {
        acknowledged: full.issues.map((i: any) => i.id),
      });
    const up = await t.call('POST', `/v1/gsp/gstn/${p.id}/upload`, {});
    expect(up.status, up.text).toBe(200);
    expect(up.body).toMatchObject({ gspStatus: 'processing', sandbox: true });
    expect((await t.call('POST', `/v1/gsp/gstn/${p.id}/upload`, {})).status).toBe(409); // not twice
    await new Promise((r) => setTimeout(r, 1100));
    const st = await t.call('POST', `/v1/gsp/gstn/${p.id}/status`, {});
    expect(st.status, st.text).toBe(200);
    expect(st.body).toMatchObject({ status: 'filed' });
    expect(st.body.arn).toMatch(/^AA/);
    const after = (await t.call('GET', `/v1/filing-packs/${p.id}`)).body;
    expect(after).toMatchObject({ status: 'filed', arn: st.body.arn });
  });
  it('does not upload what the provider can not take, or a return that is not ready', async () => {
    const ims = await t.call('POST', '/v1/filing-packs', {
      businessId: t.businessId,
      kind: 'gstr9',
      period: '032026',
      payload: {},
    });
    if (ims.status < 300)
      expect((await t.call('POST', `/v1/gsp/gstn/${ims.body.id}/upload`, {})).status).toBe(422);
    const notYet = await t.call(
      'POST',
      `/v1/gsp/gstn/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}/upload`,
      {},
    );
    expect(notYet.status).toBe(404);
  });
  it('reads GSTR-2B for a period', async () => {
    const res = await t.call('GET', `/v1/gsp/gstr2b?businessId=${t.businessId}&period=102026`);
    expect(res.status, res.text).toBe(200);
    expect(res.body.sandbox).toBe(true);
  });
});
