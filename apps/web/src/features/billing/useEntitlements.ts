import { useSession } from '../auth/SessionContext';
import { roleCan, type Permission } from '../../lib/permissions';
import { FEATURES } from '@ledgora/contracts';

const PAID_FEATURES = new Set<string>(FEATURES.map((f) => f.id));

/**
 * What the signed-in member can do in this organization (change 3.22): their role's permissions, and, from change 4.4,
 * the features their plan includes. Until billing exists every feature is available, so `hasFeature` is true; screens
 * can already ask, and the day plans arrive only this file changes.
 */
/** Features sold as add-ons (change 3.18). Everything else is part of every plan. */
export const ADD_ONS = new Set(['income-tax']);
/** An add-on is available while the plan is on trial or paid up; Razorpay billing (Phase 4) adds the per-add-on switch. */
const ADD_ON_STATUSES = new Set(['trialing', 'active']);

export function useEntitlements() {
  const { me } = useSession();
  const role = me?.role as string | undefined;
  return {
    role,
    plan: me?.subscription?.plan ?? null,
    planStatus: me?.subscription?.status ?? null,
    can: (permission: Permission) => roleCan(role, permission),
    // SaaS plans: the server's entitlements decide (a live trial has everything). Older servers send none: the add-on rule.
    hasFeature: (feature: string) => {
      const ent = (me as { entitlements?: { features: string[] } } | null)?.entitlements;
      if (ent) return !PAID_FEATURES.has(feature) || ent.features.includes(feature);
      return !ADD_ONS.has(feature) || ADD_ON_STATUSES.has(me?.subscription?.status ?? 'trialing');
    },
    entitlements: (me as { entitlements?: unknown } | null)?.entitlements ?? null,
    /** null = every business of the organization. */
    businessIds: (me?.businessIds as string[] | null | undefined) ?? null,
  };
}
