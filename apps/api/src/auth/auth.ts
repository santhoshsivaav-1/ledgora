import { createHash, randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { and, asc, eq } from 'drizzle-orm';
import { schema, type Database } from '@ledgora/db';
import type { AppEnv } from '../env.ts';
import { isRealEmail, sendMail, sendSms } from '../mail/index.ts';
import { newDeviceAlert } from '../mail/templates.ts';
import { onboardNewUser } from '../modules/onboarding/service.ts';
import { deviceLabel } from './device.ts';
import { emailAuth } from './email.ts';
import { googleAuth } from './google.ts';
import { organizationPlugin } from './organization.ts';
import { phonePlugin } from './phone.ts';
import { twoFactorPlugin } from './twoFactor.ts';

export function createAuth(db: Database, env: AppEnv) {
  const baseURL = env.API_URL ?? `http://localhost:${env.API_LISTEN_PORT}`;
  const {
    user,
    session,
    account,
    verification,
    twoFactor: twoFactorTable,
    member,
    invitation,
    organizations,
  } = schema;

  return betterAuth({
    baseURL,
    basePath: '/v1/auth',
    secret: env.AUTH_SECRET,
    appName: 'Ledgora',
    trustedOrigins: [env.APP_URL, baseURL, ...env.ALLOWED_ORIGINS.split(',').filter(Boolean)],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user,
        session,
        account,
        verification,
        twoFactor: twoFactorTable,
        member,
        invitation,
        organization: organizations,
      },
    }),
    advanced: {
      // Row ids are UUID strings everywhere, so an organization id can double as the tenant key.
      database: { generateId: () => randomUUID() },
      useSecureCookies: env.NODE_ENV === 'production',
      ipAddress: { ipAddressHeaders: env.TRUST_PROXY ? ['x-forwarded-for', 'x-real-ip'] : [] },
    },
    session: {
      expiresIn: env.SESSION_DAYS * 86_400,
      updateAge: 86_400,
      cookieCache: { enabled: false },
    },
    // security.ts owns rate limiting so one set of rules covers Better Auth and the rest of the API.
    rateLimit: { enabled: false },

    ...emailAuth(env),
    ...googleAuth(env),

    plugins: [phonePlugin(env), twoFactorPlugin(), organizationPlugin()],

    databaseHooks: {
      user: {
        create: {
          // E-mail confirmation is switched off for now: every new account counts as verified.
          before: async (u) => ({ data: { ...u, emailVerified: true } }),
          // 2.6: workspace, first business and trial exist before the first session does.
          after: async (u) => void (await onboardNewUser(db, u)),
        },
      },
      session: {
        create: {
          before: async (s) => {
            const [m] = await db
              .select({ orgId: member.organizationId })
              .from(member)
              .where(eq(member.userId, s.userId))
              .orderBy(asc(member.createdAt))
              .limit(1);
            return { data: { ...s, activeOrganizationId: m?.orgId ?? null } };
          },
          after: async (s) => {
            // 2.12: a sign-in from a browser/phone we have not seen before sends an alert (never for the very first one).
            const fingerprint = createHash('sha256')
              .update(s.userAgent ?? 'unknown')
              .digest('hex')
              .slice(0, 32);
            const label = deviceLabel(s.userAgent);
            const known = await db
              .select({ fp: schema.userDevices.fingerprint })
              .from(schema.userDevices)
              .where(eq(schema.userDevices.userId, s.userId));
            if (known.some((k) => k.fp === fingerprint)) {
              await db
                .update(schema.userDevices)
                .set({ lastSeenAt: new Date() })
                .where(
                  and(
                    eq(schema.userDevices.userId, s.userId),
                    eq(schema.userDevices.fingerprint, fingerprint),
                  ),
                );
              return;
            }
            await db.insert(schema.userDevices).values({ userId: s.userId, fingerprint, label });
            if (known.length === 0) return;
            const [u] = await db.select().from(user).where(eq(user.id, s.userId));
            if (u && isRealEmail(u.email))
              await sendMail(env, newDeviceAlert(u.email, u.name, label, new Date().toUTCString()));
            else if (u?.phoneNumber)
              await sendSms(env, {
                to: u.phoneNumber,
                text: `New Ledgora sign-in from ${label}. If this was not you, log out everywhere.`,
              });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
