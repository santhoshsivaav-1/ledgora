// Attachments (Vyapar parity Phase 3: the original bill on a purchase, the receipt on an expense or payment). Uses the
// account API's files module: ask for a signed upload URL, PUT the file there, then confirm, and the file is kept with
// the organization. Documents keep only the returned { fileId, fileName }.

import { apiFetch } from './api';

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export async function uploadAttachment(file) {
  if (!file) throw new Error('No file');
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('Files up to 20 MB can be attached');
  const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(file.type || '') ? file.type : 'application/octet-stream';
  const slot = await apiFetch('/v1/files/upload-url', {
    method: 'POST',
    body: JSON.stringify({ kind: 'attachment', fileName: file.name || 'attachment', contentType, sizeBytes: file.size }),
  });
  const put = await fetch(slot.uploadUrl, { method: slot.method || 'PUT', headers: slot.headers || {}, body: file, credentials: 'include' });
  if (!put.ok) throw new Error('Upload failed');
  const done = await apiFetch(`/v1/files/${slot.fileId}/complete`, { method: 'POST' });
  return { fileId: done.id, fileName: done.fileName };
}

/** Opens an attachment in a new tab through a short-lived signed URL. */
export async function openAttachment(fileId) {
  const { url } = await apiFetch(`/v1/files/${fileId}/download-url`);
  window.open(url, '_blank', 'noopener');
}
