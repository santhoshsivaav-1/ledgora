import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '@ledgora/db';
import { createApp } from '../src/app.ts';
import { loadEnv } from '../src/env.ts';
import { createStorage } from '../src/storage.ts';

// The API serves the built web app too (change 3.23): one process, one origin.
const dist = mkdtempSync(path.join(tmpdir(), 'ledgora-dist-'));
mkdirSync(path.join(dist, 'assets'));
writeFileSync(
  path.join(dist, 'index.html'),
  '<!doctype html><title>Ledgora</title><div id="root"></div>',
);
writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL!,
  WEB_DIST_DIR: dist,
  PORT: '5050',
});
const { db, close } = createDb(env.DATABASE_URL, { max: 2 });
const app = createApp({ db, env, storage: createStorage(env) });
afterAll(() => close());

describe('serving the web app', () => {
  it('uses the host PORT when API_LISTEN_PORT is not set', () => {
    expect(env.API_LISTEN_PORT).toBe(5050);
  });
  it('opens the app at / and at any app path (a copied link), with a policy that lets the app run', async () => {
    for (const p of ['/', '/clients', '/accept-invite/abc']) {
      const res = await app.request(p);
      expect(res.status, p).toBe(200);
      expect(await res.text()).toContain('<div id="root">');
      const csp = res.headers.get('content-security-policy')!;
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(res.headers.get('cache-control')).toBe('no-cache');
    }
  });
  it('serves build files with long caching, and keeps API paths as JSON', async () => {
    const asset = await app.request('/assets/app-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    const missing = await app.request('/v1/nope');
    expect(missing.status).toBe(404);
    expect((await missing.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'not_found' },
    });
    expect(missing.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect((await app.request('/health')).status).toBe(200);
    expect((await app.request('/v1/me')).status).toBe(401);
  });
});
