// Utilities (Vyapar parity Phase 7): barcode codes, Tally export, Close FY, backup and restore, the setup checklist and
// the typed trash. Talks to the typed /v1 API.

import { apiClient } from '../apiClient';

const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();
const enc = encodeURIComponent;

// barcode
export const listAllItems = async () => {
  const out = [];
  let cursor;
  for (let i = 0; i < 25; i += 1) {
    const r = await apiClient.get(`/v1/items?${qs({ limit: 200, cursor })}`);
    out.push(...r.data);
    if (!r.nextCursor) break;
    cursor = r.nextCursor;
  }
  return out;
};
export const assignBarcodes = (itemIds) => apiClient.post('/v1/utilities/barcodes/assign', { itemIds });

// Tally
export const tallyConfig = (businessId) => apiClient.get(`/v1/utilities/tally/config?${qs({ businessId })}`);
export const saveTallyConfig = (body) => apiClient.put('/v1/utilities/tally/config', body);
export const tallyPreview = (businessId, from, to) => apiClient.get(`/v1/utilities/tally/preview?${qs({ businessId, from, to })}`);
export async function downloadTally(businessId, from, to, file) {
  const res = await fetch(`/v1/utilities/tally/export?${qs({ businessId, from, to, file })}`, { credentials: 'same-origin' });
  if (!res.ok) throw Object.assign(new Error((await res.json().catch(() => null))?.error?.message || 'Could not export'), { body: await res.json().catch(() => null) });
  return saveBlob(await res.blob(), file === 'master' ? 'Master.xml' : 'Voucher.xml');
}

// Close FY
export const fyPreview = (q) => apiClient.get(`/v1/utilities/fy-close/preview?${qs(q)}`);
export const fyClose = (body) => apiClient.post('/v1/utilities/fy-close', body);
export const fyReopen = (body) => apiClient.post('/v1/utilities/fy-reopen', body);
export const fyHistory = (businessId) => apiClient.get(`/v1/utilities/fy-close/history?${qs({ businessId })}`);
export const financialYears = async (businessId) => (await apiClient.get(`/v1/financial-years?${qs({ businessId })}`)).data;

// backup
export const backupList = () => apiClient.get('/v1/backups');
export const backupNow = (body) => apiClient.post('/v1/backups', body);
export const driveConnectUrl = async () => (await apiClient.get('/v1/backups/drive/connect')).url;
export const driveDisconnect = () => apiClient.delete('/v1/backups/drive/connection');
export const backupDelete = (id) => apiClient.delete(`/v1/backups/${enc(id)}`);
export const backupSaveSettings = (body) => apiClient.put('/v1/backups/settings', body);
export async function downloadBackup(b) {
  const res = await fetch(`/v1/backups/${enc(b.id)}/download`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Could not download the backup');
  return saveBlob(await res.blob(), b.fileName);
}
export const restoreBackup = (body) => apiClient.post('/v1/backups/restore', body);
export const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });

// setup checklist
export const setupChecklist = (businessId) => apiClient.get(`/v1/setup/checklist?${qs({ businessId })}`);
export const setupDismiss = (businessId, dismissed) => apiClient.post('/v1/setup/dismiss', { businessId, dismissed });

// trash
export const trashList = async (type) => (await apiClient.get(`/v1/trash?${qs({ type })}`)).data;
export async function trashRestore(id, reason) {
  if (!reason) return apiClient.post(`/v1/trash/${enc(id)}/restore`);
  // the owner's override reason travels in a header, which apiClient does not send
  const res = await fetch(`/v1/trash/${enc(id)}/restore`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-override-reason': reason }, body: '{}' });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message || 'Could not restore');
  return json;
}
export const trashRestoreMany = (ids) => apiClient.post('/v1/trash/restore', { ids });
export const trashEmpty = () => apiClient.post('/v1/trash/purge');

function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return { size: blob.size };
}

// Barcode label presets are kept in the business's settings (preferences.barcode), read and written whole as the
// settings screen does, so nothing else in preferences is lost.
export async function loadBarcodePreset(businessId) {
  const s = await apiClient.get(`/v1/businesses/${enc(businessId)}/settings`);
  return s.preferences?.barcode ?? null;
}
export async function saveBarcodePreset(businessId, preset) {
  const s = await apiClient.get(`/v1/businesses/${enc(businessId)}/settings`);
  await apiClient.put(`/v1/businesses/${enc(businessId)}/settings`, { ...s, preferences: { ...(s.preferences ?? {}), barcode: preset } });
}
