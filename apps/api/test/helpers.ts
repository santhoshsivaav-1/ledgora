import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDb } from '@ledgora/db';
import { createApp } from '../src/app.ts';
import { loadEnv } from '../src/env.ts';
import { createStorage } from '../src/storage.ts';

const url = () => {
  const u = process.env.TEST_DATABASE_URL;
  if (!u) throw new Error('TEST_DATABASE_URL is set by test/global-setup.ts');
  return u;
};

export interface HarnessOptions {
  env?: Record<string, string>;
}

export function makeHarness(opts: HarnessOptions = {}) {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: url(),
    LOCAL_FILES_DIR: mkdtempSync(path.join(tmpdir(), 'ledgora-files-')),
    API_LISTEN_PORT: '4999',
    // Most tests are about billing, not sign-up: no mail round trip, no throttling. auth.test.ts turns both back on.
    REQUIRE_EMAIL_VERIFICATION: 'false',
    RATE_LIMIT_ENABLED: 'false',
    ...opts.env,
  });
  const { db, sql, close } = createDb(url(), { max: 12 });
  const app = createApp({ db, env, storage: createStorage(env) });

  /** A caller bound to one session cookie. */
  const client =
    (cookie: string, extra: Record<string, string> = {}) =>
    async <T = any>(
      method: string,
      p: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) => {
      const res = await app.request(p, {
        method,
        headers: {
          ...(cookie ? { cookie } : {}),
          ...extra,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* not json */
      }
      return { status: res.status, body: json as T, text, headers: res.headers };
    };

  const cookieOf = (res: Response) =>
    res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .filter((c) => !c.endsWith('='))
      .join('; ');

  async function signUp(
    email = `u${randomUUID().slice(0, 8)}@example.com`,
    password = 'correct-horse-9',
    name = 'Test User',
    ua = 'vitest/1.0',
  ) {
    const res = await app.request('/v1/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': ua },
      body: JSON.stringify({ name, email, password }),
    });
    return { res, email, password, cookie: cookieOf(res) };
  }

  /** A new user with a new organization (the sign-up hook makes the org, business and trial). */
  async function newTenant() {
    const { email, password, cookie } = await signUp();
    const call = client(cookie);
    const me = (await call('GET', '/v1/me')).body;
    const businessId = (await call('GET', '/v1/businesses')).body.data[0].id as string;
    // Tax splits need the seller's state; the sign-up business starts blank until the setup wizard fills it.
    await call('PATCH', `/v1/businesses/${businessId}`, { state: 'Tamil Nadu' });
    return {
      orgId: me.organization.id as string,
      businessId,
      userId: me.user.id as string,
      email,
      password,
      cookie,
      call,
    };
  }

  /** Another person in the same organization with a chosen role, optionally limited to some businesses. */
  async function addMember(t: { orgId: string }, role: string, businessIds: string[] = []) {
    const { cookie } = await signUp();
    const call = client(cookie);
    const me = (await call('GET', '/v1/me')).body;
    const memberId = randomUUID();
    await sql`insert into member (id, organization_id, user_id, role) values (${memberId}, ${t.orgId}, ${me.user.id}, ${role})`;
    if (businessIds.length) {
      const { withTenant, schema } = await import('@ledgora/db');
      await withTenant(db, t.orgId, (tx) =>
        tx
          .insert(schema.memberBusinesses)
          .values(businessIds.map((businessId) => ({ orgId: t.orgId, memberId, businessId }))),
      );
    }
    await sql`update session set active_organization_id = ${t.orgId} where user_id = ${me.user.id}`;
    return { call, cookie, userId: me.user.id as string, memberId };
  }
  return { env, db, sql, app, close, newTenant, signUp, client, addMember, cookieOf };
}
export type Tenant = Awaited<ReturnType<ReturnType<typeof makeHarness>['newTenant']>>;

export const line = (over: Record<string, unknown> = {}) => ({
  name: 'Widget',
  quantity: 2,
  rate: 100,
  taxPercent: 18,
  ...over,
});
