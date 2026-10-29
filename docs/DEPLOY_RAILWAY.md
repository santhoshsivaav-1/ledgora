# Deploy Ledgora on Railway

One service plus Postgres:

```
┌─ Railway project ─────────────────────────────────────────┐
│  Postgres (managed)  ◄── migrations run before each deploy │
│        ▲                                                   │
│  ledgora (PUBLIC domain *.up.railway.app)                  │
│    = the API (Hono) that also serves the built web app     │
│    · /            the web app (any app path opens it)      │
│    · /v1/*        the API                                  │
│    · /health      health check                             │
└────────────────────────────────────────────────────────────┘
```

One public origin is what makes sign-in work: the session cookie lives on your `*.up.railway.app` domain, and the
pages and `/v1` come from the same server. All data, including invoices, is in Postgres. There is no volume and no
second service.

## 1. Prerequisites

- A GitHub account with this repository pushed to it.
- A free **Resend** account (resend.com): sign-up and invitation e-mails must really arrive. Create an API key.
- Node 22.18+ and pnpm 9.15 (pinned in `package.json`).

## 2. With the Railway CLI (recommended)

1. `pnpm install`, then edit two constants at the top of `.railway/railway.ts`: `GITHUB_REPO` (`owner/repo`) and
   leave `WEB_DOMAIN` as the placeholder for now.
2. `npm i -g @railway/cli`, then `railway login` and `railway link`.
3. `railway config plan` previews what will be created (Postgres and the `ledgora` service); `railway config apply` creates it
   and starts the first deploy.
4. In the dashboard, set the secrets on the `ledgora` service (Variables): `AUTH_SECRET` and `FILE_SIGNING_SECRET`
   (`openssl rand -base64 32` for each), `RESEND_API_KEY`, `MAIL_FROM` (a sender on a domain you verified in Resend).
5. Open the service's **Networking → Generate Domain**, copy the domain into `WEB_DOMAIN` in `.railway/railway.ts`,
   then `railway config plan && railway config apply` once more so `APP_URL`, `API_URL` and `ALLOWED_ORIGINS` use it.
6. Every push to the linked branch redeploys. Re-apply only when the topology changes.

## 3. By hand in the dashboard

1. **New Project → Deploy from GitHub repo**, pick the repository. Name the service `ledgora`.
2. **+ Create → Database → PostgreSQL**.
3. Service **Settings**:

| Setting | Value |
|---|---|
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @ledgora/web build` |
| Pre-deploy command | `pnpm --filter @ledgora/db migrate` |
| Start command | `node apps/api/src/server.ts` |
| Healthcheck path | `/health` |
| Networking | Generate a public domain |

4. **Variables** on the `ledgora` service:

| Name | Value |
|---|---|
| `DATABASE_URL` | `{{Postgres.DATABASE_URL}}` |
| `NODE_ENV` | `production` |
| `APP_URL`, `API_URL`, `ALLOWED_ORIGINS` | `https://<your-domain>.up.railway.app` |
| `TRUST_PROXY` | `true` (Railway is a proxy; without it rate limits and the audit log see the proxy address) |
| `AUTH_SECRET`, `FILE_SIGNING_SECRET` | `openssl rand -base64 32` each |
| `RESEND_API_KEY`, `MAIL_FROM` | your Resend key and a verified sender |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional: Google sign-in |
| `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` | optional: phone codes by SMS |

Railway sets `PORT`; the API listens on it. The API refuses to start in production if `AUTH_SECRET` or
`FILE_SIGNING_SECRET` is left at its development default.

## 4. First deploy: what you should see

1. The pre-deploy step prints "Migrations applied.".
2. The service log shows `Ledgora API on http://localhost:<port>`.
3. `https://<your-domain>/health` answers `{"status":"ok","db":true,...}`.
4. `https://<your-domain>/` shows the sign-in screen. Create an account, open the confirmation e-mail, and the business
   form follows.

## 5. Backups

All data is in Postgres. Turn on Railway's Postgres backups (paid plans) or point `DATABASE_URL` at a managed
Postgres with point-in-time recovery (Neon, RDS, Supabase), and test a restore before launch. The in-app Export
(Settings, Data) gives each user a JSON copy of their own workspace.
