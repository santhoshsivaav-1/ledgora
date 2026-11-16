// One call that answers what the app needs to draw its first screen: who the person is, whether the business is set up, their
// saved screen preferences and the businesses. Before this the browser asked for each in turn (three round trips, then the
// shell asked for more); on a slow host that was most of the wait.
import { z } from 'zod';
import { business, me as meSchema, onboardingStatus } from '@ledgora/contracts';
import type { Registrar } from '../http.ts';
import { buildMe } from './account.ts';
import { listBusinessesOf } from './businesses.ts';
import { onboardingStatusOf } from './onboarding/routes.ts';
import { getKv } from './workspace/store.ts';

export function bootstrapModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/bootstrap',
    tag: 'Account',
    summary:
      'Everything the app needs to start in one answer: me, onboarding, my screen preferences and the businesses (the same values as GET /v1/me, /v1/onboarding, /v1/workspace/local-prefs and /v1/businesses)',
    permission: null,
    response: z.object({
      me: meSchema,
      onboarding: onboardingStatus,
      prefs: z.record(z.string(), z.string()),
      businesses: z.array(business),
    }),
    handler: async ({ tx, auth, deps }) => {
      const [me, onboarding, prefs, businesses] = await Promise.all([
        buildMe(deps, auth),
        onboardingStatusOf(tx),
        getKv<Record<string, string>>(tx, `prefs:${auth.user.id}`),
        listBusinessesOf(tx),
      ]);
      return { me, onboarding, prefs: prefs ?? {}, businesses };
    },
  });
}
