import { PLANNED_TABLES, SETTINGS, SETTINGS_TABS, SETTING_KEYS, keysOfTab } from '@ledgora/contracts';

// Vyapar parity P8-S1: what the Settings screen draws, worked out from the registry. Pure, so it is tested without a browser.

export const TAB_IDS = SETTINGS_TABS.map((t) => t.id);
export const isTabId = (id) => TAB_IDS.includes(id);

/** A tab's keys grouped by section, in the order the registry declares them. */
export function sectionsOf(tab) {
  const out = [];
  for (const key of keysOfTab(tab)) {
    const { section } = SETTINGS[key];
    let s = out.find((x) => x.title === section);
    if (!s) out.push((s = { title: section, keys: [] }));
    s.keys.push(key);
  }
  return out;
}

export const plannedOf = (tab) => PLANNED_TABLES.filter((p) => p.tab === tab);

/** The keys a tab shows on its page: the same list the test compares against the registry. */
export const keysShownOn = (tab) => sectionsOf(tab).flatMap((s) => s.keys);

const norm = (s) => String(s).toLowerCase();

/** Settings whose label, help, section or tab contain every word typed. Live ones first, so what you can change leads. */
export function searchSettings(query, limit = 20) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const tabLabel = Object.fromEntries(SETTINGS_TABS.map((t) => [t.id, t.label]));
  const hits = SETTING_KEYS.filter((key) => {
    const d = SETTINGS[key];
    const hay = norm(`${d.label} ${d.help} ${d.section} ${tabLabel[d.tab]}`);
    return words.every((w) => hay.includes(w));
  }).map((key) => ({ key, tab: SETTINGS[key].tab, label: SETTINGS[key].label, live: !!SETTINGS[key].live }));
  hits.sort((a, b) => Number(b.live) - Number(a.live));
  return hits.slice(0, limit);
}

/** The text on the badge of a key that is not built yet; the phase that will build it when known. */
export const comingSoonLabel = (key) => (SETTINGS[key].phase ? `Coming soon (${SETTINGS[key].phase})` : 'Coming soon');
