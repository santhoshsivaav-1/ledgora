// Phase 2 (docs/AUDIT_2026-11.md section 9): e-invoice, e-way bill and GSTN upload through a GST service provider. The provider is
// behind one contract (gsp/provider.ts) so the sandbox and a real provider behave the same to the screens. Nothing here has been
// run against a real portal.
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@ledgora/db';
import { uuid } from '@ledgora/contracts';
import { validateEinvoice } from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import type { Deps, Registrar } from '../http.ts';
import { gspFromEnv, type GspProvider } from '../gsp/provider.ts';
import { loadBusiness } from './businesses.ts';
import { loadPack, recordFiledPack, summary } from './filing.ts';

const { filingPacks, ewayBills, invoices } = schema;
const providerOf = (deps: Deps): GspProvider => deps.gsp ?? gspFromEnv(deps.env);
const reason = z.enum(['1', '2', '3', '4']);
const remark = z.string().trim().min(3, 'Say why').max(100);
const UPLOADABLE = ['gstr1', 'gstr3b'];

/** The provider, switched on, and the business's GSTIN: both are needed before anything is sent. */
async function ready(deps: Deps, tx: Parameters<typeof loadBusiness>[0], businessId: string) {
  const gsp = providerOf(deps);
  if (gsp.mode === 'off')
    throw new AppError(
      'conflict',
      'No GST service provider is connected on this server. The manual route (download, upload, paste back) still works.',
    );
  const biz = await loadBusiness(tx, businessId);
  if (!biz.gstin) throw new AppError('unprocessable', 'This business has no GSTIN');
  return { gsp, gstin: biz.gstin };
}

export function gspModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/gsp/status',
    tag: 'GSP',
    summary: 'Is a GST service provider connected, and is it the sandbox stand-in',
    permission: null,
    handler: async ({ deps }) => {
      const gsp = providerOf(deps);
      return { connected: gsp.mode !== 'off', mode: gsp.mode, sandbox: gsp.mode === 'sandbox' };
    },
  });

  // ---- e-invoice ----------------------------------------------------------------------------------------------------------
  route({
    method: 'post',
    path: '/v1/gsp/einvoice/generate',
    tag: 'GSP',
    summary:
      'Send an e-invoice (IRP JSON) to the IRP through the provider and get the IRN, acknowledgement and signed QR',
    permission: 'invoice:write',
    body: z.object({ businessId: uuid, invoice: z.record(z.string(), z.unknown()) }),
    handler: async ({ tx, orgId, deps, body }) => {
      const { gsp, gstin } = await ready(deps, tx, body.businessId);
      const problems = validateEinvoice(body.invoice as Parameters<typeof validateEinvoice>[0]);
      if (problems.length) throw new AppError('unprocessable', problems[0]!.message, { problems });
      const res = await gsp.einvoiceGenerate(gstin, body.invoice);
      await audit(tx, orgId, 'einvoice.generate', 'business', body.businessId, {
        after: { irn: res.irn, sandbox: res.sandbox },
      });
      return res;
    },
  });

  route({
    method: 'post',
    path: '/v1/gsp/einvoice/cancel',
    tag: 'GSP',
    summary:
      'Cancel an IRN with the IRP. Only within 24 hours of its acknowledgement; after that issue a credit note',
    permission: 'invoice:write',
    body: z.object({
      businessId: uuid,
      irn: z.string().regex(/^[a-f0-9]{64}$/i),
      /** The acknowledgement date-time as the IRP gave it (IST), to apply the 24-hour rule before asking. */
      ackDt: z.string().regex(/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/),
      reason,
      remark,
    }),
    handler: async ({ tx, orgId, deps, body }) => {
      const { gsp, gstin } = await ready(deps, tx, body.businessId);
      const ack = Date.parse(
        `${body.ackDt.replace(' ', 'T')}${body.ackDt.length > 10 ? '' : 'T00:00:00'}+05:30`,
      );
      if (Number.isFinite(ack) && Date.now() - ack > 24 * 3_600_000)
        throw new AppError(
          'conflict',
          'More than 24 hours since acknowledgement: an IRN can no longer be cancelled. Issue a credit note.',
        );
      const res = await gsp.einvoiceCancel(gstin, body.irn, body.reason, body.remark);
      await audit(tx, orgId, 'einvoice.cancel', 'business', body.businessId, {
        after: { irn: body.irn, reason: body.reason },
      });
      return res;
    },
  });

  // ---- e-way bill ---------------------------------------------------------------------------------------------------------
  const invoiceRef = z.object({ businessId: uuid, invoiceId: uuid.optional() });
  const record = async (
    tx: Parameters<typeof loadBusiness>[0],
    orgId: string,
    businessId: string,
    invoiceId: string | undefined,
    set: Record<string, unknown>,
  ) => {
    if (!invoiceId) return;
    const [inv] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), isNull(invoices.deletedAt)));
    if (!inv) throw notFound('Invoice');
    await tx
      .insert(ewayBills)
      .values({ orgId, businessId, invoiceId, ...set })
      .onConflictDoUpdate({
        target: [ewayBills.orgId, ewayBills.invoiceId],
        targetWhere: isNull(ewayBills.deletedAt),
        set: { ...set, updatedAt: new Date() },
      });
  };

  route({
    method: 'post',
    path: '/v1/gsp/eway/generate',
    tag: 'GSP',
    summary:
      'Generate an e-way bill from the NIC JSON through the provider; recorded on the invoice when one is named',
    permission: 'invoice:write',
    body: invoiceRef.extend({ bill: z.record(z.string(), z.unknown()) }),
    handler: async ({ tx, orgId, deps, body }) => {
      const { gsp, gstin } = await ready(deps, tx, body.businessId);
      const res = await gsp.ewayGenerate(gstin, body.bill);
      await record(tx, orgId, body.businessId, body.invoiceId, {
        ewayNo: res.ewayNo,
        vehicleNo: String(body.bill.vehicleNo ?? ''),
        distanceKm: String(body.bill.transDistance ?? ''),
        status: 'generated',
        validUntil: res.validUntil,
      });
      await audit(tx, orgId, 'eway.generate', 'business', body.businessId, {
        after: { ewayNo: res.ewayNo, sandbox: res.sandbox },
      });
      return res;
    },
  });

  route({
    method: 'post',
    path: '/v1/gsp/eway/vehicle',
    tag: 'GSP',
    summary: 'Update Part-B of an e-way bill (a new vehicle)',
    permission: 'invoice:write',
    body: invoiceRef.extend({
      ewayNo: z.string().regex(/^\d{12}$/),
      vehicleNo: z.string().trim().min(6).max(15),
      reason: z.string().max(2).default('1'),
      remark: remark.default('Vehicle changed'),
    }),
    handler: async ({ tx, orgId, deps, body }) => {
      const { gsp, gstin } = await ready(deps, tx, body.businessId);
      const res = await gsp.ewayUpdateVehicle(
        gstin,
        body.ewayNo,
        body.vehicleNo.toUpperCase(),
        body.reason,
        body.remark,
      );
      await record(tx, orgId, body.businessId, body.invoiceId, {
        ewayNo: body.ewayNo,
        vehicleNo: body.vehicleNo.toUpperCase(),
        status: 'generated',
        validUntil: res.validUntil,
      });
      await audit(tx, orgId, 'eway.vehicle', 'business', body.businessId, {
        after: { ewayNo: body.ewayNo },
      });
      return res;
    },
  });

  route({
    method: 'post',
    path: '/v1/gsp/eway/cancel',
    tag: 'GSP',
    summary: 'Cancel an e-way bill',
    permission: 'invoice:write',
    body: invoiceRef.extend({ ewayNo: z.string().regex(/^\d{12}$/), reason, remark }),
    handler: async ({ tx, orgId, deps, body }) => {
      const { gsp, gstin } = await ready(deps, tx, body.businessId);
      const res = await gsp.ewayCancel(gstin, body.ewayNo, body.reason, body.remark);
      await record(tx, orgId, body.businessId, body.invoiceId, {
        ewayNo: body.ewayNo,
        status: 'cancelled',
      });
      await audit(tx, orgId, 'eway.cancel', 'business', body.businessId, {
        after: { ewayNo: body.ewayNo },
      });
      return res;
    },
  });

  // ---- GSTN upload and status -----------------------------------------------------------------------------------------------
  route({
    method: 'post',
    path: '/v1/gsp/gstn/:id/upload',
    tag: 'GSP',
    summary: 'Upload an approved GSTR-1 or GSTR-3B pack to the GST portal through the provider',
    permission: 'filing:record',
    params: z.object({ id: uuid }),
    handler: async ({ tx, orgId, auth, deps, params }) => {
      const p = await loadPack(tx, params.id, auth);
      if (!UPLOADABLE.includes(p.kind))
        throw new AppError(
          'unprocessable',
          'Only GSTR-1 and GSTR-3B can be uploaded through the provider. File this one on the portal and record the ARN.',
        );
      if (p.supersededAt)
        throw new AppError('conflict', 'A newer version of this return exists; open that one');
      if (p.gspReference && p.gspStatus !== 'error')
        throw new AppError('conflict', 'This return was already sent. Check its status instead.');
      if (!['ready', 'approved'].includes(p.status))
        throw new AppError(
          'conflict',
          `A return that is ${p.status.replace('_', ' ')} can not be uploaded yet`,
        );
      if (p.reviewRequestedAt && !(p.approvedSha256 && p.approvedSha256 === p.sha256))
        throw new AppError(
          'conflict',
          'The file changed after it was approved; send it for review again',
        );
      const { gsp, gstin } = await ready(deps, tx, p.businessId);
      const res = await gsp.gstnUpload(gstin, p.kind, p.period, p.payload);
      const [row] = await tx
        .update(filingPacks)
        .set({
          gspReference: res.reference,
          gspStatus: 'processing',
          gspCheckedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(filingPacks.id, p.id))
        .returning();
      await audit(tx, orgId, 'filing.gsp_upload', 'filing_pack', p.id, {
        after: { reference: res.reference, sandbox: res.sandbox, sha256: p.sha256 },
      });
      return { ...summary(row!), sandbox: res.sandbox };
    },
  });

  route({
    method: 'post',
    path: '/v1/gsp/gstn/:id/status',
    tag: 'GSP',
    summary:
      'Ask the provider where an uploaded return stands; when it is filed the ARN is recorded and the months lock, with no manual step',
    permission: 'filing:record',
    params: z.object({ id: uuid }),
    handler: async ({ tx, orgId, auth, deps, params }) => {
      const p = await loadPack(tx, params.id, auth);
      if (!p.gspReference)
        throw new AppError('conflict', 'This return has not been uploaded through the provider');
      if (p.status === 'filed') return { ...summary(p), errors: [] as string[] };
      const { gsp, gstin } = await ready(deps, tx, p.businessId);
      const st = await gsp.gstnStatus(gstin, p.gspReference);
      if (st.status === 'filed' && st.arn) {
        await tx
          .update(filingPacks)
          .set({ gspStatus: 'filed', gspCheckedAt: new Date() })
          .where(eq(filingPacks.id, p.id));
        const filed = await recordFiledPack(tx, orgId, auth, p.id, {
          arn: st.arn,
          filedOn: st.filedOn ?? new Date().toISOString().slice(0, 10),
        });
        return { ...filed, errors: [] as string[] };
      }
      const [row] = await tx
        .update(filingPacks)
        .set({ gspStatus: st.status, gspCheckedAt: new Date() })
        .where(eq(filingPacks.id, p.id))
        .returning();
      return { ...summary(row!), errors: st.errors ?? [] };
    },
  });

  route({
    method: 'get',
    path: '/v1/gsp/gstr2b',
    tag: 'GSP',
    summary:
      'Read the GSTR-2B of a period from the GST portal through the provider (the JSON the reconciliation screen takes)',
    permission: 'filing:prepare',
    query: z.object({ businessId: uuid, period: z.string().regex(/^(0[1-9]|1[0-2])\d{4}$/) }),
    handler: async ({ tx, deps, query }) => {
      const { gsp, gstin } = await ready(deps, tx, query.businessId);
      return gsp.gstr2b(gstin, query.period);
    },
  });
}
