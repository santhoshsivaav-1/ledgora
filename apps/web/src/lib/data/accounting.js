// The books (Vyapar parity Phase 4): chart of accounts, account ledger, trial balance, journals, ledger setup, financial
// years, Verify My Data. Like staff.js this talks to the typed /v1 API, not the workspace collections.

import { apiClient } from '../apiClient';

const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();
const enc = encodeURIComponent;

export const listBusinesses = async () => (await apiClient.get('/v1/businesses')).data;
export const ledgerStatus = (businessId) => apiClient.get(`/v1/accounting/status?${qs({ businessId })}`);
/** dryRun (the default) writes nothing. */
export const runBackfill = (body) => apiClient.post('/v1/accounting/backfill', body);

export const listAccounts = async (businessId, extra = {}) => (await apiClient.get(`/v1/accounts?${qs({ businessId, ...extra })}`)).data;
export const createAccount = (body) => apiClient.post('/v1/accounts', body);
export const updateAccount = (id, patch) => apiClient.patch(`/v1/accounts/${enc(id)}`, patch);
export const deleteAccount = (id) => apiClient.delete(`/v1/accounts/${enc(id)}`);
export const accountLedger = (id, params = {}) => apiClient.get(`/v1/ledger/${enc(id)}?${qs(params)}`);
export const trialBalance = (businessId, asOf) => apiClient.get(`/v1/ledger/trial-balance?${qs({ businessId, asOf })}`);

export const listJournals = async (businessId) => (await apiClient.get(`/v1/journals?${qs({ businessId })}`)).data;
export const createJournal = (body) => apiClient.post('/v1/journals', body);
export const updateJournal = (id, body) => apiClient.put(`/v1/journals/${enc(id)}`, body);
export const deleteJournal = (id) => apiClient.delete(`/v1/journals/${enc(id)}`);

export const listYears = async (businessId) => (await apiClient.get(`/v1/financial-years?${qs({ businessId })}`)).data;
export const closeYear = (id) => apiClient.post(`/v1/financial-years/${enc(id)}/close`, {});
export const reopenYear = (id) => apiClient.post(`/v1/financial-years/${enc(id)}/reopen`, {});
export const getLock = (businessId) => apiClient.get(`/v1/accounting/lock?${qs({ businessId })}`);
export const saveLock = (body) => apiClient.put('/v1/accounting/lock', body);

export const runVerify = (businessId) => apiClient.get(`/v1/verify?${qs({ businessId })}`);
export const fixCheck = (checkId, businessId) => apiClient.post(`/v1/verify/${enc(checkId)}/fix`, { businessId });

// ---- what the screens show ---------------------------------------------------------------------------------------------

/** "₹48,300 Dr": a signed Dr-positive amount as the books write it. */
export const drCrText = (signed, fmt) => {
  const v = Math.round((Number(signed) || 0) * 100) / 100;
  return v === 0 ? fmt(0) : `${fmt(Math.abs(v))} ${v > 0 ? 'Dr' : 'Cr'}`;
};

/** An account's balance in its natural direction, as the chart shows it: "₹2,40,100 Dr" for an asset, "Cr" for income. */
export const balanceText = (a, fmt) => {
  const v = Math.round((Number(a.balance) || 0) * 100) / 100;
  if (v === 0) return fmt(0);
  const natural = a.kind === 'asset' || a.kind === 'expense' ? 'Dr' : 'Cr';
  const side = v > 0 ? natural : natural === 'Dr' ? 'Cr' : 'Dr';
  return `${fmt(Math.abs(v))} ${side}`;
};

/** Where a ledger row's reference opens: the screen of the document it came from (null for journals and openings). */
export const refLink = (refType) => ({ invoice: '/invoices', purchase: '/purchases', payment: '/receipts', expense: '/expenses' })[refType] ?? null;

/** Journal rows are valid when each has one side, at least two exist, and the sides are equal. */
export function journalState(rows) {
  const clean = (rows || []).filter((r) => r.accountId && (Number(r.debit) > 0 || Number(r.credit) > 0));
  const debit = Math.round(clean.reduce((s, r) => s + (Number(r.debit) || 0), 0) * 100) / 100;
  const credit = Math.round(clean.reduce((s, r) => s + (Number(r.credit) || 0), 0) * 100) / 100;
  const bothSides = clean.some((r) => Number(r.debit) > 0 && Number(r.credit) > 0);
  return { rows: clean, debit, credit, balanced: debit === credit && debit > 0, ok: clean.length >= 2 && !bothSides && debit === credit && debit > 0, bothSides, diff: Math.round((debit - credit) * 100) / 100 };
}

/** The financial year label of a date, and the FY's first and last day. */
export const fyRange = (label) => {
  const y = Number(String(label).slice(0, 4));
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
};
