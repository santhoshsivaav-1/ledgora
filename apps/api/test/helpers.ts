import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDb, seed } from '@ledgora/db';
import { createApp } from '../src/app.ts';
import { loadEnv } from '../src/env.ts';
import { createStorage } from '../src/storage.ts';

const url = () => {
  const u = process.env.TEST_DATABASE_URL;
  if (!u) throw new Error('TEST_DATABASE_URL is set by test/global-setup.ts');
  return u;
};

export function makeHarness() {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: url(),
    LOCAL_FILES_DIR: mkdtempSync(path.join(tmpdir(), 'ledgora-files-')),
    API_LISTEN_PORT: '4999',
  });
  const { db, sql, close } = createDb(url(), { max: 12 });
  const app = createApp({ db, env, storage: createStorage(env) });

  /** A new organization with one business, and a client bound to it. */
  async function newTenant() {
    const orgId = randomUUID();
    const { businessId } = await seed(db, orgId);
    const call = async <T = any>(
      method: string,
      p: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) => {
      const res = await app.request(p, {
        method,
        headers: {
          'x-org-id': orgId,
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
      return { status: res.status, body: json as T, text };
    };
    return { orgId, businessId, call };
  }
  return { env, db, sql, app, close, newTenant };
}
export type Tenant = Awaited<ReturnType<ReturnType<typeof makeHarness>['newTenant']>>;

export const line = (over: Record<string, unknown> = {}) => ({
  name: 'Widget',
  quantity: 2,
  rate: 100,
  taxPercent: 18,
  ...over,
});
