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

First run of the smoke test: `pnpm --filter @ledgora/legacy-server exec playwright install firefox`.
The smoke test starts the server on throwaway folders, so it never touches `data/`.

## Layout

```
apps/
  web/            React 19 + Vite app (the product UI). Still JavaScript, migrated feature by feature in Phase 3.
  legacy-server/  The old single-user Express server that stores JSON files. Parked; replaced in Phase 1.
packages/
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
