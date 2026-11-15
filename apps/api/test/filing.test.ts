import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FILING_PACK_KINDS, FILING_PACK_STATUSES } from '@ledgora/contracts';
import { FILING_KINDS, FILING_STATUSES, GSTIN_CHARS } from '@ledgora/tax-engine';
import { clearOutbox, getOutbox } from '../src/mail/index.ts';
import { forgetPlan } from '../src/middleware/feature.ts';
import { sql as dsql } from 'drizzle-orm';
import { withTenant } from '@ledgora/db';
import { makeHarness, type Tenant } from './helpers.ts';

// File-ready returns, Phase 1 (docs/FILE_READY_PLAN.md): packs, the CA's review, recording the ARN, the lock on filed
// months, the return calendar and the CA's practice view.
const h = makeHarness();
afterAll(() => h.close());

const gstin = (first14: string) => {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const p = GSTIN_CHARS.indexOf(first14[i]!) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return first14 + GSTIN_CHARS[(36 - (sum % 36)) % 36];
};
const OWN = gstin('33AAPFU0939F1Z'); // Tamil Nadu, like the harness business
const BUYER = gstin('33AABCU9603R1Z');
const ARN = 'AA331026123456Z';

const r1 = (txval = 10000) => ({
  gstin: OWN,
  fp: '102026',
  version: 'GST3.0.4',
  hash: 'hash',
  b2b: [
    {
      ctin: BUYER,
      inv: [
        {
          inum: 'INV/001',
          idt: '05-10-2026',
          val: txval * 1.18,
          pos: '33',
          inv_typ: 'R',
          itms: [
            {
              num: 1,
              itm_det: { rt: 18, txval, camt: txval * 0.09, samt: txval * 0.09, csamt: 0 },
            },
          ],
        },
      ],
    },
  ],
  hsn: { data: [{ num: 1, hsn_sc: '8471', txval }] },
});
const r3 = (txval = 10000) => ({
  gstin: OWN,
  ret_period: '102026',
  version: 'GST3.0.4',
  hash: 'hash',
  sup_details: { osup_det: { txval, iamt: 0, camt: txval * 0.09, samt: txval * 0.09, csamt: 0 } },
  itc_elg: { itc_avl: [{ ty: 'OTH', iamt: 0, camt: 0, samt: 0, csamt: 0 }] },
});
const save = (
  who: { call: Tenant['call'] },
  t: Tenant,
  kind: string,
  payload: unknown,
  extra = {},
) =>
  who.call('POST', '/v1/filing-packs', {
    businessId: t.businessId,
    kind,
    period: '102026',
    payload,
    ...extra,
  });
const sale = (t: Tenant, invoiceDate: string) =>
  t.call('POST', '/v1/invoices', {
    businessId: t.businessId,
    invoiceDate,
    items: [{ name: 'Widget', quantity: 1, rate: 1000, taxPercent: 18 }],
  });

/** Moves the date the business was added to the app (tracking of overdue returns starts the month before). */
const startedOn = (who: Tenant, day: string) =>
  withTenant(h.db, who.orgId, (tx) =>
    tx.execute(
      dsql`update businesses set created_at = ${day}::timestamptz where id = ${who.businessId}`,
    ),
  );

let t: Tenant;
beforeAll(async () => {
  t = await h.newTenant();
  expect((await t.call('PATCH', `/v1/businesses/${t.businessId}`, { gstin: OWN })).status).toBe(
    200,
  );
});

describe('contracts and engine agree', () => {
  it('same kinds and statuses', () => {
    expect([...FILING_PACK_KINDS]).toEqual([...FILING_KINDS]);
    expect([...FILING_PACK_STATUSES]).toEqual([...FILING_STATUSES]);
  });
});

describe('saving a pack', () => {
  it('the server checks the file itself, and the same file again keeps its version', async () => {
    const a = await save(t, t, 'gstr1', r1());
    expect(a.status, a.text).toBe(201);
    expect(a.body).toMatchObject({
      status: 'ready',
      version: 1,
      errors: 0,
      warnings: 0,
      ready: true,
    });
    expect(a.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    const again = await save(t, t, 'gstr1', r1());
    expect(again.body).toMatchObject({ id: a.body.id, version: 1, unchanged: true });
    const dl = await t.call('GET', `/v1/filing-packs/${a.body.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-disposition')).toMatch(/GSTR1_33AAPFU0939F1Z._102026_v1\.json/);
    expect(dl.headers.get('x-content-sha256')).toBe(a.body.sha256);
    expect(dl.body).toEqual(r1());
  });

  it('a broken file stays a draft with its errors; warnings become ready only when acknowledged', async () => {
    const bad = await save(t, t, 'gstr3b', { ...r3(), gstin: BUYER, version: undefined });
    expect(bad.body).toMatchObject({ status: 'draft', ready: false });
    const one = (await t.call('GET', `/v1/filing-packs/${bad.body.id}`)).body;
    expect(one.issues.map((i: any) => i.code)).toEqual(
      expect.arrayContaining(['GSTIN_OTHER', 'VERSION_MISSING']),
    );
    // 3B that disagrees with the saved GSTR-1: a warning per head, ready only after acknowledging them.
    const off = await save(t, t, 'gstr3b', r3(9000));
    expect(off.body).toMatchObject({ status: 'draft', version: 2, errors: 0 });
    const pack = (await t.call('GET', `/v1/filing-packs/${off.body.id}`)).body;
    expect(pack.issues.every((i: any) => i.code === 'R1_3B_MISMATCH')).toBe(true);
    expect(pack.versions.map((v: any) => [v.version, v.current])).toEqual([
      [2, true],
      [1, false],
    ]);
    const ack = await t.call('POST', `/v1/filing-packs/${off.body.id}/acknowledge`, {
      acknowledged: pack.issues.map((i: any) => i.id),
    });
    expect(ack.body).toMatchObject({ status: 'ready', ready: true });
    // The old version can not be moved any more.
    expect(
      (
        await t.call('POST', `/v1/filing-packs/${bad.body.id}/record-filed`, {
          arn: ARN,
          filedOn: '2026-11-10',
        })
      ).status,
    ).toBe(409);
  });

  it('refuses a business without a GSTIN, an unknown kind and a quarter that does not end a quarter', async () => {
    const t2 = await h.newTenant();
    expect((await save(t2, t2, 'gstr1', r1())).status).toBe(422);
    expect((await save(t, t, 'gstr99', r1())).status).toBe(400);
    expect((await save(t, t, 'gstr1', r1(), { quarterly: true })).status).toBe(422);
  });
});

describe('review by the CA, filing and the lock', () => {
  it('prepare → review → changes → approve → filed (ARN) → months locked → reopen unlocks', async () => {
    const t3 = await h.newTenant();
    await t3.call('PATCH', `/v1/businesses/${t3.businessId}`, { gstin: OWN });
    const accountant = await h.addMember(t3, 'accountant');
    const ca = await h.addMember(t3, 'ca');
    const viewer = await h.addMember(t3, 'viewer');
    const biller = await h.addMember(t3, 'biller');

    expect((await biller.call('GET', '/v1/filing-packs')).status).toBe(403);
    expect((await viewer.call('GET', '/v1/filing-packs')).status).toBe(200);
    expect((await save(viewer, t3, 'gstr1', r1())).status).toBe(403);

    const made = await save(accountant, t3, 'gstr1', r1());
    expect(made.status, made.text).toBe(201);
    const id = made.body.id;
    clearOutbox();
    const sent = await accountant.call('POST', `/v1/filing-packs/${id}/submit-review`, {
      note: 'Please check',
    });
    expect(sent.body).toMatchObject({ status: 'in_review', reviewRequired: true });
    expect(getOutbox().some((m: any) => /waiting for your review/.test(m.subject ?? ''))).toBe(
      true,
    );

    // Only a reviewer approves, never the person who prepared it; sending back needs a reason.
    expect((await accountant.call('POST', `/v1/filing-packs/${id}/approve`, {})).status).toBe(403);
    expect((await ca.call('POST', `/v1/filing-packs/${id}/request-changes`, {})).status).toBe(400);
    const back = await ca.call('POST', `/v1/filing-packs/${id}/request-changes`, {
      note: 'Add the HSN of item 2',
    });
    expect(back.body.status).toBe('changes_requested');
    expect(
      (await ca.call('POST', `/v1/filing-packs/${id}/comments`, { body: 'Sent back once' })).status,
    ).toBe(201);
    // Recording it filed now is refused: a reviewed return needs its approval.
    expect(
      (
        await accountant.call('POST', `/v1/filing-packs/${id}/record-filed`, {
          arn: ARN,
          filedOn: '2026-11-10',
        })
      ).status,
    ).toBe(409);
    expect(
      (await accountant.call('POST', `/v1/filing-packs/${id}/submit-review`, {})).body.status,
    ).toBe('in_review');
    const ok = await ca.call('POST', `/v1/filing-packs/${id}/approve`, { note: 'Looks right' });
    expect(ok.body).toMatchObject({ status: 'approved', approvedSha256: made.body.sha256 });

    // ARN checks, dates, then filed.
    const filed = (arn: string, filedOn = '2026-11-10') =>
      ca.call('POST', `/v1/filing-packs/${id}/record-filed`, { arn, filedOn });
    expect((await filed('AA291026123456Z')).status).toBe(422);
    expect((await filed(ARN, '2026-10-20')).status).toBe(422);
    expect((await filed(ARN, '2099-01-01')).status).toBe(422);
    const done = await filed(ARN);
    expect(done.body).toMatchObject({ status: 'filed', arn: ARN, filedOn: '2026-11-10' });

    // The filed month is locked for new sales; a filed return can not be replaced.
    expect((await sale(t3, '2026-10-15')).body.error).toMatchObject({
      code: 'period_locked',
      details: { reason: 'filed_month' },
    });
    expect((await sale(t3, '2026-11-15')).status).toBe(201);
    expect((await save(accountant, t3, 'gstr1', r1(12000))).status).toBe(409);

    const timeline = (await viewer.call('GET', `/v1/filing-packs/${id}`)).body.events;
    expect(timeline.map((e: any) => e.to ?? 'comment')).toEqual([
      'ready',
      'in_review',
      'changes_requested',
      'comment',
      'in_review',
      'approved',
      'filed',
    ]);

    // Reopening a wrong record: owner or admin only, with a reason; the approval of the unchanged file stands.
    expect(
      (await accountant.call('POST', `/v1/filing-packs/${id}/reopen`, { reason: 'typo in ARN' }))
        .status,
    ).toBe(403);
    const re = await t3.call('POST', `/v1/filing-packs/${id}/reopen`, {
      reason: 'Wrong ARN typed',
    });
    expect(re.body).toMatchObject({ status: 'approved', arn: null });
    expect((await sale(t3, '2026-10-16')).status).toBe(201);

    // A changed file after review is a new version that needs a fresh approval.
    const v2 = await save(accountant, t3, 'gstr1', r1(12000));
    expect(v2.body).toMatchObject({
      version: 2,
      status: 'ready',
      reviewRequired: true,
      approvedSha256: null,
    });
    expect(
      (
        await accountant.call('POST', `/v1/filing-packs/${v2.body.id}/record-filed`, {
          arn: ARN,
          filedOn: '2026-11-10',
        })
      ).status,
    ).toBe(409);

    const audit = (await t3.call('GET', '/v1/audit?q=filing&limit=50')).body.data.map(
      (a: any) => a.action,
    );
    expect(audit).toEqual(
      expect.arrayContaining(['filing.prepare', 'filing.approve', 'filing.filed', 'filing.reopen']),
    );
  });

  it('an unreviewed ready pack is filed straight away; IMS needs no ARN', async () => {
    const t4 = await h.newTenant();
    await t4.call('PATCH', `/v1/businesses/${t4.businessId}`, { gstin: OWN });
    const ims = await save(t4, t4, 'ims', {
      gstin: OWN,
      ret_period: '102026',
      version: 'IMS-ACTIONS-1',
      rows: [
        {
          ctin: BUYER,
          supplier: 'B',
          invoiceNumber: 'P1',
          date: '',
          value: 118,
          taxable: 100,
          tax: 18,
          action: 'accept',
          reason: '',
        },
      ],
    });
    expect(ims.body.status).toBe('ready');
    const r = await t4.call('POST', `/v1/filing-packs/${ims.body.id}/record-filed`, {
      filedOn: '2026-11-12',
    });
    expect(r.body).toMatchObject({ status: 'filed', arn: null });
    // IMS does not lock the month.
    expect((await sale(t4, '2026-10-15')).status).toBe(201);
  });

  it('on Free: the CA seat does not count as a user, review works, and a CA made into a biller needs a seat', async () => {
    const free = await h.newTenant();
    await free.call('POST', '/v1/billing/trial', { choice: 'free' });
    // subscriptions is under row-level security: change it inside the tenant, then drop the cached plan.
    await withTenant(h.db, free.orgId, (tx) =>
      tx.execute(
        dsql`update subscriptions set status = 'active', plan = 'free', trial_ends_at = null`,
      ),
    );
    forgetPlan(free.orgId);
    await free.call('PATCH', `/v1/businesses/${free.businessId}`, { gstin: OWN });
    // Free allows 1 user (the owner): another user is refused, a CA is not.
    expect(
      (await free.call('POST', '/v1/invitations', { email: 'b@example.com', role: 'biller' }))
        .status,
    ).toBe(402);
    const invited = await free.call('POST', '/v1/invitations', {
      email: 'ca@example.com',
      role: 'ca',
    });
    expect(invited.status, invited.text).toBe(201);
    const ca = await h.addMember(free, 'ca');
    const p = await save(free, free, 'gstr1', r1());
    expect(p.status, p.text).toBe(201);
    expect(
      (await free.call('POST', `/v1/filing-packs/${p.body.id}/submit-review`, {})).status,
    ).toBe(200);
    expect((await ca.call('POST', `/v1/filing-packs/${p.body.id}/approve`, {})).body.status).toBe(
      'approved',
    );
    // Turning the free CA seat into a user role needs a free user seat.
    const res = await free.call('PATCH', `/v1/members/${ca.memberId}`, { role: 'biller' });
    expect(res.status).toBe(402);
    expect(res.body.error.details).toMatchObject({ limit: 'users' });
  });

  it('the CA prepares the return and the business approves it; the CA never approves its own', async () => {
    const t5 = await h.newTenant();
    await t5.call('PATCH', `/v1/businesses/${t5.businessId}`, { gstin: OWN });
    const ca = await h.addMember(t5, 'ca');
    const p = await save(ca, t5, 'gstr1', r1());
    expect(p.status, p.text).toBe(201);
    clearOutbox();
    expect(
      (await ca.call('POST', `/v1/filing-packs/${p.body.id}/submit-review`, {})).body.status,
    ).toBe('in_review');
    // The owner is told (the CA prepared it, so the owner approves).
    expect(getOutbox().some((m: any) => m.to === t5.email)).toBe(true);
    expect((await ca.call('POST', `/v1/filing-packs/${p.body.id}/approve`, {})).status).toBe(403);
    // On the CA's dashboard it is "with the client", not "waiting for you".
    const dash = (await ca.call('GET', '/v1/practice/clients')).body.data.find(
      (c: any) => c.orgId === t5.orgId,
    );
    expect(dash).toMatchObject({ waiting: 0, withClient: 1 });
    expect((await t5.call('POST', `/v1/filing-packs/${p.body.id}/approve`, {})).body.status).toBe(
      'approved',
    );
    const after = (await ca.call('GET', '/v1/practice/clients')).body.data.find(
      (c: any) => c.orgId === t5.orgId,
    );
    expect(after).toMatchObject({ withClient: 0, toAct: 1 });
    // The CA files it on the portal and records the ARN.
    expect(
      (
        await ca.call('POST', `/v1/filing-packs/${p.body.id}/record-filed`, {
          arn: ARN,
          filedOn: '2026-11-10',
        })
      ).body.status,
    ).toBe('filed');
  });
});

describe('isolation, date windows and the practice view', () => {
  it('another organization can not see a pack; a CA given a window sees only returns inside it', async () => {
    const mine = await save(t, t, 'gstr1', r1(15000));
    const other = await h.newTenant();
    expect((await other.call('GET', `/v1/filing-packs/${mine.body.id}`)).status).toBe(404);
    expect((await other.call('GET', '/v1/filing-packs')).body.data).toEqual([]);

    const ca = await h.addMember(t, 'ca');
    await h.sql`update member set data_from = '2025-04-01', data_to = '2026-03-31' where id = ${ca.memberId}`;
    expect((await ca.call('GET', `/v1/filing-packs/${mine.body.id}`)).status).toBe(404);
    expect((await ca.call('GET', `/v1/filing-packs/${mine.body.id}/download`)).status).toBe(404);
    expect((await ca.call('GET', '/v1/filing-packs')).body.data).toEqual([]);
  });

  it('the CA sees every client where they review, what waits for them and what is overdue', async () => {
    const a = await h.newTenant();
    const b = await h.newTenant();
    for (const x of [a, b]) await x.call('PATCH', `/v1/businesses/${x.businessId}`, { gstin: OWN });
    await startedOn(b, '2025-06-01'); // b has used the app for a while and filed nothing
    const ca = await h.addMember(a, 'ca');
    await h.sql`insert into member (id, organization_id, user_id, role) values (gen_random_uuid(), ${b.orgId}, ${ca.userId}, 'ca')`;
    const p = await save(a, a, 'gstr1', r1());
    await a.call('POST', `/v1/filing-packs/${p.body.id}/submit-review`, {});

    const res = await ca.call('GET', '/v1/practice/clients');
    expect(res.status, res.text).toBe(200);
    const orgs = res.body.data.map((c: any) => c.orgId);
    expect(orgs).toEqual(expect.arrayContaining([a.orgId, b.orgId]));
    expect(res.body.data[0]).toMatchObject({ orgId: a.orgId, waiting: 1 });
    expect(res.body.data[0].businesses[0].waiting[0]).toMatchObject({
      id: p.body.id,
      kind: 'gstr1',
    });
    // Returns of past months with nothing filed are overdue.
    expect(res.body.data.find((c: any) => c.orgId === b.orgId).overdue).toBeGreaterThan(0);
    // An owner's own organization is not a client.
    expect((await a.call('GET', '/v1/practice/clients')).body.data).toEqual([]);
  });

  it('the calendar lists the year with each return, its pack and overdue ones', async () => {
    // A business added today: months before it started are listed but never overdue.
    const fresh = await h.newTenant();
    await fresh.call('PATCH', `/v1/businesses/${fresh.businessId}`, { gstin: OWN });
    const early = (
      await fresh.call('GET', `/v1/filing-calendar?businessId=${fresh.businessId}&fy=2026`)
    ).body.rows.find((r: any) => r.month === '2026-04' && r.form === 'GSTR-1');
    expect(early).toMatchObject({ beforeTracking: true, overdue: false });

    await startedOn(t, '2026-05-10');
    const cal = await t.call('GET', `/v1/filing-calendar?businessId=${t.businessId}&fy=2026`);
    expect(cal.body.trackedFrom).toBe('2026-04');
    // The business can move the start; a viewer can not.
    const viewer = await h.addMember(t, 'viewer');
    expect(
      (
        await viewer.call('PUT', '/v1/filing-calendar/track-from', {
          businessId: t.businessId,
          month: '2026-09',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await t.call('PUT', '/v1/filing-calendar/track-from', {
          businessId: t.businessId,
          month: '2026-09',
        })
      ).status,
    ).toBe(200);
    const moved = (await t.call('GET', `/v1/filing-calendar?businessId=${t.businessId}&fy=2026`))
      .body;
    expect(moved.trackedFrom).toBe('2026-09');
    expect(moved.rows.find((r: any) => r.month === '2026-04' && r.form === 'GSTR-1').overdue).toBe(
      false,
    );
    await t.call('PUT', '/v1/filing-calendar/track-from', {
      businessId: t.businessId,
      month: null,
    });
    expect(cal.status, cal.text).toBe(200);
    const oct = cal.body.rows.filter((r: any) => r.month === '2026-10');
    expect(oct.map((r: any) => [r.form, r.due])).toEqual([
      ['GSTR-1', '2026-11-11'],
      ['GSTR-3B', '2026-11-20'],
    ]);
    expect(oct[0].packId).toBeTruthy();
    expect(
      cal.body.rows.find((r: any) => r.month === '2026-04' && r.form === 'GSTR-1').overdue,
    ).toBe(true);
    expect(
      cal.body.rows.find((r: any) => r.month === '2027-01' && r.form === 'GSTR-1').overdue,
    ).toBe(false);
  });
});

describe('R1 returns: GSTR-1A, GSTR-9, CMP-08', () => {
  const file = async (who: Tenant, kind: string, payload: unknown, period = '102026') => {
    const p = await who.call('POST', '/v1/filing-packs', {
      businessId: who.businessId,
      kind,
      period,
      payload,
    });
    expect(p.status, p.text).toBe(201);
    const r = await who.call('POST', `/v1/filing-packs/${p.body.id}/record-filed`, {
      arn: ARN,
      filedOn: '2026-11-12',
    });
    expect(r.status, r.text).toBe(200);
    return p.body.id as string;
  };

  it('GSTR-1A opens after GSTR-1 is filed, shows what changed, and closes once 3B is filed', async () => {
    const t6 = await h.newTenant();
    await t6.call('PATCH', `/v1/businesses/${t6.businessId}`, { gstin: OWN });
    const build = (current: unknown) =>
      t6.call('POST', '/v1/filing-packs/build/gstr1a', {
        businessId: t6.businessId,
        period: '102026',
        current,
      });
    expect((await build(r1(12000))).status).toBe(409); // GSTR-1 not filed yet
    await file(t6, 'gstr1', r1());
    const b = await build(r1(12000));
    expect(b.status, b.text).toBe(200);
    expect(b.body.payload.changes).toHaveLength(1);
    expect(b.body.payload.changes[0]).toMatchObject({ table: 'b2b', change: 'amended' });
    expect(b.body.payload.delta.txval).toBe(2000);
    const saved = await t6.call('POST', '/v1/filing-packs', {
      businessId: t6.businessId,
      kind: 'gstr1a',
      period: '102026',
      payload: b.body.payload,
    });
    expect(saved.body).toMatchObject({ kind: 'gstr1a', status: 'ready', kindLabel: 'GSTR-1A' });
    await file(t6, 'gstr3b', r3(12000));
    expect((await build(r1(13000))).status).toBe(409); // 3B filed: 1A closed
  });

  it('GSTR-9 is built from the filed months, covers the whole year, and lists the missing months', async () => {
    const t7 = await h.newTenant();
    await t7.call('PATCH', `/v1/businesses/${t7.businessId}`, { gstin: OWN });
    await file(t7, 'gstr1', r1());
    await file(t7, 'gstr3b', r3());
    const b = await t7.call('POST', '/v1/filing-packs/build/gstr9', {
      businessId: t7.businessId,
      fy: 2026,
    });
    expect(b.status, b.text).toBe(200);
    expect(b.body.period).toBe('032027');
    expect(b.body.payload.table4.B_b2b.txval).toBe(10000);
    expect(b.body.payload.missing.gstr1).toHaveLength(11);
    const saved = await t7.call('POST', '/v1/filing-packs', {
      businessId: t7.businessId,
      kind: 'gstr9',
      period: '032027',
      payload: b.body.payload,
    });
    expect(saved.body).toMatchObject({
      status: 'draft',
      periodFrom: '2026-04-01',
      periodTo: '2027-03-31',
    });
    expect(
      (
        await t7.call('POST', '/v1/filing-packs', {
          businessId: t7.businessId,
          kind: 'gstr9',
          period: '102026',
          payload: b.body.payload,
        })
      ).status,
    ).toBe(422);
  });

  it('CMP-08 is for composition dealers, at their rate', async () => {
    const t8 = await h.newTenant();
    await t8.call('PATCH', `/v1/businesses/${t8.businessId}`, { gstin: OWN });
    const build = () =>
      t8.call('POST', '/v1/filing-packs/build/cmp08', {
        businessId: t8.businessId,
        period: '122026',
        turnover: 300000,
      });
    expect((await build()).status).toBe(422);
    await t8.call('PATCH', '/v1/settings', {
      businessId: t8.businessId,
      values: { 'gst.regType': 'composition', 'gst.compRate': 1 },
    });
    const b = await build();
    expect(b.status, b.text).toBe(200);
    expect(b.body.payload.outward).toMatchObject({ cgst: 1500, sgst: 1500 });
    const saved = await t8.call('POST', '/v1/filing-packs', {
      businessId: t8.businessId,
      kind: 'cmp08',
      period: '122026',
      payload: b.body.payload,
    });
    expect(saved.body).toMatchObject({
      status: 'ready',
      periodFrom: '2026-10-01',
      periodTo: '2026-12-31',
    });
  });
});
