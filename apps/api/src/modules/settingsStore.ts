// Vyapar parity P8-S1: reading and writing registry settings. Keys the older code already reads stay where it reads them
// (the registry's `legacy` path inside business_settings.preferences); every other key is a row in setting_values.
// Screens and rules that obey a setting call `settingValue`, so the default lives in one place.
import { and, eq, isNull } from 'drizzle-orm';
import { schema, type Tx } from '@ledgora/db';
import { SETTINGS, SETTING_KEYS, type SettingKey, type SettingValue } from '@ledgora/contracts';

const { businessSettings, settingValues } = schema;

type Prefs = Record<string, unknown>;

const dig = (o: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Prefs)[k] : undefined), o);

/** A copy of `o` with `value` at `path`; `undefined` removes the key. */
export function put(o: Prefs, path: readonly string[], value: unknown): Prefs {
  const [head, ...rest] = path as [string, ...string[]];
  const copy = { ...o };
  if (!rest.length) {
    if (value === undefined) delete copy[head];
    else copy[head] = value;
    return copy;
  }
  const child = copy[head];
  copy[head] = put(child && typeof child === 'object' ? (child as Prefs) : {}, rest, value);
  return copy;
}

export async function loadPrefs(tx: Tx, businessId: string) {
  const [row] = await tx
    .select()
    .from(businessSettings)
    .where(eq(businessSettings.businessId, businessId));
  return { row, prefs: (row?.preferences ?? {}) as Prefs };
}

async function loadRows(tx: Tx, businessId: string) {
  const rows = await tx
    .select({ key: settingValues.key, value: settingValues.value })
    .from(settingValues)
    .where(and(eq(settingValues.businessId, businessId), isNull(settingValues.deletedAt)));
  return new Map(rows.map((r) => [r.key, r.value]));
}

/** Every key with its stored value, or the default when nothing valid is stored. */
export function mergeSettings(prefs: Prefs, rows: Map<string, unknown> = new Map()) {
  const out: Record<string, unknown> = {};
  for (const k of SETTING_KEYS) {
    const def = SETTINGS[k];
    const stored = def.legacy ? dig(prefs, def.legacy) : rows.get(k);
    // A stored value that no longer validates (older data, a hand edit) falls back to the default rather than breaking the screen.
    out[k] = stored !== undefined && def.type.safeParse(stored).success ? stored : def.default;
  }
  return out;
}

export async function loadSettings(tx: Tx, businessId: string) {
  const [{ prefs }, rows] = await Promise.all([
    loadPrefs(tx, businessId),
    loadRows(tx, businessId),
  ]);
  return mergeSettings(prefs, rows);
}

/** The value of one setting for a business (default when never changed). */
export async function settingValue<K extends SettingKey>(
  tx: Tx,
  businessId: string,
  key: K,
): Promise<SettingValue<K>> {
  const def = SETTINGS[key];
  const stored = def.legacy
    ? dig((await loadPrefs(tx, businessId)).prefs, def.legacy)
    : (await loadRows(tx, businessId)).get(key);
  return (
    stored !== undefined && def.type.safeParse(stored).success ? stored : def.default
  ) as SettingValue<K>;
}

/** Writes validated values; returns the preferences after, for the legacy keys. */
export async function writeSettings(
  tx: Tx,
  orgId: string,
  businessId: string,
  values: Partial<Record<SettingKey, unknown>>,
) {
  const keys = Object.keys(values) as SettingKey[];
  const { row, prefs } = await loadPrefs(tx, businessId);
  let next = prefs;
  for (const k of keys) {
    const { legacy } = SETTINGS[k];
    if (legacy) {
      next = put(next, legacy, values[k]);
      continue;
    }
    await tx
      .insert(settingValues)
      .values({ orgId, businessId, key: k, value: values[k] })
      .onConflictDoUpdate({
        target: [settingValues.orgId, settingValues.businessId, settingValues.key],
        set: { value: values[k], updatedAt: new Date(), deletedAt: null },
      });
  }
  if (next !== prefs) {
    if (row)
      await tx
        .update(businessSettings)
        .set({ preferences: next, updatedAt: new Date() })
        .where(eq(businessSettings.id, row.id));
    else await tx.insert(businessSettings).values({ orgId, businessId, preferences: next });
  }
}
