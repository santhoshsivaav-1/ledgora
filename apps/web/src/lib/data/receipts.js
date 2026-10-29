// Receipt and payment vouchers.

import { API, apiFetch } from './api';

// ---- Receipts / Payment Vouchers ----
export const getAllReceipts = async () => {
  return apiFetch(`${API}/collections/receipts`);
};

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
