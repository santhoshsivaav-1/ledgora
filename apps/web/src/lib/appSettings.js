import { useSyncExternalStore } from 'react';
import { SETTINGS } from '@ledgora/contracts';
import { apiClient } from './apiClient';

// Vyapar parity P8 follow-up: the settings of the business the person is working in, readable from any screen.
// `getAppSetting(key)` is for plain functions (a formatter, a default), `useAppSetting(key)` re-renders a component when
// the value changes. Until the first load, and when signed out or offline, every key answers its registry default, so a
// screen behaves exactly as it did before the setting existed.

let values = {};
let businessId = '';
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

export const getAppSetting = (key) => (key in values ? values[key] : SETTINGS[key]?.default);
export const getAllAppSettings = () => values;
export const appSettingsBusiness = () => businessId;

/** Called by the loader and by the Settings screen after a save, so the rest of the app sees the change at once. */
export function setAppSettings(id, next) {
  if (businessId && id !== businessId) return;
  businessId = id;
  values = next || {};
  emit();
}
export function resetAppSettings() {
  businessId = '';
  values = {};
  emit();
}

export async function loadAppSettings() {
  const list = (await apiClient.get('/v1/businesses')).data || [];
  const biz = list.find((b) => b.isDefault) || list[0];
  if (!biz) return resetAppSettings();
  businessId = biz.id;
  const res = await apiClient.get(`/v1/settings?businessId=${biz.id}`);
  setAppSettings(biz.id, res.settings);
}

const subscribe = (l) => (listeners.add(l), () => listeners.delete(l));
export const useAppSetting = (key) => useSyncExternalStore(subscribe, () => getAppSetting(key), () => getAppSetting(key));
/** Every setting at once, for a screen that reads several. */
export const useAppSettings = () => useSyncExternalStore(subscribe, () => values, () => values);
