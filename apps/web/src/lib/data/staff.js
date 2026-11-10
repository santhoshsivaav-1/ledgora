// Salesmen (Vyapar parity P2-S1). Like partyGroups.js this talks to the typed /v1 API, not the workspace collections;
// an invoice document only carries the chosen `salesmanId` (and the name, for printing and lists).

import { apiClient } from '../apiClient';

const S = '/v1/staff';

export const listStaff = async ({ activeOnly = false } = {}) =>
  (await apiClient.get(activeOnly ? `${S}?active=true` : S)).data;
export const createStaff = (input) => apiClient.post(S, input);
export const updateStaff = (id, patch) => apiClient.patch(`${S}/${encodeURIComponent(id)}`, patch);
export const deleteStaff = (id) => apiClient.delete(`${S}/${encodeURIComponent(id)}`);
export const staffPerformance = (id, { from, to, basis = 'sale' }) =>
  apiClient.get(`${S}/${encodeURIComponent(id)}/performance?from=${from}&to=${to}&basis=${basis}`);

/** The form's fields → the API body. Blank phone stays blank; numbers come from text inputs. */
export const staffBody = (form) => ({
  name: String(form.name || '').trim(),
  phone: String(form.phone || '').replace(/\D/g, ''),
  userId: form.userId || null,
  commissionPct: Number(form.commissionPct) || 0,
  monthlyTarget: Number(form.monthlyTarget) || 0,
  active: form.active !== false,
});

/** Field errors the form shows before saving (the API checks the same rules). */
export function staffFormErrors(form) {
  const e = {};
  const b = staffBody(form);
  if (!b.name) e.name = 'Enter a name';
  else if (b.name.length > 100) e.name = 'At most 100 characters';
  if (b.phone && b.phone.length !== 10) e.phone = 'Use 10 digits';
  if (b.commissionPct < 0 || b.commissionPct > 100) e.commissionPct = 'Between 0 and 100';
  if (b.monthlyTarget < 0) e.monthlyTarget = 'Cannot be negative';
  return e;
}

/** The first and last day of the month a date is in, for "this month" performance. */
export function monthRange(today) {
  const [y, m] = today.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}
