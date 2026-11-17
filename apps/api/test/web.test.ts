import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { brotliCompressSync, gzipSync } from 'node:zlib';
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
// v1.10.81 — the web build writes Brotli/gzip twins next to every text file
// (apps/web/scripts/compress-dist.mjs) and serveStatic hands them out with
// precompressed: true, so a first visit downloads ~a quarter of the bytes on
// hosts that do not compress at the edge (Railway's free plan among them).
const appJs = 'console.log(1)';
writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), appJs);
writeFileSync(
  path.join(dist, 'assets', 'app-abc123.js.br'),
  brotliCompressSync(Buffer.from(appJs)),
);
writeFileSync(path.join(dist, 'assets', 'app-abc123.js.gz'), gzipSync(Buffer.from(appJs)));
writeFileSync(
  path.join(dist, 'index.html.br'),
  brotliCompressSync(Buffer.from('<!doctype html><title>Ledgora</title><div id="root"></div>')),
);
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

  // v1.10.81 — the precompressed twins: the bytes on the wire shrink with no
  // request-time CPU, and the SPA fallback joins in for accepted encodings.
  // v1.10.81 — the precompressed twins: the bytes on the wire shrink with no
  // request-time CPU, and the SPA fallback joins in for accepted encodings.
  it('hands out the brotli/gzip twins a browser accepts, the raw file otherwise', async () => {
    const twin = (p: string) => readFileSync(path.join(dist, p));
    const bytes = async (r: Response) => Buffer.from(await r.arrayBuffer());
    const br = await app.request('/assets/app-abc123.js', {
      headers: { 'accept-encoding': 'br,gzip' },
    });
    expect(br.headers.get('content-encoding')).toBe('br');
    expect((await bytes(br)).equals(twin('assets/app-abc123.js.br'))).toBe(true);
    const gz = await app.request('/assets/app-abc123.js', {
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(gz.headers.get('content-encoding')).toBe('gzip');
    expect((await bytes(gz)).equals(twin('assets/app-abc123.js.gz'))).toBe(true);
    const raw = await app.request('/assets/app-abc123.js', {
      headers: { 'accept-encoding': 'identity' },
    });
    expect(raw.headers.get('content-encoding')).toBeNull();
    expect((await bytes(raw)).toString()).toBe(appJs);
    const spa = await app.request('/clients', { headers: { 'accept-encoding': 'br' } });
    expect(spa.headers.get('content-encoding')).toBe('br');
    expect((await bytes(spa)).equals(twin('index.html.br'))).toBe(true);
    const fallbackRaw = await app.request('/clients', {
      headers: { 'accept-encoding': 'identity' },
    });
    expect(fallbackRaw.headers.get('content-encoding')).toBeNull();
    expect((await fallbackRaw.text()).includes('<div id="root">')).toBe(true);
  });

  it('publishes robots.txt and a sitemap of the public pages, with absolute addresses', async () => {
    const robots = await app.request('/robots.txt');
    const txt = await robots.text();
    expect(txt).toContain('Disallow: /v1/');
    expect(txt).toMatch(/Sitemap: https?:\/\//);
    const map = await (await app.request('/sitemap.xml')).text();
    expect(map).toContain('/pricing</loc>');
    expect(map).toContain('/switch/vyapar</loc>');
    expect(map).not.toContain('/v1/');
    expect(map).toMatch(/<loc>https?:\/\//);
  });
});
