// Vyapar parity P8-S1: the settings registry over HTTP. GET returns every key with its default merged; PATCH validates
// each key against packages/contracts/src/settings.ts. Owner-only keys are refused here for anyone who is not the owner,
// whatever the screen shows. Values live where the code that reads them already looks (the registry's `legacy` path
// inside business_settings.preferences), so the older readers keep working and a rollback loses nothing; the rest are
// rows in setting_values (settingsStore.ts).
import { and, count, eq, isNull } from 'drizzle-orm';
import { DEFAULT_ACCOUNT_ROLES } from '@ledgora/tax-engine';
import { schema } from '@ledgora/db';
import {
  SETTINGS,
  SETTING_FEATURE,
  planAllows,
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
import { planOfTx } from '../middleware/feature.ts';

const { invoices } = schema;

/**
 * Settings whose paid feature the plan lacks read as their default (what was saved stays and returns on upgrade), and
 * come back in `locked` so the screen can show an upgrade note.
 */
async function withPlan(tx: Parameters<typeof loadSettings>[0], businessId: string) {
  const [settings, eff] = await Promise.all([loadSettings(tx, businessId), planOfTx(tx)]);
  const locked: Record<string, string> = {};
  for (const [key, feature] of Object.entries(SETTING_FEATURE)) {
    if (planAllows(eff.plan, feature) || !(key in settings)) continue;
    locked[key] = feature;
    settings[key] = SETTINGS[key as SettingKey].default;
  }
  return { settings, locked };
}

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
      return withPlan(tx, query.businessId);
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

      // A paid setting can be switched off on any plan, but switched on only where the plan includes it.
      const eff = await planOfTx(tx);
      const needs = keys.filter((k) => {
        const feature = SETTING_FEATURE[k];
        return (
          feature &&
          !planAllows(eff.plan, feature) &&
          JSON.stringify(values[k]) !== JSON.stringify(SETTINGS[k].default)
        );
      });
      if (needs.length)
        throw new AppError(
          'payment_required',
          `Your ${eff.label} plan does not include ${needs.map((k) => SETTINGS[k].label).join(', ')}. Upgrade to use it.`,
          { feature: SETTING_FEATURE[needs[0]!], plan: eff.plan, keys: needs },
        );

      // Default accounts must be real accounts of this business, of the same kind as what they replace.
      const chosen = values['acct.defaultAccounts'] as Record<string, string> | undefined;
      if (chosen && Object.keys(chosen).length) {
        const rows = await tx
          .select({ code: schema.accounts.code, kind: schema.accounts.kind })
          .from(schema.accounts)
          .where(eq(schema.accounts.businessId, body.businessId));
        const kindOf = new Map(rows.map((r) => [r.code, r.kind]));
        const problems = Object.entries(chosen).flatMap(([role, code]) => {
          const def = DEFAULT_ACCOUNT_ROLES.find((r) => r.role === role);
          if (!def) return [{ path: `acct.defaultAccounts.${role}`, message: 'Unknown posting' }];
          if (!kindOf.size)
            return [
              { path: 'acct.defaultAccounts', message: 'Switch the ledger on first (Accounting)' },
            ];
          if (kindOf.get(code) !== def.kind)
            return [
              {
                path: `acct.defaultAccounts.${role}`,
                message: `${def.label} needs an ${def.kind} account`,
              },
            ];
          return [];
        });
        if (problems.length)
          throw new AppError('validation_failed', 'The request is not valid', problems);
      }

      const before = await loadSettings(tx, body.businessId);
      await writeSettings(tx, orgId, body.businessId, values);
      if (keys.length)
        await audit(tx, orgId, 'settings.change', 'business', body.businessId, {
          before: Object.fromEntries(keys.map((k) => [k, before[k]])),
          after: values,
        });
      return withPlan(tx, body.businessId);
    },
  });
}
