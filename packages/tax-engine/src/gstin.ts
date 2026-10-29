// Moved verbatim from apps/web/src/utils.js (Phase 0, change 0.7/0.8/0.9).
// Types are deliberately loose until the Zod contracts land in Phase 1 (change 1.13).

import type { Rec } from './types.ts';
import { INDIAN_STATES } from './states.ts';

// GST State Codes (as per GST portal) — used in GSTR-1 JSON export
export const GST_STATE_CODES: Record<string, string> = {
  'jammu and kashmir': '01',
  'himachal pradesh': '02',
  punjab: '03',
  chandigarh: '04',
  uttarakhand: '05',
  haryana: '06',
  delhi: '07',
  rajasthan: '08',
  'uttar pradesh': '09',
  bihar: '10',
  sikkim: '11',
  'arunachal pradesh': '12',
  nagaland: '13',
  manipur: '14',
  mizoram: '15',
  tripura: '16',
  meghalaya: '17',
  assam: '18',
  'west bengal': '19',
  jharkhand: '20',
  odisha: '21',
  chhattisgarh: '22',
  'madhya pradesh': '23',
  gujarat: '24',
  'dadra and nagar haveli and daman and diu': '26',
  maharashtra: '27',
  'andhra pradesh': '37',
  karnataka: '29',
  goa: '30',
  lakshadweep: '31',
  kerala: '32',
  'tamil nadu': '33',
  puducherry: '34',
  'andaman and nicobar islands': '35',
  telangana: '36',
  ladakh: '38',
};

// v1.10.68 (#68, idea from @deppen12) — a GSTIN carries its own facts, so the
// state can be filled in and a typo caught without any API key or internet:
//   27 ABCDE1234F 2 Z 5
//   |  |          | | +- checksum over the first 14 characters
//   |  |          | +--- Z for a regular taxpayer (D = TDS, C = TCS)
//   |  |          +----- which registration of that PAN in that state
//   |  +---------------- the PAN, whose 4th letter is the kind of entity
//   +------------------- the state (2011 census code)
export const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const PAN_ENTITY_TYPES: Record<string, string> = {
  P: 'Individual',
  C: 'Company',
  F: 'Firm / LLP',
  H: 'HUF',
  A: 'Association of persons',
  T: 'Trust',
  B: 'Body of individuals',
  L: 'Local authority',
  J: 'Artificial juridical person',
  G: 'Government',
};

export const GSTIN_TAXPAYER_TYPES: Record<string, string> = {
  Z: 'Regular',
  D: 'TDS deductor',
  C: 'TCS collector',
};

// Luhn mod 36 over the first 14 characters. Verified against real GSTINs:
// it rejects a single mistyped or transposed character, which is the whole
// point — a wrong GSTIN is only discovered when the return is rejected.
export const gstinChecksumOk = (value: unknown) => {
  const gstin = String(value || '')
    .trim()
    .toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][A-Z][0-9A-Z]$/.test(gstin)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const product = GSTIN_CHARS.indexOf(gstin[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === gstin[14];
};

// Everything the number itself says. `state` is null for a code we do not
// know (96/97/99 are used for foreign country, other territory and centre
// jurisdiction), so callers can tell "unknown" from "wrong".
export const decodeGstin = (value: unknown) => {
  const gstin = String(value || '')
    .trim()
    .toUpperCase();
  if (gstin.length !== 15) return null;
  const stateCode = gstin.slice(0, 2);
  const pan = gstin.slice(2, 12);
  return {
    gstin,
    stateCode,
    state: stateNameForCode(stateCode),
    pan,
    entityType: PAN_ENTITY_TYPES[pan[3]] || null,
    registration: gstin[12],
    taxpayerType: GSTIN_TAXPAYER_TYPES[gstin[13]] || null,
    checksumOk: gstinChecksumOk(gstin),
  };
};

// v1.10.31 — GST-H1: legacy codes normalized.
// AP was reorganised in June 2014; old GSTINs with prefix `28` (before
// bifurcation) should map to the current code `37` (Andhra Pradesh).
// Daman & Diu had legacy code `25` before the 2020 merger into DNH+DD (`26`).
// Without normalisation, a `28ABCDE…` GSTIN and the current state "Andhra
// Pradesh" produced different codes → interstate/intrastate mis-classification.
export const LEGACY_STATE_CODE_MAP: Record<string, string> = { '28': '37', '25': '26' };

// v1.10.68 — code -> state name. Built from INDIAN_STATES so the value is
// spelled exactly like the entry in the State dropdown: a title-cased copy
// would read "Dadra And Nagar Haveli..." and match no option at all.
export const STATE_NAME_BY_CODE = INDIAN_STATES.reduce<Record<string, string>>((acc, name) => {
  const code = GST_STATE_CODES[name.trim().toLowerCase()];
  if (code && !acc[code]) acc[code] = name;
  return acc;
}, {});

export const stateNameForCode = (code: unknown) =>
  STATE_NAME_BY_CODE[String(code || '').trim()] || null;

// Get 2-digit GST state code from state name or GSTIN
export const getStateCode = (stateOrGstin: string | null | undefined) => {
  if (!stateOrGstin) return '';
  const s = stateOrGstin.trim();
  // If it looks like a GSTIN (15 chars), extract first 2 digits
  if (/^\d{2}[A-Z0-9]{13}$/i.test(s)) {
    const prefix = s.substring(0, 2);
    return LEGACY_STATE_CODE_MAP[prefix] || prefix;
  }
  const code = GST_STATE_CODES[s.toLowerCase()] || '';
  return LEGACY_STATE_CODE_MAP[code] || code;
};

// v1.10.76 (#82) - is a purchase inter-state? Compares the state in the
// supplier's GSTIN with the business's own (from its GSTIN, else its state).
// true / false when both are known, null when either is not - the caller then
// leaves the user's choice alone.
export const isInterstateSupply = (supplierGstin: unknown, profile: Rec | null | undefined) => {
  const g = String(supplierGstin || '').trim();
  if (!/^\d{2}[A-Z0-9]{13}$/i.test(g)) return null;
  const theirs = getStateCode(g);
  const ours = getStateCode(profile?.gstin || '') || getStateCode(profile?.state || '');
  if (!theirs || !ours) return null;
  return theirs !== ours;
};

// v1.10.1 — Union Territories WITHOUT their own legislature use CGST +
// UTGST instead of CGST + SGST for intra-UT supplies. This is required
// by Chapter II of the GST Act and enforced by the GSTN portal.
//
// UTs WITH legislature (Delhi 07, Puducherry 34, J&K 01 post-2019) are
// treated as states — CGST + SGST as normal.
//
// The 5 UTs below are the ones that need UTGST. Codes are the 2-digit
// GST state code (matches getStateCode() output).
export const UTS_WITHOUT_LEGISLATURE = new Set(['04', '26', '31', '35', '38']);

//                                        │      │      │      │      │
//    Chandigarh ─────────────────────────┘      │      │      │      │
//    Dadra & Nagar Haveli / Daman & Diu ────────┘      │      │      │
//    Lakshadweep ──────────────────────────────────────┘      │      │
//    Andaman & Nicobar Islands ───────────────────────────────┘      │
//    Ladakh ─────────────────────────────────────────────────────────┘
export const isUnionTerritoryWithoutLegislature = (stateCode: unknown) => {
  if (!stateCode) return false;
  return UTS_WITHOUT_LEGISLATURE.has(String(stateCode).padStart(2, '0'));
};

// v1.10.79 (#95) - a place of supply the way the GST portal writes it:
// "10-Bihar". Takes a code, a state name or a GSTIN.
export const placeOfSupplyLabel = (stateOrCode: unknown) => {
  const raw = String(stateOrCode || '').trim();
  const code = /^\d{2}$/.test(raw) ? raw : getStateCode(raw);
  if (!code) return raw;
  const name = PORTAL_STATE_NAMES[code] || INDIAN_STATES.find((s) => getStateCode(s) === code);
  return name ? `${code}-${name}` : code;
};

// The GST portal's own spelling where it differs from INDIAN_STATES.
export const PORTAL_STATE_NAMES: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '26': 'Dadra & Nagar Haveli & Daman & Diu',
  '35': 'Andaman & Nicobar Islands',
  '97': 'Other Territory',
};
