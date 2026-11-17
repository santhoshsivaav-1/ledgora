import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { sql } from 'drizzle-orm';
import { health } from '@ledgora/contracts';
import pkg from '../package.json' with { type: 'json' };
import { createAuth } from './auth/auth.ts';
import { consoleHtml } from './console.ts';
import { errorHandler, notFoundHandler } from './errors.ts';
import { forgetSessions } from './middleware/session.ts';
import { forgetMembers } from './middleware/org.ts';
import { getOutbox } from './mail/index.ts';
import { applySecurity } from './security.ts';
import { serveWeb } from './web.ts';
import { accountModule } from './modules/account.ts';
import { membersModule } from './modules/members.ts';
import { onboardingModule } from './modules/onboarding/routes.ts';
import { workspaceModule } from './modules/workspace/routes.ts';
import { createRegistrar, type Deps } from './http.ts';
import { buildOpenApi, docsHtml } from './openapi.ts';
import { businessesModule } from './modules/businesses.ts';
import { filesModule, localFileEndpoints } from './modules/files.ts';
import { invoicesModule } from './modules/invoices.ts';
import { itemsModule } from './modules/items.ts';
import { lotsModule } from './modules/lots.ts';
import { godownsModule } from './modules/godowns.ts';
import { catalogModule } from './modules/catalog.ts';
import { partiesModule } from './modules/parties.ts';
import { partyGroupsModule } from './modules/partyGroups.ts';
import { paymentsModule } from './modules/payments.ts';
import { staffModule } from './modules/staff.ts';
import { purchasesModule } from './modules/purchases.ts';
import { purchaseOrdersModule } from './modules/purchaseOrders.ts';
import { ledgerModule } from './modules/ledger.ts';
import { verifyModule } from './modules/verify.ts';
import { cashbankModule } from './modules/cashbank.ts';
import { chequesModule } from './modules/cheques.ts';
import { loansModule } from './modules/loans.ts';
import { ifscModule } from './modules/ifsc.ts';
import { posModule } from './modules/pos.ts';
import { settingsModule } from './modules/settings.ts';
import { publicLinkEndpoints } from './publicLink.ts';
import { messagingModule } from './modules/messaging.ts';
import { billingModule, billingWebhook } from './modules/billing.ts';
import { privacyModule } from './modules/privacy.ts';
import { platformModule } from './modules/platform.ts';
import { tdsDeductorModule } from './modules/tdsDeductor.ts';
import { gspModule } from './modules/gsp.ts';
import { rolesModule } from './modules/roles.ts';
import { utilitiesModule } from './modules/utilities.ts';
import { backupsModule } from './modules/backups.ts';
import { setupModule } from './modules/setup.ts';
import { reportsModule } from './modules/reports.ts';
import { recurringModule } from './modules/recurring.ts';
import { templatesModule } from './modules/templates.ts';
import { trashModule } from './modules/trash.ts';
import { transferModule } from './modules/transfer.ts';
import { filingModule } from './modules/filing.ts';
import { editLogModule } from './modules/editLog.ts';
import { incomeTaxModule } from './modules/incomeTax.ts';
import { assetsModule } from './modules/assets.ts';
import { bootstrapModule } from './modules/bootstrap.ts';

const startedAt = Date.now();

export function createApp(base: Omit<Deps, 'auth'>) {
  const deps: Deps = { ...base, auth: createAuth(base.db, base.env) };
  const app = new Hono();
  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  applySecurity(app, deps.env);
  // How long the API took, on every answer (Server-Timing shows in the browser's network panel), and a log line for the slow
  // ones, so a slow screen can be traced to its call in minutes.
  app.use('/v1/*', async (c, next) => {
    const t0 = performance.now();
    await next();
    const ms = performance.now() - t0;
    c.header('Server-Timing', `app;dur=${ms.toFixed(1)}`);
    const limit = deps.env.SLOW_REQUEST_MS;
    if (limit > 0 && ms > limit)
      console.warn(`[slow] ${c.req.method} ${c.req.path} ${Math.round(ms)}ms`);
  });

  // v1.10.81 — gzip the JSON answers above 1 KB (hono's compress middleware;
  // it skips already-encoded, streamed and no-transform responses on its own).
  // Invoice/report list payloads run into hundreds of KB raw; on the Railway
  // free plan's link that was seconds per screen load on phones. The filter
  // keeps uploads/downloads (octet-stream, already-compressed formats) and
  // files out of the compressor, so the shared CPU pays nothing for them.
  app.use('/v1/*', compress({ contentTypeFilter: (type) => type.startsWith('application/json') }));

  // Better Auth owns everything under /v1/auth: sign-up, sign-in, OTP, 2FA, password reset, Google.
  app.on(['GET', 'POST'], '/v1/auth/*', async (c) => {
    const res = await deps.auth.handler(c.req.raw);
    if (c.req.method !== 'GET') forgetSessions();
    return res;
  });
  // Any write may change a role, a member or a business assignment: drop the short-lived member cache with it.
  app.use('/v1/*', async (c, next) => {
    await next();
    if (c.req.method !== 'GET') forgetMembers();
  });

  const reg = createRegistrar(app, deps);
  const { route } = reg;

  route({
    method: 'get',
    path: '/health',
    tag: 'System',
    summary: 'Is the API up, and can it reach the database',
    response: health,
    access: 'public',
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
    accountModule,
    membersModule,
    onboardingModule,
    workspaceModule,
    businessesModule,
    partiesModule,
    partyGroupsModule,
    lotsModule,
    godownsModule,
    catalogModule,
    itemsModule,
    invoicesModule,
    paymentsModule,
    staffModule,
    purchasesModule,
    purchaseOrdersModule,
    ledgerModule,
    verifyModule,
    cashbankModule,
    chequesModule,
    loansModule,
    ifscModule,
    reportsModule,
    posModule,
    settingsModule,
    messagingModule,
    billingModule,
    privacyModule,
    platformModule,
    tdsDeductorModule,
    gspModule,
    rolesModule,
    utilitiesModule,
    backupsModule,
    setupModule,
    recurringModule,
    templatesModule,
    filesModule,
    trashModule,
    transferModule,
    filingModule,
    editLogModule,
    incomeTaxModule,
    assetsModule,
    bootstrapModule,
  ])
    mod(reg);
  localFileEndpoints(app, deps);
  publicLinkEndpoints(app, deps);
  billingWebhook(app, deps);

  // The API reference loads Swagger from a CDN into the app's own origin and lists every route: development only.
  if (deps.env.NODE_ENV !== 'production') {
    app.get('/v1/openapi.json', (c) => c.json(buildOpenApi(reg.documented, pkg.version)));
    app.get('/v1/docs', (c) => c.html(docsHtml));
    app.get('/v1/console', (c) => c.html(consoleHtml));
    // Mail and SMS "sent" in development, so a sign-up can be finished without a mail provider.
    app.get('/v1/dev/outbox', (c) => c.json({ data: [...getOutbox()].reverse() }));
  }
  // Last: static files and the single-page fallback must not shadow any API route.
  serveWeb(app, deps.env);
  return app;
}
