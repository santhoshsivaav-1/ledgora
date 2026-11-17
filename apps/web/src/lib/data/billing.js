import { apiClient } from '../apiClient';

// SaaS billing (contracts/plans.ts, apps/api/src/modules/billing.ts).
export const getBilling = () => apiClient.get('/v1/billing');
export const startCheckout = (plan, interval) => apiClient.post('/v1/billing/checkout', { plan, interval });
export const cancelPlan = () => apiClient.post('/v1/billing/cancel', {});
/** Begin: the 7-day free trial ('trial') or Free ('free'). Owner only, once. */
export const startTrial = (choice) => apiClient.post('/v1/billing/trial', { choice });
/** After the trial or a paid plan has ended: carry on with Free. Unlocks a locked account. Owner only. */
export const chooseFree = () => apiClient.post('/v1/billing/free', {});
/** The GST invoices issued for this organization's subscription payments. Owner only. */
export const getInvoices = () => apiClient.get('/v1/billing/invoices').then((r) => r.invoices);
export const getInvoice = (id) => apiClient.get(`/v1/billing/invoices/${id}`).then((r) => r.invoice);
