// Point of Sale (Vyapar parity P12). Talks to the typed /v1/pos API: the counter bill is a typed invoice, so it is in
// the ledger, the reports and Cash & Bank like any other sale.

import { apiClient } from '../apiClient';

const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();

export const getPosSettings = (businessId) => apiClient.get(`/v1/pos/settings?${qs({ businessId })}`);
export const savePosSettings = (businessId, settings) => apiClient.put('/v1/pos/settings', { businessId, settings });
export const posItems = async (businessId, q, limit = 20) => (await apiClient.get(`/v1/pos/items?${qs({ businessId, q, limit })}`)).data;
export const posCustomers = async (businessId, q = '') => (await apiClient.get(`/v1/pos/customers?${qs({ businessId, q })}`)).data;
export const saveSale = (body) => apiClient.post('/v1/pos/sales', body);
export const getInvoice = (id) => apiClient.get(`/v1/invoices/${encodeURIComponent(id)}`);
export const recentBills = async (businessId, limit = 15) => (await apiClient.get(`/v1/invoices?${qs({ limit })}`)).data.filter((b) => !businessId || b.businessId === businessId);
export const cancelBill = (id) => apiClient.post(`/v1/invoices/${encodeURIComponent(id)}/cancel`, {});

export const createPosItem = (body) => apiClient.post('/v1/items', body);
export const createPosCustomer = (body) => apiClient.post('/v1/parties', body);
export const listTypedItemNames = async () => {
  const names = new Set();
  let cursor;
  for (let i = 0; i < 50; i += 1) {
    const r = await apiClient.get(`/v1/items?${qs({ limit: 200, cursor })}`);
    for (const it of r.data) names.add(`${it.name.toLowerCase()}|${it.hsn}`);
    if (!r.nextCursor) break;
    cursor = r.nextCursor;
  }
  return names;
};
