// Vyapar parity P10-S7, offline only (D-15). The invoice in the IRP's INV-1 JSON (e-invoice schema version 1.1), checked
// against the IRP's published field rules before the person uploads it on the IRP portal; then the IRN, acknowledgement
// and signed QR the portal returns are checked before they are stored. Nothing here talks to a provider and no
// credentials exist.

import type { Numeric } from './types.ts';
import { splitLineTax } from './lineTax.ts';
import { GST_PORTAL_RATES } from './rates.ts';

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const n = (v: Numeric) => Number(v) || 0;

export type EinvoiceSupplyType = 'B2B' | 'SEZWP' | 'SEZWOP' | 'EXPWP' | 'EXPWOP' | 'DEXP';
export interface EinvoiceParty {
  gstin: string;
  name: string;
  address: string;
  city: string;
  pin: string | number;
  stateCode: string;
  /** Buyer only: place of supply as a state code. */
  pos?: string;
}
export interface EinvoiceDoc {
  docType: 'INV' | 'CRN' | 'DBN';
  number: string;
  /** YYYY-MM-DD */
  date: string;
  supplyType: EinvoiceSupplyType;
  reverseCharge?: boolean;
  interState: boolean;
  taxInclusive?: boolean;
  seller: EinvoiceParty;
  buyer: EinvoiceParty;
  items: {
    name: string;
    hsn: string;
    quantity: Numeric;
    unit?: string;
    rate: Numeric;
    discount?: Numeric;
    discountType?: string;
    taxPercent: Numeric;
    cessPercent?: Numeric;
  }[];
  otherCharges?: Numeric;
  /** Whole-bill discount after tax. */
  discount?: Numeric;
  roundOff?: Numeric;
}

const dmy = (iso: string) => {
  const [y, m, d] = String(iso).split('-');
  return `${d}/${m}/${y}`;
};
const pinOf = (p: string | number) => Number(String(p ?? '').replace(/\D/g, '')) || 0;

/** The INV-1 JSON for one document. Amounts are rounded to the paisa per line, as the IRP checks them. */
export function buildEinvoice(d: EinvoiceDoc) {
  const ItemList = d.items.map((it, i) => {
    const t = splitLineTax(it, d.interState, !!d.taxInclusive);
    const qty = n(it.quantity);
    const price = n(it.rate);
    const tot = r2(qty * price);
    const ass = r2(t.taxable);
    const cgst = r2(t.cgst);
    const sgst = r2(t.sgst + t.utgst);
    const igst = r2(t.igst);
    const cess = r2(t.cess);
    return {
      SlNo: String(i + 1),
      PrdDesc: String(it.name ?? '').trim(),
      IsServc: /^99/.test(String(it.hsn ?? '').trim()) ? 'Y' : 'N',
      HsnCd: String(it.hsn ?? '').trim(),
      Qty: qty,
      Unit: it.unit || 'OTH',
      UnitPrice: price,
      TotAmt: tot,
      Discount: r2(Math.max(0, tot - ass - (d.taxInclusive ? cgst + sgst + igst : 0))),
      AssAmt: ass,
      GstRt: n(it.taxPercent),
      IgstAmt: igst,
      CgstAmt: cgst,
      SgstAmt: sgst,
      CesRt: n(it.cessPercent),
      CesAmt: cess,
      TotItemVal: r2(ass + cgst + sgst + igst + cess),
    };
  });
  const sum = (k: 'AssAmt' | 'CgstAmt' | 'SgstAmt' | 'IgstAmt' | 'CesAmt') =>
    r2(ItemList.reduce((s, x) => s + x[k], 0));
  const AssVal = sum('AssAmt');
  const CgstVal = sum('CgstAmt');
  const SgstVal = sum('SgstAmt');
  const IgstVal = sum('IgstAmt');
  const CesVal = sum('CesAmt');
  const Discount = r2(n(d.discount));
  const OthChrg = r2(n(d.otherCharges));
  const RndOffAmt = r2(n(d.roundOff));
  const exp = d.supplyType.startsWith('EXP');
  return {
    Version: '1.1',
    TranDtls: {
      TaxSch: 'GST',
      SupTyp: d.supplyType,
      RegRev: d.reverseCharge ? 'Y' : 'N',
      IgstOnIntra: 'N',
    },
    DocDtls: { Typ: d.docType, No: String(d.number ?? '').trim(), Dt: dmy(d.date) },
    SellerDtls: {
      Gstin: d.seller.gstin.trim().toUpperCase(),
      LglNm: d.seller.name.trim(),
      Addr1: d.seller.address.trim(),
      Loc: d.seller.city.trim(),
      Pin: pinOf(d.seller.pin),
      Stcd: d.seller.stateCode,
    },
    BuyerDtls: {
      Gstin: exp ? 'URP' : d.buyer.gstin.trim().toUpperCase(),
      LglNm: d.buyer.name.trim(),
      Pos: exp ? '96' : d.buyer.pos || d.buyer.stateCode,
      Addr1: d.buyer.address.trim(),
      Loc: d.buyer.city.trim(),
      Pin: exp ? 999999 : pinOf(d.buyer.pin),
      Stcd: exp ? '96' : d.buyer.stateCode,
    },
    ItemList,
    ValDtls: {
      AssVal,
      CgstVal,
      SgstVal,
      IgstVal,
      CesVal,
      Discount,
      OthChrg,
      RndOffAmt,
      TotInvVal: r2(AssVal + CgstVal + SgstVal + IgstVal + CesVal + OthChrg + RndOffAmt - Discount),
    },
  };
}
export type Einvoice = ReturnType<typeof buildEinvoice>;

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const DOC_NO = /^[A-Z1-9][A-Z0-9/-]{0,15}$/i;
const STATE = /^\d{2}$/;

/** The IRP's field rules that a person can fix before upload. Empty = ready. */
export function validateEinvoice(j: Einvoice) {
  const errs: { field: string; message: string }[] = [];
  const bad = (field: string, message: string) => errs.push({ field, message });
  if (!DOC_NO.test(j.DocDtls.No))
    bad(
      'DocDtls.No',
      'Invoice number: 1 to 16 letters, digits, / or -, not starting with 0, / or -',
    );
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(j.DocDtls.Dt)) bad('DocDtls.Dt', 'Invoice date is missing');
  for (const side of ['SellerDtls', 'BuyerDtls'] as const) {
    const p = j[side];
    const who = side === 'SellerDtls' ? 'Your' : "The buyer's";
    if (!(side === 'BuyerDtls' && p.Gstin === 'URP') && !GSTIN.test(p.Gstin))
      bad(`${side}.Gstin`, `${who} GSTIN is not a valid GSTIN`);
    if (p.LglNm.length < 3 || p.LglNm.length > 100)
      bad(`${side}.LglNm`, `${who} legal name must be 3 to 100 characters`);
    if (!p.Addr1 || p.Addr1.length > 100) bad(`${side}.Addr1`, `${who} address is missing`);
    if (p.Loc.length < 3 || p.Loc.length > 50)
      bad(`${side}.Loc`, `${who} city must be 3 to 50 characters`);
    if (p.Pin < 100000 || p.Pin > 999999) bad(`${side}.Pin`, `${who} PIN code must be 6 digits`);
    if (!STATE.test(p.Stcd)) bad(`${side}.Stcd`, `${who} state code is missing`);
  }
  if (!STATE.test(j.BuyerDtls.Pos)) bad('BuyerDtls.Pos', 'Place of supply is missing');
  if (!j.ItemList.length || j.ItemList.length > 1000)
    bad('ItemList', 'An e-invoice needs 1 to 1000 lines');
  j.ItemList.forEach((it, i) => {
    const f = (k: string) => `ItemList[${i}].${k}`;
    if (!it.PrdDesc) bad(f('PrdDesc'), `Line ${i + 1}: item name is missing`);
    if (!/^\d{4}(\d{2}){0,2}$/.test(it.HsnCd))
      bad(f('HsnCd'), `Line ${i + 1}: HSN/SAC must be 4, 6 or 8 digits`);
    if (!(GST_PORTAL_RATES as readonly number[]).includes(it.GstRt))
      bad(f('GstRt'), `Line ${i + 1}: ${it.GstRt}% is not a GST rate`);
    if (it.IsServc === 'N' && !(it.Qty > 0)) bad(f('Qty'), `Line ${i + 1}: goods need a quantity`);
    if (it.AssAmt < 0) bad(f('AssAmt'), `Line ${i + 1}: taxable value is negative`);
  });
  if (Math.abs(j.ValDtls.RndOffAmt) > 99.99)
    bad('ValDtls.RndOffAmt', 'Round-off must be within ±99.99');
  if (!(j.ValDtls.TotInvVal > 0)) bad('ValDtls.TotInvVal', 'Invoice value must be above zero');
  return errs;
}

/** What the IRP returned, as typed or pasted back: IRN (64 hex), Ack No (digits), Ack date, signed QR (a JWT). */
export function checkIrnDetails(x: {
  irn?: string;
  ackNo?: string;
  ackDt?: string;
  signedQr?: string;
}) {
  const errs: { field: string; message: string }[] = [];
  if (!/^[a-f0-9]{64}$/i.test(String(x.irn ?? '').trim()))
    errs.push({ field: 'irn', message: 'The IRN is 64 letters and digits (0-9, a-f)' });
  if (!/^\d{10,20}$/.test(String(x.ackNo ?? '').trim()))
    errs.push({ field: 'ackNo', message: 'The Ack No is a number of 10 to 20 digits' });
  if (!/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(String(x.ackDt ?? '').trim()))
    errs.push({ field: 'ackDt', message: 'Ack date as YYYY-MM-DD HH:MM:SS' });
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(x.signedQr ?? '').trim()))
    errs.push({ field: 'signedQr', message: 'Paste the whole Signed QR Code text from the IRP' });
  return errs;
}
