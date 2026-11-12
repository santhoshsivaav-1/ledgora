import { useSyncExternalStore } from 'react';
import { getAppSetting, useAppSetting } from '../lib/appSettings';
import { CATALOGS, LANGS } from './catalog';

// P11-S6: t(key, english) answers the text in the language in use, or the English given. The language is this
// browser's choice when set (the sign-in screen has a picker, before any business is known), else the business's
// Settings > General > App language.
const KEY = 'ledgora_lang';
const listeners = new Set();
const readLocal = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
let local = typeof window !== 'undefined' ? readLocal() : '';

export { LANGS };
export const isLang = (l) => LANGS.some((x) => x.id === l);
export const currentLang = () => (isLang(local) ? local : isLang(getAppSetting('ui.lang')) ? getAppSetting('ui.lang') : 'en');

export function setLocalLang(lang) {
  local = isLang(lang) ? lang : '';
  try { if (local) localStorage.setItem(KEY, local); else localStorage.removeItem(KEY); } catch { /* private window */ }
  if (typeof document !== 'undefined') document.documentElement.lang = currentLang();
  listeners.forEach((l) => l());
}

/** The text of `key` in `lang` (default: the language in use), else `english`. */
export function t(key, english, lang = currentLang()) {
  if (lang === 'en') return english;
  return CATALOGS[lang]?.[key] ?? english;
}

const subscribe = (l) => (listeners.add(l), () => listeners.delete(l));
/** Re-renders on a language change; returns t bound to the language in use. */
export function useT() {
  const biz = useAppSetting('ui.lang');
  const mine = useSyncExternalStore(subscribe, () => local, () => local);
  const lang = isLang(mine) ? mine : isLang(biz) ? biz : 'en';
  return (key, english) => t(key, english, lang);
}
export const useLang = () => {
  const biz = useAppSetting('ui.lang');
  const mine = useSyncExternalStore(subscribe, () => local, () => local);
  return isLang(mine) ? mine : isLang(biz) ? biz : 'en';
};
