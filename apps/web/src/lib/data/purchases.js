// Purchase bills.

import { API, apiFetch } from './api';

// ---- Purchases (Purchase Bills for ITC) ----
export const getAllPurchases = async () => {
  return apiFetch(`${API}/collections/purchases`);
};

export const savePurchase = async (purchase) => {
  const res = await apiFetch(`${API}/collections/purchases`, { method: 'POST', body: JSON.stringify(purchase) });
  if (res.id) purchase.id = res.id;
  return purchase;
};

export const deletePurchase = async (id) => {
  return apiFetch(`${API}/collections/purchases/${encodeURIComponent(id)}`, { method: 'DELETE' });
};
