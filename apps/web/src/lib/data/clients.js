// Clients.

import { API, apiFetch } from './api';

// ---- Saved Clients ----
export const saveClient = async (client) => {
  const res = await apiFetch(`${API}/collections/clients`, { method: 'POST', body: JSON.stringify(client) });
  if (res.id) client.id = res.id;
  return client;
};

export const getAllClients = async () => {
  return apiFetch(`${API}/collections/clients`);
};

// One page of saved clients, name A→Z (Phase 3: the Clients screen pages 50 at
// a time and searches `q` on the server — name, phone, GSTIN, email). Returns
// `{ data: [...client docs in the legacy shape...], nextCursor: string | null }`
// when `limit` is present; without `limit` it behaves like getAllClients, so
// the screens that still need every client in one array are unaffected.
export const listClientsPage = async ({ limit, cursor, q } = {}) => {
  const params = new URLSearchParams();
  if (limit != null) params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);
  if (q) params.set('q', q);
  const qs = params.toString();
  return apiFetch(`${API}/collections/clients${qs ? `?${qs}` : ''}`);
};

export const deleteClient = async (id) => {
  return apiFetch(`${API}/collections/clients/${encodeURIComponent(id)}`, { method: 'DELETE' });
};
