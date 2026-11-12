// Messaging (Vyapar parity Phase 9): share a document, reminders, service reminders, the Messages log, templates and the
// salesman's consented check-ins. Talks to the typed /v1 API.

import { apiClient } from '../apiClient';

const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();
const id = encodeURIComponent;

export const messagingStatus = (businessId) => apiClient.get(`/v1/messaging/status?${qs({ businessId })}`);
export const previewMessage = (body) => apiClient.post('/v1/messaging/preview', body);
export const sendMessage = (body) => apiClient.post('/v1/messages/send', body);
export const markOpened = (messageId) => apiClient.post(`/v1/messages/${id(messageId)}/opened`, {});
export const retryMessage = (messageId) => apiClient.post(`/v1/messages/${id(messageId)}/retry`, {});
export const listMessages = async (businessId, status) => (await apiClient.get(`/v1/messages?${qs({ businessId, status, limit: 100 })}`)).data;

export const listReminders = (businessId, minDaysLate = 1) => apiClient.get(`/v1/reminders?${qs({ businessId, minDaysLate })}`);
export const sendReminders = (businessId, invoiceIds, channel) => apiClient.post('/v1/reminders/send', { businessId, invoiceIds, channel });
export const setDoNotMessage = (partyId, doNotMessage) => apiClient.patch(`/v1/parties/${id(partyId)}`, { doNotMessage });

export const listServiceReminders = async (businessId) => (await apiClient.get(`/v1/service-reminders?${qs({ businessId })}`)).data;
export const addServiceReminder = (body) => apiClient.post('/v1/service-reminders', body);
export const markServiceDone = (rid) => apiClient.post(`/v1/service-reminders/${id(rid)}/done`, {});
export const snoozeService = (rid, days) => apiClient.post(`/v1/service-reminders/${id(rid)}/snooze`, { days });
export const deleteService = (rid) => apiClient.delete(`/v1/service-reminders/${id(rid)}`);

export const listTemplates = async (businessId) => (await apiClient.get(`/v1/messaging/templates?${qs({ businessId })}`)).data;
export const saveTemplate = (body) => apiClient.put('/v1/messaging/templates', body);
export const resetTemplate = (body) => apiClient.post('/v1/messaging/templates/reset', body);

export const createLink = (refId, days = 30) => apiClient.post('/v1/document-links', { refType: 'invoice', refId, days });
export const listLinks = async (refId) => (await apiClient.get(`/v1/document-links?${qs({ refType: 'invoice', refId })}`)).data;
export const revokeLink = (linkId) => apiClient.delete(`/v1/document-links/${id(linkId)}`);

export const getConsent = () => apiClient.get('/v1/visits/consent');
export const giveConsent = (version) => apiClient.post('/v1/visits/consent', { version });
export const withdrawConsent = (erase) => apiClient.post('/v1/visits/consent/withdraw', { erase });
export const checkIn = (body) => apiClient.post('/v1/visits', body);
export const listVisits = (staffId) => apiClient.get(`/v1/staff/${id(staffId)}/visits`);
