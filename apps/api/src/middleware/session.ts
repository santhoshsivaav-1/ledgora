import type { Context } from 'hono';
import type { Auth } from '../auth/auth.ts';
import type { AppEnv } from '../env.ts';
import { AppError } from '../errors.ts';
import type { AuthContext, SessionUser } from './context.ts';

/** The caller's address, for rate limits and the audit log. X-Forwarded-For counts only when TRUST_PROXY is on. */
export function clientIp(c: Context, env: AppEnv): string | null {
  if (env.TRUST_PROXY) {
    // A proxy APPENDS the address it saw, so the left-most entries are whatever the caller wrote. Count from the right,
    // skipping only the proxies we run (TRUST_PROXY_HOPS, default 1), or a forged header would dodge every rate limit.
    const hops = env.TRUST_PROXY_HOPS;
    const chain = (c.req.header('x-forwarded-for') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const fwd = chain.length >= hops ? chain[chain.length - hops] : chain[0];
    if (fwd) return fwd;
    const real = c.req.header('x-real-ip');
    if (real) return real;
  }
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming;
  return incoming?.socket?.remoteAddress ?? null;
}

// Every request used to re-read the session and user from the database (2 round trips). The answer is kept for a few
// seconds per cookie, and dropped whenever anything under /v1/auth writes (sign-out, switching organization, 2FA).
const sessions = new Map<
  string,
  { at: number; found: Awaited<ReturnType<Auth['api']['getSession']>> }
>();
export const forgetSessions = () => sessions.clear();

/** First link of the chain (change 2.7): the request must carry a valid session cookie. */
export async function requireSession(c: Context, auth: Auth, env: AppEnv): Promise<AuthContext> {
  const key = c.req.header('cookie') ?? c.req.header('authorization') ?? '';
  const hit = key ? sessions.get(key) : undefined;
  let found: Awaited<ReturnType<Auth['api']['getSession']>>;
  if (hit && Date.now() - hit.at < env.AUTH_CACHE_MS) found = hit.found;
  else {
    found = await auth.api.getSession({ headers: c.req.raw.headers });
    if (key && found && env.AUTH_CACHE_MS > 0) {
      if (sessions.size > 2000) sessions.clear();
      sessions.set(key, { at: Date.now(), found });
    } else if (key) sessions.delete(key);
  }
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
