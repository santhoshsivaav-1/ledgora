import type { AppEnv } from '../env.ts';

/** Google sign-in (change 2.3): on only when both GOOGLE_CLIENT_* values are set. */
export const googleAuth = (env: AppEnv) => ({
  socialProviders:
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {},
  account: { accountLinking: { enabled: true, trustedProviders: ['google'] } },
});
