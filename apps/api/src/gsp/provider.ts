import { createHash, randomInt } from 'node:crypto';
import type { AppEnv } from '../env.ts';
import { AppError } from '../errors.ts';

// A GST Suvidha Provider (GSP) is how software reaches the e-invoice portal (IRP), the e-way bill portal and the GST portal: the
// taxpayer authorizes a GSP, and the software calls the GSP. Providers differ in their API, so Ledgora talks to one small, fixed
// contract (below) and a provider is plugged in behind it:
//   sandbox  a built-in stand-in that follows the portals' rules (IRN rules, the 24-hour cancel window, e-way validity by distance,
//            return status and ARN) but signs nothing real. For trying the screens and for tests. Everything it returns is marked sandbox.
//   http     a real provider: set GSP_BASE_URL and GSP_API_KEY and put a thin shim in front of the provider's API that speaks this
//            contract (docs/GSP_INTEGRATION.md). Nothing here has been run against a real portal.
// Credentials stay on the server and are never returned to the browser.

export interface IrpResult {
  irn: string;
  ackNo: string;
  ackDt: string;
  signedQr: string;
  sandbox: boolean;
}
export interface EwayResult {
  ewayNo: string;
  ewayDate: string;
  validUntil: string;
  sandbox: boolean;
}
export type GstnStatus = 'processing' | 'processed' | 'error' | 'filed';
export interface GstnUploadResult {
  reference: string;
  sandbox: boolean;
}
export interface GstnStatusResult {
  status: GstnStatus;
  arn?: string;
  filedOn?: string;
  errors?: string[];
}

type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- the portals' e-invoice/e-way JSON is untyped by nature

export interface GspProvider {
  /** off = nothing is called and the screens keep the manual route. */
  mode: 'off' | 'sandbox' | 'http';
  einvoiceGenerate(gstin: string, invoice: Rec): Promise<IrpResult>;
  einvoiceCancel(
    gstin: string,
    irn: string,
    reasonCode: '1' | '2' | '3' | '4',
    remark: string,
  ): Promise<{ irn: string; cancelDate: string }>;
  ewayGenerate(gstin: string, bill: Rec): Promise<EwayResult>;
  ewayUpdateVehicle(
    gstin: string,
    ewayNo: string,
    vehicleNo: string,
    reasonCode: string,
    remark: string,
  ): Promise<{ validUntil: string }>;
  ewayCancel(
    gstin: string,
    ewayNo: string,
    reasonCode: '1' | '2' | '3' | '4',
    remark: string,
  ): Promise<{ cancelDate: string }>;
  gstnUpload(
    gstin: string,
    kind: string,
    period: string,
    payload: unknown,
  ): Promise<GstnUploadResult>;
  gstnStatus(gstin: string, reference: string): Promise<GstnStatusResult>;
  gstr2b(gstin: string, period: string): Promise<Record<string, unknown>>;
}

const istNow = () => new Date(Date.now() + 5.5 * 3_600_000);
const stamp = (d = istNow()) => d.toISOString().slice(0, 19).replace('T', ' ');
const fyOf = (docDt: string) => {
  const [, mm, yyyy] = docDt.split('/').map(Number);
  const y = mm! >= 4 ? yyyy! : yyyy! - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** The e-way bill's validity: one day for each 200 km, or part of it (a normal cargo). */
export function ewayValidityDays(distanceKm: number) {
  return Math.max(1, Math.ceil(Math.max(1, distanceKm) / 200));
}

/**
 * The stand-in. It is deliberately strict about what the real portals are strict about, so a screen that works against it fails
 * early on the same mistakes: a repeated IRN is refused, only an IRN under 24 hours old can be cancelled, a vehicle number must
 * look like one. State lives in memory and is lost on restart.
 */
export function sandboxGsp(): GspProvider {
  const irns = new Map<string, { at: number; cancelled: boolean }>();
  const eways = new Map<string, { cancelled: boolean; validUntil: string }>();
  const uploads = new Map<string, { gstin: string; kind: string; period: string; at: number }>();
  return {
    mode: 'sandbox',
    async einvoiceGenerate(gstin, inv) {
      const docNo = String(inv?.DocDtls?.No ?? '');
      const docDt = String(inv?.DocDtls?.Dt ?? '');
      const typ = String(inv?.DocDtls?.Typ ?? 'INV');
      if (!docNo || !/^\d{2}\/\d{2}\/\d{4}$/.test(docDt))
        throw new AppError(
          'unprocessable',
          'E-invoice: the document number and its date (DD/MM/YYYY) are required (IRP 2172)',
        );
      if (String(inv?.SellerDtls?.Gstin ?? '') !== gstin)
        throw new AppError(
          'unprocessable',
          'E-invoice: the seller GSTIN is not the business GSTIN (IRP 2148)',
        );
      // The real IRN is a SHA-256 over the supplier GSTIN, document number, financial year and type; the same document twice is refused.
      const irn = createHash('sha256')
        .update(`${gstin}${docNo}${fyOf(docDt)}${typ}`)
        .digest('hex');
      if (irns.has(irn))
        throw new AppError(
          'conflict',
          'E-invoice: duplicate IRN. This document already has one (IRP 2150)',
        );
      const ackDt = stamp();
      const ackNo = `${randomInt(100000, 999999)}${randomInt(100000000, 999999999)}`;
      irns.set(irn, { at: Date.now(), cancelled: false });
      const claims = {
        sandbox: true,
        SellerGstin: gstin,
        BuyerGstin: inv?.BuyerDtls?.Gstin,
        DocNo: docNo,
        DocTyp: typ,
        DocDt: docDt,
        TotInvVal: inv?.ValDtls?.TotInvVal,
        Irn: irn,
      };
      return {
        irn,
        ackNo,
        ackDt,
        signedQr: `${b64({ alg: 'none', typ: 'JWT', sandbox: true })}.${b64(claims)}.${b64('sandbox-not-signed')}`,
        sandbox: true,
      };
    },
    async einvoiceCancel(_gstin, irn, reason, remark) {
      if (!remark.trim())
        throw new AppError('unprocessable', 'E-invoice: a cancel remark is required');
      const e = irns.get(irn);
      if (!e)
        throw new AppError('not_found', 'E-invoice: this IRN was not generated here (IRP 2155)');
      if (e.cancelled) throw new AppError('conflict', 'E-invoice: already cancelled');
      if (Date.now() - e.at > 24 * 3_600_000)
        throw new AppError(
          'conflict',
          'E-invoice: more than 24 hours since acknowledgement. Issue a credit note instead (IRP 2162)',
        );
      e.cancelled = true;
      return { irn, cancelDate: stamp() };
    },
    async ewayGenerate(gstin, bill) {
      if (Number(bill?.totInvValue ?? 0) < 50000)
        throw new AppError(
          'unprocessable',
          'E-way bill: the consignment value is below 50,000 (EWB 338)',
        );
      if (
        !/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/.test(
          String(bill?.vehicleNo ?? '')
            .replace(/[\s-]/g, '')
            .toUpperCase(),
        ) &&
        bill?.vehicleNo
      )
        throw new AppError(
          'unprocessable',
          'E-way bill: the vehicle number does not look right (EWB 339)',
        );
      if (String(bill?.fromGstin ?? '') !== gstin)
        throw new AppError(
          'unprocessable',
          'E-way bill: the consignor GSTIN is not the business GSTIN',
        );
      const days = ewayValidityDays(Number(bill?.transDistance ?? 0));
      const validUntil = new Date(istNow().getTime() + days * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const ewayNo = `${randomInt(100000, 999999)}${randomInt(100000, 999999)}`;
      eways.set(ewayNo, { cancelled: false, validUntil });
      return { ewayNo, ewayDate: stamp(), validUntil, sandbox: true };
    },
    async ewayUpdateVehicle(_g, ewayNo, vehicleNo) {
      const e = eways.get(ewayNo);
      if (!e || e.cancelled)
        throw new AppError('not_found', 'E-way bill: no live e-way bill with this number');
      if (!/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/.test(vehicleNo.replace(/[\s-]/g, '').toUpperCase()))
        throw new AppError('unprocessable', 'E-way bill: the vehicle number does not look right');
      return { validUntil: e.validUntil };
    },
    async ewayCancel(_g, ewayNo, _reason, remark) {
      const e = eways.get(ewayNo);
      if (!e || e.cancelled)
        throw new AppError('not_found', 'E-way bill: no live e-way bill with this number');
      if (!remark.trim())
        throw new AppError('unprocessable', 'E-way bill: a cancel remark is required');
      e.cancelled = true;
      return { cancelDate: stamp() };
    },
    async gstnUpload(gstin, kind, period, payload) {
      if (!payload || typeof payload !== 'object')
        throw new AppError('unprocessable', 'GSTN: nothing to upload');
      const reference = `SBX${Date.now().toString(36).toUpperCase()}${randomInt(1000, 9999)}`;
      uploads.set(reference, { gstin, kind, period, at: Date.now() });
      return { reference, sandbox: true };
    },
    async gstnStatus(gstin, reference) {
      const u = uploads.get(reference);
      if (!u) throw new AppError('not_found', 'GSTN: unknown reference');
      // First look: still processing. Later: processed and filed with an ARN (a 15-character AA + 13 style reference).
      const age = Date.now() - u.at;
      if (age < 1000) return { status: 'processing' };
      const yy = String(new Date().getFullYear() % 100).padStart(2, '0');
      const mm = String(new Date().getMonth() + 1).padStart(2, '0');
      return {
        status: 'filed',
        arn: `AA${gstin.slice(0, 2)}${mm}${yy}${String(randomInt(1000000, 9999999))}`.slice(0, 15),
        filedOn: istNow().toISOString().slice(0, 10),
      };
    },
    async gstr2b(gstin, period) {
      return {
        sandbox: true,
        data: {
          gstin,
          rtnprd: period,
          version: '1.0',
          docdata: { b2b: [] },
          itcsumm: { itcavl: { nonrevsup: { igst: 0, cgst: 0, sgst: 0, cess: 0 } } },
        },
      };
    },
  };
}

/** A real provider behind the contract in docs/GSP_INTEGRATION.md. */
export function httpGsp(
  env: Pick<AppEnv, 'GSP_BASE_URL' | 'GSP_API_KEY'>,
  fetchImpl: typeof fetch = fetch,
): GspProvider {
  const base = (env.GSP_BASE_URL ?? '').replace(/\/+$/, '');
  const call = async <T>(
    method: 'GET' | 'POST',
    path: string,
    gstin: string,
    body?: unknown,
  ): Promise<T> => {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${env.GSP_API_KEY}`,
          'content-type': 'application/json',
          'x-gstin': gstin,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(25_000),
      });
    } catch {
      throw new AppError(
        'bad_request',
        'The GST service provider did not answer. Try again in a minute.',
      );
    }
    const json = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; code?: string };
    } & T;
    // The provider's own message (it quotes the portal's error code), never the request, never the key.
    if (!res.ok)
      throw new AppError(
        res.status === 409 ? 'conflict' : res.status === 404 ? 'not_found' : 'unprocessable',
        json?.error?.message || `The GST service provider answered ${res.status}`,
      );
    return json as T;
  };
  const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
  return {
    mode: 'http',
    einvoiceGenerate: async (g, invoice) => ({
      ...(await call<Omit<IrpResult, 'sandbox'>>('POST', '/einvoice/generate', g, { invoice })),
      sandbox: false,
    }),
    einvoiceCancel: (g, irn, reason, remark) =>
      call('POST', '/einvoice/cancel', g, { irn, reason, remark }),
    ewayGenerate: async (g, bill) => ({
      ...(await call<Omit<EwayResult, 'sandbox'>>('POST', '/eway/generate', g, { bill })),
      sandbox: false,
    }),
    ewayUpdateVehicle: (g, ewayNo, vehicleNo, reason, remark) =>
      call('POST', '/eway/vehicle', g, { ewayNo, vehicleNo, reason, remark }),
    ewayCancel: (g, ewayNo, reason, remark) =>
      call('POST', '/eway/cancel', g, { ewayNo, reason, remark }),
    gstnUpload: async (g, kind, period, payload) => ({
      ...(await call<{ reference: string }>('POST', '/gstn/upload', g, {
        gstin: g,
        kind,
        period,
        payload,
      })),
      sandbox: false,
    }),
    gstnStatus: (g, reference) => call('GET', `/gstn/status?${q({ reference })}`, g),
    gstr2b: (g, period) => call('GET', `/gstn/gstr2b?${q({ gstin: g, period })}`, g),
  };
}

const made = new WeakMap<AppEnv, GspProvider>();
/** One provider per configuration for the life of the process: the sandbox remembers its IRNs and uploads between requests. */
export function gspFromEnv(env: AppEnv): GspProvider {
  const have = made.get(env);
  if (have) return have;
  const gsp: GspProvider =
    env.GSP_MODE === 'http' && env.GSP_BASE_URL && env.GSP_API_KEY
      ? httpGsp(env)
      : env.GSP_MODE === 'sandbox'
        ? sandboxGsp()
        : { ...sandboxGsp(), mode: 'off' };
  made.set(env, gsp);
  return gsp;
}
