import type { Context } from 'hono';
import type { Auth } from '../auth/auth.ts';
import type { AppEnv } from '../env.ts';
import { AppError } from '../errors.ts';
import type { AuthContext, SessionUser } from './context.ts';

/** The caller's address, for rate limits and the audit log. X-Forwarded-For counts only when TRUST_PROXY is on. */
export function clientIp(c: Context, env: AppEnv): string | null {
  if (env.TRUST_PROXY) {
    const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip');
    if (fwd) return fwd;
  }
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming;
  return incoming?.socket?.remoteAddress ?? null;
}

/** First link of the chain (change 2.7): the request must carry a valid session cookie. */
export async function requireSession(c: Context, auth: Auth, env: AppEnv): Promise<AuthContext> {
  const found = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!found) throw new AppError('unauthorized', 'Sign in required');
  const u = found.user as unknown as SessionUser;
  return {
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      phoneNumber: u.phoneNumber ?? null,
      emailVerified: !!u.emailVerified,
      phoneNumberVerified: !!u.phoneNumberVerified,
      twoFactorEnabled: !!u.twoFactorEnabled,
    },
    sessionId: found.session.id,
    activeOrganizationId:
      (found.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null,
    ip: clientIp(c, env),
  };
}
