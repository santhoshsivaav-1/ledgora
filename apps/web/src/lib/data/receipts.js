// Receipt and payment vouchers. Payment Out vouchers (Vyapar parity P3-S2) share the `receipts` collection with
// `direction: 'out'`; missing means money received, as on every receipt saved before Phase 3.

import { API, apiFetch } from './api';

export const isPaymentOut = (r) => r?.direction === 'out';
const allVouchers = async () => apiFetch(`${API}/collections/receipts`);

// ---- Receipts / Payment Vouchers ----
/** Money received only: what every screen read before Phase 3, so they keep reading the same thing. */
export const getAllReceipts = async () => {
  const rows = await allVouchers();
  return Array.isArray(rows) ? rows.filter((r) => !isPaymentOut(r)) : rows;
};

/** P3-S2 Payment Out vouchers. */
export const getAllPaymentsOut = async () => (await allVouchers() || []).filter(isPaymentOut);

export const saveReceipt = async (receipt) => {
  const res = await apiFetch(`${API}/collections/receipts`, { method: 'POST', body: JSON.stringify(receipt) });
  if (res.id) receipt.id = res.id;
  return receipt;
};

// Saved-PDF folder features of the old desktop app (CANCELLED stamp on a saved PDF, moving it to a trash folder)
// have no counterpart now: PDFs are downloaded or printed from the browser. Kept as no-ops so the screens that call
// them (cancel, delete) need no special case; server-side PDF storage will hook in here.
export const markSavedPdfCancelled = async () => ({ success: true });
export const trashSavedPdf = async () => ({ success: true });

export const deleteReceipt = async (id) => {
  return apiFetch(`${API}/collections/receipts/${encodeURIComponent(id)}`, { method: 'DELETE' });
};
