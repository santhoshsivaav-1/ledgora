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

export const deleteClient = async (id) => {
  return apiFetch(`${API}/collections/clients/${encodeURIComponent(id)}`, { method: 'DELETE' });
};
