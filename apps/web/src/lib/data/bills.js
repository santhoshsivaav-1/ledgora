// Invoices ("bills") and the 30-day trash.

import { API, apiFetch } from './api';

// ---- Bills ----
// Pass overwrite: true when the caller knows they're updating an existing
// bill (edit flow, bulk-status change, auto-fire re-process). Default is
// to refuse silent overwrites — server returns 409 with an actionable
// message that the UI can show as "Invoice number already exists".
export const saveBill = async (bill, { overwrite = false } = {}) => {
  const qs = overwrite ? '?overwrite=1' : '';
  return apiFetch(`${API}/collections/bills${qs}`, { method: 'POST', body: JSON.stringify(bill) });
};

export const getAllBills = async () => {
  return apiFetch(`${API}/collections/bills`);
};

// Query string for the paged list (S6, screens 50 invoices at a time). Pure so
// it can be unit-tested: empty/absent filters produce no param at all, so the
// URL stays exactly as short as the request needs. `status` is passed through
// verbatim — the caller decides which of its filter values the server
// understands ('open' / 'converted' are client-side concepts and never sent).
export const billsPageQuery = ({ limit = 50, cursor, q, status, from, to } = {}) => {
  const params = new URLSearchParams();
  if (limit != null) params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
};

// One page of invoices, newest invoiceDate first. Returns
// `{ data: [...bill docs in the legacy shape...], nextCursor: string | null }`
// when `limit` is present; without `limit` it behaves like getAllBills (full
// array) so other screens are unaffected. getAllBills above is left alone —
// SalesOverview, IncomeTax, GSTReturns etc. keep using it untouched.
export const listBillsPage = async (opts = {}) => {
  return apiFetch(`${API}/collections/bills${billsPageQuery(opts)}`);
};

export const deleteBill = async (id) => {
  return apiFetch(`${API}/collections/bills/${encodeURIComponent(id)}`, { method: 'DELETE' });
};

// Deleted-invoice trash (30 days). Backups are the managed database's job now (point-in-time recovery).
export const getTrashedBills = async () => apiFetch(`${API}/trash`);
export const restoreTrashedBill = async (id) => apiFetch(`${API}/trash/${encodeURIComponent(id)}/restore`, { method: 'POST', body: JSON.stringify({}) });
export const purgeTrashedBill = async (id) => apiFetch(`${API}/trash/${encodeURIComponent(id)}`, { method: 'DELETE' });
