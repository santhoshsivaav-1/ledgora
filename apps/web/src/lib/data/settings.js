// Invoice-number, stock-alert, display, region and module settings.

import { API, apiFetch } from './api';
import { numberSeriesFor } from '../../utils';

// ---- Invoice Number Settings ----
const DEFAULT_INV_SETTINGS = {
  format: 'branded',      // 'branded' | 'sequential' | 'random'
  brandPrefix: '',         // e.g. 'ACME' — empty means use type prefix (INV/EST/CN/BOS)
  separator: '/',          // '/' | '-' | '#'
  showFinYear: true,       // include 2026-27 financial year
  startNumber: 1,          // starting counter value
  padDigits: 4,            // zero-pad to this many digits
};

export const getInvoiceNumberSettings = async () => {
  const { value } = await apiFetch(`${API}/meta/invoiceNumberSettings`);
  return { ...DEFAULT_INV_SETTINGS, ...(value || {}) };
};

export const saveInvoiceNumberSettings = async (settings) => {
  await apiFetch(`${API}/meta/invoiceNumberSettings`, {
    method: 'POST',
    body: JSON.stringify({ value: settings }),
  });
};

// v1.10.79 (#95) - businesses with their own numbering: { [businessKey]: settings }.
export const getNumberSeriesMap = async () => {
  const { value } = await apiFetch(`${API}/meta/invoiceNumberSeries`);
  return value && typeof value === 'object' ? value : {};
};
export const saveNumberSeriesMap = (map) => apiFetch(`${API}/meta/invoiceNumberSeries`, {
  method: 'POST', body: JSON.stringify({ value: map || {} }),
});
// A business saved under a new GSTIN or name keeps its own series (#95).
export const renameNumberSeries = (from, to) => apiFetch(`${API}/number-series/rename`, {
  method: 'POST', body: JSON.stringify({ from, to }),
});
// The settings a business numbers with (own series, else shared); .own tells which.
export const getNumberSeries = async (businessKey) => {
  const [shared, map] = await Promise.all([getInvoiceNumberSettings(), businessKey ? getNumberSeriesMap() : {}]);
  return numberSeriesFor(shared, map, businessKey);
};

// ---- Stock-alert Settings ----
// Master on/off for the low-stock alert + the threshold below which a product
// counts as "low". Stored at app level (not per-business profile) because the
// alerting behaviour is a UX preference, not a business rule.
const DEFAULT_STOCK_ALERT_SETTINGS = {
  enabled: true,
  threshold: 5,    // products with `stock <= threshold` are flagged
};

export const getStockAlertSettings = async () => {
  const { value } = await apiFetch(`${API}/meta/stockAlertSettings`);
  return { ...DEFAULT_STOCK_ALERT_SETTINGS, ...(value || {}) };
};

export const saveStockAlertSettings = async (settings) => {
  await apiFetch(`${API}/meta/stockAlertSettings`, {
    method: 'POST',
    body: JSON.stringify({ value: settings }),
  });
};

// v1.10.76 (#80) - add { productId: change } to product stock (see
// stockEffect in utils.js). Returns the products as saved.

// ---- Invoice Display Options (checkboxes like showGST, showLogo etc.) ----
export const getInvoiceDisplayOptions = async () => {
  const { value } = await apiFetch(`${API}/meta/invoiceDisplayOptions`);
  return value || null;
};

export const saveInvoiceDisplayOptions = async (options) => {
  await apiFetch(`${API}/meta/invoiceDisplayOptions`, {
    method: 'POST',
    body: JSON.stringify({ value: options }),
  });
};

// ---- Region preference: 'india' | 'international' | 'both' (default 'both') ----
// Drives which countries appear in pickers and whether GST-only flows show up in the UI.
// Stored in localStorage for instant boot — server copy is async-best-effort.
const REGION_KEY = 'gst_regionMode';
export const getRegionMode = () => {
  try { return localStorage.getItem(REGION_KEY) || 'both'; } catch { return 'both'; }
};
export const setRegionMode = (mode) => {
  if (!['india', 'international', 'both'].includes(mode)) return;
  try { localStorage.setItem(REGION_KEY, mode); } catch { /* ignore */ }
  apiFetch(`${API}/meta/regionMode`, { method: 'POST', body: JSON.stringify({ value: mode }) }).catch(() => {});
};

// ---- Enabled feature modules ----
// Map of moduleId → bool. Missing keys fall back to the module's default.
// Stored locally for instant boot; mirrored to server for backup/import.
const MODULES_KEY = 'gst_enabledModules';
export const getEnabledModules = () => {
  try {
    const raw = localStorage.getItem(MODULES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
};
export const setEnabledModules = (map) => {
  try { localStorage.setItem(MODULES_KEY, JSON.stringify(map || {})); } catch { /* ignore */ }
  apiFetch(`${API}/meta/enabledModules`, { method: 'POST', body: JSON.stringify({ value: map || {} }) }).catch(() => {});
};
