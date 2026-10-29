import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';
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
  const isApi = (p: string) => p.startsWith('/v1/') || p === '/health';
  app.use('/*', async (c, next) => (isApi(c.req.path) ? next() : serveStatic({ root })(c, next)));
  app.get('*', (c) => (isApi(c.req.path) ? notFoundHandler(c) : c.html(index())));
  return true;
}
