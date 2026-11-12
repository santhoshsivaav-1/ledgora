import { describe, expect, it } from 'vitest';
import { PLANNED_TABLES, SETTINGS, SETTINGS_TABS, SETTING_KEYS } from '@ledgora/contracts';
import { TAB_IDS, comingSoonLabel, keysShownOn, plannedOf, searchSettings, sectionsOf } from '../src/features/settings/registry/model';
import { viewFromPath, pathForView } from '../src/app/router';

// Vyapar parity P8-S1: what the Settings screen is built from.

describe('settings screen model', () => {
  it('renders every registry key on exactly one tab page', () => {
    const shown = TAB_IDS.flatMap((t) => keysShownOn(t));
    expect(shown.length).toBe(new Set(shown).size);
    expect([...shown].sort()).toEqual([...SETTING_KEYS].sort());
  });

  it('has 11 tabs and no tab page is empty', () => {
    expect(TAB_IDS).toHaveLength(11);
    for (const t of TAB_IDS) expect(sectionsOf(t).length + plannedOf(t).length, t).toBeGreaterThan(0);
  });

  it('badges every key that is not live, so none is silently inert', () => {
    for (const k of SETTING_KEYS) {
      if (SETTINGS[k].live) continue;
      expect(comingSoonLabel(k)).toMatch(/^Coming soon/);
    }
  });

  it('gives each tab a deep link the router knows', () => {
    for (const { id } of SETTINGS_TABS) {
      expect(viewFromPath(`/settings/${id}`)).toBe(`settings-${id}`);
      expect(pathForView(`settings-${id}`)).toBe(`/settings/${id}`);
    }
    // The pages from before Phase 8 still answer, for rollback.
    expect(viewFromPath('/settings/business')).toBe('settings-business');
  });
});

describe('cards that point elsewhere', () => {
  it('every link on a settings tab opens a screen the router knows', () => {
    for (const p of PLANNED_TABLES.filter((x) => x.href)) expect(viewFromPath(p.href.split('?')[0]), p.title).not.toBe('dashboard');
  });
  it('the reminder rules a business can edit are live, so none of them is an inert toggle', () => {
    for (const k of SETTING_KEYS.filter((k) => k.startsWith('reminder.') || k === 'party.reminder' || k === 'msg.enabled' || k === 'visits.retentionDays'))
      expect(SETTINGS[k].live, k).toBe(true);
  });
});

describe('settings search', () => {
  it('finds a row by label, by help text, and by tab name', () => {
    expect(searchSettings('negative stock')[0].key).toBe('txn.negativeStock');
    expect(searchSettings('scanner input').some((h) => h.key === 'txn.barcodeScan')).toBe(true);
    expect(searchSettings('multi currency').every((h) => SETTINGS[h.key].tab === 'currency' || /currency/i.test(SETTINGS[h.key].label + SETTINGS[h.key].help))).toBe(true);
  });
  it('finds every key by its own label', () => {
    for (const k of SETTING_KEYS) expect(searchSettings(SETTINGS[k].label, 200).some((h) => h.key === k), k).toBe(true);
  });
  it('needs every word, ignores case, and lists live settings first', () => {
    expect(searchSettings('ZZZ nothing')).toEqual([]);
    expect(searchSettings('')).toEqual([]);
    const hits = searchSettings('stock');
    expect(hits[0].live).toBe(true);
  });
});
