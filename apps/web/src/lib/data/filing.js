// File-ready returns (docs/FILE_READY_PLAN.md): filing packs, their review by a CA, the Return Register and the CA's
// practice view. Talks to the typed /v1 API; the server re-checks every file it is given.

import { apiClient } from '../apiClient';

const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();
const id = encodeURIComponent;

export const savePack = (body) => apiClient.post('/v1/filing-packs', body);
export const listPacks = async (filter = {}) => (await apiClient.get(`/v1/filing-packs?${qs(filter)}`)).data;
export const getPack = (packId) => apiClient.get(`/v1/filing-packs/${id(packId)}`);
export const acknowledge = (packId, acknowledged) => apiClient.post(`/v1/filing-packs/${id(packId)}/acknowledge`, { acknowledged });
export const submitReview = (packId, note) => apiClient.post(`/v1/filing-packs/${id(packId)}/submit-review`, { note: note || undefined });
export const approvePack = (packId, note) => apiClient.post(`/v1/filing-packs/${id(packId)}/approve`, { note: note || undefined });
export const requestChanges = (packId, note) => apiClient.post(`/v1/filing-packs/${id(packId)}/request-changes`, { note });
export const commentOn = (packId, body) => apiClient.post(`/v1/filing-packs/${id(packId)}/comments`, { body });
export const recordFiled = (packId, body) => apiClient.post(`/v1/filing-packs/${id(packId)}/record-filed`, body);
export const reopenPack = (packId, reason) => apiClient.post(`/v1/filing-packs/${id(packId)}/reopen`, { reason });
export const filingCalendar = (businessId, fy) => apiClient.get(`/v1/filing-calendar?${qs({ businessId, fy })}`);
// R1 builders: the server works the return out and hands back the file; savePack then checks and stores it.
export const buildGstr1a = (businessId, period, current) => apiClient.post('/v1/filing-packs/build/gstr1a', { businessId, period, current });
export const buildGst = (businessId, kind, period, quarterly = false) => apiClient.post('/v1/filing-packs/build/gst', { businessId, kind, period, quarterly });
export const buildGstr4 = (businessId, fy) => apiClient.post('/v1/filing-packs/build/gstr4', { businessId, fy });
export const buildGstr9c = (businessId, fy, adjustments = []) => apiClient.post('/v1/filing-packs/build/gstr9c', { businessId, fy, adjustments });
export const comparePortal = (packId, figures) => apiClient.post(`/v1/filing-packs/${id(packId)}/compare-portal`, figures);
export const buildGstr9 = (businessId, fy, itc2b = null) => apiClient.post('/v1/filing-packs/build/gstr9', { businessId, fy, itc2b });
export const buildCmp08 = (businessId, period, turnover) => apiClient.post('/v1/filing-packs/build/cmp08', { businessId, period, turnover });
export const editLog = (filter = {}) => apiClient.get(`/v1/edit-log?${qs(filter)}`);
export const editLogCsvUrl = (filter = {}) => `/v1/edit-log/export?${qs(filter)}`;
export const setTrackFrom = (businessId, month) => apiClient.put('/v1/filing-calendar/track-from', { businessId, month });
export const practiceClients = async () => (await apiClient.get('/v1/practice/clients')).data;

/** The file exactly as saved, downloaded through the API (so it carries the session cookie). */
export async function downloadPack(packId) {
  const res = await fetch(`/v1/filing-packs/${id(packId)}/download`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Could not download the file');
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'return.json';
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return name;
}

export const STATUS_TONES = {
  draft: ['danger', 'Needs fixes'],
  ready: ['info', 'Ready to file'],
  in_review: ['warn', 'With CA'],
  changes_requested: ['danger', 'CA asked for changes'],
  approved: ['success', 'Approved by CA'],
  filed: ['success', 'Filed'],
  not_started: ['neutral', 'Not started'],
};
export const KIND_LABELS = { gstr1: 'GSTR-1', gstr3b: 'GSTR-3B', ims: 'IMS actions', gstr1a: 'GSTR-1A', gstr9: 'GSTR-9', cmp08: 'CMP-08', gstr4: 'GSTR-4', gstr9c: 'GSTR-9C' };
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
/** "Oct 2026" for 102026; "Oct–Dec 2026" for a quarter. */
export const periodLabel = (period, quarterly = false) => {
  const m = Number(String(period).slice(0, 2));
  const y = String(period).slice(2);
  if (!m) return period;
  return quarterly ? `${MONTHS[m - 3]}–${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ${y}`;
};
/** The financial year a date falls in: 2026 for FY 2026-27. */
export const fyOf = (iso) => (Number(iso.slice(5, 7)) >= 4 ? Number(iso.slice(0, 4)) : Number(iso.slice(0, 4)) - 1);
