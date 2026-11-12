// Vyapar parity P8-S1: the settings registry over HTTP. GET returns every key with its default merged; PATCH validates
// each key against packages/contracts/src/settings.ts. Owner-only keys are refused here for anyone who is not the owner,
// whatever the screen shows. Values live where the code that reads them already looks (the registry's `legacy` path
// inside business_settings.preferences), so the older readers keep working and a rollback loses nothing; the rest are
// rows in setting_values (settingsStore.ts).
import { and, count, eq, isNull } from 'drizzle-orm';
import { schema } from '@ledgora/db';
import {
  SETTINGS,
  gstinUsageResponse,
  parseSettingsPatch,
  settingsPatch,
  settingsQuery,
  settingsResponse,
  type SettingKey,
} from '@ledgora/contracts';
import { audit } from '../audit.ts';
import { AppError } from '../errors.ts';
import type { Registrar } from '../http.ts';
import { loadBusiness } from './businesses.ts';
import { loadSettings, writeSettings } from './settingsStore.ts';

const { invoices } = schema;

export function settingsModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/settings/gstin-usage',
    tag: 'Settings',
    summary: 'How many invoices carry the business GSTIN',
    query: settingsQuery,
    response: gstinUsageResponse,
    handler: async ({ tx, query }) => {
      const biz = await loadBusiness(tx, query.businessId);
      const [row] = await tx
        .select({ n: count() })
        .from(invoices)
        .where(and(eq(invoices.businessId, query.businessId), isNull(invoices.deletedAt)));
      return { gstin: biz.gstin ?? null, invoices: row?.n ?? 0 };
    },
  });

  route({
    method: 'get',
    path: '/v1/settings',
    tag: 'Settings',
    summary: 'Every setting of a business with defaults merged',
    query: settingsQuery,
    response: settingsResponse,
    handler: async ({ tx, query }) => {
      await loadBusiness(tx, query.businessId);
      return { settings: await loadSettings(tx, query.businessId) };
    },
  });

  route({
    method: 'patch',
    path: '/v1/settings',
    tag: 'Settings',
    summary: 'Change some settings; unknown keys, bad values and owner-only keys are refused',
    body: settingsPatch,
    response: settingsResponse,
    handler: async ({ tx, orgId, auth, body }) => {
      await loadBusiness(tx, body.businessId);
      const { values, errors } = parseSettingsPatch(body.values);
      if (errors.length)
        throw new AppError(
          'validation_failed',
          'The request is not valid',
          errors.map((e) => ({ path: e.key, message: e.message })),
        );
      const keys = Object.keys(values) as SettingKey[];
      const locked = keys.filter((k) => 'ownerOnly' in SETTINGS[k] && SETTINGS[k].ownerOnly);
      if (locked.length && auth.role !== 'owner')
        throw new AppError('forbidden', 'Only the owner can change this setting', {
          keys: locked,
        });

      const before = await loadSettings(tx, body.businessId);
      await writeSettings(tx, orgId, body.businessId, values);
      if (keys.length)
        await audit(tx, orgId, 'settings.change', 'business', body.businessId, {
          before: Object.fromEntries(keys.map((k) => [k, before[k]])),
          after: values,
        });
      return { settings: await loadSettings(tx, body.businessId) };
    },
  });
}
