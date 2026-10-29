// The billing screens' data layer (change 3.23). Every call goes to the signed-in organization's workspace on the account
// API (apps/api, /v1/workspace): tenant-isolated, role-checked and audited. Nothing is read from or written to this computer.
// One file per kind of data; this one holds the shared call.

import { request, ApiError } from '../apiClient';

export const API = '/v1/workspace';

// Same call shape the screens always used. Errors keep the fields they read (`status`, `body.error`, `body.dependents`);
// 401 / 402 / 403 are answered once for everyone by lib/apiClient (sign-in, Upgrade sheet, message).
const LEGACY_CODES = { credit_dependency: 'client-credit-dependency' };
export async function apiFetch(url, options = {}) {
  try {
    return await request(options.method || 'GET', url, options.body ? JSON.parse(options.body) : undefined);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    const err = new Error(e.message);
    err.status = e.status;
    err.body = { error: LEGACY_CODES[e.code] || e.message, message: e.message, code: e.code, ...(e.details && typeof e.details === 'object' ? e.details : {}) };
    throw err;
  }
}
