import { describe, expect, it } from 'vitest';
import {
  PLANNED_TABLES,
  SETTINGS,
  SETTINGS_TABS,
  SETTING_KEYS,
  keysOfTab,
  parseSettingsPatch,
  type SettingKey,
} from './settings.ts';

describe('settings registry', () => {
  it('puts every key on exactly one of the 11 tabs', () => {
    expect(SETTINGS_TABS).toHaveLength(11);
    const ids = new Set<string>(SETTINGS_TABS.map((t) => t.id));
    const seen = new Map<string, string>();
    for (const tab of SETTINGS_TABS)
      for (const k of keysOfTab(tab.id)) {
        expect(seen.get(k), `${k} is on two tabs`).toBeUndefined();
        seen.set(k, tab.id);
      }
    for (const k of SETTING_KEYS) {
      expect(ids.has(SETTINGS[k].tab), `${k} names an unknown tab`).toBe(true);
      expect(seen.get(k), `${k} is on no tab`).toBe(SETTINGS[k].tab);
    }
    expect(seen.size).toBe(SETTING_KEYS.length);
  });

  it('gives every tab something to show: a key or a planned table', () => {
    for (const t of SETTINGS_TABS)
      expect(
        keysOfTab(t.id).length + PLANNED_TABLES.filter((p) => p.tab === t.id).length,
        t.id,
      ).toBeGreaterThan(0);
  });

  it('has a default that passes its own validator, and a label and help for each key', () => {
    for (const k of SETTING_KEYS) {
      const d = SETTINGS[k];
      expect(d.type.safeParse(d.default).success, `${k} default`).toBe(true);
      expect(d.label.length, k).toBeGreaterThan(0);
      expect(d.help.length, k).toBeGreaterThan(0);
    }
  });

  it('lists options only for select and radio, and the default is one of them', () => {
    for (const k of SETTING_KEYS) {
      const d = SETTINGS[k] as {
        control: string;
        options?: { value: unknown }[];
        default: unknown;
      };
      if (d.control === 'select' || d.control === 'radio') {
        expect(d.options?.length, k).toBeGreaterThan(0);
        expect(
          d.options!.some((o) => String(o.value) === String(d.default)),
          `${k} default is not an option`,
        ).toBe(true);
      } else expect(d.options, k).toBeUndefined();
    }
  });

  it('keeps legacy storage only on live keys, and never twice on one path', () => {
    const paths = new Set<string>();
    for (const k of SETTING_KEYS) {
      const d = SETTINGS[k];
      if (!d.legacy) continue;
      expect(d.live, `${k} has a legacy path but is not live`).toBe(true);
      const p = d.legacy.join('.');
      expect(paths.has(p), `${p} used twice`).toBe(false);
      paths.add(p);
    }
  });

  it('marks the owner-only keys the blueprint names', () => {
    for (const k of [
      'txn.lockBefore',
      'txn.showProfit',
      'acct.enabled',
      'gst.regType',
      'gst.enabled',
    ] as SettingKey[])
      expect(SETTINGS[k].ownerOnly, k).toBe(true);
  });
});

describe('parseSettingsPatch', () => {
  it('accepts live keys with valid values', () => {
    const r = parseSettingsPatch({ 'txn.negativeStock': 'block', 'txn.lockBefore': '2026-03-31' });
    expect(r.errors).toEqual([]);
    expect(r.values).toEqual({ 'txn.negativeStock': 'block', 'txn.lockBefore': '2026-03-31' });
  });
  it('accepts null to clear the lock date', () => {
    expect(parseSettingsPatch({ 'txn.lockBefore': null }).errors).toEqual([]);
  });
  it('rejects unknown keys', () => {
    expect(parseSettingsPatch({ 'nope.nothing': 1 }).errors).toEqual([
      { key: 'nope.nothing', message: 'Unknown setting' },
    ]);
  });
  it('rejects invalid values with the key on the error', () => {
    const r = parseSettingsPatch({ 'txn.negativeStock': 'maybe', 'txn.lockBefore': '31/03/2026' });
    expect(r.errors.map((e) => e.key).sort()).toEqual(['txn.lockBefore', 'txn.negativeStock']);
    expect(r.values).toEqual({});
  });
  it('refuses keys that are not live yet instead of storing something nothing reads', () => {
    const r = parseSettingsPatch({ 'txn.quickEntry': true });
    expect(r.errors[0]?.key).toBe('txn.quickEntry');
    expect(r.errors[0]?.message).toMatch(/coming soon/i);
    expect(r.values).toEqual({});
  });
});
