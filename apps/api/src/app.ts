import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { health } from '@ledgora/contracts';
import pkg from '../package.json' with { type: 'json' };
import { createAuth } from './auth/auth.ts';
import { consoleHtml } from './console.ts';
import { errorHandler, notFoundHandler } from './errors.ts';
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
import { utilitiesModule } from './modules/utilities.ts';
import { backupsModule } from './modules/backups.ts';
import { setupModule } from './modules/setup.ts';
import { reportsModule } from './modules/reports.ts';
import { recurringModule } from './modules/recurring.ts';
import { templatesModule } from './modules/templates.ts';
import { trashModule } from './modules/trash.ts';
import { transferModule } from './modules/transfer.ts';

const startedAt = Date.now();

export function createApp(base: Omit<Deps, 'auth'>) {
  const deps: Deps = { ...base, auth: createAuth(base.db, base.env) };
  const app = new Hono();
  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  applySecurity(app, deps.env);

  // Better Auth owns everything under /v1/auth: sign-up, sign-in, OTP, 2FA, password reset, Google.
  app.on(['GET', 'POST'], '/v1/auth/*', (c) => deps.auth.handler(c.req.raw));

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
    utilitiesModule,
    backupsModule,
    setupModule,
    recurringModule,
    templatesModule,
    filesModule,
    trashModule,
    transferModule,
  ])
    mod(reg);
  localFileEndpoints(app, deps);
  publicLinkEndpoints(app, deps);
  billingWebhook(app, deps);

  app.get('/v1/openapi.json', (c) => c.json(buildOpenApi(reg.documented, pkg.version)));
  app.get('/v1/docs', (c) => c.html(docsHtml));
  if (deps.env.NODE_ENV !== 'production') {
    app.get('/v1/console', (c) => c.html(consoleHtml));
    // Mail and SMS "sent" in development, so a sign-up can be finished without a mail provider.
    app.get('/v1/dev/outbox', (c) => c.json({ data: [...getOutbox()].reverse() }));
  }
  // Last: static files and the single-page fallback must not shadow any API route.
  serveWeb(app, deps.env);
  return app;
}
