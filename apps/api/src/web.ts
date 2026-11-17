import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Context, Hono } from 'hono';
import type { AppEnv } from './env.ts';
import { notFoundHandler } from './errors.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The built web app: WEB_DIST_DIR, else apps/web/dist next to this package. null when it has not been built. */
export function webDistDir(env: AppEnv) {
  const dir = path.resolve(env.WEB_DIST_DIR ?? path.join(HERE, '..', '..', 'web', 'dist'));
  return existsSync(path.join(dir, 'index.html')) ? dir : null;
}

/**
 * Serves the web app from the same process as the API (change 3.23, the legacy server's old job): one public origin,
 * so the session cookie, the pages and /v1 all share it. Any path that is not an API path falls back to index.html,
 * so a copied /clients or /accept-invite/... link opens the app.
 */
export function serveWeb(app: Hono, env: AppEnv) {
  const dir = webDistDir(env);
  if (!dir) return false;
  const root = path.relative(process.cwd(), dir) || '.';
  // Read on each request: it is small, and a rebuilt app (new file names) is picked up without a restart.
  const index = () => readFileSync(path.join(dir, 'index.html'), 'utf8');
  // Search engines: the public pages are indexed, the signed-in app and the API are not. The addresses are absolute, from APP_URL.
  const site = env.APP_URL.replace(/\/+$/, '');
  const PUBLIC = [
    '/',
    '/pricing',
    '/security',
    '/switch',
    '/switch/vyapar',
    '/switch/tally',
    '/switch/zoho',
    '/contact',
    '/privacy',
    '/terms',
    '/login',
    '/signup',
  ];
  app.get('/robots.txt', (c) =>
    c.text(`User-agent: *\nAllow: /\nDisallow: /v1/\nSitemap: ${site}/sitemap.xml\n`),
  );
  app.get('/sitemap.xml', (c) =>
    c.body(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PUBLIC.map((p) => `  <url><loc>${site}${p}</loc></url>`).join('\n')}\n</urlset>\n`,
      200,
      { 'content-type': 'application/xml; charset=utf-8' },
    ),
  );
  const isApi = (p: string) => p.startsWith('/v1/') || p === '/health';
  // v1.10.81 — precompressed lets serveStatic hand out the `.br` / `.gz` twins the web build
  // writes next to every text file (scripts/compress-dist.mjs) with `Content-Encoding`.
  // Without it every first visit and every pre-SW reload re-downloaded the whole bundle
  // uncompressed — the reported "first load is so slow" on the Railway free plan. The
  // twins exist per-file, so nothing is compressed at request time (no CPU on the host).
  app.use('/*', async (c, next) =>
    isApi(c.req.path) ? next() : serveStatic({ root, precompressed: true })(c, next),
  );
  // The SPA fallback (paths like /clients that fell through serveStatic) served a raw index.html;
  // hand out its compressed twin on the same terms when the browser accepts one. The twins are
  // rebuilt with every deploy, so no staleness beyond what the build itself just made.
  const fallbackIndex = (c: Context) => {
    const accept = c.req.header('accept-encoding') || '';
    for (const [ext, encoding] of [
      ['.br', 'br'],
      ['.gz', 'gzip'],
    ] as const) {
      if (!accept.includes(encoding)) continue;
      try {
        const twin = readFileSync(path.join(dir, `index.html${ext}`));
        c.header('content-encoding', encoding);
        c.header('vary', 'accept-encoding', { append: true });
        return c.body(new Uint8Array(twin), 200, { 'content-type': 'text/html; charset=utf-8' });
      } catch {
        /* no twin — fall through to the raw file */
      }
    }
    return c.html(index());
  };
  app.get('*', (c) => (isApi(c.req.path) ? notFoundHandler(c) : fallbackIndex(c)));
  return true;
}
