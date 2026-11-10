// Purchase documents. Bills, purchase orders and debit notes (Vyapar parity Phase 3) share the `purchases` collection,
// told apart by `docType` ('bill' when missing, as on every purchase saved before Phase 3).

import { API, apiFetch } from './api';

export const PURCHASE_DOC_TYPES = ['bill', 'order', 'debit-note'];
export const purchaseDocType = (p) => (p && PURCHASE_DOC_TYPES.includes(p.docType) ? p.docType : 'bill');

/** Every purchase document. */
export const getAllPurchaseDocs = async () => apiFetch(`${API}/collections/purchases`);

// ---- Purchases (Purchase Bills for ITC) ----
/** Purchase bills only: what every screen read before Phase 3, so they keep reading the same thing. */
export const getAllPurchases = async () => {
  const rows = await getAllPurchaseDocs();
  return Array.isArray(rows) ? rows.filter((p) => purchaseDocType(p) === 'bill') : rows;
};

/** P3-S3 purchase orders. */
export const getAllPurchaseOrders = async () => (await getAllPurchaseDocs() || []).filter((p) => purchaseDocType(p) === 'order');

/** P3-S4 debit notes (purchase returns). */
export const getAllDebitNotes = async () => (await getAllPurchaseDocs() || []).filter((p) => purchaseDocType(p) === 'debit-note');

export const savePurchase = async (purchase) => {
  const res = await apiFetch(`${API}/collections/purchases`, { method: 'POST', body: JSON.stringify(purchase) });
  if (res.id) purchase.id = res.id;
  return purchase;
};

export const deletePurchase = async (id) => {
  return apiFetch(`${API}/collections/purchases/${encodeURIComponent(id)}`, { method: 'DELETE' });
};
