import { useSyncExternalStore } from 'react';

// The `ui.vyapar` flag (Vyapar parity, Phase 0): which shell and palette this person sees. A per-person preference
// kept in localStorage like dark mode; the build default comes from VITE_UI_VYAPAR so a deploy can turn it on for
// everyone without touching anyone's saved choice. Off means the classic app, exactly as before.
//
// Brand (decision D-01): the new layout keeps Ledgora green for the primary button; data-brand="vyapar" swaps in
// the red one. Both live in styles/tokens.css.

const UI_KEY = 'ledgora_ui';
const BRAND_KEY = 'ledgora_brand';

export type UiMode = 'classic' | 'vyapar';
export type Brand = 'ledgora' | 'vyapar';

const buildDefault = (): UiMode => (import.meta.env?.VITE_UI_VYAPAR === 'true' ? 'vyapar' : 'classic');

// Holds a choice made in a private window, where localStorage throws.
const memory = new Map<string, string>();

const read = (key: string) => {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
};

export function getUiMode(): UiMode {
  const saved = read(UI_KEY);
  return saved === 'vyapar' || saved === 'classic' ? saved : buildDefault();
}

export const isVyaparUi = () => getUiMode() === 'vyapar';

export function getBrand(): Brand {
  return read(BRAND_KEY) === 'vyapar' ? 'vyapar' : 'ledgora';
}

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Puts the current mode and brand on <html>, where the token files look for them. */
export function applyUiAttributes() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (isVyaparUi()) root.setAttribute('data-ui', 'vyapar');
  else root.removeAttribute('data-ui');
  root.setAttribute('data-brand', getBrand());
}

function write(key: string, value: string) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private window: the choice lasts until reload */
  }
  applyUiAttributes();
  listeners.forEach((fn) => fn());
}

export const setUiMode = (mode: UiMode) => write(UI_KEY, mode);
export const setBrand = (brand: Brand) => write(BRAND_KEY, brand);

/** The current mode; components re-render when it is switched. */
export const useUiMode = () => useSyncExternalStore(subscribe, getUiMode, buildDefault);
export const useBrand = () => useSyncExternalStore(subscribe, getBrand, () => 'ledgora' as Brand);
