import { apiClient } from '../apiClient';

// Phase 2: the GST service provider (apps/api/src/modules/gsp.ts). When none is connected the screens keep the manual route.
export const getGspStatus = () => apiClient.get('/v1/gsp/status');
export const gspEinvoiceGenerate = (businessId, invoice) => apiClient.post('/v1/gsp/einvoice/generate', { businessId, invoice });
export const gspEinvoiceCancel = (businessId, e, reason, remark) => apiClient.post('/v1/gsp/einvoice/cancel', { businessId, irn: e.irn, ackDt: e.ackDt, reason, remark });
export const gspEwayGenerate = (businessId, bill, invoiceId) => apiClient.post('/v1/gsp/eway/generate', { businessId, bill, ...(invoiceId ? { invoiceId } : {}) });
export const gspEwayVehicle = (businessId, ewayNo, vehicleNo, invoiceId) => apiClient.post('/v1/gsp/eway/vehicle', { businessId, ewayNo, vehicleNo, ...(invoiceId ? { invoiceId } : {}) });
export const gspEwayCancel = (businessId, ewayNo, reason, remark, invoiceId) => apiClient.post('/v1/gsp/eway/cancel', { businessId, ewayNo, reason, remark, ...(invoiceId ? { invoiceId } : {}) });
export const gspGstnUpload = (packId) => apiClient.post(`/v1/gsp/gstn/${packId}/upload`, {});
export const gspGstnStatus = (packId) => apiClient.post(`/v1/gsp/gstn/${packId}/status`, {});
export const gspGstr2b = (businessId, period) => apiClient.get(`/v1/gsp/gstr2b?businessId=${businessId}&period=${period}`);
