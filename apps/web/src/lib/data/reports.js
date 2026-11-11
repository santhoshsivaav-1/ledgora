// Reports (Vyapar parity Phase 6): the typed /v1/reports API: favourites, recent and saved views, scheduled e-mails, the
// e-way bill record and the full CSV download. The reports themselves are run by features/reports/definitions.js.
import { apiClient } from '../apiClient';

const enc = encodeURIComponent;
const qs = (o) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();

export const getPrefs = () => apiClient.get('/v1/reports/prefs');
export const setFavourite = (reportId, on) =>
  apiClient.put('/v1/reports/prefs/favourites', { reportId, on });
export const noteRecent = (reportId) => apiClient.post('/v1/reports/prefs/recent', { reportId });
export const saveView = (body) => apiClient.post('/v1/reports/prefs/views', body);
export const deleteView = (id) => apiClient.delete(`/v1/reports/prefs/views/${enc(id)}`);

export const listSchedules = async (businessId) =>
  (await apiClient.get(`/v1/reports/schedules?${qs({ businessId })}`)).data;
export const createSchedule = (body) => apiClient.post('/v1/reports/schedules', body);
export const patchSchedule = (id, patch) =>
  apiClient.patch(`/v1/reports/schedules/${enc(id)}`, patch);
export const deleteSchedule = (id) => apiClient.delete(`/v1/reports/schedules/${enc(id)}`);

export const recordEway = (invoiceId, body) =>
  apiClient.put(`/v1/eway-bills/${enc(invoiceId)}`, body);

/** The query string a server report is run (or exported) with: the period split into from/to, toggles as 0/1. */
export function reportQuery(businessId, params = {}) {
  const { period, q: _q, ...rest } = params;
  const out = { businessId, from: period?.from, to: period?.to };
  for (const [k, v] of Object.entries(rest)) out[k] = typeof v === 'boolean' ? (v ? '1' : '0') : v;
  return qs(out);
}

/**
 * The whole report as a CSV file from the server (streamed, up to 100,000 rows), not just the rows on screen. Returns
 * `{ rows, truncated }` so the screen can say when there were more.
 */
export async function downloadReportCsv(id, businessId, params) {
  const res = await fetch(`/v1/reports/${enc(id)}/export?${reportQuery(businessId, params)}`, {
    credentials: 'same-origin',
  });
  if (!res.ok)
    throw Object.assign(new Error('Could not export'), {
      body: await res.json().catch(() => null),
    });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${id}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return {
    rows: Number(res.headers.get('x-report-rows')) || 0,
    truncated: res.headers.get('x-report-truncated') === '1',
  };
}
