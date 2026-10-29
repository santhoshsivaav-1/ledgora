# Development guide

How the repository is laid out after Phase 0 and how to run it. This file is for developers; the
user-facing guide is `USER_GUIDE.md`.

## Requirements

- Node 22.18 or newer (`.nvmrc` pins 24 for CI). Node runs the TypeScript packages directly, no build step.
- pnpm 9.15 (`corepack enable` picks the right version from `package.json`).
- Docker, only for the local Postgres / Redis / Mailpit services (Phase 1 onwards).

## Everyday commands

Run from the repository root.

| Command                              | What it does                                                                |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `pnpm install`                       | Install every workspace                                                     |
| `pnpm dev`                           | Start the legacy server (port 47371) and the Vite app (http://localhost:5173) |
| `pnpm test`                          | Vitest for `packages/tax-engine` and `apps/web`                             |
| `pnpm typecheck`                     | `tsc --noEmit` in every workspace                                           |
| `pnpm lint`                          | ESLint for the whole repo                                                   |
| `pnpm format:check` / `pnpm format`  | Prettier (new code only, see `.prettierignore`)                             |
| `pnpm build`                         | Production build of the web app into `apps/web/dist`                        |
| `pnpm test:smoke`                    | Browser smoke test of the legacy app (needs Firefox, see below)             |
| `docker compose up -d`               | Postgres 16, Redis 7 and Mailpit on 127.0.0.1                               |
| `pnpm db:migrate` / `pnpm db:seed`   | Apply SQL migrations / create the demo organization (needs Postgres)        |
| `pnpm --filter @ledgora/api dev`     | The new API on http://localhost:4000 (docs at `/v1/docs`)                   |
| `pnpm db:generate`                   | After editing `packages/db/src/schema`, write the next migration file       |

First run of the smoke test: `pnpm --filter @ledgora/legacy-server exec playwright install firefox`.
The smoke test starts the server on throwaway folders, so it never touches `data/`.

## Layout

```
apps/
  web/            React 19 + Vite app (the product UI). Still JavaScript, migrated feature by feature in Phase 3.
  legacy-server/  The old single-user Express server that stores JSON files. Parked until the web app switches over (end of Phase 3).
  api/            Multi-tenant REST API (Hono + Postgres). One folder per module under src/modules.
packages/
  db/             Drizzle schema, SQL migrations (incl. row-level security), withTenant(), seed.
  contracts/      Zod schemas shared by the API and the web app; request and response types come from here.
  tax-engine/     Pure GST / invoice maths in TypeScript. No I/O, no React, no browser APIs.
  config/         Shared tsconfig and Prettier presets.
docs/             Product and developer documentation (this file, LEGAL.md, USER_GUIDE.md, ...).
docs-site/        Generator for the public help site.
data/ "Saved Invoices"/ Trash/   Runtime data of the legacy app. Git-ignored. Never commit these.
```

`apps/web/src/utils.js` re-exports `@ledgora/tax-engine`, so existing `import ... from './utils'` lines
keep working. New code should import from `@ledgora/tax-engine` directly.

## Working on the tax engine

`packages/tax-engine/src` is consumed as source (no build): Vite, Vitest and Node all load the `.ts` files.
Rules that keep that working:

- Relative imports end in `.ts` (`import { r2 } from './money.ts'`).
- Erasable TypeScript only: no `enum`, no constructor parameter properties (`erasableSyntaxOnly` enforces it).
- No I/O and no browser globals. Anything environmental (for example the business's custom units, kept in
  `localStorage` in the web app) is passed in as an argument.
- Invoices, parties and profiles are typed `Rec` (a loose record) for now. They get exact types from the Zod
  contracts in change 1.13.

## Feature flags

| Flag                    | Default | Effect                                                              |
| ----------------------- | ------- | ------------------------------------------------------------------- |
| `VITE_ENABLE_BILL_SCAN` | `false` | Shows Purchases > "Import from image (OCR)". Needs OCR work (6.10). |

## Environment

Copy `.env.example` to `.env`. Values marked "Planned" are not read by any code yet.

## Branches and commits

Work on a branch, open a pull request, let CI pass. A Husky pre-commit hook formats and lints staged
TypeScript, JSON, Markdown and YAML files. Direct pushes to `main` should be blocked in the repository
settings (see `docs/LEGAL.md` for the other owner actions).

## The API (Phase 1)

First run, from the repository root:

```
docker compose up -d          # Postgres on 127.0.0.1:5432 (user ledgora, password ledgora)
cp .env.example .env
pnpm db:migrate && pnpm db:seed
pnpm --filter @ledgora/api dev
```

Without Docker, any Postgres 16 works: create a role `ledgora` with `CREATEROLE` and a database `ledgora`, and
point `DATABASE_URL` at it. The migration role needs `CREATEROLE` once, to create `app_user` (migration 0001).

- **See it:** open http://localhost:4000/v1/docs (Swagger UI, pre-signed in as the demo organization), or
  `curl localhost:4000/health`.
- **Who is calling:** login arrives in Phase 2. Until then every request names its organization in the
  `x-org-id` header (`DEV_ORG_ID` in `.env` is the fallback). A production process refuses this.
- **Tenant safety:** each request runs in one transaction as the `app_user` role with
  `app.org_id` set, and every table has a forced `tenant_isolation` policy. Never query with a plain
  connection in request code; use `withTenant()` (the route helper does this for you).
- **Errors** are always `{ "error": { "code", "message", "details?" } }`; codes are listed in
  `packages/contracts/src/common.ts`. **Lists** use cursor pagination (`limit`, `cursor`, `q`).
- **Tests:** `pnpm --filter @ledgora/api test` needs the Postgres above. They create their own database
  (`ledgora_test`) and their own organizations, so they never touch your data.
- **Files:** with no `S3_*` variables the API stores uploads under `apps/api/.local-files` and signs the URLs
  itself. Set `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (and `S3_ENDPOINT` for R2) to use object storage.

### Backups

The file-copy backups of the legacy app are gone from the new API (change 1.25). Use the managed Postgres
provider's point-in-time recovery (Neon, RDS, Supabase and Cloud SQL all offer it) and test a restore before launch.
The full export (`POST /v1/export`) is a convenience copy for users, not a disaster-recovery tool.
