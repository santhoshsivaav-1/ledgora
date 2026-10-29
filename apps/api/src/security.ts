import type { Context, Hono, MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from './env.ts';
import { AppError } from './errors.ts';
import { clientIp } from './middleware/session.ts';

// Change 2.11: security headers, a CORS allow-list for the app's own domains, rate limits, and CSRF protection.

export const allowedOrigins = (env: AppEnv) =>
  [
    env.APP_URL,
    env.API_URL ?? `http://localhost:${env.API_LISTEN_PORT}`,
    ...env.ALLOWED_ORIGINS.split(','),
  ]
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);

// ---- rate limits -----------------------------------------------------------------------------------------------------

interface Bucket {
  name: string;
  match: (method: string, path: string) => boolean;
  windowMs: number;
  max: number;
}

/** In-memory fixed windows, per caller address. One process only: a shared Redis store replaces Map when the API scales out. */
export function createRateLimiter(env: AppEnv, now: () => number = Date.now) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const buckets: Bucket[] = [
    {
      name: 'otp',
      match: (_m, p) =>
        p === '/v1/auth/phone-number/send-otp' ||
        p === '/v1/auth/phone-number/request-password-reset',
      windowMs: 10 * 60_000,
      max: env.RATE_LIMIT_OTP_PER_10MIN,
    },
    {
      name: 'login',
      match: (_m, p) =>
        /^\/v1\/auth\/(sign-in|sign-up|two-factor\/verify|phone-number\/verify|request-password-reset|reset-password|forget-password)/.test(
          p,
        ),
      windowMs: 60_000,
      max: env.RATE_LIMIT_LOGIN_PER_MIN,
    },
    {
      name: 'api',
      match: (_m, p) => p.startsWith('/v1/'),
      windowMs: 60_000,
      max: env.RATE_LIMIT_API_PER_MIN,
    },
  ];
  return {
    /** Returns seconds to wait when the caller is over a limit, else 0. */
    check(method: string, path: string, caller: string): number {
      const t = now();
      for (const b of buckets) {
        if (!b.match(method, path)) continue;
        const key = `${b.name}:${caller}`;
        const cur = hits.get(key);
        if (!cur || cur.resetAt <= t) hits.set(key, { count: 1, resetAt: t + b.windowMs });
        else if (++cur.count > b.max) return Math.ceil((cur.resetAt - t) / 1000);
        // The first bucket that matches is the strictest; a request counts against every bucket that matches it.
      }
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
      return 0;
    },
  };
}

const rateLimit = (env: AppEnv): MiddlewareHandler => {
  const limiter = createRateLimiter(env);
  return async (c, next) => {
    if (!env.RATE_LIMIT_ENABLED) return next();
    const wait = limiter.check(c.req.method, c.req.path, clientIp(c, env) ?? 'unknown');
    if (wait > 0) {
      c.header('retry-after', String(wait));
      throw new AppError('too_many_requests', `Too many requests. Try again in ${wait} seconds.`);
    }
    return next();
  };
};

// ---- CSRF ------------------------------------------------------------------------------------------------------------

/**
 * Sessions live in cookies, so a page on another site could make the browser send them. Session cookies are
 * SameSite=Lax (Better Auth's default), which already blocks most of that; this closes the rest: a state-changing
 * request that carries cookies must come from an allowed origin (Origin, or Referer when Origin is absent).
 */
const csrf = (env: AppEnv): MiddlewareHandler => {
  const allowed = new Set(allowedOrigins(env));
  return async (c, next) => {
    const m = c.req.method;
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS' || !c.req.header('cookie')) return next();
    const origin = c.req.header('origin') ?? safeOrigin(c.req.header('referer'));
    if (origin && !allowed.has(origin))
      throw new AppError('forbidden', 'This request came from an origin that is not allowed');
    if (!origin && c.req.header('sec-fetch-site') === 'cross-site')
      throw new AppError('forbidden', 'Cross-site request blocked');
    return next();
  };
};
const safeOrigin = (url?: string) => {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
};

const PAGE_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'";

export function applySecurity(app: Hono, env: AppEnv) {
  const origins = allowedOrigins(env);
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: undefined,
      crossOriginResourcePolicy: 'same-site',
      strictTransportSecurity:
        env.NODE_ENV === 'production' ? 'max-age=31536000; includeSubDomains' : false,
    }),
  );
  app.use('*', async (c: Context, next) => {
    await next();
    const page = c.req.path === '/v1/docs' || c.req.path === '/v1/console';
    c.header(
      'content-security-policy',
      page ? PAGE_CSP : "default-src 'none'; frame-ancestors 'none'",
    );
    c.header('cache-control', 'no-store');
  });
  app.use(
    '*',
    cors({
      origin: (o) => (origins.includes(o) ? o : null),
      credentials: true,
      allowHeaders: ['content-type', 'x-org-id'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    }),
  );
  app.use('/v1/*', rateLimit(env));
  app.use('/v1/*', csrf(env));
}
