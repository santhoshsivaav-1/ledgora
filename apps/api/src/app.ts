import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sql } from 'drizzle-orm';
import { health } from '@ledgora/contracts';
import pkg from '../package.json' with { type: 'json' };
import { errorHandler, notFoundHandler } from './errors.ts';
import { createRegistrar, type Deps } from './http.ts';
import { buildOpenApi, docsHtml } from './openapi.ts';
import { businessesModule } from './modules/businesses.ts';
import { filesModule, localFileEndpoints } from './modules/files.ts';
import { invoicesModule } from './modules/invoices.ts';
import { itemsModule } from './modules/items.ts';
import { partiesModule } from './modules/parties.ts';
import { paymentsModule } from './modules/payments.ts';
import { purchasesModule } from './modules/purchases.ts';
import { recurringModule } from './modules/recurring.ts';
import { templatesModule } from './modules/templates.ts';
import { trashModule } from './modules/trash.ts';
import { transferModule } from './modules/transfer.ts';

const startedAt = Date.now();

export function createApp(deps: Deps) {
  const app = new Hono();
  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  app.use(
    '*',
    cors({
      origin: [deps.env.APP_URL],
      allowHeaders: ['content-type', 'x-org-id', 'authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    }),
  );
  app.use('*', async (c, next) => {
    await next();
    c.header('x-content-type-options', 'nosniff');
    c.header('cache-control', 'no-store');
  });

  const reg = createRegistrar(app, deps);
  const { route } = reg;

  route({
    method: 'get',
    path: '/health',
    tag: 'System',
    summary: 'Is the API up, and can it reach the database',
    response: health,
    tenant: false,
    handler: async ({ tx, c }) => {
      let db = false;
      try {
        await tx.execute(sql`select 1`);
        db = true;
      } catch {
        /* reported below */
      }
      const body = {
        status: db ? ('ok' as const) : ('degraded' as const),
        db,
        version: pkg.version,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      };
      return c.json(body, db ? 200 : 503);
    },
  });

  for (const mod of [
    businessesModule,
    partiesModule,
    itemsModule,
    invoicesModule,
    paymentsModule,
    purchasesModule,
    recurringModule,
    templatesModule,
    filesModule,
    trashModule,
    transferModule,
  ])
    mod(reg);
  localFileEndpoints(app, deps);

  app.get('/v1/openapi.json', (c) => c.json(buildOpenApi(reg.documented, pkg.version)));
  app.get('/v1/docs', (c) => c.html(docsHtml));
  return app;
}
