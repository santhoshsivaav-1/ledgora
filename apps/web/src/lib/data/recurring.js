// Recurring invoice schedules and "generate now".

import { API, apiFetch } from './api';

// ---- Recurring Invoices ----
export const getAllRecurring = async () => {
  return apiFetch(`${API}/collections/recurring`);
};

export const saveRecurring = async (item) => {
  const res = await apiFetch(`${API}/collections/recurring`, { method: 'POST', body: JSON.stringify(item) });
  if (res.id) item.id = res.id;
  return item;
};

// "Generate Now": the server makes the invoice with the same code as the daily
// auto-fire, so both give identical invoices. Resolves to { invoiceNumber }.
export const generateRecurringNow = async (id) => {
  return apiFetch(`${API}/recurring/${encodeURIComponent(id)}/generate`, { method: 'POST', body: JSON.stringify({}) });
};

export const deleteRecurring = async (id) => {
  return apiFetch(`${API}/collections/recurring/${encodeURIComponent(id)}`, { method: 'DELETE' });
};
