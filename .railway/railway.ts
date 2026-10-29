// Railway Infrastructure as Code for this monorepo.
//
// The whole project — Postgres and ONE service — is described here. That service is the API, which also serves the
// built web app (apps/web/dist), so there is no separate front door and no data volume: all data is in Postgres. Plan and apply with
// the Railway CLI:
//
//   railway login && railway link
//   railway config plan       preview exactly what would change
//   railway config apply      create EVERYTHING (database included) — no dashboard clicking
//
// Afterwards: every push to the linked branch still deploys normally; the
// file only needs re-applying when you change the project topology.
// (The `railway` npm package is installed as a devDependency so the CLI
// can evaluate this file; `pnpm install` is all the setup needed.)
//
// Two values to fill in before `plan`:
//   1. GITHUB_REPO — owner/repo of the fork or clone on GitHub.
//   2. WEB_DOMAIN  — the public domain name for the app. If you let Railway
//      generate one you apply WITHOUT it first (see the placeholder below),
//      copy the generated domain here, and re-plan/apply once more.
import { defineRailway, github, postgres, preserve, project, service } from 'railway/iac';

const GITHUB_REPO = 'your-github-user/Free-GST-Billing-Software';

// Deploy once with *any* placeholder, copy the Railway-generated domain
// (service → Networking → Public domain), come back and set the real one.
const WEB_DOMAIN = 'SET-AFTER-FIRST-DEPLOY.up.railway.app';

export default defineRailway(() => {
  // Managed Postgres. DATABASE_URL is never written by hand; Railway wires
  // a private connection string into the service and runs daily backups.
  const db = postgres('postgres');

  // One public service: the API (Hono) plus the web app it serves. One origin means the session cookie, the pages and
  // /v1 all agree, with nothing to proxy.
  const app = service('ledgora', {
    source: github(GITHUB_REPO),
    // Builds the web app into apps/web/dist, which the API then serves.
    build: 'pnpm install --frozen-lockfile && pnpm --filter @ledgora/web build',
    // Node runs the TypeScript directly (engines: >=22.18.0 pin in package.json). Railway sets PORT; the API reads it.
    start: 'node apps/api/src/server.ts',
    // Migrations run against the live DATABASE_URL before the deployment swaps
    // in — a failing migration stops the deploy instead of booting a broken app.
    preDeploy: 'pnpm --filter @ledgora/db migrate',
    healthcheck: '/health',
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      NODE_ENV: 'production',
      APP_URL: `https://${WEB_DOMAIN}`,
      API_URL: `https://${WEB_DOMAIN}`,
      ALLOWED_ORIGINS: `https://${WEB_DOMAIN}`,
      TRUST_PROXY: 'true',
      // Secrets: set once in the dashboard (Variables), the file keeps them.
      AUTH_SECRET: preserve(),
      FILE_SIGNING_SECRET: preserve(),
      RESEND_API_KEY: preserve(),
      MAIL_FROM: preserve(),
      // Optional: set in the dashboard to turn these on.
      GOOGLE_CLIENT_ID: preserve(),
      GOOGLE_CLIENT_SECRET: preserve(),
      MSG91_AUTH_KEY: preserve(),
      MSG91_TEMPLATE_ID: preserve(),
    },
  });

  return project('ledgora', {
    resources: [db, app],
  });
});
