import { apiClient } from '../apiClient';

// SaaS billing (contracts/plans.ts, apps/api/src/modules/billing.ts).
export const getBilling = () => apiClient.get('/v1/billing');
export const startCheckout = (plan, interval) => apiClient.post('/v1/billing/checkout', { plan, interval });
export const cancelPlan = () => apiClient.post('/v1/billing/cancel', {});
