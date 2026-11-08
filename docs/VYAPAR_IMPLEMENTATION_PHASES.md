# Vyapar-Parity: Phase-by-Phase Implementation Guide (for Claude)

> Companion to [`VYAPAR_PARITY_BLUEPRINT.md`](./VYAPAR_PARITY_BLUEPRINT.md).
> The blueprint says **what** to build and **why**. This guide says **in what order, in what files, with which fields, flows, wireframes, tests and acceptance checks**, so that Claude (or any developer) can pick up one phase and finish it without guessing.
>
> Status: planning document, written 2026-11-06 against Ledgora 1.10.80 (commit `e49739f`).
> Audience: Claude Code sessions working in this repository, plus the human reviewing them.

---

## How to use this guide

1. Read **Part A** (operating rules) once. It applies to every phase.
2. Pick the next phase from the **phase map** (A.4). Never start a phase whose prerequisites are not merged.
3. Inside a phase, work **slice by slice** (`P1-S1`, `P1-S2`, …). A slice is one shippable pull request.
4. For every slice follow the **slice recipe** (A.3): contracts, migration with RLS, API module, data layer, screen, tests, docs.
5. Finish a slice only when its **acceptance checklist** is green and the **definition of done** (A.6) holds.
6. Use the **Claude prompt** at the end of each phase as the opening message of a session. It names the files, the order and the stop conditions.

Legend, same as the blueprint: ✅ exists · 🟡 partial · 🆕 new · ⚠️ unverified Vyapar detail, confirm before building.

### Table of contents

| Part | Content |
|---|---|
| **A** | Operating rules, repository map, slice recipe, phase map, conventions, definition of done |
| **Phase 0** | UI foundation: tokens (U0), shell (U1), component library (U2) |
| **Phase 1** | Masters: Parties, Items, Categories, Units, Import wizards |
| **Phase 2** | Sale enhancements: inline payments, salesman, additional charges, credit limit, Payment In upgrade |
| **Phase 3** | Purchase side: Payment Out, Purchase Order, Purchase Return, Other Income, expense items |
| **Phase 4** | Ledger foundation: accounts, ledger entries, posting engine, backfill, Verify My Data |
| **Phase 5** | Cash & Bank: bank accounts, cash in hand, transfers, cheques, loans |
| **Phase 6** | Reports: ReportShell, hub, all 45+ report definitions |
| **Phase 7** | Utilities: barcode, bulk update, Tally export, Close FY, backup |
| **Phase 8** | Settings: 11 tabs |
| **Phase 9** | Grow your business: reminders, messages, salesman tracking, service reminders, multi-currency |
| **Phase 10** | Compliance polish: Table 11 advances, RCM, 3B 4(B), e-invoice, TDS ledger, ITR-3 map |
| **Phase 11** | Hardening, performance, accessibility, release |
| **Reference R1–R13** | Journeys, state machines, table columns, RLS templates, sample payloads, seed data, slice tracker, extra wireframes, UI-state matrix, copy deck, keyboard map |
| **Appendices** | Permission keys, API catalogue, migration map, error catalogue, test matrix, use-case catalogue, glossary |

---

# PART A: Operating rules for Claude

## A.1 What the repository looks like (verified 2026-11-06)

```text
Free-GST-Billing-Software-main/
├─ apps/
│  ├─ web/            React 19 + Vite PWA
│  │  └─ src/
│  │     ├─ app/               AppShell.jsx Sidebar.jsx TopBar.jsx CommandPalette.jsx router.tsx providers.tsx
│  │     ├─ components/ui/     Can.tsx ConfirmModal.jsx PageHeader.jsx States.jsx Toast.jsx LockedFeature.jsx …
│  │     ├─ features/<area>/   auth billing dashboard expenses gst-returns import-export income-tax invoices
│  │     │                     items onboarding parties payments print purchases recurring reports sales settings
│  │     ├─ lib/               apiClient.ts queryClient.ts permissions.ts  +  lib/data/*.js (one file per kind of data)
│  │     ├─ styles/            tokens.css analytics.css auth.css   (+ index.css, 3.5k lines)
│  │     └─ utils.js           re-exports @ledgora/tax-engine
│  └─ api/            Hono + Postgres, one folder/file per module in src/modules (parties.ts items.ts invoices.ts
│                      payments.ts purchases.ts recurring.ts trash.ts transfer.ts files.ts …)
├─ packages/
│  ├─ db/             Drizzle schema in src/schema/*.ts, SQL migrations in migrations/0000…0007, withTenant(), seed
│  ├─ contracts/      Zod schemas shared by API and web (parties.ts items.ts invoices.ts payments.ts permissions.ts …)
│  ├─ tax-engine/     Pure TS: totals.ts lineTax.ts stock.ts outstanding.ts payments.ts itr.ts eway.ts gstin.ts …
│  └─ config/         tsconfig + prettier presets
└─ docs/              this file, blueprint, DEVELOPMENT.md, USER_GUIDE.md, COMPETITOR_GAPS.md, TAX_HELPER_PLAN.md
```

Facts Claude must respect (read from the code, do not re-derive):

| Fact | Evidence |
|---|---|
| Every tenant table spreads `...base()` (`id uuid`, `org_id`, `created_at`, `updated_at`, `deleted_at`) | `packages/db/src/schema/common.ts` |
| Money = `money('col')` numeric(14,2) returned as JS number; quantities = `qty('col')` numeric(14,3) | same file |
| A composite unique `(org_id, id)` exists on parent tables so children can use composite FKs | `parties.ts`: `unique('parties_org_id_id')` |
| API modules export `xModule({ route })` and register routes with `route({ method, path, tag, summary, query?, params?, body?, response, handler })`; handler gets `{ tx, query, params, body, … }` where `tx` is the tenant-scoped transaction | `apps/api/src/modules/parties.ts` |
| List endpoints use `listPage(tx, table, { searchColumns, where, …cursor })` and return `{ data, nextCursor }` | same |
| Row-level security is per `org_id`; every new table needs its RLS policy in a migration, pattern in `0002_rls.sql` and `0007_workspace_rls.sql` | migrations |
| Zod schemas: `xInput`, `xPatch = patchOf(xInput)`, `x = xInput.extend({ id, ...withStamps })` | `contracts/src/parties.ts` |
| The web app's older screens talk to `lib/data/*.js` which call `apiFetch(`${API}/collections/...`)`; newer ones can use TanStack Query hooks with `apiClient.ts` | `lib/data/clients.js` |
| Tax math is pure and lives in `packages/tax-engine`; it is imported as TypeScript source with relative `.ts` extensions and **erasable TypeScript only** (no `enum`, no parameter properties) | `docs/DEVELOPMENT.md` |
| Permission check on the web: `<Can>` component and `can()` in `lib/permissions.ts`; keys in `packages/contracts/src/permissions.ts` | |
| Existing tests: `apps/web/test/*.test.js` (salesFlow, tax, gstReturnTables, analytics, csv, phase3), `apps/api/test/*.test.ts` (api, auth, isolation, onboarding, web, workspace), tax-engine tests next to the source | |
| Latest migration is `0007_workspace_rls.sql`; the next free number is `0008` | `ls packages/db/migrations` |

## A.2 Ten rules Claude follows in every phase

1. **Read before write.** Open the neighbouring file that does the same job (e.g. copy the shape of `modules/parties.ts` for a new module) and match its comment density, naming and idioms. Do not invent a new pattern when one exists.
2. **Pure logic goes in `packages/tax-engine`.** Calculations (EMI schedule, ageing buckets, posting rules, GST rate grouping, round-off) are pure functions with Vitest tests written first. The API and the web both import them.
3. **Contracts first.** Add or change the Zod schema in `packages/contracts` before touching the API or the UI. The type that results is the single source of truth.
4. **Every new table**: `...base()`, composite FK to `(org_id, parent_id)`, indexes for the list filters, an RLS policy, and a line in the migration map (Appendix C). Never write a table without RLS.
5. **Never edit an applied migration.** Add a new numbered file. Use `pnpm db:generate` after editing the Drizzle schema, then review the SQL by hand and append the RLS statements.
6. **Soft delete, not hard delete**, for anything the user created (the Trash screen relies on `deleted_at`). Ledger rows are never deleted: they are reversed by a counter-entry or rebuilt from the source document.
7. **Permissions on both sides.** Each endpoint declares the permission it needs; each button is wrapped in `<Can>`. New keys are added to `packages/contracts/src/permissions.ts` and to Appendix A.
8. **Feature flags for anything half-finished.** Use the `featureFlags.js` pattern. A flag-off build must behave exactly like today's build.
9. **No silent behaviour change** to GST output. GSTR-1, GSTR-3B and e-way JSON must stay byte-identical for existing data unless the slice says otherwise and a test proves the intended diff.
10. **Stop and ask** when the guide marks a decision as ⚠️ or lists an **Open decision**. Do not pick silently; record the decision in `docs/DECISIONS.md` (create it on first use).

## A.3 The slice recipe

Every slice, in this order. Each step has a commit-sized scope.

```text
 ┌──────────────┐   ┌─────────────┐   ┌───────────┐   ┌────────────┐   ┌──────────────┐   ┌─────────┐   ┌──────┐
 │ 1 tax-engine │ → │ 2 contracts │ → │ 3 db      │ → │ 4 api      │ → │ 5 web data   │ → │ 6 screen│ → │ 7 doc│
 │ pure fn+test │   │ zod schemas │   │ schema +  │   │ module +   │   │ lib/data or  │   │ + tests │   │ +    │
 │              │   │             │   │ migration │   │ api tests  │   │ query hooks  │   │         │   │ log  │
 └──────────────┘   └─────────────┘   └───────────┘   └────────────┘   └──────────────┘   └─────────┘   └──────┘
```

| Step | Command / location | Exit check |
|---|---|---|
| 1 | `packages/tax-engine/src/<name>.ts` + `<name>.test.ts`; export from `index.ts` | `pnpm --filter @ledgora/tax-engine test` green |
| 2 | `packages/contracts/src/<module>.ts`; export from `index.ts` | `pnpm typecheck` green |
| 3 | edit `packages/db/src/schema/<file>.ts`; `pnpm db:generate`; edit generated SQL to add RLS | `pnpm db:migrate` on a fresh DB, then on a DB with seed data |
| 4 | `apps/api/src/modules/<module>.ts`; register in the module list; tests in `apps/api/test/` incl. an **isolation** case (org A cannot read org B) | `pnpm --filter @ledgora/api test` green |
| 5 | `apps/web/src/lib/data/<name>.js` (or a `useX` query hook next to the feature) | unit test with mocked fetch |
| 6 | `apps/web/src/features/<area>/…`; wrap actions in `<Can>`; route in `app/router.tsx` + nav entry | manual run (`pnpm dev`) following the slice's flow script |
| 7 | add to `CHANGELOG.md`, `docs/USER_GUIDE.md` (user-facing slices), tick the slice in this file | `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check` |

**Slice naming**: `P<phase>-S<n>` (for example `P3-S2 Payment Out`). Branch name `feat/p3-s2-payment-out`. Commit style follows the log: `feat: add payment out voucher`.

## A.4 Phase map and dependencies

```text
P0  UI foundation (U0 tokens → U1 shell → U2 components)
 │
 ├──► P1  Masters (Parties, Items, imports)
 │      │
 │      ├──► P2  Sale enhancements ───────────────┐
 │      │                                          │
 │      └──► P3  Purchase side ───────────────────┤
 │                                                 ▼
 │                                         P4  Ledger foundation
 │                                                 │
 │                          ┌──────────────────────┼───────────────────────┐
 │                          ▼                      ▼                       ▼
 │                    P5 Cash & Bank        P6 Reports (needs P4)    P10 Compliance (needs P3,P4)
 │                          │                      │
 │                          └────────┬─────────────┘
 │                                   ▼
 ├──────────────────────────► P7 Utilities (Tally, Close FY need P4)
 ├──────────────────────────► P8 Settings 11 tabs (UI in P0/P1, accounting tab needs P4)
 └──────────────────────────► P9 Grow & messaging (needs P2 for salesman, P8 for templates)
                                    │
                                    ▼
                              P11 Hardening & release
```

| Phase | Name | Size | Depends on | Output flag |
|---|---|---|---|---|
| P0 | UI foundation | 3 wk | none | `ui.vyapar` |
| P1 | Masters | 3 wk | P0 | none |
| P2 | Sale enhancements | 2 wk | P1 | `sale.inlinePayments` |
| P3 | Purchase side | 3 wk | P1 | none |
| P4 | Ledger foundation | 4 wk | P2, P3 | `accounting.ledger` |
| P5 | Cash & Bank | 3 wk | P4 | `cashbank` |
| P6 | Reports | 4 wk | P4 (some reports earlier) | none |
| P7 | Utilities | 2 wk | P4 | none |
| P8 | Settings 11 tabs | 2 wk | P0 | none |
| P9 | Grow & messaging | 3 wk | P2, P8 | `messaging` |
| P10 | Compliance polish | 3 wk | P3, P4 | none |
| P11 | Hardening | 2 wk | all | none |

Total ≈ 34 engineer-weeks sequential; with API and UI in parallel ≈ 20 calendar weeks.

## A.5 Conventions every screen and API follows

### A.5.1 Naming

| Thing | Rule | Example |
|---|---|---|
| Table | snake_case plural | `party_groups` |
| Column | snake_case | `credit_limit` |
| Drizzle export | camelCase plural | `partyGroups` |
| Contract | `xInput`, `xPatch`, `x`, `xListQuery` | `partyGroupInput` |
| API path | `/v1/<plural>`; actions as sub-resources | `/v1/cheques/:id/deposit` |
| Permission | `<module>.<action>` | `cheques.edit` |
| Web feature folder | kebab-case under `features/` | `features/cash-bank/` |
| React component | PascalCase `.jsx`/`.tsx` | `ChequeModal.jsx` |
| Route | kebab-case | `/cash-bank/cheques` |
| Query key | `[module, scope, params]` | `['cheques','list',{status}]` |
| Feature flag | dot path | `accounting.ledger` |

### A.5.2 API response shapes

```text
GET  list    →  { data: T[], nextCursor: string | null }
GET  one     →  T
POST create  →  T (201)
PATCH update →  T
DELETE       →  { ok: true }            (soft delete; id lands in Trash)
POST action  →  T or { ok: true, … }
Errors       →  { error: { code, message, fields?: { [name]: string } } } with 400/403/404/409/422
```

Standard error codes to reuse (Appendix D lists all): `VALIDATION`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `PERIOD_LOCKED`, `OVER_ALLOCATED`, `NEGATIVE_STOCK`, `CREDIT_LIMIT`, `LEDGER_IMBALANCE`.

### A.5.3 Form behaviour

| Behaviour | Rule |
|---|---|
| Required marker | red `*` after the label |
| Validation timing | on blur for the field, on submit for the form; errors under the field in `--neg` |
| Save button | disabled while saving; shows spinner; becomes enabled again on error |
| Save & New | saves, shows a toast, clears the form but keeps date, party-type and payment account defaults |
| Unsaved changes | browser prompt when closing a dirty form (`beforeunload`) and in-app confirm on route change |
| Numbers | right-aligned, `Intl.NumberFormat('en-IN')`; input accepts `1,23,456.50` and plain `123456.5` |
| Dates | `dd-MM-yyyy` in UI; ISO `yyyy-MM-dd` on the wire; FY switcher bounds the default |
| Keyboard | `Enter` moves to next field in single-line forms; `Ctrl/⌘+S` saves; `Esc` closes modals |

### A.5.4 Test conventions

| Layer | Tool | Where | What it proves |
|---|---|---|---|
| Pure logic | Vitest | `packages/tax-engine/src/*.test.ts` | numbers, rounding, GST splits, schedules |
| Contracts | Vitest | `packages/contracts/src/*.test.ts` (new) | accept/reject cases |
| API | Vitest + real Postgres via `global-setup.ts` | `apps/api/test/*.test.ts` | happy path, validation, permissions, **tenant isolation** |
| Web units | Vitest | `apps/web/test/*.test.js` | data helpers, report definitions |
| Component | Vitest + Testing Library (add if missing) | `apps/web/test/components/*.test.jsx` | DataTable, Combobox, LinesGrid |
| Smoke E2E | Playwright (scripts exist in `apps/web/scripts/*-e2e.mjs`) | `apps/web/scripts/` | the money flow end to end |

Every API test file ends with an isolation test: create as org A, request as org B, expect 404 (not 403, so existence does not leak).

## A.6 Definition of done (every slice)

- [ ] Contracts, DB, API, data layer, UI, tests all present for the slice.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check` all pass.
- [ ] Migration applies on empty DB and on seeded DB; RLS verified by an isolation test.
- [ ] Permission keys added; buttons gated; role defaults updated in the seed.
- [ ] Empty, loading, error and permission-denied states exist and look right.
- [ ] Keyboard path works (tab order, Enter, Esc, Ctrl+S).
- [ ] No GST/IT output drift for existing data (golden-file tests where relevant).
- [ ] CHANGELOG entry and, if user-facing, USER_GUIDE section.
- [ ] Feature flag documented (name, default, how to flip).
- [ ] Screenshots attached to the PR for each new screen (light and dark).

## A.7 Standard task card (copy for each slice)

```text
SLICE: P<n>-S<m>  <title>
GOAL: <one sentence a user would say>
PRE-REQS: <slices merged>
TOUCHES: tax-engine ☐  contracts ☐  db ☐  api ☐  web-data ☐  web-ui ☐  docs ☐
TABLES: <new/altered>
ENDPOINTS: <list>
SCREENS: <list with route>
PERMISSIONS: <keys>
FLAG: <name or none>
TESTS: <names>
ACCEPTANCE: <numbered checks>
OUT OF SCOPE: <explicit>
```

## A.8 Risks that apply to the whole programme

| Risk | Impact | Mitigation |
|---|---|---|
| Ledger (P4) backfill produces Dr ≠ Cr on old data | Wrong Trial Balance | Dry-run mode prints diffs; Verify My Data check; backfill is idempotent and per-business |
| Redesign (P0) breaks existing screens | Regression | Flag `ui.vyapar`, token aliases, smoke E2E per module |
| Report SQL slow on large businesses | Timeouts | Indexes listed per report; cursor pagination; 60-second query cap; materialised totals only if profiling shows need |
| GSTR output changes by accident | Filing errors | Golden JSON fixtures from current data checked in before P2 starts |
| Multi-tenant leak in new tables | Security | RLS + isolation test per module, CI blocks merge without it |
| Scope creep from "Vyapar has it" | Never finishing | Only items in the blueprint gap matrix; extras go to `docs/BACKLOG.md` |
| Unverified Vyapar behaviours (⚠️) | Building the wrong thing | Decision log, confirm against the live app before the slice starts |

---

# PHASE 0: UI foundation (tokens, shell, component library)

**Goal**: the app looks and navigates like Vyapar desktop without changing what any screen does.
**Why first**: every later phase builds on `DataTable`, `FilterBar`, `Modal`, `ActionBar`, `ReportShell`. Building those once prevents ten divergent table implementations.
**Flag**: `ui.vyapar` (per user, default off until P0 is complete; then on for new accounts; then on for all).

## P0-S1 (U0): Design tokens

### Intent
One file defines the look. Existing CSS keeps working through aliases.

### Files
| File | Action |
|---|---|
| `apps/web/src/styles/tokens.css` | rewrite values, keep old variable names as aliases |
| `apps/web/src/index.css` | no edits in this slice |
| `apps/web/src/styles/theme-vyapar.css` | new, applied when `data-ui="vyapar"` on `<html>` |

### Token table (final)

| Group | Token | Light | Dark |
|---|---|---|---|
| Brand | `--cta` | `#e8294c` | `#f0556f` |
| | `--cta-hover` | `#d01f40` | `#e8294c` |
| | `--link` | `#2563eb` | `#60a5fa` |
| Surface | `--bg` | `#f4f5f9` | `#0f1220` |
| | `--surface` | `#ffffff` | `#171a2b` |
| | `--surface-2` | `#f7f8fb` | `#1d2136` |
| | `--border` | `#e3e6ee` | `#2a2f4a` |
| Text | `--text` | `#1f2437` | `#e8eaf3` |
| | `--text-muted` | `#6b7280` | `#9aa1b9` |
| Sidebar | `--sidebar-bg` | `#14152a` | `#0b0c1a` |
| | `--sidebar-fg` | `#ffffff` | `#e8eaf3` |
| | `--sidebar-active` | `#262a52` | `#262a52` |
| Status | `--pos` | `#16a34a` | `#4ade80` |
| | `--neg` | `#dc2626` | `#f87171` |
| | `--warn` | `#d97706` | `#fbbf24` |
| | `--info` | `#2563eb` | `#60a5fa` |
| Tints | `--tint-pos` | `#e8f6ef` | `#12301f` |
| | `--tint-neg` | `#fdecec` | `#3a1717` |
| | `--tint-warn` | `#fff4e5` | `#3a2a10` |
| Shape | `--r-sm / --r-md / --r-lg` | `6 / 8 / 12px` | same |
| Spacing | `--s-1 … --s-8` | `4 8 12 16 24 32 40 48px` | same |
| Type | `--font` | `"Roboto", system-ui, sans-serif` | same |
| | `--fs-title / --fs-section / --fs-body / --fs-label` | `24 / 18 / 14 / 13px` | same |
| Elevation | `--shadow-1`, `--shadow-2` | `0 1px 2px rgba(20,21,42,.06)`, `0 8px 24px rgba(20,21,42,.14)` | darker alpha |

### Steps
1. Snapshot: list every `var(--…)` used in `index.css`, `analytics.css`, `auth.css` (`grep -o 'var(--[a-z0-9-]*)' | sort -u`). Every name found must exist in the new token file, either as a value or an alias.
2. Write the new tokens. Aliases: `--primary: var(--cta)`, `--primary-hover: var(--cta-hover)`, plus whichever legacy names step 1 found.
3. Add the Roboto font via `<link>` in `index.html` with `display=swap`; keep `system-ui` fallback so offline PWA still renders.
4. Add `[data-theme="dark"]` block deriving dark values from the table.
5. Decision gate: palette (blueprint 5.12 #1). Implement **both** palettes as `data-brand="vyapar"` and `data-brand="ledgora"`; default per the decision.

### Acceptance
1. App loads with no unresolved CSS variable (a script lists `getComputedStyle` of `:root` against the usage list).
2. Contrast: `--sidebar-fg` on `--sidebar-bg` ≥ 7:1; white on `--cta` ≥ 4.5:1 for 14px bold.
3. Dark mode toggle still works.
4. Visual diff: old screens only change colours, not layout.

## P0-S2 (U1): Shell, navigation, "Open Anything"

### Intent
Replace the sidebar, top bar and page chrome. Screens render unchanged inside.

### Wireframe: desktop shell (≥1280px)

```text
┌────────────┬─────────────────────────────────────────────────────────────────────────────┐
│ ┌────────┐ │  ☎ Customer Support: +91 …  ·  Chat                         (optional strip)│
│ │ Logo   │ ├─────────────────────────────────────────────────────────────────────────────┤
│ └────────┘ │  ● Enter Business Name  ✎                    [ FY 2026-27 ▾ ]  🔔  ⚙  👤    │
│ ┌────────┐ ├─────────────────────────────────────────────────────────────────────────────┤
│ │🔍 Open │ │  Invoices   ›  Sale                                     [ + Add Sale ]      │
│ │ Anything│ ├─────────────────────────────────────────────────────────────────────────────┤
│ │ ⌘F     │ │                                                                             │
│ └────────┘ │   PAGE CONTENT                                                              │
│ 🏠 Home    │                                                                             │
│ 👥 Parties▾│                                                                             │
│ 🛍 Items (+)│                                                                            │
│ 🧾 Sale    ▾│                                                                            │
│ 🛒 Purchase▾│                                                                            │
│ 📈 Grow    ▾│                                                                            │
│ 🏦 Cash&Bk ▾│                                                                            │
│ 📊 Reports │                                                                             │
│ ⚖ Taxes   ▾│                                                                             │
│ 🔄 Sync    ▾│                                                                            │
│ 🛠 Utilities▾│                                                                           │
│ ⚙ Settings │                                                                             │
│ ★ Plans    │                                                                             │
│ ────────── ├─────────────────────────────────────────────────────────────────────────────┤
│ [My Company›]│  (sticky ActionBar on form pages)                    [ Back ] [ Continue ] │
└────────────┴─────────────────────────────────────────────────────────────────────────────┘
```

### Data structure: `app/navigation.ts` (single source)

```ts
export type NavLeaf = {
  id: string; label: string; path: string; icon?: LucideIcon;
  perm?: string;             // permission key, hides item if missing
  flag?: string;             // feature flag key
  badge?: () => number | null;   // red dot / count (e.g. overdue parties)
  quickAdd?: string;         // path of the (+) shortcut
};
export type NavGroup = NavLeaf | (Omit<NavLeaf,'path'> & { children: NavLeaf[] });
export const NAV: NavGroup[] = [ /* see blueprint 5.6 */ ];
export const ROUTE_TITLES: Record<string,string> = deriveFromNav(NAV);
export const LEGACY_REDIRECTS: Record<string,string> = {
  '/clients':'/parties', '/inventory':'/products', '/receipts':'/sales/payment-in',
};
```

### Components to (re)write

| Component | File | Props | Notes |
|---|---|---|---|
| `AppShell` | `app/AppShell.jsx` | `children` | grid: 240px / 1fr; rail mode 64px |
| `Sidebar` | `app/Sidebar.jsx` | `nav`, `collapsed`, `onToggle` | reads `NAV`, filters by `can()` and flags |
| `NavGroup`, `NavItem` | `app/nav/*.jsx` | `item`, `active`, `open` | `aria-expanded`, chevron rotates, open state persisted in `localStorage('nav.open')` |
| `CompanySwitcher` | `app/CompanySwitcher.jsx` | none | reuse existing business/branch menu from current `Sidebar.jsx` |
| `OpenAnything` | `app/OpenAnything.jsx` | none | wraps `CommandPalette`; pill in sidebar, `⌘/Ctrl+F` |
| `TopBar` | `app/TopBar.jsx` | none | `BusinessNameField` + `FYSwitcher` + bell + avatar |
| `BusinessNameField` | `app/BusinessNameField.jsx` | none | inline edit; red dot while profile incomplete; click → Setup checklist |
| `FYSwitcher` | `app/FYSwitcher.jsx` | none | lists financial years; sets global date range default |
| `PageHeader` | `components/ui/PageHeader.jsx` | `title`, `breadcrumb`, `actions` | only primary-action location |
| `ActionBar` | `components/ui/ActionBar.jsx` | `left`, `right` | sticky bottom, 64px |

### Flow: navigation

```text
User clicks "Sale ▾"
   ├─ group closed → open, persist
   └─ group open   → close
User clicks leaf "Invoices"
   → router.navigate('/sales/invoices')
   → Sidebar marks leaf active, parent group stays open
   → TopBar title/breadcrumb from ROUTE_TITLES
   → PageHeader shows primary action "+ Add Sale" (from screen)
Legacy URL /clients
   → router redirect (LEGACY_REDIRECTS) → /parties
```

### Open Anything search sources

| Source | Result row | Action |
|---|---|---|
| Screens | icon + "Reports › Day Book" | navigate |
| Parties | name · phone · balance | open party detail |
| Items | name · code · stock | open item drawer |
| Invoices | number · party · amount | open document |
| Reports | name · group | open report |
| Settings | "Settings › GST › Reverse charge" | open tab, scroll to row |
| Actions | "Add Sale", "Add Party", "Backup now" | run |

Ranking: exact prefix > word start > fuzzy; recents first when query empty (last 8, `localStorage('recent')`).

### Keyboard map (update `ShortcutsHelp.jsx`)

| Keys | Action |
|---|---|
| `⌘/Ctrl+F` | Open Anything |
| `⌘/Ctrl+S` | Save current form |
| `⌘/Ctrl+Shift+S` | Save & New |
| `Alt+N` | New (context: Add Sale on Sale pages, Add Party on Parties…) |
| `Alt+B` | Toggle sidebar |
| `Esc` | Close modal/drawer |
| `?` | Shortcut help |

### Acceptance
1. Every existing route renders inside the new shell.
2. Legacy paths redirect; deep links and the PWA cache do not 404.
3. Sidebar entries hidden for roles without the permission.
4. Group open/closed state survives reload.
5. `⌘F` opens Open Anything from any page, `Esc` closes.
6. Under 1280px the sidebar collapses to the rail; under 1024px the existing drawer layout is used.
7. `App.jsx` shrinks (navItems moved out); no behaviour change.

## P0-S3 (U2): Component library

Build in `apps/web/src/components/ui/`, each with a props table, states, a11y notes, tests and an entry in the **gallery route** `/dev/ui` (dev-only).

### P0-S3.1 DataTable

```text
┌ toolbar: [☐ n selected] [Columns ▾] [density ◐]                              (slot right) ┐
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ ☐ │ Date ▲ │ Invoice No │ Party         │ Type    │   Amount │   Balance │ Status │  ⋮   │
├───┼────────┼────────────┼───────────────┼─────────┼──────────┼───────────┼────────┼──────┤
│ ☐ │ 06-11  │ INV-12     │ Ravi Traders  │ Invoice │ 8,260.00 │  8,260.00 │ Unpaid │  ⋮   │
├───┴────────┴────────────┴───────────────┴─────────┼──────────┼───────────┼────────┴──────┤
│ Totals (sticky)                                   │ 8,260.00 │  8,260.00 │               │
└───────────────────────────────────────────────────┴──────────┴───────────┴───────────────┘
footer: 1–50 of 312  ‹ 1 2 3 ›   Rows [50 ▾]
```

| Prop | Type | Notes |
|---|---|---|
| `columns` | `{ id, header, accessor, align?, width?, sortable?, render?, total? }[]` | `total: 'sum' \| fn` shows sticky totals |
| `rows` | `T[]` | |
| `rowKey` | `(r)=>string` | |
| `loading`, `error`, `empty` | node/boolean | skeleton, `States` error with Retry, `EmptyState` |
| `selectable` | boolean | checkbox column, shift-click range |
| `onSort`, `sort` | controlled | server-side sort allowed |
| `pagination` | `{ cursor, onNext, onPrev, pageSize, onPageSize }` | cursor based, matches `listPage` |
| `rowActions` | `(r)=>MenuItem[]` | the ⋮ menu; items filtered by `can()` |
| `onRowClick` | fn | whole row clickable except checkbox and menu |
| `density` | `'comfortable'\|'compact'` | 44px / 36px rows |
| `columnPicker` | boolean | persisted per table id in `localStorage` |
| `stickyFirstColumn` | boolean | for narrow widths |
| `exportable` | `{ filename }` | feeds `ExportMenu` |

States: loading (8 skeleton rows), empty, error, partial (some rows hidden by filter shows "n hidden by filters, clear").
A11y: `<table>` semantics with `scope="col"`, sort buttons with `aria-sort`, row menu is a `button aria-haspopup="menu"`, arrow-key navigation optional but Tab order correct.
Tests: sort cycling, selection range, totals correctness with negative numbers, column picker persistence, empty vs error.

### P0-S3.2 FilterBar + SummaryChips

```text
[ This Month ▾ ] [ Party ▾ ] [ Status ▾ ] [ 🔍 Search…        ]                [ Export ▾ ]
┌ Total ₹4,80,000 ┐ ┌ Paid ₹3,10,000 ┐ ┌ Unpaid ₹1,70,000 ┐
```

`PeriodPicker` presets: Today, Yesterday, This week, This month, This quarter, This FY, Last month, Last quarter, Last FY, Custom (two `DateInput`s). Result `{ from, to, label }`. FY boundaries come from the business setting `fyStartMonth` (default 4).
`SummaryChips` takes `[{ label, value, tone?: 'pos'|'neg'|'warn', hint? }]`.

### P0-S3.3 Form primitives

| Component | Specifics |
|---|---|
| `Field` | label above, required `*`, help text, error line, `htmlFor` wiring |
| `TextInput` | trims on blur, `maxLength`, `inputMode` |
| `MoneyInput` | `₹` prefix, accepts Indian grouping, returns number, `allowNegative` prop, 2 decimals on blur |
| `QtyInput` | 3 decimals max (setting-driven 0–4) |
| `DateInput` | `dd-MM-yyyy` text + popover calendar, min/max (FY lock), keyboard typing `060126` → `06-01-2026` |
| `Select` | native styled; for ≤ 12 options |
| `Combobox` | async search, keyboard navigation, `+ Add new "<query>"` footer row, `renderOption`, `onCreate` |
| `PhoneInput` | `+91` prefix, 10 digits |
| `GstinInput` | uppercase, 15 chars, checksum via `tax-engine/gstin.ts`, shows state name once 2 digits typed, `Get Details ⟳` button (disabled until API provider decided) |
| `StateSelect` | 37 states/UTs from `tax-engine/states.ts` with GST state codes |
| `Switch`, `Checkbox`, `RadioCards` | |
| `FileDrop` | attach to the `files` API; max 5 MB; image/pdf |

### P0-S3.4 Overlays and navigation

| Component | Spec |
|---|---|
| `Modal` | 640px default, `size: sm 480 / md 640 / lg 880`; focus trap; `Esc`; footer slot; scroll body; confirm-on-dirty |
| `Drawer` | 480px right |
| `ConfirmModal` ✅ | keep API |
| `Tabs` | underline style, `aria` tablist, URL-synced via `?tab=` |
| `Stepper` | numbered, completed ✓, current, upcoming |
| `Toast` ✅ | add `action` (Undo) |
| `Menu` | the ⋮ and dropdown menus |

### P0-S3.5 Display

`StatusChip` (tones: success, warn, danger, neutral, info), `Badge`, `EmptyState` (illustration slot, title, text, primary and secondary action), `PromoCard`, `Kbd`, `Skeleton`, `OptionCard`, `Avatar`, `Money` (formats + colours by sign when `signed`).

### P0-S3.6 Document components

`LinesGrid` (evolved from `LineItemsGrid`): spreadsheet-like rows; Enter on last cell adds a row; Tab/Shift+Tab; `Ctrl+Backspace` deletes row; paste multiple rows from Excel (tab-separated); column config per document type so Sale, Purchase, Order, Return reuse it.

| Column | Sale | Purchase | Order | Return | Expense |
|---|---|---|---|---|---|
| Item | ✔ | ✔ | ✔ | ✔ (from bill) | ✔ (expense item) |
| HSN/SAC | ✔ | ✔ | ✔ | ✔ | ✔ SAC |
| Qty / Unit | ✔ | ✔ | ✔ | ✔ ≤ billed | ✔ |
| Rate | ✔ | ✔ | ✔ | ✔ | ✔ |
| Discount % / ₹ | ✔ | ✔ | ✔ | – | – |
| GST % | ✔ | ✔ | ✔ | ✔ | ✔ |
| ITC flag | – | ✔ | – | ✔ | ✔ |
| Batch / Serial | optional | optional | – | optional | – |
| Amount | ✔ | ✔ | ✔ | ✔ | ✔ |

`LivePreview`: right pane that renders `InvoicePreview` from the in-memory draft (debounced 250 ms); toggle button; collapses under 1280px.

### P0-S3.7 ReportShell (contract used by Phase 6)

```ts
type ReportDef = {
  id: string; title: string; group: ReportGroup; description?: string;
  filters: FilterSpec[];            // period, party, item, category, status, toggles, selects
  columns: ColumnSpec[];            // id, header, align, format, total?
  summary?: (rows)=>Chip[];
  fetch: (params)=>Promise<{ rows, totals?, meta? }>;  // calls GET /v1/reports/:id
  drilldown?: (row)=>Route | DocumentRef;
  exports: ('pdf'|'xlsx'|'print'|'share')[];
};
```

### P0-S3.8 Gallery and tests
Route `/dev/ui` (excluded from production build via `import.meta.env.DEV`) renders every component in every state, light and dark. Component tests with Testing Library for DataTable, Combobox, MoneyInput, DateInput, LinesGrid, Modal focus trap.

### Phase 0 acceptance (whole phase)
1. With `ui.vyapar` on, every existing screen works in the new shell.
2. Gallery shows all components; each has at least one test.
3. No new dependency unless the decision (blueprint 5.12 #5) chose Radix; if hand-built, no dependency added.
4. Lighthouse accessibility ≥ 95 on Home, Parties, Add Sale.
5. `index.css` untouched or smaller.

### Claude prompt for Phase 0
```text
You are implementing Phase 0 of docs/VYAPAR_IMPLEMENTATION_PHASES.md in the Ledgora repo.
Work on slice P0-S1 first. Read apps/web/src/styles/tokens.css and grep every var(--…) used in index.css,
analytics.css, auth.css. Rewrite tokens with legacy aliases per the token table. Do not touch any screen.
Stop after P0-S1 passes its acceptance list and show me a before/after screenshot of Home, Parties and Add Sale.
Palette is decided (D-01): Vyapar layout and navy sidebar with Ledgora green as the primary button colour; keep a data-brand switch.
```

---

# PHASE 1: Masters (Parties, Items, Categories, Units, Imports)

**Goal**: a user can set up the whole business master data (parties with groups, addresses, credit limits; items with category, type, alternate units, min stock, batches) and bulk-load it from Excel, in the new UI.
**Prerequisite**: P0-S1 and P0-S2 merged; P0-S3 components `DataTable`, `FilterBar`, `Modal`, `Field*`, `Combobox`, `Tabs` available.
**Flag**: none (additive columns with defaults; old data stays valid).
**Slices**: P1-S1 Party Groups · P1-S2 Party fields and addresses · P1-S3 Parties list and detail · P1-S4 Item categories and units · P1-S5 Item fields and tracking · P1-S6 Items list and drawer · P1-S7 Import wizards · P1-S8 Stock adjust and bulk update.

## P1-S1 Party Groups

### Use cases
| # | Actor | Scenario | Expected |
|---|---|---|---|
| 1 | Owner | Creates group "Wholesale" while adding a party | Group appears in the dropdown immediately without leaving the modal |
| 2 | Owner | Renames group with 40 parties | All 40 parties show the new name |
| 3 | Owner | Deletes a group that has parties | Blocked: "12 parties use this group. Move them first" with a **Move to…** action |
| 4 | Accountant | Opens "Sale by Party Group" report | Totals roll up by group (Phase 6) |
| 5 | Owner | Creates a child group "Retail > Chennai" | Tree shown with indentation; filters include children |

### Data model (`packages/db/src/schema/parties.ts`)

```ts
export const partyGroups = pgTable('party_groups', {
  ...base(),
  name: text('name').notNull(),
  parentId: uuid('parent_id'),            // self reference, composite FK (org_id, parent_id)
}, (t) => [
  unique('party_groups_org_id_id').on(t.orgId, t.id),
  unique('party_groups_org_name').on(t.orgId, t.name),   // case-insensitive via lower() index in SQL
]);
// parties gets: groupId uuid null, composite FK (org_id, group_id) → party_groups
```

Migration `0008_masters_parties.sql` also contains: `alter table parties add column group_id uuid`, RLS policy copy of `parties`, index `parties_org_group_idx (org_id, group_id)`.

### Contracts (`packages/contracts/src/parties.ts`)
```ts
export const partyGroupInput = z.object({ name: z.string().trim().min(1).max(80), parentId: uuid.nullish() });
export const partyGroup = partyGroupInput.extend({ id: uuid, partyCount: z.number().int().optional(), ...withStamps });
```
Cycle guard: API rejects `parentId` that equals own id or any descendant (422 `VALIDATION`, field `parentId`).

### Endpoints
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/v1/party-groups` | `parties.view` | flat list with `partyCount`, client builds tree |
| POST | `/v1/party-groups` | `parties.create` | |
| PATCH | `/v1/party-groups/:id` | `parties.edit` | |
| DELETE | `/v1/party-groups/:id` | `parties.delete` | 409 `CONFLICT` if parties attached unless `?moveTo=<id>` |

### Wireframe: Party Groups modal

```text
┌ Party Groups ──────────────────────────────────────────────────── [×] ┐
│ [ + Add Group ]                                      [🔍 Search group ]│
│ ┌──────────────────────────────┬──────────┬────────────────────────┐   │
│ │ Group                        │ Parties  │                        │   │
│ │ ▾ Retail                     │ 24       │ [Rename] [Delete]      │   │
│ │     Chennai                  │ 10       │ [Rename] [Delete]      │   │
│ │     Madurai                  │ 14       │ [Rename] [Delete]      │   │
│ │ Wholesale                    │ 12       │ [Rename] [Delete]      │   │
│ │ Vendors                      │ 8        │ [Rename] [Delete]      │   │
│ └──────────────────────────────┴──────────┴────────────────────────┘   │
│ Add / Rename group                                                      │
│ Group name* [______________]   Parent group [None ▾]                    │
│                                              [Cancel]  [ Save ]         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Fields
| Field | Type | Required | Validation | Default |
|---|---|---|---|---|
| Group name | text 1–80 | yes | unique per business, case-insensitive | none |
| Parent group | select | no | not self or descendant | None |

### Edge cases
- Deleting a group with `?moveTo` runs a single transaction updating parties then soft-deleting the group.
- Two users creating the same name concurrently: unique violation mapped to 409 with message "Group already exists".
- Import (P1-S7) creates unknown groups on the fly when "Create missing groups" is ticked.

### Acceptance
1. Create, rename, nest, delete (with and without move) all work and are audited via `audit()`.
2. Isolation test: org B cannot see org A's groups.
3. Tree rendering handles 3 levels and 200 groups under 50 ms.

## P1-S2 Party fields and addresses

### New columns on `parties`
| Column | Type | Default | Purpose |
|---|---|---|---|
| `group_id` | uuid null | null | group |
| `gst_type` | text | `'unregistered'` | enum below; replaces `is_sez` (keep `is_sez` in sync until P11 cleanup) |
| `credit_limit` | money null | null | null = no limit |
| `credit_mode` | text | `'none'` | `none` / `warn` / `block` |
| `payment_terms_days` | int | 0 | default due-date offset |
| `contact_person` | text | `''` | |
| `opening_balance_date` | date null | null | as-of date |
| `tds_applicable` | bool | false | |
| `tds_section` | text null | null | e.g. `194Q` |
| `tcs_applicable` | bool | false | |
| `custom1..custom4` | stored in existing `extra` jsonb | | labels come from Settings > Party |

`gst_type` values: `registered_regular`, `registered_composition`, `unregistered`, `consumer`, `sez`, `overseas`. Back-fill: `is_sez = true → 'sez'`; gstin present → `'registered_regular'`; else `'unregistered'`.
`opening_balance` stays **signed**: positive = party owes you (To Collect), negative = you owe party (To Pay). The UI shows a direction radio and converts.

### New tables
```ts
export const partyAddresses = pgTable('party_addresses', {
  ...base(), partyId: uuid('party_id').notNull(),
  label: text('label').notNull().default('Shipping'),
  address: text('address').notNull().default(''), city: text('city').notNull().default(''),
  state: text('state').notNull().default(''), pin: text('pin').notNull().default(''),
  isDefaultShipping: boolean('is_default_shipping').notNull().default(false),
}); // composite FK (org_id, party_id)

export const partyItemRates = pgTable('party_item_rates', {
  ...base(), partyId: uuid('party_id').notNull(), itemId: uuid('item_id').notNull(),
  rate: money('rate').notNull(), rateIncludesTax: boolean('rate_includes_tax').notNull().default(false),
}, (t)=>[unique('party_item_rates_unique').on(t.orgId, t.partyId, t.itemId)]);
```

### Contracts
Extend `partyInput` with the columns above (all with defaults so old clients keep working). New: `partyAddressInput`, `partyItemRateInput`. Zod refinements:
- `gstType in registered_* ⇒ gstin required and checksum valid`.
- `tdsApplicable ⇒ tdsSection required`.
- `creditMode != 'none' ⇒ creditLimit > 0`.
- `state` required when `gstType != 'overseas'` (place of supply needs it).

### Endpoints
| Method | Path | Permission |
|---|---|---|
| GET/POST/PATCH/DELETE | `/v1/parties/:id/addresses[/:addrId]` | `parties.view/edit` |
| GET/PUT | `/v1/parties/:id/item-rates` | `parties.edit` (PUT replaces the full list in one transaction) |
| GET | `/v1/parties/:id/summary` | `parties.view` → `{ balance, creditLimit, creditUsed, lastTxnDate, overdue, counts }` |

### Wireframe: Add / Edit Party modal (tab 1)

```text
┌ Add Party ───────────────────────────────────────────────────────────────── [×] ┐
│ [ Party Details ]  [ GST & Address ]  [ Credit & Other ]                         │
│ ─────────────────────────────────────────────────────────────────────────────── │
│  Party Name *            [____________________________]                          │
│  Party Type *            (●) Customer  ( ) Supplier  ( ) Both                     │
│  Phone                   [+91 ____________]       Email [____________________]    │
│  Contact Person          [____________________]                                   │
│  Party Group             [ Retail            ▾ ] [+]                              │
│  Opening Balance         [₹ 0.00]   (●) To Collect  ( ) To Pay    As of [06-11-2026]│
│                                                                                    │
│                                         [ Cancel ]  [ Save & New ]  [  Save  ]    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Tab 2:
```text
│  GST Type *       [ Registered (Regular) ▾ ]                                       │
│  GSTIN            [ 33AAAAA0000A1Z5 ] [ Get Details ⟳ ]   ✔ Tamil Nadu (33)        │
│  PAN              [ AAAAA0000A ]  (auto from GSTIN)                                │
│  State of supply* [ Tamil Nadu ▾ ]                                                 │
│  Billing address  [____________________________________________]                  │
│  City [__________]  PIN [______]                                                   │
│  [x] Shipping address same as billing                                              │
│  Shipping addresses                                           [ + Add address ]    │
│   ┌ Warehouse – Madurai ────────────────────────────── ● default  [Edit][Delete]┐  │
```

Tab 3:
```text
│  Credit limit     [₹ _______]   (●) No limit  ( ) Warn  ( ) Block                  │
│  Payment terms    [ 30 days ▾ ]   (Net 0, 7, 15, 30, 45, 60, Custom)               │
│  Party-wise item rates   [ Manage rates ]  (n items)                               │
│  [ ] TDS applicable   Section [ 194Q ▾ ]     [ ] TCS applicable                    │
│  Additional fields    Label1 [______] Label2 [______]  (names set in Settings>Party)│
│  Notes            [____________________________________________]                  │
```

### Field reference
| Field | Type | Required | Validation / behaviour |
|---|---|---|---|
| Party name | text ≤ 200 | ✔ | unique (case-insensitive); on duplicate show "Ravi Traders already exists. [Open it]" |
| Party type | radio | ✔ | `kind` |
| Phone | text | | 10 digits after `+91`; warns if already used by another party |
| Email | text | | RFC check |
| Contact person | text ≤ 100 | | |
| Group | combobox | | create inline |
| Opening balance | money ≥ 0 | | with direction radio; stored signed |
| As-of date | date | if balance ≠ 0 | ≤ today, within an open FY |
| GST type | select | ✔ | six values |
| GSTIN | text 15 | if registered | checksum; 2-digit prefix sets State and shows its name; PAN auto-fill |
| State | select | ✔ unless overseas | drives CGST/SGST vs IGST |
| Billing address, city, pin | text | | PIN 6 digits |
| Shipping addresses | list | | each: label, address, city, state, pin; one default |
| Credit limit + mode | money, radio | | see contract refinement |
| Payment terms | select | | default due offset in sale |
| TDS flag + section | checkbox, select | | sections from `tds_sections` (P8) or a fixed list until then |
| TCS flag | checkbox | | |
| Custom 1-4 | text | | label from settings |
| Notes | textarea ≤ 1000 | | |

### Flow: save party

```text
Click Save
 ├─ client validation fails → focus first invalid field, show message
 ├─ POST /v1/parties
 │    ├─ 409 duplicate name → inline error + "Open existing"
 │    ├─ 422 gstin → error under GSTIN
 │    └─ 201 → close modal, toast "Party added", refresh list, if opened from Add Sale preselect it
 └─ Save & New → same, then reset form (keep group and type)
```

### Credit limit enforcement (used in Phase 2)
`creditUsed = outstanding receivable + unbilled open orders (setting)`. A pure function `creditCheck({ limit, mode, used, newAmount })` in `tax-engine/credit.ts` (file exists: extend it) returns `{ ok, exceededBy, mode }`.

### Acceptance
1. Old parties still load; `gst_type` back-filled correctly in a migration test with 4 sample rows.
2. All refinements covered by contract tests.
3. Address and rate endpoints replace atomically (a failing row rolls back all).
4. Party-wise rate wins over item default price when adding a line (Phase 2 hook, unit-tested here).

## P1-S3 Parties list and Party Detail

### Wireframe: list (Template A)

```text
┌ Parties ───────────────────────────────────────────────────────── [ Import ▾ ] [ + Add Party ] ┐
│ [🔍 Search name / phone / GSTIN] [Group ▾] [Type ▾] [Balance: All|To Collect|To Pay ▾]          │
│ ┌ To Collect ₹1,24,000 ↑ ┐ ┌ To Pay ₹56,200 ↓ ┐ ┌ Parties 48 ┐ ┌ Overdue 6 ┐                   │
│ ┌──┬──────────────┬─────────┬──────────┬─────────────────┬──────────────┬────────────┬──────┐ │
│ │☐ │ Party        │ Group   │ Phone    │ GSTIN           │ Balance      │ Credit     │  ⋮   │ │
│ │☐ │ Ravi Traders │ Retail  │ 98…01    │ 33AAAA…         │ ₹12,000 ↑    │ 24% used   │  ⋮   │ │
│ │☐ │ Om Supplies  │ Vendors │ 99…22    │ 29BBBB…         │ ₹4,500 ↓     │ –          │  ⋮   │ │
│ └──┴──────────────┴─────────┴──────────┴─────────────────┴──────────────┴────────────┴──────┘ │
│ Selected 2:  [Send reminder] [Change group] [Export] [Delete]                                  │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Row ⋮ menu: Open, Edit, Add Sale, Add Payment In, Send reminder, Download statement, Delete.
Balance colour: To Collect green with ↑, To Pay red with ↓ (the only place colour encodes sign).
Server: `GET /v1/parties?search=&groupId=&kind=&balance=receivable|payable&cursor=` returns a `balance` per row computed in SQL: `opening_balance + Σ invoices − Σ allocated receipts − …` (reuse `tax-engine/outstanding.ts` logic; add a SQL view `party_balances` for speed, defined in `0008`).

### Wireframe: Party Detail (Template F)

```text
┌ ← Ravi Traders   [Retail]                                 [Edit] [Statement ⬇] [⋮]       ┐
│ 📞 98xxxxxx01 · ✉ ravi@x.in · GSTIN 33AAAA0000A1Z5 · Tamil Nadu · Credit 30 days          │
│ ┌ Balance ────────┐ ┌ Credit limit ───────┐ ┌ This FY sales ┐ ┌ Last payment ┐             │
│ │ ₹12,000         │ │ ₹50,000 · 24% used  │ │ ₹3,40,000     │ │ 30-10-2026   │             │
│ │ To Collect      │ │ ▓▓░░░░░░░░          │ │               │ │ ₹5,000       │             │
│ └─────────────────┘ └─────────────────────┘ └───────────────┘ └──────────────┘             │
│ [ + Sale ] [ + Payment In ] [ + Quotation ] [ Remind on WhatsApp ]                          │
│ [ Transactions ][ Profitability ][ Ledger ][ Items bought ][ Details ]                      │
│ ─────────────────────────────────────────────────────────────────────────────────────── │
│ Type      │ Number │ Date     │ Total  │ Balance │ Status │                                 │
│ Sale      │ INV-12 │ 02-11-26 │ 8,260  │ 8,260   │ Unpaid │                                 │
│ Pmt In    │ RCT-4  │ 30-10-26 │ 5,000  │ –       │ –      │                                 │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

Tabs: **Transactions** (all documents, filter by type/date), **Profitability** (bill-wise profit rows; uses Phase 6 report), **Ledger** (running balance; before Phase 4 compute from documents, after Phase 4 read `ledger_entries`), **Items bought** (item, qty, amount), **Details** (read-only fields + addresses + rates).

### Use cases
| # | Scenario | Expected |
|---|---|---|
| 1 | Open party with 500 documents | First 50 rows < 300 ms, infinite/cursor paging |
| 2 | Click **Statement ⬇** | PDF with opening balance, rows, closing; reuses `TableExport` |
| 3 | Party over credit limit | Credit card turns amber at ≥ 80%, red at > 100% |
| 4 | Customer and supplier at once (kind `both`) | Balance is net; detail shows both receivable and payable sub-lines |
| 5 | Delete party with documents | Blocked: "Has 14 documents. Archive instead" (soft delete keeps documents intact; hidden from pickers) |
| 6 | Bulk **Change group** | One PATCH batch, optimistic update |

### Acceptance
1. List matches Template A wireframe at 1440 px and degrades at 1100 px.
2. Balance column equals Party Statement closing balance for 20 random parties in a test.
3. Pickers (`Combobox`) show balance and phone in the option row.
4. Archive hides but never breaks old documents' party name.

## P1-S4 Item categories and units

### Data
```ts
export const itemCategories = pgTable('item_categories', {
  ...base(), name: text('name').notNull(), parentId: uuid('parent_id'),
}, (t)=>[ unique('item_categories_org_id_id').on(t.orgId, t.id), unique('item_categories_org_name').on(t.orgId, t.name) ]);
// items gets: category_id uuid null (composite FK)
export const itemUnits = pgTable('item_units', {   // alternate units per item
  ...base(), itemId: uuid('item_id').notNull(), unit: text('unit').notNull(),
  factor: qty('factor').notNull(),     // 1 alt unit = factor × base unit
});
```
`units` master table already exists (custom units); alternate units reference unit codes, validated against the master or the built-in list in `tax-engine/units.ts`.

### Wireframes
```text
┌ Item Categories ─────────────────────────────────────── [×] ┐       ┌ Units ───────────────────────────── [×] ┐
│ [+ Add Category]                                            │       │ [+ Add Unit]                             │
│ Stationery (14)  [Rename][Delete]                           │       │ PCS  Pieces                              │
│ ▾ Electronics (22)                                          │       │ KGS  Kilograms                           │
│     Cables (9)                                              │       │ BOX  Box          1 BOX = 12 PCS ✎       │
└─────────────────────────────────────────────────────────────┘       └──────────────────────────────────────────┘
```

Unit conversion modal: Base unit\* (select), Secondary unit\* (select), `1 [secondary] = [factor] [base]`, factor > 0 with up to 3 decimals; prevents a unit pair from being defined twice.

### Acceptance
1. Category CRUD with delete guard like groups.
2. Alternate unit factor arithmetic tested: sale of 2 BOX deducts 24 PCS (stock engine in `tax-engine/stock.ts` gets `toBaseQty(qty, unit, itemUnits)`).

## P1-S5 Item fields and tracking

### New columns on `items`
| Column | Type | Default | Purpose |
|---|---|---|---|
| `item_type` | text | `'product'` | `product` / `service` |
| `category_id` | uuid null | | |
| `sac` | text null | | service code (6–8 digits); `hsn` stays for products. UI shows one "HSN/SAC" field that writes to the right column by type |
| `mrp` | money null | | |
| `wholesale_price` | money null | | |
| `wholesale_min_qty` | qty null | | |
| `sale_price_incl_tax` | bool | false | |
| `purchase_price_incl_tax` | bool | false | |
| `tax_category` | text | `'taxable'` | `taxable` / `exempt` / `nil_rated` / `non_gst` |
| `min_stock` | qty null | | low stock alert |
| `location` | text | `''` | rack/shelf |
| `barcode` | text null | | unique per org when set |
| `track_batch` | bool | false | |
| `track_serial` | bool | false | |
| `image_file_id` | uuid null | | from `files` |
| `description` | text | `''` | |

Back-fill: services = items with `track_stock = false`.

Batch and serial tables:
```ts
itemBatches: { itemId, batchNo, mfgDate?, expDate?, model?, size?, qtyOnHand }  unique (org, item, batchNo)
itemSerials: { itemId, serialNo, status: 'in_stock'|'sold'|'returned', batchId?, saleLineId?, purchaseLineId? }  unique (org, item, serialNo)
```
`stock_movements` gains `batch_id uuid null`, `serial_id uuid null`.

### Contract rules
- `itemType = 'service' ⇒ trackStock = false, trackBatch = false, trackSerial = false`.
- `trackSerial ⇒ opening stock quantity must equal number of serials supplied`.
- `taxCategory != 'taxable' ⇒ gstRate = 0`.
- Barcode unique per business: 409 on duplicate.
- `minStock ≥ 0`.

### Wireframe: Add Item modal

```text
┌ Add Item ──────────────────────────────────────── (●) Product  ( ) Service  [×] ┐
│ [ Basic ]  [ Pricing & Tax ]  [ Stock & Other ]                                    │
│ Item Name *   [____________________________]    Item Code [______] [Generate ▮▮▮]│
│ Category      [ Stationery ▾ ] [+]               Unit * [ PCS ▾ ]  [+ Secondary]  │
│ HSN / SAC     [ 4820 ] [🔍 Search]               Description [_______________]     │
│ Image         [ Upload ]                                                            │
├────────────────────────────────────────────────────────────────────────────────────┤
│ Sale price    [₹ 10.00]  (●) without tax ( ) with tax    Discount [__] (●)% ( )₹    │
│ Wholesale     [₹ 9.00]   min qty [10]                    MRP [₹ 12.00]              │
│ Purchase price[₹ 6.00]   (●) without tax ( ) with tax                               │
│ GST rate *    [ 18% ▾ ]  Cess [__ %]                                                │
│ Tax category  (●) Taxable ( ) Exempt ( ) Nil-rated ( ) Non-GST                      │
├────────────────────────────────────────────────────────────────────────────────────┤
│ [x] Track stock   Opening qty [120]  at ₹ [6.00]  as of [01-04-2026]  Location [A3]│
│ Minimum stock to maintain [20]                                                      │
│ [ ] Track batch (batch no, mfg, exp)    [ ] Track serial numbers                    │
│                                           [ Cancel ] [ Save & New ] [  Save  ]     │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Service mode hides: Track stock block, wholesale, MRP, batch, serial; shows **SAC** and "Default rate".

### Behaviours
- HSN search dialog uses `tax-engine/hsn.ts`; selecting an HSN suggests GST rate (user can override, small "suggested" chip).
- Price toggles ("with tax / without tax"): the stored value is whatever the user typed plus the flag; invoice lines convert using `tax-engine/lineTax.ts`.
- Generate barcode: writes `ITM` + 8 digit sequence from the business counter, or EAN-13 if the user chose EAN in Settings > Item.
- Changing unit after movements exist is blocked (409) because conversions would silently change history; allow adding secondary units only.

### Use cases
| # | Scenario | Expected |
|---|---|---|
| 1 | Create service "Web design" with SAC 998314, 18% | No stock UI; appears in Sale picker with "Service" chip |
| 2 | Product with batch tracking, sale of 5 | LinesGrid asks to pick batch (FEFO default: earliest expiry first) |
| 3 | Serial item sale of 2 | Opens serial picker for 2 in-stock serials, rejects sold serial |
| 4 | Exempt item sold in intra-state invoice | GST 0, appears in GSTR-1 Table 8 and 3B 3.1(c) (Phase 10 completes) |
| 5 | Opening stock back-dated before FY | Allowed only if the period is not locked |
| 6 | Price including tax 118 @18% | Taxable 100, tax 18, total 118 |

### Acceptance
1. Contract tests for each refinement.
2. A service cannot receive stock movements (API 422 `VALIDATION`).
3. Low-stock query `stock <= min_stock` uses an index and returns in < 100 ms for 10k items.

## P1-S6 Items list and Item drawer

### Wireframe: list

```text
┌ Items ──────────────────────────────────────────────── [ Import ▾ ] [ + Add Item ] ┐
│ [🔍 Search name / code / HSN / barcode] [Category ▾] [Type ▾] [Stock: All|Low|Out ▾]│
│ ┌ Stock value ₹4,12,000 ┐ ┌ Low stock 5 ┐ ┌ Out of stock 2 ┐ ┌ Items 132 ┐          │
│ ┌──┬────────────┬──────┬────────────┬──────────┬───────────┬────────┬─────────┬───┐ │
│ │☐ │ Item       │ Code │ Category   │ Sale ₹   │ Purchase ₹│ Stock  │ Value ₹ │ ⋮ │ │
│ │☐ │ Pen Blue   │ P01  │ Stationery │ 10.00    │ 6.00      │ 120 PCS│ 720.00  │ ⋮ │ │
│ │☐ │ Web Design │ S01  │ Services   │ 5,000.00 │ –         │ –      │ –       │ ⋮ │ │
│ └──┴────────────┴──────┴────────────┴──────────┴───────────┴────────┴─────────┴───┘ │
│ Selected: [Adjust stock] [Change category] [Bulk update] [Print barcodes] [Delete]   │
└──────────────────────────────────────────────────────────────────────────────────────┘
```
Stock cell turns red when ≤ min stock (chip "Low") or ≤ 0 ("Out"). Purchase price column hidden for roles with `items.hidePurchasePrice`.

### Drawer (peek, 480 px)
```text
┌ Pen Blue                          [Edit] [×] ┐
│ Code P01 · HSN 4820 · GST 18% · PCS          │
│ Stock 120 PCS   Value ₹720   Min 20          │
│ [Adjust stock]  [Add to sale]                │
│ [ Transactions ][ Stock history ][ Rates ]   │
│ 06-11 Sale  INV-12 Ravi   −10   @10.00       │
│ 05-11 Purch PUR-3 Om     +100   @6.00        │
└──────────────────────────────────────────────┘
```

### Acceptance
1. Stock value equals `Σ qty × weighted average cost` and equals Stock Summary report footer.
2. Drawer opens without navigation; URL gets `?item=<id>` so it is shareable.

## P1-S7 Import wizards

### Shared wizard engine (`features/import-export/ImportWizard.jsx`)
Steps: **Method → Template/Upload → Map columns → Preview & fix → Import → Result**.

```text
Stepper:  ① Method  ② Upload  ③ Map columns  ④ Preview  ⑤ Done
```

### Wireframe: Import Items method chooser (matches the Vyapar screenshot)

```text
┌ Import Items ─────────────────────────────────────────────────────────────────────┐
│                          Select Import Method                                      │
│  ┌─────────────────────────────┐        ┌─────────────────────────────┐            │
│  │ ◉ [RECOMMENDED]           ○ │        │                           ○ │            │
│  │      (  👑  )               │        │      (  📗  )               │            │
│  │  Import From Barcode        │        │  Import From Excel          │            │
│  │  Scan or type barcodes,     │        │  Upload .xlsx / .csv using  │            │
│  │  we fill the details        │        │  our template               │            │
│  └─────────────────────────────┘        └─────────────────────────────┘            │
│                         ───────────  OR  ───────────                               │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │ Import From Library                                                        ◉ │  │
│  │ Pick from a starter catalogue by business type                              │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│                                                                   [  Continue  ]   │
└────────────────────────────────────────────────────────────────────────────────────┘
```

### Excel path: items

| Step | UI | Rules |
|---|---|---|
| Upload | Dropzone; **Download template** link (generated `.xlsx` with header row, one sample row, data validation lists for unit/GST/type) | max 5,000 rows, 5 MB |
| Map columns | left: detected headers, right: Ledgora field select, auto-matched by fuzzy name; unmapped required fields highlighted | remembers last mapping in `localStorage('import.items.map')` |
| Preview | table of first 100 rows with per-cell error badges; summary "480 valid, 12 with errors, 8 duplicates" | filter **Errors only**; edit cell inline; download error report CSV |
| Duplicates | radio: **Skip** / **Update existing** (match by code, else name) / **Create anyway** | |
| Import | progress bar; chunked 200 rows per request | partial success allowed; result lists created/updated/skipped/failed |

Items template columns (order fixed): `Item Name*`, `Item Code`, `Item Type (Product/Service)`, `Category`, `Unit*`, `HSN/SAC`, `Sale Price`, `Sale Price Incl Tax (Y/N)`, `Purchase Price`, `Purchase Price Incl Tax (Y/N)`, `GST %`, `Cess %`, `Tax Category`, `MRP`, `Wholesale Price`, `Min Stock`, `Opening Stock`, `Opening Stock Rate`, `Opening Stock Date`, `Location`, `Barcode`, `Description`.

Row-level validations (shared pure module `tax-engine/importValidate.ts` so API and web agree):
| Check | Message |
|---|---|
| name empty | "Item name is required" |
| unit unknown | "Unit 'XYZ' not found. Add it or pick one of PCS, KGS…" |
| GST % not in rate list (0, 0.25, 3, 5, 12, 18, 28 + custom) | "GST % must be one of …" |
| HSN not 4/6/8 digits | "HSN must be 4, 6 or 8 digits" |
| negative price | "Price cannot be negative" |
| service with opening stock | "Services cannot have stock" |
| duplicate code inside the file | "Duplicate code at row 14" |

### Barcode method
Reader input accepts a USB scanner (keystroke burst ending in Enter) or camera (`BarcodeDetector` API where available). Lookup order: (1) existing items by barcode → "already exists, open it", (2) bundled starter catalogue (JSON in `apps/web/public/catalog/barcodes.json`, ships empty plus a small seed), (3) not found → manual mini-form. ⚠️ Open decision: licensed 100M barcode dataset (blueprint 4.9 #2). Until decided, implement (1) and (3) only and show method as **Beta**.

### Library method
Starter catalogues per business type (Retail, Wholesale, Restaurant, Pharmacy, Service) as versioned JSON `catalog/<type>.json` with `name, unit, hsn, gst, saleHint`. User ticks items and imports; prices left blank to fill later.

### Import Parties
Same engine. Template columns: `Party Name*`, `Party Type`, `Phone`, `Email`, `Contact Person`, `Group`, `GSTIN`, `GST Type`, `State`, `Billing Address`, `City`, `PIN`, `Opening Balance`, `Balance Type (To Collect/To Pay)`, `Opening Date`, `Credit Limit`, `Credit Mode`, `Payment Terms Days`. Duplicate detection by GSTIN, then phone, then name. "Create missing groups" checkbox.

### API
| Method | Path | Notes |
|---|---|---|
| POST | `/v1/import/items/validate` | body rows → `{ rows: [{ index, errors[], status }] }`, no writes |
| POST | `/v1/import/items/commit` | body `{ rows, duplicateMode }` → `{ created, updated, skipped, failed[] }`, idempotent via `importId` |
| POST | `/v1/import/parties/validate` / `commit` | same shape |
| GET | `/v1/import/templates/:kind.xlsx` | generated server-side with exceljs or client-side `xlsx.js` ✅ |

### Use cases
| # | Scenario | Expected |
|---|---|---|
| 1 | Upload file with Vyapar's own export | Fuzzy mapping matches ≥ 90 % of headers |
| 2 | 12 rows have unknown unit | Preview marks them, **Fix** dropdown offers nearest unit, bulk "Apply to all" |
| 3 | Network drop at 60 % | Resume: `importId` makes re-sent chunks idempotent |
| 4 | Import 5,000 items | Completes < 60 s, UI stays responsive |
| 5 | User uploads `.xls` (old Excel) | Friendly error "Save as .xlsx or .csv" |

### Acceptance
1. Method chooser matches wireframe; Continue disabled until a method is selected.
2. Preview error counts equal server validation counts.
3. Rollback: if a commit chunk fails with a DB error, only that chunk is reported failed; earlier chunks stay.
4. `BulkCsvImport.jsx` is either replaced or becomes the CSV adapter inside the new wizard (no duplicate parser).

## P1-S8 Stock adjust and bulk update

### Stock Adjust modal
```text
┌ Adjust Stock ─────────────────────────────────── [×] ┐
│ Item *        [ Pen Blue ▾ ]   Current: 120 PCS       │
│ (●) Add stock   ( ) Reduce stock                      │
│ Quantity *    [ 10 ] PCS     At price [₹ 6.00]        │
│ Date          [06-11-2026]   Batch [ ▾ ] (if tracked) │
│ Remarks       [ Damaged in transit ____________ ]     │
│ New stock after adjustment: 130 PCS                   │
│                              [ Cancel ] [  Save  ]    │
└────────────────────────────────────────────────────────┘
```
Writes `stock_movements(reason='adjustment', qty ±)`. Reducing below zero → `NEGATIVE_STOCK` unless Settings > Transaction allows it.

### Bulk update grid
```text
┌ Update Items in Bulk ──────────────────────────────────────────────────────────┐
│ Step 1: choose fields   [x] Sale price [x] GST % [ ] HSN [ ] Category [ ] Min stock │
│ Step 2: items           (filters) [Category ▾] [Select all 132]                 │
│ Step 3: rule            Sale price: ( ) Set to [__]  (●) Increase by [10] (●)%  │
│ Preview diff   Item │ Old │ New                                               │
│                Pen Blue │ 10.00 │ 11.00                                         │
│                                        [ Cancel ] [ Apply to 132 items ]        │
└─────────────────────────────────────────────────────────────────────────────────┘
```
Apply runs in one transaction; writes an audit row with the count and the rule; Undo toast for 30 s restores previous values from a temp copy.

### Acceptance
1. Adjust writes exactly one movement; stock report reflects immediately.
2. Bulk update applies percent changes with 2-decimal rounding (half-up) and shows the same numbers in preview and result.

## Phase 1 test plan

| Area | Tests |
|---|---|
| Contracts | party refinements (8 cases), item refinements (8 cases), import row validation (14 cases) |
| API | party group CRUD + cycle guard + delete-with-move; addresses atomic replace; item barcode uniqueness; import idempotency; isolation per module |
| Web | Combobox create-inline, DataTable selection with bulk bar, ImportWizard mapping persistence, MoneyInput |
| E2E | create group → create party in it → create category → create item → import 50 items → adjust stock → open drawer |

## Phase 1 acceptance (whole phase)
1. All eight slices merged and individually accepted.
2. Existing invoices and purchases open unchanged; GSTR-1 JSON for a fixed sample identical to the pre-phase golden file.
3. Parties and Items screens use only P0 components (no bespoke tables).
4. USER_GUIDE gains "Parties", "Items" and "Import" sections.

### Claude prompt for Phase 1
```text
Implement Phase 1 of docs/VYAPAR_IMPLEMENTATION_PHASES.md slice by slice (P1-S1 … P1-S8).
For each slice: write contract tests first, then schema + migration 0008 (append, never edit), then the API module
following apps/api/src/modules/parties.ts, then the web screen using only P0 components.
Run pnpm lint typecheck test after each slice and stop for review at the end of every slice.
Never change gstr-1 output; if a golden test diffs, stop and report.
```

---

# PHASE 2: Sale enhancements

**Goal**: a sale can be created and paid in one screen (cash, UPI, bank, cheque, split), with salesman, additional charges, credit-limit checks, and a richer Payment In voucher.
**Prerequisites**: P1-S2 (credit fields), P1-S5 (tax category, batch/serial), P0 components.
**Flag**: `sale.inlinePayments` (default off until P2-S2 acceptance, then on).
**Slices**: P2-S1 Salesman master · P2-S2 Inline payments · P2-S3 Additional charges · P2-S4 Credit limit and cash-limit guards · P2-S5 Payment In upgrade (TDS, discount, cheque) · P2-S6 Sale Return and Sale Order upgrades · P2-S7 Single-page editor with live preview.

## P2-S1 Salesman master

### Data
```ts
export const staff = pgTable('staff', {
  ...base(), name: text('name').notNull(), phone: text('phone').notNull().default(''),
  userId: text('user_id'),                       // optional link to a login
  commissionPct: numeric('commission_pct', { precision: 5, scale: 2, mode: 'number' }).notNull().default(0),
  monthlyTarget: money('monthly_target').notNull().default(0),
  active: boolean('active').notNull().default(true),
}, (t)=>[ unique('staff_org_id_id').on(t.orgId, t.id) ]);
// invoices gets: salesman_id uuid null (composite FK to staff)
```
Contract `staffInput`: `name` 1–100, `phone` optional 10 digits, `commissionPct` 0–100, `monthlyTarget` ≥ 0.
Endpoints: `GET/POST/PATCH/DELETE /v1/staff`, `GET /v1/staff/:id/performance?from&to` → `{ sales, collected, outstanding, commission, targetPct, invoices[] }`. Permission `staff.view|create|edit|delete`.

### Wireframe
```text
┌ Salesman ──────────────────────────────────────────────── [ + Add Salesman ] ┐
│ Name   │ Phone     │ Target (month) │ Sales this month │ Collected │ Commission │
│ Kumar  │ 98…       │ ₹5,00,000      │ ₹3,20,000 (64%)  │ ₹2,10,000 │ ₹6,400     │
└────────────────────────────────────────────────────────────────────────────────┘
Add Salesman modal: Name* · Phone · Linked user [▾] · Commission % [__] · Monthly target [₹__] · Active ☑
```
Commission rule (pure fn `commission({ sales, collected, basis, pct })`; basis in Settings: on sale or on collection): default on **sale net of GST and returns**.

### Use cases
| # | Scenario | Expected |
|---|---|---|
| 1 | Owner picks salesman on invoice | Stored; list can filter by salesman |
| 2 | Salesman logs in (role Salesman) | Sees only own invoices and their parties |
| 3 | Credit note against Kumar's invoice | Commission recomputed lower |
| 4 | Deactivate salesman | Hidden in pickers; history intact |

### Acceptance
1. Performance numbers equal the Sale Report filtered by salesman for a seeded month.
2. Role "Salesman" cannot read other salesman's invoices (API-level filter, tested).

## P2-S2 Inline payments (pay at time of sale)

### Why
Vyapar's Add Sale has Payment type (Cash / Credit) and Received amount. Ledgora today creates receipts separately.

### Data
`payments` already exists with `payment_allocations`. Add:
| Column | On | Type | Notes |
|---|---|---|---|
| `direction` | payments | text default `'in'` | `in` / `out` (used from Phase 3) |
| `mode` | payments | text | `cash` / `upi` / `bank` / `cheque` / `card` / `other` |
| `account_id` | payments | uuid null | bank account (P5) or null = cash in hand |
| `reference` | payments | text | UPI ref / cheque no |
| `cheque_date` | payments | date null | |
| `discount_amount` | payments | money default 0 | payment-time discount |
| `tds_amount` | payments | money default 0 | TDS deducted by payer |
| `source` | payments | text default `'receipt'` | `receipt` / `invoice_inline` |
| `invoice_id` | payment_allocations | uuid null | exists |
| `purchase_id` | payment_allocations | uuid null | for Phase 3 |

### Contract
```ts
export const inlinePayment = z.object({
  mode: z.enum(PAYMENT_MODES), accountId: uuid.nullish(), amount: z.number().positive(),
  reference: z.string().max(80).default(''), chequeDate: isoDate.nullish(),
});
export const invoiceInput = invoiceInput.extend({ payments: z.array(inlinePayment).max(6).default([]) });
```
Rules: `Σ payments.amount ≤ invoice total` (else 422 `OVER_ALLOCATED`); `mode = 'cheque' ⇒ chequeDate required`; `mode = 'bank' | 'upi' ⇒ accountId required once P5 is on`, else optional.

### Flow
```text
Save invoice (payments=[…])
  BEGIN tx
   ├─ insert invoice + lines + totals
   ├─ stock movements (if goods)
   ├─ for each payment row: insert payments(source='invoice_inline') + allocation → this invoice
   │     └─ mode='cheque' → create cheque (status open) instead of raising bank balance  [P5]
   ├─ if Σ payments = total → invoice.paymentStatus = 'paid' else 'partial' / 'unpaid'
   ├─ [P4] post ledger entries
   └─ audit
  COMMIT
Edit invoice → payments with source='invoice_inline' are shown inside the editor; editing the total re-checks the cap;
               payments created as separate receipts stay read-only links ("Received via RCT-4")
```

### Wireframe: payment block inside Add Sale
```text
┌ Payment ──────────────────────────────────────────────────────────────────────────┐
│ Sale type  (●) Credit  ( ) Cash                                                    │
│ ┌ Mode ───────┬ Account ───────────┬ Amount ───────┬ Reference ────────┬ Cheque date ┬─┐
│ │ Cash   ▾    │ Cash in hand   ▾   │ ₹ 500.00      │                   │             │✕│
│ │ UPI    ▾    │ HDFC Current   ▾   │ ₹ 400.00      │ 3249…             │             │✕│
│ └─────────────┴────────────────────┴───────────────┴───────────────────┴─────────────┴─┘
│ [ + Add payment mode ]                         Received ₹900.00   Balance ₹ 0.00  ✔ Paid│
└─────────────────────────────────────────────────────────────────────────────────────────┘
```
"Cash" sale type: preselects one Cash row = total; party optional (uses "Cash Sale" walk-in party created on demand). Changing the invoice total while a single row exists auto-updates that row if Settings > Transaction > "Auto-fill received" is on.

### Edge cases
| Case | Behaviour |
|---|---|
| Overpay | Inline error "Received exceeds total by ₹x"; Save disabled |
| Cheque payment | Row shows post-dated chip when cheque date > today |
| Cancel invoice | Inline payments are reversed (soft-deleted) and the cheque (if open) cancelled |
| Credit note later | Refund handled in credit-note flow (P2-S6) |
| Existing invoice with earlier receipt | Block shows read-only "Received ₹5,000 via RCT-4" row plus new rows for the remaining balance |

### Acceptance
1. Save with two rows creates two `payments` and two allocations; invoice status "paid".
2. Editing total down below received amount is rejected.
3. Flag off: block hidden; behaviour unchanged.
4. Outstanding report agrees with ledger-free computation before P4 and with the ledger after P4.

## P2-S3 Additional charges

### Data and contract
Stored in `invoices.data.charges[]` (existing jsonb) as:
```ts
{ id, name: 'Shipping', amount: 100, gstRate: 18, hsn: '9965', taxable: true }
```
Settings > Transaction holds named presets (Shipping, Packaging, Installation…, each with default GST %, SAC). Charges are **taxable supplies** at their own rate: they add to taxable value and to tax in totals.

### tax-engine changes (`totals.ts`)
`computeTotals(lines, { charges, discount, tcs, roundOff, placeOfSupply })`:
1. line taxable values (after line discount)
2. transaction discount spread proportionally across lines (existing)
3. charges: each charge forms a pseudo-line with its own rate; tax split CGST/SGST or IGST by place of supply
4. TCS on (taxable + tax)
5. round-off to nearest rupee (setting: nearest/up/down)
Tests: 12 golden cases incl. mixed rates (18% goods + 5% shipping), IGST, zero-rated charge, discount + charge, round-off up/down. Totals for invoices **without** charges must be byte-identical to existing results (regression test over the 20 existing `tax.test.js` fixtures).

GSTR-1 impact: charges with a different rate than goods are listed in the rate-wise tables (B2CS, HSN Table 12 as a row with the charge's SAC). Verify via `gstReturnTables.test.js` additions.

### Wireframe
```text
┌ Additional charges ─────────────────────────────────────────────────┐
│ Name [ Shipping ▾ ]  Amount [₹ 100.00]  GST [18% ▾]  SAC [9965]  [✕] │
│ Name [ Packaging ▾ ] Amount [₹  50.00]  GST [ 5% ▾]  SAC [____]  [✕] │
│ [ + Add charge ]                                                     │
└──────────────────────────────────────────────────────────────────────┘
Totals: Sub total · Discount · Charges · CGST · SGST · (IGST) · TCS · Round off · TOTAL
```

### Acceptance
1. Totals with and without charges match golden tests.
2. Print template renders charges as separate rows (Print settings toggle).
3. Credit note against such an invoice can return charges proportionally.

## P2-S4 Credit limit and cash-limit guards

### Rules
| Guard | Trigger | Result | Source of rule |
|---|---|---|---|
| Credit limit | save invoice for party with `credit_mode != none`, `used + new balance > limit` | `warn`: confirm dialog "Exceeds limit by ₹x. Continue?"; `block`: save refused with `CREDIT_LIMIT` | Party settings |
| §269ST cash | Σ cash received from one party in a day (or per invoice / per event) ≥ ₹2,00,000 | red banner, save allowed with typed acknowledgement; logged | IT Act |
| §40A(3) cash payment | cash paid to one supplier in a day > ₹10,000 (Phase 3) | amber banner; flagged in IT cash watch | IT Act |
| Negative stock | line qty > stock, tracked item | warn or block per Settings > Transaction | |
| Period lock | invoice date ≤ lock date or in a filed GST month | `PERIOD_LOCKED` unless owner override | Settings, filing markers |
| E-way bill | invoice goods value > ₹50,000 (setting) | prompt "Generate e-way bill JSON after saving?" | |

Pure functions: `creditCheck` (exists, extend), `cashLimitCheck({ dayCashTotal, newCash, limit=200000 })`, `periodLocked({ date, lockDate, filedMonths, role })`, all in `tax-engine` with tests.

### Wireframe: credit warning dialog
```text
┌ Credit limit exceeded ───────────────────────────────────┐
│ Ravi Traders has a limit of ₹50,000.                      │
│ Outstanding ₹42,000 + this sale ₹18,000 = ₹60,000         │
│ Exceeds by ₹10,000.                                       │
│                  [ Go back ]  [ Save anyway ]             │
└───────────────────────────────────────────────────────────┘
(block mode shows only [ Go back ] and an "Ask owner to approve" link)
```

### Acceptance
1. Each guard has a unit test and an API test; block mode cannot be bypassed by direct API call.
2. Owner override leaves an audit row with reason.

## P2-S5 Payment In upgrade

### New voucher fields
`Party*`, `Receipt No` (series), `Date`, `Mode`, `Account`, `Reference`, `Cheque date`, `Amount received*`, `Discount given`, `TDS deducted`, `Allocation grid`, `Notes`, `Attachment`.
Math: `settled = amount + discount + tds`; allocations must sum to ≤ settled; leftover = **advance** (party credit). Pure fn `allocateReceipt({ amount, discount, tds, invoices, strategy })` exists in `tax-engine/payments.ts`: extend for `discount` and `tds`; strategies `oldest_first`, `manual`.

### Wireframe
```text
┌ Payment In ───────────────────────────────────────────────────────────────────────┐
│ Party* [Ravi Traders ▾]  Balance ₹12,000 To Collect          Receipt No [RCT-005]   │
│ Date [06-11-2026]   Mode [Bank ▾]  Account [HDFC Current ▾]  Reference [UTR…]       │
│ Amount received* [₹ 5,000]  Discount [₹ 100]  TDS deducted [₹ 0]                    │
│ ┌ Link to invoices ─────────────────────────────────────────────────────────────┐   │
│ │☑ INV-12  02-11-26  Total 8,260  Pending 8,260  Settle [5,100]                 │   │
│ │☐ INV-09  20-10-26  Total 3,740  Pending 3,740  Settle [____]                  │   │
│ │ [Auto-allocate oldest first]   Allocated 5,100 / 5,100   Advance ₹0           │   │
│ └───────────────────────────────────────────────────────────────────────────────┘   │
│ Notes [__________]  Attach [📎]                              [ Cancel ] [  Save  ]  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Flow
```text
Pick party → load pending invoices (oldest first) → user types amount → "Auto-allocate" fills Settle column
 → user can edit Settle cells (cap = pending) → Save
   ├─ allocated < settled → ask "Keep ₹x as advance?" (Yes default)
   ├─ mode=cheque → create open cheque (P5), bank not credited until cleared
   └─ POST /v1/payments {direction:'in', …allocations[]}
```

### Use cases
| # | Scenario | Expected |
|---|---|---|
| 1 | Customer pays ₹5,000 against two invoices | Oldest gets filled first, status partial/paid correct |
| 2 | Customer deducts TDS 2% | TDS amount reduces receivable and is recorded in TDS receivable (P10) |
| 3 | Overpayment | Advance stored; next invoice offers "Adjust advance ₹x" |
| 4 | Cash payment ≥ ₹2 lakh | §269ST banner |
| 5 | Delete a receipt | Allocations removed, invoice balances restored, ledger reversed |

### Acceptance
1. `allocateReceipt` tests: exact, partial, over, discount, TDS, many invoices.
2. Editing a receipt re-computes statuses of both old and new invoices in one transaction.

## P2-S6 Sale Return / Credit Note and Sale Order upgrades

### Credit Note fields (additions)
| Field | Type | Notes |
|---|---|---|
| Against invoice | select (✅) | prefills lines with qty ≤ remaining returnable |
| Reason | enum | Sales return, Post-sale discount, Deficiency in service, Correction, Others (GSTR-1 CDNR reason) |
| Restock | toggle | default on for goods; writes `stock_movements(reason='sale_return')` |
| Refund | radio | Adjust party balance / Cash refund / Bank refund (account) |

Pure fn `returnableQty(invoiceLines, priorCreditNotes)` prevents returning more than sold.
Refund = a `payments` row with `direction='out'`, `source='credit_note_refund'`.

### Sale Order fields
`Advance received` (creates inline payment), `Expected delivery date`, `Status` (Open, Partially invoiced, Closed, Cancelled) derived from converted quantities; **Convert to Invoice** partial qty per line; `Order balance` = ordered − invoiced per line.

```text
┌ Sale Order ORD-007 ───────────────────────────────── Status: Partially invoiced ┐
│ Item        │ Ordered │ Invoiced │ Pending │ [Convert qty] │                     │
│ Pen Blue    │ 100     │ 40       │ 60      │ [ 60 ]        │                     │
│                           [ Convert selected to Invoice ]                         │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### Acceptance
1. Cannot over-return; partial conversions update statuses; Sale Order Item report (P6) matches.

## P2-S7 Single-page editor with live preview

### Decision recap
Blueprint 5.12 #3 and #4. Default: **single page**, preview on, stepper optional (setting "Step-by-step creator").

### Layout (Template B)
```text
┌ Add Sale [Tax Invoice ▾]    (○ Credit ● Cash)                       [⚙]  [ Preview ◀▶ ] ┐
│ ┌ LEFT (flex 1) ───────────────────────────────────────┐ ┌ RIGHT preview 420px ───────┐ │
│ │ Bill To card │ Invoice Details card                  │ │ ┌ TAX INVOICE ───────────┐ │ │
│ │ Items grid (LinesGrid)                               │ │ │ live render of draft   │ │ │
│ │ Charges · Totals card                                │ │ └────────────────────────┘ │ │
│ │ Payment block · Terms & notes · Attachments          │ │ [Template ▾] [Zoom]        │ │
│ └──────────────────────────────────────────────────────┘ └────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ [Share ▾] [Print ▾]                                           [ Save & New ] [  Save  ] │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```
Reuse hooks untouched: `useInvoiceTotals`, `useInvoiceDraft`. The editor remains one component with configuration by `type`.

### Field table (complete Add Sale)
| Section | Field | Type | Req | Notes |
|---|---|---|---|---|
| Bill To | Party | Combobox | ✔ credit / – cash | shows balance, credit state, phone |
| | Billing address | text | | prefilled |
| | Ship to | select | | party addresses or "Same" |
| Details | Invoice type | select | ✔ | six document types |
| | Number | text | ✔ | next in series, editable if allowed |
| | Date | date | ✔ | default today, within open FY |
| | Due date | date | | date + terms |
| | Place of supply | StateSelect | ✔ | default party state |
| | PO number/date | text/date | | |
| | E-way bill / Vehicle | text | | shown if goods and value > threshold |
| | Salesman | select | | P2-S1 |
| | Reverse charge | checkbox | | P10 |
| Items | Item, HSN, Qty, Unit, Rate, Disc %, Disc ₹, GST %, Cess, Batch/Serial, Amount | LinesGrid | ≥ 1 row | |
| Charges | Name, amount, GST, SAC | rows | | P2-S3 |
| Totals | Discount (txn), TCS %, Round-off | | | |
| Payment | rows | | | P2-S2 |
| Footer | Terms, notes, attachments, signature, description | | | |

### Flow: create invoice
```text
Open /invoices/new?type=tax-invoice[&party=…]
 → draft restored if exists (useInvoiceDraft)
 → pick party → address, balance, state, credit state load; rates from party item rates (P1-S2)
 → add lines (scan barcode / search / Enter adds row)
 → totals recalc on every change (tax-engine)
 → guards run (credit, stock, cash limit) on Save, results appear as dialogs
 → Save → POST /v1/invoices → toast "Invoice INV-13 saved" → stays on page (Save & New) or goes to detail
```

### Acceptance
1. Feature parity with the stepper (every field reachable).
2. Preview stays in sync under 300 ms with 100 lines.
3. Keyboard-only creation of a 3-line invoice possible (documented script in the PR).

## Phase 2 test plan
| Layer | Cases |
|---|---|
| tax-engine | totals with charges (12), allocateReceipt (10), creditCheck (6), cashLimitCheck (4), commission (4), returnableQty (5) |
| API | invoice+inline payments transaction, over-allocation, period lock, credit block, salesman scoping, credit-note refund, isolation |
| Web | PaymentBlock math, LinesGrid keyboard, ChargeRows totals |
| E2E | cash sale; credit sale + partial payment; credit sale over limit warn; sale order → partial invoice → invoice; credit note refund |

## Phase 2 acceptance
1. GSTR-1/3B golden files unchanged for existing data, and changed only as intended for new charge fixtures.
2. A new user can complete a cash sale in under 60 seconds (timed run).
3. Flag-off build equals current behaviour.

### Claude prompt for Phase 2
```text
Implement Phase 2 slices in order P2-S1…P2-S7 from docs/VYAPAR_IMPLEMENTATION_PHASES.md.
Before P2-S3 capture golden outputs of computeTotals for the 20 fixtures in apps/web/test/tax.test.js.
Anything touching packages/tax-engine/src/totals.ts must keep those outputs byte-identical when no charges are given.
Put new behaviour behind the sale.inlinePayments flag until P2-S2's acceptance list passes.
```

---

# PHASE 3: Purchase side

**Goal**: complete the buy-side document set with correct ITC and stock effects.
**Prerequisites**: P1 (masters), P2-S2 (generalised `payments` with `direction`).
**Slices**: P3-S1 Purchase Bill upgrades · P3-S2 Payment Out · P3-S3 Purchase Order · P3-S4 Purchase Return / Debit Note · P3-S5 Expenses upgrade and expense items · P3-S6 Other Income.

## P3-S1 Purchase Bill upgrades

### Fields added
| Field | Type | Notes |
|---|---|---|
| Our reference | text | auto from series `PUR-` |
| Supplier bill no* / date* | text/date | uniqueness `(supplier, bill no)` per FY: warn on duplicate |
| Place of supply | state | default business state |
| Reverse charge | checkbox | RCM liability, GSTR-3B 3.1(d), ITC claimable on payment |
| Line ITC flag | select | `eligible` (default), `ineligible_17_5`, `capital_goods`, `blocked`, `exempt_supply_use` |
| Additional charges | rows | same component as P2-S3 |
| TDS §194Q | checkbox + % | purchases from a supplier above ₹50 lakh in FY |
| Payment rows | rows | same as P2-S2 with `direction='out'` |
| Original bill | attachment | file |

Schema: `purchase_lines.itc_status text default 'eligible'`, `purchases.reverse_charge bool`, `purchases.place_of_supply text`, `purchases.tds_amount money`, `purchases.data.charges[]`.
Pure fn: `itcSplit(lines)` → `{ eligible, ineligible, capitalGoods }` per tax head; feeds GSTR-3B 4(A) and 4(D).

### Wireframe
```text
┌ Add Purchase ───────────────────────────────────────────────────────────────────────────┐
│ ┌ Supplier ─────────────────────────┐ ┌ Bill details ───────────────────────────────┐   │
│ │ Supplier* [Om Supplies ▾ +]       │ │ Our ref [PUR-004]  Bill no* [OM-221]        │   │
│ │ GSTIN 29BBBB… · Karnataka         │ │ Bill date* [05-11-26] Due [05-12-26]        │   │
│ │ Balance ₹4,500 To Pay             │ │ Place of supply [Karnataka ▾] RCM [ ]       │   │
│ └───────────────────────────────────┘ └─────────────────────────────────────────────┘   │
│ Items: # │ Item │ HSN │ Qty │ Unit │ Rate │ Disc │ GST% │ ITC [Eligible ▾] │ Amount │ ✕ │
│ Charges [+]   TDS §194Q [ ] __%    Round off [x]                                         │
│ Totals: Taxable · CGST · SGST · IGST · Cess · TDS · Round · TOTAL                        │
│ Payment: rows (mode, account, amount, ref) …                  Paid ₹ 0   Balance ₹ …    │
│ Original bill [📎]  Notes [___]                                  [Save & New] [ Save ]  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Flow: save purchase
```text
validate → duplicate bill check (warn)
BEGIN tx
  purchase + lines + stock movements (+qty, at landed cost incl. proportional charges)
  payments rows (direction out) + allocations(purchase_id)
  [P4] ledger posting: Dr Purchases, Dr Input CGST/SGST/IGST (eligible portion), Dr GST expense (ineligible portion)
       Cr Supplier  (and Dr Supplier / Cr Cash-Bank for payments)
  RCM: Dr Input GST (when eligible) Cr RCM liability, settled on payment
COMMIT
```

### Use cases
| # | Scenario | Expected |
|---|---|---|
| 1 | Normal B2B purchase, intra-state 18% | Eligible ITC CGST 9 + SGST 9 in 3B 4(A)(5) |
| 2 | Purchase of passenger car, §17(5) | Line flagged `ineligible_17_5`; GST added to cost, no ITC |
| 3 | Unregistered supplier above RCM notified goods | RCM checkbox; liability 3.1(d); ITC after payment |
| 4 | Duplicate bill number | Warning with link to existing bill; user can override |
| 5 | Stock-in at landed cost | Charges allocated proportionally by value into item cost |
| 6 | Supplier paid in cheque | Open cheque row; ITC 180-day timer starts from bill date (P10) |

### Acceptance
1. `itcSplit` unit tests incl. mixed lines.
2. GSTR-3B Table 4 numbers for fixtures change only for lines with non-default ITC flags.
3. Old purchases default to `eligible`, so existing 3B is unchanged.

## P3-S2 Payment Out

### Reuse
`PaymentVoucher` component with `direction='out'`; party picker filters suppliers; allocations to `purchase_id`.

### Fields
`Supplier*`, `Voucher No` (series `PAY-`), `Date`, `Mode`, `Account`, `Reference`, `Cheque date`, `Amount paid*`, `Discount received`, `TDS deducted by us`, allocations grid (pending purchase bills), notes, attachment.

### TDS deducted by us
Sections and default rates (editable master in Settings > Taxes, P8): 194C 1%/2% (individual/others), 194J 10% (2% technical), 194H 5%, 194I 10% (2% plant, 10% land), 194Q 0.1%, 194A 10%. `tdsAmount = base × rate` with threshold awareness: pure fn `tdsCalc({ section, base, ytdToDeductee, thresholds })`. Posting: Dr Supplier (gross), Cr Cash/Bank (net), Cr TDS Payable (tds).

### Wireframe
```text
┌ Payment Out ──────────────────────────────────────────────────────────────────────┐
│ Supplier* [Om Supplies ▾]  Balance ₹4,500 To Pay            Voucher No [PAY-003]    │
│ Date [06-11-2026]  Mode [Bank ▾]  Account [HDFC ▾]  Reference [NEFT…]               │
│ Amount paid* [₹ 4,455]  Discount received [₹ 0]  TDS deducted [₹ 45] §[194C ▾]     │
│ ┌ Link to bills ────────────────────────────────────────────────────────────────┐   │
│ │ ☑ OM-221 05-11-26 Total 4,500 Pending 4,500 Settle [4,500]                    │   │
│ │ [Auto-allocate oldest first]                    Allocated 4,500/4,500          │   │
│ └────────────────────────────────────────────────────────────────────────────────┘   │
│ ⚠ Cash payment to one supplier today would exceed ₹10,000 (§40A(3))                 │
│ Notes […]  Attach [📎]                                       [ Cancel ] [ Save ]   │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Acceptance
1. Allocation math identical to Payment In engine with mirrored sign.
2. TDS payable accrues per deductee per section for the Form 26Q-style report (P6).
3. Deleting a payment reverses allocations and TDS rows.

## P3-S3 Purchase Order

### Data
```ts
purchaseOrders: { id, orgId, number, supplierId, date, expectedDate, status, advance, data jsonb(charges,notes), totals… }
purchaseOrderLines: { orderId, itemId, name, hsn, qty, unit, rate, gstRate, receivedQty }
```
Status derived: `open` (receivedQty = 0), `partial`, `received`, `cancelled`.

### Flow
```text
Create PO → Save → (optional advance → payment out source='po_advance')
 → on goods arrival: row action "Convert to Purchase Bill" (choose qty per line)
      creates purchase with lines, links po_id, bumps receivedQty, status recalculated
      advance becomes an allocation against the new bill
 → Cancel PO: status cancelled, advance kept as supplier advance
```

### Wireframe
```text
┌ Purchase Orders ─────────────────────────────────────── [ + Add Purchase Order ] ┐
│ [This FY ▾][Supplier ▾][Status ▾]                                                 │
│ PO No │ Date │ Supplier │ Expected │ Status │ Total │ Advance │ Pending value │ ⋮ │
│ PO-004│ 01-11│ Om       │ 10-11    │ Partial│ 12,000│ 2,000   │ 6,000         │ ⋮ │
└───────────────────────────────────────────────────────────────────────────────────┘
Editor: same as Add Purchase minus ITC, payment and stock; extra fields PO No*, Expected delivery, Advance paid.
```

### Acceptance
1. PO has zero effect on stock, ledger, GST.
2. Partial conversion keeps remaining qty convertible; over-conversion rejected.

## P3-S4 Purchase Return / Debit Note

### Fields
`Supplier*`, `Return No` (`DN-`), `Date`, `Against bill` (select, optional), `Reason` (Purchase return, Rate difference, Quality, Other), lines (picked from the bill, qty ≤ returnable), totals, `Refund` (Adjust payable / Cash / Bank).
Pure fn `returnableQtyPurchase`. Effects: stock out (`reason='purchase_return'`), ITC reversal (3B 4(B)(2)) proportional to bill ITC status, reduces supplier payable; if refund by cash/bank creates payment `direction='in'`, `source='debit_note_refund'`.

### Wireframe
```text
┌ Debit Note / Purchase Return ─────────────────────────────────────────────────────┐
│ Supplier* [Om ▾] Return No [DN-001] Date [06-11-26] Against bill [OM-221 ▾]        │
│ Reason [Purchase return ▾]                                                         │
│ ┌ Items from bill ──────────────────────────────────────────────────────────────┐ │
│ │ ☑ Pen Blue  Billed 100  Already returned 0  Return qty [10]  Rate 6  GST 18%  │ │
│ └────────────────────────────────────────────────────────────────────────────────┘ │
│ Taxable ₹60 · CGST ₹5.40 · SGST ₹5.40 · TOTAL ₹70.80                              │
│ Refund [Adjust payable ▾]                              [ Cancel ] [ Save ]        │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Use cases
1. Return of damaged goods: stock decreases, supplier payable decreases, ITC reversed.
2. Rate difference (no goods): `Reason = Rate difference`, no stock effect, tax effect on value diff.
3. Debit note without a linked bill: allowed for old bills; user picks items manually; warning shown.

### Acceptance
1. ITC reversal appears in 3B 4(B)(2) test fixture.
2. Cannot return more than purchased minus prior returns.

## P3-S5 Expenses upgrade and expense items

### Data
`expense_items(id, name, sac, defaultRate, gstRate, defaultCategoryId)`; `expenses` gets `number`, `payee_party_id null`, `gst_amount`, `itc_eligible bool`, `payment_mode`, `account_id`, `data.items[]`.
Category tree: `expense_categories` ✅ add `parent_id`, `kind` (`direct` | `indirect`, drives P&L placement), `is_system`.

### Fields (Add Expense)
| Field | Type | Req | Notes |
|---|---|---|---|
| Expense No | auto `EXP-` | ✔ | |
| Date | date | ✔ | |
| Category | combobox + add | ✔ | |
| Payee | party combobox | | enables TDS and supplier statement |
| Items | rows: item, qty, rate, GST%, amount | | or single amount mode |
| Total amount | money | ✔ | computed or typed |
| GST paid | money | | split CGST/SGST/IGST by payee state |
| ITC eligible | checkbox | | default from category |
| Payment | mode, account, paid | | paid now or on credit (creates payable to payee) |
| Description, attachment | | | |

### Wireframe
```text
┌ Add Expense ─────────────────────────────────────────────────────────────────────┐
│ Expense No [EXP-012]  Date [06-11-2026]  Category* [Rent ▾ +]  Payee [Landlord ▾] │
│ ( ) Single amount  (●) Itemised                                                   │
│ # │ Expense item │ SAC │ Qty │ Rate │ GST % │ Amount                              │
│ 1 │ Office rent  │9972 │ 1   │ 25000│ 18    │ 29,500                              │
│ Total ₹29,500   GST paid ₹4,500  [x] ITC eligible                                  │
│ Payment: [Bank ▾] [HDFC ▾] Paid [₹ 29,500]   Balance ₹0                           │
│ Description […]  Attach receipt [📎]                          [ Save & New ] [ Save ]│
└───────────────────────────────────────────────────────────────────────────────────┘
```

### Acceptance
1. Expense with GST and ITC flag shows in 3B 4(A) test.
2. Category rollup equals Expense Category report (P6).

## P3-S6 Other Income

Same screen, route `/other-income`, mode flag `kind='income'`. Income categories seeded: Interest received, Commission, Rent received, Discount received, Misc. Fields: No `INC-`, date, category, payer (party optional), items or amount, GST (if taxable supply, goes to GSTR-1 as B2C / B2B outward supply and 3B 3.1(a)), receive-in mode/account.
Income Tax link: category `Interest received` feeds "Income from other sources"; exempt income (e.g., agricultural) flagged `exempt`.

### Acceptance
1. Income appears in P&L "Other income"; GST income appears in GSTR-1 totals; exempt income in 3B 5.

## Phase 3 test plan
| Layer | Cases |
|---|---|
| tax-engine | itcSplit (8), tdsCalc (10), returnableQtyPurchase (5), landed-cost allocation (6) |
| API | purchase+payments tx, duplicate bill check, PO conversion partial, debit note over-return, TDS thresholds, isolation |
| Web | ITC dropdown logic, PO conversion dialog, PaymentVoucher out mode |
| E2E | PO → partial bill → payment out with TDS → debit note → check 3B numbers |

## Phase 3 acceptance
1. Document set complete; each document reachable from Purchase & Expense menu.
2. 3B 4(A)/4(B) fixtures pass; old data unchanged.
3. Supplier statement equals sum of bills − payments − returns.

### Claude prompt for Phase 3
```text
Implement Phase 3 (P3-S1…P3-S6). Reuse PaymentVoucher, LinesGrid and Charges components from Phase 2/0.
Generalise rather than copy: purchases and sales must share the allocation engine in tax-engine/payments.ts.
For any GST number that changes, add a fixture in apps/web/test/gstReturnTables.test.js showing before/after.
```

---

# PHASE 4: Ledger foundation

**Goal**: every transaction posts balanced ledger entries, so Cash & Bank, Day Book, Trial Balance, Balance Sheet, Bank Statement and Party Statement become queries over one table and are correct by construction.
**Prerequisites**: P2 and P3 merged (documents stable).
**Flag**: `accounting.ledger` (per business). Off: documents behave exactly as today. On: documents also post entries.
**Slices**: P4-S1 Chart of accounts · P4-S2 Posting engine (pure) · P4-S3 Posting wiring in API · P4-S4 Backfill · P4-S5 Verify My Data (basic) · P4-S6 Period lock and FY table · P4-S7 Ledger viewer UI.
**Open decision**: ledger-lite vs full double entry with manual journals (blueprint 4.9 #3). This guide implements **ledger-lite + optional manual journal** in P4-S7 so the table can already carry both.

## Concept map

```text
  Document (invoice, purchase, payment, expense, transfer, loan, cheque, adjustment)
        │  posting function (pure, in tax-engine/posting.ts)
        ▼
  PostingLines[]  =  [{ account, debit, credit, narration, partyId? }]   ← must balance (Σdebit = Σcredit)
        │  API writes in the same transaction as the document
        ▼
  ledger_entries  (append-only; reversal = counter entry; edit = reverse + repost)
        │
        ▼
  Reports: Day Book · Party Statement · Bank Statement · Cash Flow · Trial Balance · P&L · Balance Sheet
```

## P4-S1 Chart of accounts

### Data
```ts
export const accounts = pgTable('accounts', {
  ...base(),
  businessId: uuid('business_id').notNull(),
  code: text('code').notNull(),                         // '1100'
  name: text('name').notNull(),
  group: text('group').notNull(),                       // see group table
  kind: text('kind').notNull(),                         // asset | liability | income | expense | equity
  system: boolean('system').notNull().default(false),   // cannot delete or rename code
  partyId: uuid('party_id'), bankAccountId: uuid('bank_account_id'), loanId: uuid('loan_id'),
  active: boolean('active').notNull().default(true),
}, (t)=>[ unique('accounts_org_id_id').on(t.orgId, t.id), unique('accounts_biz_code').on(t.orgId, t.businessId, t.code) ]);

export const ledgerEntries = pgTable('ledger_entries', {
  ...base(),
  businessId: uuid('business_id').notNull(),
  txnDate: date('txn_date').notNull(),
  accountId: uuid('account_id').notNull(),
  debit: money('debit').notNull().default(0),
  credit: money('credit').notNull().default(0),
  refType: text('ref_type').notNull(),                  // invoice|purchase|payment|expense|transfer|loan|cheque|adjustment|journal|opening
  refId: uuid('ref_id').notNull(),
  voucherId: uuid('voucher_id').notNull(),              // groups lines of one posting; Σdebit=Σcredit per voucher
  partyId: uuid('party_id'),
  narration: text('narration').notNull().default(''),
  fy: text('fy').notNull(),                             // '2026-27'
  reversalOf: uuid('reversal_of'),
}, (t)=>[
  index('le_org_acct_date').on(t.orgId, t.accountId, t.txnDate),
  index('le_org_ref').on(t.orgId, t.refType, t.refId),
  index('le_org_party_date').on(t.orgId, t.partyId, t.txnDate),
  check('le_one_side', sql`(debit = 0) <> (credit = 0)`),   // exactly one side non-zero
]);
```
Constraint trigger `ledger_voucher_balanced` (deferred, per voucher) rejects commit when Σdebit ≠ Σcredit.
`ledger_entries` has **no UPDATE or DELETE policy** for the app role; corrections are new rows.

### Default chart (seeded per business on enabling the ledger)

| Code | Name | Group | Kind | System |
|---|---|---|---|---|
| 1000 | Cash in Hand | Cash | asset | ✔ |
| 1100 | (each bank account) | Bank | asset | created with the bank account |
| 1200 | Cheques in Hand (received) | Current assets | asset | ✔ |
| 1300 | Accounts Receivable control | Receivables | asset | ✔ (parties are sub-ledgers via `party_id`) |
| 1400 | Stock in Hand | Inventory | asset | ✔ (valuation entries at period end only) |
| 1500 | Input CGST | Duties & taxes | asset | ✔ |
| 1510 | Input SGST | Duties & taxes | asset | ✔ |
| 1520 | Input IGST | Duties & taxes | asset | ✔ |
| 1530 | Input Cess | Duties & taxes | asset | ✔ |
| 1600 | TDS Receivable | Duties & taxes | asset | ✔ |
| 1610 | TCS Receivable | Duties & taxes | asset | ✔ |
| 1700 | Fixed Assets | Fixed assets | asset | |
| 2000 | Accounts Payable control | Payables | liability | ✔ |
| 2100 | Output CGST | Duties & taxes | liability | ✔ |
| 2110 | Output SGST | Duties & taxes | liability | ✔ |
| 2120 | Output IGST | Duties & taxes | liability | ✔ |
| 2130 | Output Cess | Duties & taxes | liability | ✔ |
| 2140 | RCM Payable | Duties & taxes | liability | ✔ |
| 2200 | TDS Payable | Duties & taxes | liability | ✔ |
| 2210 | TCS Payable | Duties & taxes | liability | ✔ |
| 2300 | Loans (each loan) | Loans | liability | created per loan |
| 2400 | Cheques Issued (uncleared) | Current liabilities | liability | ✔ |
| 3000 | Owner's Capital | Equity | equity | ✔ |
| 3100 | Retained Earnings / Opening Balance Equity | Equity | equity | ✔ |
| 4000 | Sales | Direct income | income | ✔ |
| 4010 | Sales Return | Direct income | income | ✔ |
| 4100 | Other Income | Indirect income | income | ✔ |
| 4110 | Discount Received | Indirect income | income | ✔ |
| 4120 | Additional Charges Income | Direct income | income | ✔ |
| 4130 | Round-off Gain | Indirect income | income | ✔ |
| 5000 | Purchases | Direct expense | expense | ✔ |
| 5010 | Purchase Return | Direct expense | expense | ✔ |
| 5100 | Expenses (one account per expense category) | Indirect expense | expense | per category |
| 5200 | Discount Allowed | Indirect expense | expense | ✔ |
| 5210 | Bank Charges | Indirect expense | expense | ✔ |
| 5220 | Loan Interest | Indirect expense | expense | ✔ |
| 5230 | Round-off Loss | Indirect expense | expense | ✔ |
| 5240 | Salesman Commission | Indirect expense | expense | ✔ |
| 5250 | Ineligible GST expensed | Indirect expense | expense | ✔ |
| 5260 | Forex Gain/Loss | Indirect | expense | ✔ |

Parties are **not** separate accounts in the list; party ledgers are the control accounts (1300/2000) filtered by `party_id`. This keeps the chart short while statements stay per-party.

### Wireframe: Chart of Accounts (Settings > Accounting)
```text
┌ Chart of accounts ─────────────────────────────────────────── [ + Add Account ] ┐
│ [🔍 Search] [Kind ▾] [x] Show system accounts                                    │
│ Code │ Name                 │ Group            │ Kind    │ Balance      │ ⋮      │
│ 1000 │ Cash in Hand 🔒      │ Cash             │ Asset   │ ₹48,300 Dr   │        │
│ 1101 │ HDFC Current         │ Bank             │ Asset   │ ₹2,40,100 Dr │ Edit   │
│ 5101 │ Rent                 │ Indirect expense │ Expense │ ₹25,000 Dr   │ Edit   │
└──────────────────────────────────────────────────────────────────────────────────┘
```
Add Account modal: Code* (auto next), Name*, Group* (select), Kind (derived from group), Opening balance + Dr/Cr + date. Locked accounts show 🔒 and cannot be deleted.

### Acceptance
1. Enabling the ledger seeds exactly the accounts above, idempotently.
2. DB rejects an entry with both debit and credit non-zero, and an unbalanced voucher.
3. App role cannot UPDATE/DELETE `ledger_entries` (tested).

## P4-S2 Posting engine (pure functions)

File `packages/tax-engine/src/posting.ts`, tested exhaustively. Signature:

```ts
type Line = { account: AccountRef; debit?: number; credit?: number; partyId?: string; narration?: string };
type Posting = { date: string; refType: string; refId: string; lines: Line[] };
postInvoice(inv, ctx): Posting[]      // may return several vouchers (sale + each payment)
postPurchase(p, ctx), postPayment(pay, ctx), postCreditNote(cn, ctx), postDebitNote(dn, ctx),
postExpense(e, ctx), postIncome(i, ctx), postTransfer(t, ctx), postLoanDisbursal(l, ctx), postLoanPayment(lp, ctx),
postChequeEvent(c, event, ctx), postAdjustment(a, ctx), postOpening(entity, ctx)
```
`ctx` provides account lookup (by code or bank/cash id), the business state and settings (round-off accounts, discount handling), so functions stay pure.

### Posting rule tables (authoritative)

**Sales (tax invoice, credit)**

| Dr / Cr | Account | Amount |
|---|---|---|
| Dr | Receivable (party) | invoice total |
| Cr | Sales | taxable value of goods/services (after discounts) |
| Cr | Additional Charges Income | charges taxable value |
| Cr | Output CGST / SGST or IGST / Cess | tax by head |
| Cr | TCS Payable | TCS if any |
| Dr/Cr | Round-off Loss / Gain | rounding difference |

Inline payment of ₹X by mode:

| Dr | Cash / Bank (or Cheques in Hand if cheque) | X |
|---|---|---|
| Cr | Receivable (party) | X |

**Bill of Supply / Composition**: same as above without tax heads.
**Quotation, Sale Order, Proforma, Delivery Challan**: **no posting** (documents only). Challan affects stock only.

**Payment In**

| Dr | Cash/Bank (or Cheques in Hand) | amount |
| Dr | TDS Receivable | tds |
| Dr | Discount Allowed | discount |
| Cr | Receivable (party) | amount + tds + discount |
(advance, i.e. unallocated part, still credits the party; it nets automatically in the party ledger.)

**Credit Note (sale return)**

| Dr | Sales Return | taxable value |
| Dr | Output CGST/SGST/IGST/Cess | tax |
| Cr | Receivable (party) | total |
Refund by cash/bank: Dr Receivable / Cr Cash-Bank.

**Purchase**

| Dr | Purchases | taxable value (+ charges) |
| Dr | Input CGST/SGST/IGST/Cess | eligible tax only |
| Dr | Ineligible GST expensed (or Purchases) | ineligible tax |
| Cr | Payable (party) | total |
| Cr | TDS Payable | §194Q tds (Dr Payable reduced) |
RCM: Dr Input GST / Cr RCM Payable for the tax portion when the bill is saved; on payment of RCM tax: Dr RCM Payable / Cr Cash-Bank.

**Payment Out**

| Dr | Payable (party) | amount + tds + discount |
| Cr | Cash/Bank (or Cheques Issued) | amount |
| Cr | TDS Payable | tds |
| Cr | Discount Received | discount |

**Debit Note (purchase return)**

| Dr | Payable (party) | total |
| Cr | Purchase Return | taxable |
| Cr | Input GST (reversal) | tax |

**Expense**: Dr Expense category account (net), Dr Input GST (if ITC), Cr Cash/Bank or Payable (payee).
**Other income**: Dr Cash/Bank or Receivable, Cr Other Income (+ Cr Output GST if taxable).
**Transfer**: Dr destination account, Cr source account.
**Adjust bank/cash**: increase: Dr account, Cr "Opening Balance Equity" (or Bank adjustment income); reduce: reverse.
**Loan disbursal**: Dr Bank, Cr Loan account. **EMI**: Dr Loan (principal), Dr Loan Interest, Dr Bank Charges (fees), Cr Bank.
**Cheque deposit/cleared/bounced**: see P5-S3 table.
**Opening balances**: parties → Dr Receivable or Cr Payable against Opening Balance Equity; banks/cash same; stock opening via stock valuation (not posted; valuation is computed).
**Stock**: **not** posted per movement. Closing stock value is computed at report time (weighted average) and shown in P&L and Balance Sheet. ⚠️ If the owner wants perpetual inventory (COGS per sale) record a decision; not in scope here.

### Test matrix (`posting.test.ts`)
Each row: input fixture → expected lines → `Σdebit == Σcredit` (property test with random invoices: 500 random cases).
| Case | Check |
|---|---|
| Intra-state 18% sale | Cr CGST 9% SGST 9% |
| Inter-state sale | Cr IGST 18% |
| Sale with charges at 5% | Cr Charges Income + tax split at 5% |
| Sale with TCS | Cr TCS Payable |
| Sale with round-off ±0.49 | round-off account side correct |
| Sale with 3 inline payments | 3 extra vouchers |
| Payment In with TDS and discount | all three sides |
| Purchase with mixed ITC flags | tax split between Input and expense |
| RCM purchase | RCM payable posted |
| Debit note partial | proportional |
| Credit note refund by bank | extra voucher |
| Expense without GST | no tax lines |
| Transfer bank→cash | two lines |
| Loan EMI | four lines |
| Zero-value invoice | no entries, no error |

### Acceptance
1. Property test: 500 random documents always balance.
2. Every document type in the table has a function and tests; documents marked "no posting" return `[]`.

## P4-S3 Posting wiring in the API

### Pattern
```ts
// in apps/api/src/modules/invoices.ts, inside the same tx as the insert
if (await ledgerEnabled(tx, businessId)) {
  await repost(tx, { refType: 'invoice', refId: invoice.id, postings: postInvoice(invoice, ctx) });
}
```
`repost()` = find existing vouchers for `(refType, refId)` → insert reversal rows (swapped sides, `reversalOf`) → insert new rows. This makes edit and delete uniform: **delete = reverse only**. Soft-deleted documents have only their reversal rows plus originals (net zero).

Where to hook:
| Module | Events |
|---|---|
| `invoices.ts` | create, update, cancel, delete, restore (Trash) |
| `purchases.ts` | same |
| `payments.ts` | create/update/delete for both directions, allocation changes don't post (only totals do) |
| expenses | create/update/delete |
| transfers, adjustments, cheques, loans | P5 |
| `trash.ts` | on restore, repost; on purge, nothing (already reversed) |

### Concurrency
Posting happens inside the document transaction with `SELECT … FOR UPDATE` on the document row, so two edits cannot interleave.

### Period lock
`repost` checks `periodLocked()`; locked → `PERIOD_LOCKED` 409.

### Acceptance
1. Flag on: create invoice → exactly the expected vouchers; edit total → reversal + new; delete → net zero.
2. Flag off: no ledger rows written (spot-check).
3. Failure inside posting rolls back the document too (test by forcing an unbalanced posting).
4. Trash restore reposts; permanent delete leaves history net zero.

## P4-S4 Backfill

### Command
`pnpm --filter @ledgora/api backfill:ledger -- --business <id> [--dry-run] [--from 2024-04-01]` and an owner-only button in Settings > Accounting.

### Algorithm
```text
1. seed chart (idempotent)
2. clear existing ledger rows for the business where refType in documented set   (only if --rebuild)
3. post opening balances (parties, banks, cash)
4. iterate all documents ordered by date, id → run posting function → insert
5. verify: per account compute totals; per party compare ledger balance to document-based balance (tax-engine/outstanding.ts)
6. print diff table; non-zero diffs listed with document ids
7. set accounting.ledger = true only if diffs are empty (or --force)
```
Dry-run prints counts and a diff without writing.

### Wireframe: backfill panel
```text
┌ Accounting ledger ─────────────────────────────────────────────────────────────────┐
│ Status: ○ Not enabled                                                                │
│ Enable the ledger to unlock Cash & Bank, Trial Balance and Balance Sheet.            │
│ Step 1  [ Run check (no changes) ]   → 412 documents · 0 problems                    │
│ Step 2  Opening balances confirmed ☑ (cash ₹__ , banks…)                             │
│ Step 3  [ Enable ledger and post history ]    progress ▓▓▓▓▓░░░ 62%                  │
│ After: Trial balance ✔ balanced · Party balances ✔ match documents                   │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Acceptance
1. Idempotent: running twice yields identical balances.
2. On a seeded demo business (200 invoices, 80 purchases, 120 receipts) party-wise ledger balance = document-based balance for all parties.
3. Trial balance totals equal.
4. 10,000-document business backfills under 3 minutes.

## P4-S5 Verify My Data (basic)

Checks implemented as pure functions over query results, each returns `{ id, severity, count, rows[], fix? }`.

| Check id | Description | Severity | Auto-fix |
|---|---|---|---|
| `negative_stock` | items with stock < 0 | warn | open Stock Adjust |
| `invoice_total_mismatch` | stored total ≠ recomputed from lines | error | recompute |
| `payment_over_allocated` | allocations > payment amount or > invoice pending | error | trim allocations |
| `invoice_number_gap` | gaps in a series within an FY | info | none |
| `invoice_number_duplicate` | same number twice in series | error | renumber wizard |
| `gstin_invalid` | party GSTIN fails checksum | warn | open party |
| `hsn_missing` | tax > 0 line without HSN/SAC | warn | open item |
| `ledger_unbalanced` | voucher Σdr ≠ Σcr | error | repost document |
| `ledger_missing` | document without vouchers (ledger on) | error | repost |
| `orphan_stock_movement` | movement without document | warn | list |
| `party_balance_mismatch` | ledger vs documents | error | repost party documents |
| `future_dated` | documents dated beyond today + 30 days | info | open document |
| `duplicate_party` | same GSTIN twice | warn | merge wizard (P11) |

### Wireframe
```text
┌ Verify My Data ──────────────────────────────────────────────── [ Run again ⟳ ] ┐
│ Last run 06-11-2026 21:10   ✔ 9 passed   ⚠ 3 warnings   ✖ 1 error                │
│ ✖ Payments over-allocated (2)                         [View] [Fix automatically]  │
│ ⚠ Items with negative stock (3)                       [View] [Adjust stock]       │
│ ⚠ Parties with invalid GSTIN (1)                      [View]                      │
│ ✔ Ledger balanced   ✔ Invoice totals match   …                                    │
│                                                     [ Export result (xlsx) ]      │
└────────────────────────────────────────────────────────────────────────────────────┘
```
Endpoint `GET /v1/verify` (permission `utilities.verify`), `POST /v1/verify/:checkId/fix` (owner/admin).

### Acceptance
1. Each check has a failing fixture and a passing fixture.
2. Fix actions are idempotent and audited.
3. Run time < 10 s on a 10k-document business (checks run as set-based SQL).

## P4-S6 Financial years and period lock

### Data
```ts
financialYears: { id, orgId, businessId, label '2026-27', startDate, endDate, status: 'open'|'closed', lockedAt, lockedBy }
```
Business settings: `lockBefore date null` (freeze transactions before date), `allowEditAfterGstFiled bool`.
Rule: a document or ledger write is refused when `date <= lockBefore`, or the date's FY is `closed`, or the GST month is marked filed and `allowEditAfterGstFiled = false` (owner override with reason allowed).

### Wireframe: FY switcher and lock banner
```text
Top bar:  [ FY 2026-27 ▾ ]  → list: 2026-27 (open) · 2025-26 (closed 🔒) · [ Manage years ]
Banner on a locked-period document:  🔒 This period is locked (GST filed for Oct 2026). [Request owner override]
```

### Acceptance
1. Locked-date writes are rejected in every module (table-driven API test over 8 modules).
2. Owner override requires a reason and writes an audit row.

## P4-S7 Ledger viewer and manual journal

### Screens
**Account ledger** (`/accounting/ledger/:accountId`) Template F: header (account name, balance), table Date · Voucher · Ref · Narration · Debit · Credit · Running balance; click Ref opens the source document.
**Journal voucher** (optional, owner/accountant): date, narration, rows (account\*, debit, credit), balance indicator, Save disabled until Σdr = Σcr.

```text
┌ Journal Voucher ────────────────────────────────────────────────────────────┐
│ Date [06-11-2026]  Voucher No [JV-001]  Narration [Depreciation on laptop ]  │
│ Account ▾                         │ Debit      │ Credit     │               │
│ Depreciation (5300)               │ 2,000.00   │            │ ✕             │
│ Fixed Assets (1700)               │            │ 2,000.00   │ ✕             │
│ [ + Add row ]            Total 2,000.00 = 2,000.00  ✔ Balanced              │
│                                              [ Cancel ] [ Save ]            │
└──────────────────────────────────────────────────────────────────────────────┘
```
Journals are posted with `refType='journal'`; editing = reverse + repost. Gated by permission `accounting.journal` (owner, accountant).

### Acceptance
1. Unbalanced journals cannot be saved (client and server).
2. Account ledger closing balance equals Trial Balance row.

## Phase 4 acceptance
1. Demo business: Trial balance balanced; Σ party ledgers = control accounts; Cash + Banks = Cash Flow closing.
2. All document modules post; flag off equals old behaviour.
3. Backfill dry-run and real run match on the demo data.
4. Docs: `docs/ACCOUNTING.md` explains accounts, postings, reversals and period lock.

### Claude prompt for Phase 4
```text
Implement Phase 4 in order P4-S1…P4-S7. Start with packages/tax-engine/src/posting.ts and its property test; do not touch
the API until 500 random invoices balance. Ledger tables must be append-only for the app role. Never write to
ledger_entries outside repost(). If backfill diffs are non-zero, stop and print the diff table instead of forcing the flag.
```

---

# PHASE 5: Cash & Bank

**Goal**: real cash and bank balances, transfers, adjustments, a cheque register, and loan accounts with schedules.
**Prerequisites**: P4 merged, flag `accounting.ledger` on.
**Flag**: `cashbank`.
**Slices**: P5-S1 Bank accounts · P5-S2 Cash in Hand and adjustments · P5-S3 Transfers · P5-S4 Cheques · P5-S5 Loans · P5-S6 Bank reconciliation · P5-S7 Dashboard widgets.

## P5-S1 Bank accounts

### Data
Evolve `payment_accounts` (✅ print details) into bank accounts:
| Column | Type | Notes |
|---|---|---|
| `opening_balance` | money default 0 | signed (negative = overdraft) |
| `opening_date` | date | |
| `account_id` | uuid | FK to `accounts` (the 1100-series ledger account created together) |
| `print_on_invoice` | bool | replaces implicit use of `isDefault` |
| `account_type` | text | current / savings / OD / CC |
| `swift` | text | |
Creating a bank account creates the ledger account and posts the opening balance in one transaction.

### Endpoints
| Method | Path | Permission |
|---|---|---|
| GET | `/v1/bank-accounts` (with `balance`, `lastTxn`) | `cashbank.view` |
| POST/PATCH/DELETE | `/v1/bank-accounts[/:id]` | `cashbank.create/edit/delete` (delete blocked if entries exist, deactivate instead) |
| GET | `/v1/bank-accounts/:id/transactions?from&to&cursor` | `cashbank.view` |

### Wireframe: list
```text
┌ Bank Accounts ──────────────────────────────────────── [Cards|Table] [ + Add Bank Account ] ┐
│ ┌ HDFC Current ──────────┐ ┌ SBI Savings ───────────┐ ┌ Cash in Hand ──────────┐           │
│ │ HDFC ••4521            │ │ SBI ••1180             │ │ System account         │           │
│ │ ₹2,40,100              │ │ ₹56,000                │ │ ₹48,300                │           │
│ │ ● default for invoices │ │                        │ │                        │           │
│ └────────────────────────┘ └────────────────────────┘ └────────────────────────┘           │
│ Total cash + bank ₹3,44,400                                                                 │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Wireframe: Add Bank Account modal
```text
┌ Add Bank Account ───────────────────────────────────────────── [×] ┐
│ Account display name* [HDFC Current        ]  Type [Current ▾]       │
│ Bank name [HDFC Bank]  Account holder [Business name]                │
│ Account number [____________] IFSC [HDFC0000123] (auto bank name)    │
│ SWIFT [______]   UPI ID [shop@hdfc]                                   │
│ Opening balance [₹ 2,00,000] as of [01-04-2026]                      │
│ [x] Print bank details on invoices   [x] Print UPI QR   [x] Active   │
│ [ ] Make default for invoices                                         │
│                                           [ Cancel ] [  Save  ]      │
└──────────────────────────────────────────────────────────────────────┘
```

### Field rules
| Field | Rule |
|---|---|
| Display name | unique per business |
| Account number | digits 9–18, stored masked in lists (••4521) |
| IFSC | `^[A-Z]{4}0[A-Z0-9]{6}$`; bank name lookup from a bundled IFSC prefix table |
| UPI | `name@handle` pattern |
| Opening balance | money, may be negative |
| Default | exactly one default among those with `print_on_invoice` |

### Account detail (Template F)
```text
┌ ← HDFC Current                       Balance ₹2,40,100      [Deposit][Withdraw][Transfer][Adjust][Statement] ┐
│ Date │ Description        │ Party   │ Type       │ Deposit │ Withdrawal │ Running balance │ Rec │
│ 06-11│ Payment In RCT-5   │ Ravi    │ Payment In │ 5,000   │            │ 2,40,100        │ ☐   │
│ 05-11│ Payment Out PAY-3  │ Om      │ Payment Out│         │ 4,455      │ 2,35,100        │ ☑   │
│ Opening balance 01-04-2026                                                      2,00,000        │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```
Data source: `ledger_entries` of the bank's account, joined to party names; running balance computed with a window function.

### Deposit / Withdraw modal
`Amount*`, `Date`, `Description`, `Category` (for withdraw: Bank charges / Owner drawing / Other expense (choose account)) → posts Dr Bank / Cr Owner capital for owner deposit; Dr Owner drawing / Cr Bank for withdrawals. ⚠️ Naming of "Deposit/Withdraw" semantics inferred; confirm.

### Acceptance
1. Creating an account with opening ₹2,00,000 shows balance ₹2,00,000 and one opening entry.
2. Balance = Σdr − Σcr of the ledger account for all test accounts.
3. Deleting an account with entries is refused (409), deactivation hides it from pickers.

## P5-S2 Cash in Hand and adjustments

```text
┌ Cash in Hand ────────────────────────────────────── Balance ₹48,300   [Adjust Cash] [Day-end count] ┐
│ Date │ Description │ Party │ Type │ Cash in │ Cash out │ Running balance                           │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
**Adjust Cash modal**: `Add cash / Reduce cash` (radio), `Amount*`, `Date`, `Remarks`. Posting: Add → Dr Cash, Cr Opening Balance Equity (or "Cash adjustment income" when the user ticks "count as income"); Reduce → opposite.
**Day-end count** (🆕): `Counted [₹]` vs system balance; difference shown; Save posts Cash Over/Short adjustment with remarks.
**Cash watch**: chip warns when cash from one party on one day ≥ ₹2,00,000 (§269ST); link opens cash watch report.

### Acceptance
1. Cash balance equals Σ cash vouchers; adjust modifies exactly by amount.
2. Day-end count of equal amount creates no entry.

## P5-S3 Transfers

Transfer modal: `From*`, `To*` (banks or Cash in Hand; cannot be equal), `Amount*`, `Date`, `Reference`, `Notes`; fee optional (posts Bank Charges).
```text
┌ Transfer Money ───────────────────────────────────────────── [×] ┐
│ From* [ HDFC Current ▾ ]  Balance ₹2,40,100                       │
│ To*   [ Cash in Hand ▾ ]  Balance ₹48,300                         │
│ Amount* [₹ 10,000]   Date [06-11-2026]   Reference [______]       │
│ Bank charges [₹ 0]  Notes [___________]                           │
│                                      [ Cancel ] [ Transfer ]      │
└───────────────────────────────────────────────────────────────────┘
```
Table `transfers(id, fromAccountId, toAccountId, amount, date, reference, fee, notes)`; posting rule in P4-S2. Editing a transfer reverses and reposts.

### Acceptance
1. Both balances change by the amount; Σ(cash+bank) unchanged (minus fee).
2. Cannot transfer more than balance for cash accounts (setting: allow overdraft for banks).

## P5-S4 Cheques

### Data
```ts
cheques: {
  id, orgId, businessId, direction: 'received'|'issued', partyId, number, amount, chequeDate, receivedDate,
  bankAccountId null,          // deposit-to (received) or drawn-from (issued)
  status: 'open'|'deposited'|'cleared'|'bounced'|'cancelled', statusDate, bounceCharges money default 0,
  paymentId null,              // the payment created with mode=cheque
  reminderDays int default 3, notes
}
```
Unique `(org, direction, partyId, number)`.

### State machine
```text
            ┌─────────┐ deposit  ┌───────────┐ clear   ┌─────────┐
 create ──► │  open   │ ───────► │ deposited │ ──────► │ cleared │
            └────┬────┘          └─────┬─────┘         └─────────┘
                 │ cancel              │ bounce
                 ▼                     ▼
            ┌───────────┐         ┌──────────┐   (invoice balance reopens, bank charges optional)
            │ cancelled │         │ bounced  │
            └───────────┘         └──────────┘
```

### Posting per transition (received cheque)
| Event | Dr | Cr |
|---|---|---|
| Created with Payment In (mode cheque) | Cheques in Hand | Receivable (party) |
| Deposited | Cheques in Hand → stays | (no bank effect yet; status marker only) |
| Cleared | Bank | Cheques in Hand |
| Bounced | Receivable (party) | Cheques in Hand (reverses); bounce charges: Dr Receivable (charged to party) or Dr Bank Charges, Cr Bank |
| Cancelled (while open) | Receivable | Cheques in Hand |
Issued cheques mirror: Created: Dr Payable, Cr Cheques Issued; Cleared: Dr Cheques Issued, Cr Bank; Bounced: reverse.

### Wireframe: Cheques
```text
┌ Cheques ───────────────────────────────────────────────────────── [ + Add Cheque ] ┐
│ [ Received ][ Issued ]  [Status: Open ▾] [Date range ▾]   Due in 3 days: 2 ⚠        │
│ Cheque no │ Party │ Bank account │ Amount │ Cheque date │ Status   │ Action         │
│ 000123    │ Ravi  │ HDFC         │ 8,000  │ 10-11-26    │ Open     │ [Deposit] [⋮]  │
│ 000099    │ Kiran │ HDFC         │ 3,000  │ 02-11-26    │ Deposited│ [Cleared][Bounced]│
└──────────────────────────────────────────────────────────────────────────────────────┘
```
Add Cheque modal: `Direction`, `Party*`, `Cheque number*`, `Amount*`, `Cheque date*`, `Bank account`, `Link documents` (optional allocation), `Reminder days`, `Notes`.
Bounce modal: `Bounce date`, `Charges [₹]`, `Charge to` (party / us), `Note`.

### Acceptance
1. Bank balance changes only on Cleared.
2. Bounce reopens invoice balance (Outstanding report shows it again) and posts charges.
3. Dashboard "Cheques due" reads `status in (open, deposited)` and `cheque_date <= today + reminderDays`.
4. Post-dated cheque (date > today) flagged; ITC 180-day timer reads cheque clear date for supplier cheques (P10).

## P5-S5 Loans

### Data
```ts
loans: { id, orgId, businessId, name, lender, type, principal, ratePct, interestType: 'reducing'|'flat', tenureMonths, emi,
         firstEmiDate, receivedOn, receivedAccountId, processingFee, status: 'active'|'closed', accountId /*ledger*/ }
loanSchedule: { id, loanId, dueDate, emi, principalPart, interestPart, balanceAfter, status: 'due'|'paid'|'part', paidOn }
loanPayments: { id, loanId, date, principal, interest, charges, accountId, scheduleId null, kind: 'emi'|'part'|'prepay', notes }
```
Pure functions in `tax-engine/loan.ts`:
- `emi({ principal, ratePct, months, type })`: reducing: `P·r·(1+r)^n / ((1+r)^n − 1)` with `r = rate/12/100`; flat: `(P + P·rate·years/100) / months`.
- `buildSchedule(loan)` → rows with principal/interest split rounded to paise, last row absorbs rounding.
- `applyPayment(schedule, payment)` → updated schedule (EMI, part-payment reduces principal and either tenure or EMI per choice).
Tests: known textbook case (₹10,00,000 at 12% for 12 months → EMI ₹88,848.79), flat, prepayment, rounding sum equals principal.

### Wireframes
```text
┌ Loan Accounts ───────────────────────────────────────────────────── [ + Add Loan ] ┐
│ Loan        │ Lender │ Type │ Principal │ Rate │ EMI    │ Outstanding │ Next due  │ ⋮ │
│ Term loan A │ HDFC   │ Term │ 10,00,000 │ 12%  │ 88,849 │ 6,22,000    │ 05-12-26  │ ⋮ │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌ Add Loan ─────────────────────────────────────────────────────────────────── [×] ┐
│ Account name* [Term loan A]  Lender [HDFC Bank]  Type [Term ▾]                    │
│ Principal* [₹ 10,00,000]  Received in* [HDFC Current ▾]  Received on [01-04-2026] │
│ Interest rate* [12 %] p.a.  Interest type (●) Reducing ( ) Flat                    │
│ Tenure [12] months   EMI [₹ 88,848.79] (editable)   First EMI date [05-05-2026]   │
│ Processing fee [₹ 5,000]  Description [__________]                                │
│                                                   [ Cancel ] [  Save  ]           │
└────────────────────────────────────────────────────────────────────────────────────┘

┌ ← Term loan A     Outstanding ₹6,22,000    [Make Payment][Increase Loan][Statement] ┐
│ # │ Due date │ EMI    │ Principal │ Interest │ Balance │ Status                      │
│ 1 │ 05-05-26 │ 88,849 │ 78,849    │ 10,000   │ 9,21,151│ Paid                        │
│ 2 │ 05-06-26 │ 88,849 │ 79,637    │ 9,212    │ 8,41,514│ Paid                        │
│ 7 │ 05-11-26 │ 88,849 │ 83,694    │ 5,155    │ 6,22,000│ Due                         │
└──────────────────────────────────────────────────────────────────────────────────────┘
Make Payment: Type (EMI|Part payment|Prepay), Principal [__] Interest [__] Charges [__], From account*, Date, Notes
```

### Flow: make EMI payment
```text
Open loan → click Make Payment → type EMI prefills principal & interest from the next due row
 → Save → loanPayments row, schedule row marked paid, posting: Dr Loan (principal), Dr Loan Interest, Dr Bank Charges (charges), Cr Bank
 → balance and next due update
```

### Income Tax link
Interest paid sums into business expense; personal housing/education loans flagged `purpose` appear in the Regime Calculator as §24(b)/§80E suggestions.

### Acceptance
1. Schedule sums: Σprincipal = principal, interest total per formula (tests).
2. Posting balanced; loan balance in ledger equals schedule balance.
3. Prepayment recomputation preserves invariants.

## P5-S6 Bank reconciliation

### Flow
```text
Upload statement (CSV / XLSX; reuse parseBankStatement ✅) → map columns (date, description, debit, credit, balance)
 → auto-match to ledger entries: same amount, date within ±3 days, reference contains payment ref → "Matched"
 → unmatched statement rows: [Create entry…] (opens Payment In / Out / Expense prefilled) or [Ignore]
 → unmatched ledger rows: stay uncleared
 → user ticks matches → Save → ledger entries marked reconciled (table bank_recon(entryId, statementRowHash, clearedOn))
```

### Wireframe
```text
┌ Reconcile HDFC Current ──────────────────────────── Statement bal ₹2,40,100  Book bal ₹2,40,100 ┐
│ Statement rows (left)                         │ Ledger entries (right)                          │
│ 06-11 CR 5,000 UPI/Ravi        ● matched ───► │ 06-11 Payment In RCT-5   5,000   ☑              │
│ 05-11 DR 4,455 NEFT Om         ● matched ───► │ 05-11 Payment Out PAY-3  4,455   ☑              │
│ 03-11 DR 180 SMS charges       ○ unmatched    │ [ Create bank charge entry ]                    │
│ Difference ₹0  [ Finish reconciliation ]                                                         │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Acceptance
1. Matching rule unit tests (exact, tolerance, duplicates).
2. Finishing with difference ≠ 0 requires an explicit reason.

## P5-S7 Dashboard widgets

Home gets: Cash + Bank total, Cheques due, Loan EMI due in 7 days, Overdraft warning. Data from existing `AnalyticsDashboard` queries plus `/v1/cashbank/summary`.

### Acceptance
1. Widgets hidden when flag off; numbers equal Bank Accounts list totals.

## Phase 5 test plan
| Layer | Cases |
|---|---|
| tax-engine | emi (6), schedule (8), applyPayment (6), recon match (8), cheque state machine (10) |
| API | bank CRUD + opening posting, transfers, cheque transitions with postings, loan payments, isolation, period lock |
| Web | AccountDetail running balance, Cheque action buttons by status, Loan form recompute |
| E2E | add bank → receive payment by cheque → deposit → clear → statement shows deposit; add loan → pay EMI |

## Phase 5 acceptance
1. Trial balance remains balanced after every test scenario.
2. Cash & Bank reachable from sidebar, all screens on P0 components.
3. Bank Statement and Loan Statement reports (P6) read the same entries.

### Claude prompt for Phase 5
```text
Implement Phase 5 (P5-S1…P5-S7) behind the cashbank flag, only on businesses with accounting.ledger on.
Write loan.ts and the cheque state machine as pure functions with tests before any API work.
After each slice run the trial-balance check from Verify My Data; if Dr≠Cr stop and report.
```

---

# PHASE 6: Reports

**Goal**: 45+ reports from one engine. Adding a report means adding a definition, not a screen.
**Prerequisites**: P0-S3.7 (`ReportShell`), P4 (ledger) for ledger-based reports; document-based reports (Sale, Purchase, Stock, GST) can ship earlier, in slice order below.
**Slices**: P6-S1 Engine and hub · P6-S2 Transaction reports · P6-S3 Party reports · P6-S4 Item and stock reports · P6-S5 GST reports · P6-S6 Expense, bank, order, loan reports · P6-S7 Financial statements (P&L, Trial Balance, Balance Sheet, Cash Flow) · P6-S8 Exports, favourites, scheduling.

## P6-S1 Engine and hub

### Architecture
```text
 web: ReportsHub ──► /reports/:id ──► ReportShell(def) ──► GET /v1/reports/:id?from&to&…  ──► rows,totals,meta
                                                                    │
 api: modules/reports.ts  registry: { [id]: { permission, params: zod, run(tx, params) } }
                                                                    │
 sql: views + queries per report (apps/api/src/reports/<id>.ts)     └─ pure aggregation helpers in tax-engine
```

### Report definition (web) and handler (api)
```ts
// web: features/reports/definitions/dayBook.js
export default {
  id: 'day-book', title: 'Day Book', group: 'transaction', icon: BookOpen,
  filters: [ period({ default: 'today' }), party(), select('types', TXN_TYPES, { multi: true }) ],
  columns: [ col('date','Date',{ format:'date' }), col('party','Party'), col('type','Txn type'), col('ref','Ref no.'),
             col('total','Total',{ align:'right', format:'money', total:'sum' }),
             col('moneyIn','Money in',{ align:'right', format:'money', total:'sum' }),
             col('moneyOut','Money out',{ align:'right', format:'money', total:'sum' }) ],
  summary: (r,t)=>[ chip('Money in',t.moneyIn,'pos'), chip('Money out',t.moneyOut,'neg') ],
  drilldown: (row)=>({ type: row.refType, id: row.refId }),
  exports: ['pdf','xlsx','print','share'],
};
```
```ts
// api: reports/dayBook.ts
export const dayBook = defineReport({
  permission: 'reports.view',
  params: z.object({ from: isoDate, to: isoDate, types: csv(z.string()).optional(), partyId: uuid.optional() }),
  run: async (tx, p, ctx) => ({ rows, totals, meta }),
});
```
Common query params: `from`, `to`, `businessId`, `partyId`, `itemId`, `categoryId`, `groupId`, `status`, `includeCancelled`, `includeNonGst`, `cursor`, `limit` (max 1000; exports use streaming CSV up to 100k rows).
Response: `{ rows: [...], totals: {...}, meta: { generatedAt, from, to, truncated } }`.
Permissions: `reports.view` baseline; `reports.profit` hides P&L-type reports (role toggle "hide profit reports"); `reports.export` for exports.

### Hub wireframe
```text
┌ Reports ───────────────────────────────────────────────  [🔍 Search reports…] [★ Favourites] ┐
│ ★ Favourites: Sale · Party Statement · GSTR-1                                                  │
│ ┌ Transaction ─────────────┐ ┌ Party ────────────────────┐ ┌ GST ───────────────────────────┐│
│ │ Sale  Purchase  Day Book │ │ Party Statement           │ │ GSTR-1 GSTR-3B GSTR-2B recon   ││
│ │ All Transactions         │ │ Party-wise P&L            │ │ GST Rate · HSN · SAC           ││
│ │ Profit & Loss            │ │ All Parties               │ │ Form 27EQ · TDS/TCS            ││
│ │ Bill Wise Profit         │ │ Party Report by Item      │ │ Sale/Purchase with GST         ││
│ │ Cash Flow · Trial Balance│ │ Sale/Purchase by Party    │ └────────────────────────────────┘│
│ │ Balance Sheet            │ │ … by Party Group          │ ┌ Income Tax ───────────────────┐ │
│ └──────────────────────────┘ └───────────────────────────┘ │ ITR Summary · Advance Tax      │ │
│ ┌ Item / Stock ────────────┐ ┌ Expense ──────────┐ ┌ Bank/Disc ┐│ TDS Receivable                │ │
│ │ Stock Summary/Detail     │ │ Expense · Category│ │ Bank Stmt ││                               │ │
│ │ Item Detail · Low Stock  │ │ Expense Item      │ │ Discount  │└───────────────────────────────┘ │
│ │ Item-wise P&L …          │ └───────────────────┘ └───────────┘ ┌ Orders / Loan ──────────────┐ │
│ └──────────────────────────┘                                      │ Sale Order · Order Item · Loan│ │
│                                                                   └───────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
Favourites stored per user (`user_prefs.reportFavourites[]`); search matches title + description; each card item is a link to `/reports/<id>`.

### ReportShell wireframe (applies to all)
```text
┌ Day Book ──────────────────────────────────────────────── [★] [Print][PDF][Excel][Share ▾] ┐
│ Period [Today ▾]  Party [All ▾]  Types [All ▾]  [x] Include cancelled   [ Apply ]            │
│ [Columns ▾] [Group by ▾]                                                                      │
│ ┌ Money in ₹58,000 ┐ ┌ Money out ₹21,000 ┐ ┌ Net ₹37,000 ┐                                    │
│ ├ Date │ Party │ Type │ Ref │ Total │ In │ Out ─────────────────────────────────────────────┤│
│ │ table (sticky header, sticky totals row, sortable, row click → source document)             ││
│ └──────────────────────────────────────────────────────────────────────────────────────────────┘│
│ Generated 06-11-2026 21:40 · Showing 1–200 of 312 [Load more]            Verify data ⟳         │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```
States: loading skeleton; empty "No data for the selected period" + `Change period`; error with Retry; truncated warning when server hits the cap.

### Common behaviours
| Behaviour | Rule |
|---|---|
| Period presets | Today, Yesterday, This week/month/quarter/FY, Last month/quarter/FY, Custom |
| Default period | This FY for financial, This month for transactional |
| Money formats | `Intl en-IN`, negative in parentheses on financial statements, minus sign elsewhere |
| Totals | server-computed, never client-summed (avoids pagination mismatch) |
| Drill-down | every row with `refType/refId` opens the document; party rows open Party Detail; item rows open Item drawer |
| Print | CSS print stylesheet, header with business name, GSTIN, period; page numbers |
| Excel | `xlsx.js` ✅ with title rows, filters echoed, numeric cells typed as numbers |
| PDF | reuse `TableExport.jsx` |
| Share | WhatsApp (text summary + PDF link) via `share.js` ✅ |
| Column picker | persisted per report id |
| Cache | TanStack Query 60 s stale; **Apply** forces refetch |

### Acceptance (engine)
1. Adding a new definition and handler requires no change in hub or shell code (checked by adding a toy report in a test).
2. Permission matrix test: a role without `reports.view` gets 403; without `reports.profit` 403 only on profit reports.
3. Streaming CSV export handles 100k rows without exceeding memory budget (test with generated data).

## P6-S2 Transaction reports

### Sale report
| Item | Detail |
|---|---|
| Id | `sale` |
| Source | `invoices` where type in (tax-invoice, bill-of-supply, composition, credit-note as negative per toggle) |
| Filters | period, party, party group, txn types, payment status, payment mode, salesman, include cancelled |
| Columns | Date, Invoice no, Party, Txn type, Payment type, Total, Received, Balance, Taxable, Tax, Salesman |
| Totals | Total, Received, Balance, Taxable, Tax |
| Summary chips | Total sale, Received, Pending, Count |
| Group by | Party, Month, Salesman, Payment mode |
| SQL index | `invoices(org_id, business_id, date)` + partial index on non-cancelled |

### Purchase report
Mirror of Sale with Supplier, Bill no, ITC eligible, ITC claimed columns.

### Day Book
| Item | Detail |
|---|---|
| Source | `ledger_entries` voucher header rows plus cash/bank accounts; before the ledger: union of documents by date |
| Opening/closing | opening cash+bank at start date, closing at end |
| Columns | Date, Party, Txn type, Ref no, Total, Money in, Money out |
| Rule | "Money in/out" only for cash/bank-affecting vouchers; credit sales appear with Total but no money columns |
| Footer | Opening cash and bank, closing |

### All Transactions
Union of sales, purchases, payments in/out, expenses, income, transfers, journals. Columns: Date, Ref no, Party, Type, Payment type, Total, Balance. Filter by multi-select type.

### Bill Wise Profit
| Column | Formula |
|---|---|
| Sale amount | taxable value of invoice (excl. GST) |
| Cost | Σ line qty × cost, where cost = item weighted-average purchase cost **as of invoice date** (pure fn `costAsOf(item, date)` from `stock_movements`) |
| Additional charges | charges taxable |
| Discount | transaction discount |
| Profit | Sale − Cost (+ charges income − discount if toggle) |
| Profit % | Profit / Sale |
Edge: items without purchase history use item `purchase_price`; service lines cost 0 (toggle "Include service cost from linked expenses" is out of scope).
Row click opens the invoice. Totals row. Hidden for roles without `reports.profit`.

### Cash Flow
```text
Opening cash + bank                            ₹3,00,000
Cash in:  Sale/Payment In ₹x · Other income ₹x · Loan received ₹x · Capital/Deposit ₹x
Cash out: Purchase/Payment Out ₹x · Expenses ₹x · Loan repaid ₹x · Withdrawals ₹x · Bank charges ₹x
Net change                                     ₹44,400
Closing cash + bank                            ₹3,44,400   ← must equal Cash & Bank total
```
Direct method from ledger entries on cash and bank accounts, grouped by `refType`. Test: closing = Bank Accounts total.

### Acceptance (S2)
1. Sale report total for a fixture equals GSTR-1 taxable + tax for the same period (reconciliation test).
2. Day Book closing equals Cash + Bank total.
3. Bill Wise Profit cost uses date-correct weighted average (fixture with price change between two sales).

## P6-S3 Party reports

| Report | Id | Source | Filters | Columns | Rules |
|---|---|---|---|---|---|
| Party Statement | `party-statement` | ledger (party sub-ledger) | party*, period | Date, Txn type, Ref, Payment type, Debit, Credit, Running balance | opening balance row first, closing last; print as a customer-facing statement with business header; **Share** via WhatsApp |
| Party-wise P&L | `party-pnl` | invoices + cost | period, group | Party, Phone, Total sale, Cost, Profit/Loss | row opens Bill Wise Profit filtered |
| All Parties | `all-parties` | parties + balances | group, balance type, kind | Party, Email, Phone, Group, Address, To Collect, To Pay, Credit limit | export for mailing |
| Party Report by Item | `party-by-item` | invoice/purchase lines | party, item, period | Party, Item, Sale qty, Sale amt, Purchase qty, Purchase amt | |
| Sale/Purchase by Party | `by-party` | docs | toggle sale/purchase | Party, Amount | |
| Sale/Purchase by Party Group | `by-party-group` | docs + groups | toggle | Group, Amount (with children rolled up) | |
| Receivable Ageing ✅ | `ageing` | existing | as-of date | Party, 0–30, 31–60, 61–90, 90+, Total | keep existing logic |
| Payable Ageing 🆕 | `payable-ageing` | purchases | as-of | same for suppliers | |

### Party Statement wireframe
```text
┌ Party Statement ───────────────────────────────────────────── [Print][PDF][Share] ┐
│ Party* [Ravi Traders ▾]  Period [01-04-26 → 06-11-26]                              │
│ ┌ Opening ₹0 ┐ ┌ Total debit ₹40,000 ┐ ┌ Total credit ₹28,000 ┐ ┌ Closing ₹12,000 Dr ┐│
│ Date │ Type    │ Ref    │ Pmt type │ Debit  │ Credit │ Balance                        │
│ 02-11│ Sale    │ INV-12 │ Credit   │ 8,260  │        │ 8,260 Dr                       │
│ 30-10│ Pmt In  │ RCT-4  │ Bank     │        │ 5,000  │ 3,260 Dr                       │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Acceptance (S3)
1. Statement closing equals Party list balance for 20 random parties.
2. By-party-group rolls children up (test with 3-level tree).
3. Ageing buckets unchanged for existing fixtures.

## P6-S4 Item and stock reports

| Report | Id | Source | Filters | Columns | Notes |
|---|---|---|---|---|---|
| Stock Summary ✅ | `stock-summary` | stock_movements | as-of, category, hide zero | Item, Sale price, Purchase price, Qty, Value | value = qty × weighted-average cost |
| Stock Detail | `stock-detail` | movements | item*, period | Opening qty, In, Out, Closing, Value | |
| Item Detail | `item-detail` | movements + docs | item*, period | Date, Txn, Party, Qty in, Qty out, Price, Running stock | per-item ledger |
| Low Stock Summary | `low-stock` | items + stock | category | Item, Min stock, Current, Shortfall | uses `min_stock` |
| Item Report by Party | `item-by-party` | lines | item*, period | Party, Sale qty/amt, Purchase qty/amt | |
| Item-wise P&L | `item-pnl` | lines + cost | period, category | Item, Sale qty, Sale amt, Cost, Closing stock value, Profit | |
| Item Category-wise P&L | `category-pnl` | rollup | period | Category, as above | |
| Sale/Purchase by Item Category | `by-category` | lines | toggle | Category, Qty, Amount | |
| Stock Summary by Item Category | `stock-by-category` | | as-of | Category, Qty, Value | |
| Item-wise Discount | `item-discount` | lines | period | Item, Qty, Sale amt, Discount amt, Discount % | |
| Batch/Expiry report 🆕 | `batch-expiry` | batches | days ahead | Item, Batch, Mfg, Exp, Qty, Days to expiry | only if batch tracking |
| Serial register 🆕 | `serials` | serials | item | Serial, Status, Sold to, Date | |

Pure helpers (`tax-engine/stock.ts`): `weightedAverageCost(movements, asOf)`, `stockAsOf(movements, asOf)`, `valuation(items, movements, asOf)`; all tested with fixtures including reversal movements and unit conversions.

### Stock Detail wireframe
```text
┌ Stock Detail ─────────────────────────────────────────────────────────────┐
│ Item* [Pen Blue ▾]  Period [01-04-26 → 06-11-26]                           │
│ Opening qty 0 │ Qty in 220 │ Qty out 100 │ Closing 120 PCS │ Value ₹720      │
│ Date │ Txn       │ Party │ In  │ Out │ Rate │ Balance                       │
│ 01-04│ Opening   │       │ 100 │     │ 6.00 │ 100                           │
│ 06-11│ Sale INV12│ Ravi  │     │ 10  │10.00 │ 90                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Acceptance (S4)
1. Stock Summary value = Σ Stock Detail closing values for all items.
2. Low-stock report matches Items list "Low stock" chip count.
3. Item-wise P&L profit = Bill Wise Profit sum for the same items and period (cross-check test).

## P6-S5 GST reports

| Report | Id | Status | Content |
|---|---|---|---|
| GSTR-1 ✅ | `gstr1` | existing | wrap in ReportShell chrome; add Table 11 (advances) in P10 |
| GSTR-3B ✅ | `gstr3b` | existing | add RCM 3.1(d), 4(B) reversals in P10 |
| GSTR-2B reconciliation ✅ | `gstr2b` | existing | |
| GST Rate Report | `gst-rate` | new | rows per slab (0, 0.25, 3, 5, 12, 18, 28, cess): Taxable, CGST, SGST, IGST, Cess, Total; split Sale and Purchase; toggles Include credit/debit notes |
| HSN Summary | `hsn` | extend | HSN, Description, UQC, Qty, Taxable, Rate, CGST, SGST, IGST, Cess; digits 4/6/8 setting; goods only |
| SAC Report | `sac` | new | same for service items/lines with SAC |
| Sale with GST | `sale-gst` | new | invoice-wise register: Date, Invoice, Party, GSTIN, POS, Rate, Taxable, CGST, SGST, IGST, Cess, Total |
| Purchase with GST | `purchase-gst` | new | + ITC status column |
| Form 27EQ | `form-27eq` | new ⚠️ | see below |
| TDS/TCS ✅ | `tds-tcs` | existing | add Form 26Q-style deductee summary |
| E-way bills 🆕 | `eway-register` | new | invoice no, value, vehicle, e-way no, status, JSON exported on |

### Form 27EQ specification (⚠️ confirm need)
Inputs: Quarter (Q1–Q4 + FY), Collector TAN\* (new Settings > GST field), challan list.
Rows: collectee PAN/name, nature of collection (§206C(1H) goods > ₹50 lakh etc.), date of collection, amount received, TCS collected, TCS rate, challan serial. Source: invoices with `totals.tcsAmount` ✅ and `payments` date (TCS is collected on **receipt**, so use payments not invoice date; ⚠️ confirm with a CA).
Output: on-screen table plus CSV in the NSDL-utility-friendly column order; no direct filing.
Validation: collectee PAN required (party PAN); missing PAN rows flagged red (higher rate u/s 206CC).

### GST Rate Report wireframe
```text
┌ GST Rate Report ────────────────────────────────────────────────────────────────┐
│ Period [Oct 2026 ▾] [x] Include credit notes   View (●) Sale ( ) Purchase ( ) Both │
│ Rate │ Taxable   │ CGST    │ SGST    │ IGST    │ Cess │ Total tax │ Invoices       │
│ 5%   │ 40,000    │ 1,000   │ 1,000   │ 0       │ 0    │ 2,000     │ 12             │
│ 18%  │ 3,20,000  │ 20,000  │ 20,000  │ 17,600  │ 0    │ 57,600    │ 80             │
│ Total│ 3,60,000  │ 21,000  │ 21,000  │ 17,600  │ 0    │ 59,600    │                │
└────────────────────────────────────────────────────────────────────────────────────┘
```

### Acceptance (S5)
1. GST Rate Report totals equal GSTR-1 taxable + tax for the same month (fixture test).
2. HSN report equals GSTR-1 Table 12.
3. 27EQ marked "Beta" until the CA review decision is recorded.

## P6-S6 Expense, bank, discount, order, loan reports

| Report | Id | Content |
|---|---|---|
| Expense | `expense` | Date, Number, Category, Payee, Amount, GST, Payment mode; group by category/month |
| Expense Category | `expense-category` | Category, Total, share %; click drills to Expense |
| Expense Item | `expense-item` | Item, Qty, Amount |
| Other Income | `other-income` | by category |
| Bank Statement | `bank-statement` | Account*, period: Date, Description, Reference, Withdrawal, Deposit, Balance; opening and closing; reconciled marker |
| Discount Report | `discount` | Party, Sale discount, Purchase discount, Payment discount given/received |
| Sale Order | `sale-order` | Order no, Party, Date, Due, Status, Total, Advance |
| Sale Order Item | `sale-order-item` | Item, Ordered, Invoiced, Pending, Amount |
| Purchase Order | `purchase-order` | mirror |
| Loan Statement | `loan-statement` | Loan*: Date, Type (Disbursal/EMI/Interest/Charges), Principal, Interest, Balance |
| Cheque Register | `cheque-register` | Direction, Cheque no, Party, Amount, Date, Status, Days overdue |
| Salesman report | `salesman` | Salesman, Sales, Collected, Outstanding, Commission, Target % |

### Acceptance (S6)
1. Bank statement closing = Bank Accounts balance.
2. Loan statement balance = schedule balance.
3. Order item pending = ordered − Σ converted quantities across invoices.

## P6-S7 Financial statements

### Profit & Loss
Layout (Indian style, both columns or vertical; user toggle):
```text
Particulars                                    Amount (₹)
INCOME
  Sale (net of returns)                        ₹ 12,40,000
  Other income                                 ₹     8,000
DIRECT EXPENSES
  Opening stock                                ₹ 1,00,000
  Purchases (net of returns)                   ₹ 7,20,000
  Direct expenses                              ₹    30,000
  Less: Closing stock                         (₹ 1,50,000)
GROSS PROFIT                                   ₹ 5,48,000
INDIRECT EXPENSES
  Rent, salaries, … (by category)              ₹ 2,10,000
  Loan interest                                ₹    40,000
  Bank charges, discount allowed               ₹     6,000
  Depreciation                                 ₹    12,000
NET PROFIT                                     ₹ 2,80,000
Toggle: with tax / without tax (default: without)   [x] Show details
```
Source: ledger accounts grouped by kind and group; stock opening/closing via valuation functions. Toggle "Cash basis" ignored (accrual only). Row expands to the ledger accounts; account click opens Account Ledger (P4-S7).

### Trial Balance
Columns: Group, Account, Debit, Credit; as-of date; totals must match (red banner if not). Party accounts shown as control with an expandable list. Balance Check line.

### Balance Sheet
```text
LIABILITIES                          │ ASSETS
Capital + Retained earnings          │ Fixed assets
Net profit (current year)            │ Closing stock
Loans                                │ Receivables (party-wise expandable)
Payables                             │ Input GST · TDS receivable
Output GST · TDS payable             │ Cash in hand · Bank accounts · Cheques in hand
TOTAL                                │ TOTAL                          (must be equal)
```
Handling of difference: shown as "Difference in opening balances" in a suspense line when opening balances do not balance (common in first setup); linked to the Opening Balance Equity account.

### Cash Flow
Specified in P6-S2.

### Acceptance (S7)
1. Balance sheet balances for the demo business and for 5 random generated businesses (property test).
2. P&L net profit equals Σ(income) − Σ(expenses) from Trial Balance; Balance Sheet "Net profit" equals P&L net profit.
3. Closing stock identical across Stock Summary, P&L and Balance Sheet.
4. Income Tax Advance tax screen offers "Use net profit from P&L" (P10 wiring check).

## P6-S8 Exports, favourites, scheduling

| Feature | Behaviour |
|---|---|
| Favourites | star on any report; hub top row |
| Recent | last 5 opened reports |
| Saved filters | "Save view" stores filters under a name per user |
| Scheduled email | weekly/monthly email with PDF to chosen recipients (needs mail module ✅ `apps/api/src/mail`); P9 messaging for WhatsApp |
| Report permission | `reports.view` baseline, group-level toggles in Account Access matrix |
| Print header | business name, GSTIN, address, period, user, timestamp |

### Acceptance
1. Saved views restore filters exactly.
2. Scheduled email sends once per schedule, idempotent across restarts (job key = report+schedule+period).

## Phase 6 index of report ids (45+)

```text
transaction : sale purchase day-book all-transactions profit-loss bill-wise-profit cash-flow trial-balance balance-sheet
party       : party-statement party-pnl all-parties party-by-item by-party by-party-group ageing payable-ageing
gst         : gstr1 gstr3b gstr2b gst-rate hsn sac sale-gst purchase-gst form-27eq tds-tcs eway-register
income-tax  : itr-summary advance-tax tds-receivable cash-watch
item/stock  : stock-summary stock-detail item-detail low-stock item-by-party item-pnl category-pnl by-category
              stock-by-category item-discount batch-expiry serials
expense     : expense expense-category expense-item other-income
bank/other  : bank-statement discount cheque-register
orders/loan : sale-order sale-order-item purchase-order loan-statement salesman
```

## Phase 6 test plan
| Layer | Cases |
|---|---|
| tax-engine | weightedAverageCost (8), costAsOf (6), valuation (6), ageing (existing), profit & loss assembly (10), balance sheet assembly (8) |
| API | per-report happy path with fixture, permission matrix, date boundary (inclusive end date), cancelled toggle, isolation, 100k export |
| Cross-checks | Sale vs GSTR-1, Stock Summary vs Stock Detail, Statement vs Party list, Bank vs Statement, Trial balance balanced |
| Web | ReportShell with toy definition, column picker persistence, favourites, print stylesheet snapshot |

## Phase 6 acceptance
1. All ids in the index load, filter, export; drill-down works.
2. Cross-check tests green on the demo dataset.
3. Old Reports tabs (`ReportsView.jsx`) removed or redirected; no dead code.
4. Largest report p95 < 2 s on 10k documents (load test script checked in).

### Claude prompt for Phase 6
```text
Implement Phase 6. First build the registry, ReportShell glue and hub (P6-S1) with one toy report and tests.
Then add reports in the order of the slices, one definition + one handler + one fixture test each. After every group run
the cross-check suite (apps/api/test/report-crosschecks.test.ts) and stop if any equality breaks.
Totals must come from SQL, never from summing a paginated page on the client.
```

---

# PHASE 7: Utilities

**Goal**: the housekeeping tools Vyapar users expect: barcode labels, bulk update (done P1-S8), Tally export, close financial year, backup.
**Prerequisites**: P4 (Tally and Close FY need ledger), P1 (items).
**Slices**: P7-S1 Barcode generator · P7-S2 Export to Tally · P7-S3 Close financial year · P7-S4 Backup, restore and scheduler · P7-S5 Setup My Business checklist · P7-S6 Trash upgrades and Share with CA.

## P7-S1 Barcode generator

### Wireframe
```text
┌ Barcode Generator ──────────────────────────────────────────────────────────────────┐
│ ┌ Settings ─────────────────────────────┐ ┌ Preview ───────────────────────────────┐ │
│ │ Items  [ Select items ▾ ] (3 selected)│ │ ┌──────────┐ ┌──────────┐ ┌──────────┐ │ │
│ │ Label size [ A4 · 65 labels ▾ ]       │ │ │ Pen Blue │ │ Pen Blue │ │ Pencil   │ │ │
│ │   (A4 65-up · A4 24-up · 50×25 roll · │ │ │ ▮▮▮▮▮▮▮▮ │ │ ▮▮▮▮▮▮▮▮ │ │ ▮▮▮▮▮▮▮▮ │ │ │
│ │    38×25 roll · custom)               │ │ │ ₹10  P01 │ │ ₹10  P01 │ │ ₹5   P02 │ │ │
│ │ Barcode type (●) Code128 ( ) EAN-13   │ │ └──────────┘ └──────────┘ └──────────┘ │ │
│ │              ( ) QR                   │ │ Page 1 of 3          [Zoom −][+]       │ │
│ │ Copies per item [ 1 ]  [ ] = stock qty│ └────────────────────────────────────────┘ │
│ │ Show: [x] Name [x] Price [ ] MRP [x] Code [ ] Business name                        │
│ │ Start at label [ 1 ] (to reuse partly used sheets)                                  │
│ └───────────────────────────────────────┘             [ Print ] [ Download PDF ]      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Fields
| Field | Type | Rule |
|---|---|---|
| Items | multi-select with category filter | items without barcode get one generated and saved |
| Label size | preset or custom (w × h mm, columns, rows, gaps, margins) | stored in business settings for reuse |
| Barcode type | Code128 / EAN-13 / QR | EAN-13 requires 12 digits + check digit, auto-compute |
| Copies | int ≥ 1, or "= stock qty" | cap 1000 per item |
| Show toggles | name, price, MRP, code, business name | |
| Start at label | int | skips used positions on A4 sheet |

Tech: `jsbarcode` (Code128/EAN) and `qrcode` rendered to SVG; PDF via existing PDF path (`jspdf` or print CSS), print stylesheet with `@page { size: A4; margin: 0 }`. Check bundle size; lazy-load the module.

### Acceptance
1. EAN-13 check digit matches known vectors (tests with 5 codes).
2. A 65-up sheet aligns within 0.5 mm in the PDF (visual check with a grid overlay script).
3. Items without codes get unique sequential codes saved atomically (no duplicates under concurrent runs).

## P7-S2 Export to Tally

### Wireframe
```text
┌ Export to Tally ─────────────────────────────────────────────────────────────────────┐
│ Step 1  Period [01-10-2026 → 31-10-2026]                                              │
│ Step 2  Data  [x] Sales [x] Sales Returns [x] Purchases [x] Purchase Returns [ ] Cancelled │
│               [ ] Payments  [ ] Receipts  [ ] Expenses   (optional extras)            │
│ Step 3  Ledger mapping                                                                │
│   Sales ledger [Sales Accounts ▾]   Purchase ledger [Purchase Accounts ▾]             │
│   Output CGST [Output CGST]  Output SGST [Output SGST]  Output IGST […]  Cess […]     │
│   Input CGST [Input CGST] …   Round off [Round Off]   Discount […]                    │
│   Party groups: customers → [Sundry Debtors]  suppliers → [Sundry Creditors]          │
│ Step 4  [ Preview counts ]  Vouchers 312 · Parties 48 · Items 132 · Warnings 3        │
│                                       [ Download Master.xml ] [ Download Voucher.xml ] │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Output rules
- **Master XML**: ledgers (parties under mapped groups with GSTIN, state, address, opening balance), tax ledgers, stock items with units and HSN, voucher types if missing.
- **Voucher XML**: `<VOUCHER VCHTYPE="Sales" ACTION="Create">` with `DATE` (yyyymmdd), `VOUCHERNUMBER`, `PARTYLEDGERNAME`, `ISINVOICE=Yes`, `ALLLEDGERENTRIES.LIST` for party (debit, `ISDEEMEDPOSITIVE=Yes`), sales and tax ledgers (credit), `INVENTORYENTRIES.LIST` per line with `STOCKITEMNAME`, `BILLEDQTY`, `RATE`, `AMOUNT`, GST rate details.
- Escape XML, UTF-8; amounts with two decimals; negative handling by `ISDEEMEDPOSITIVE`.
- Validation before download: party names unique after Tally normalisation (case, trailing spaces), mapped ledgers non-empty, vouchers balanced (debit = credit within ₹0.01), GSTIN states match POS.
Pure fn `buildTallyXml(vouchers, mapping)` in `tax-engine/tally.ts`; golden-file tests compare to checked-in sample XML validated manually in Tally Prime once (⚠️ requires a manual import test by the owner before release).

### Acceptance
1. Golden XML for 5 scenarios (intra, inter, return, purchase, discount).
2. Voucher totals in XML equal report totals for the period.
3. Warnings listed but do not block; errors block with specific row ids.

## P7-S3 Close financial year

### Flow
```text
Step 1 Backup check → show last backup time; "Back up now" required if > 24 h
Step 2 Method
        ○ Change prefix only        new prefix [2026-27/] numbering restarts at 1
        ● Start new year            carry forward: ☑ party balances ☑ stock ☑ bank/cash ☑ loans ☑ cheques open
Step 3 Lock options  ☑ Lock closed year  Allow edits by [Owner only ▾]
Step 4 Confirm: type "2025-26" to confirm   → [ Close FY 2025-26 ]
Run:  tx { compute closing balances (ledger) → create opening entries dated first day of new FY
          → update number series (prefix/reset) → mark FY closed + lock → audit }
Result page: summary (parties carried n, stock value, banks, loans) + [Download closing report PDF]
```

### Wireframe
```text
┌ Close Financial Year ────────────────────────────────────── ① Backup ② Method ③ Lock ④ Confirm ┐
│ Closing: FY 2025-26 (01-04-2025 → 31-03-2026)                                                  │
│ ○ Change prefix only    New prefix [2026-27/]                                                  │
│ ● Start new year        Carry forward  [x] Parties [x] Stock [x] Bank/cash [x] Loans           │
│ Lock closed year [x]    Allow edits by [Owner only ▾]                                          │
│ ⚠ This cannot be undone without restoring a backup.                                            │
│                                               [ Back ] [ Cancel ] [ Close FY 2025-26 ]         │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Rules
- Opening entries: party balances posted against Opening Balance Equity; stock carried as `stock_movements(reason='opening')` at weighted-average cost dated new FY start; P&L accounts are **not** carried (net profit moves to Retained Earnings through a closing journal `refType='fy_close'`).
- Number series: `numbering.js` ✅ supports prefix; add `resetOn: 'fy'` and per-FY counters.
- Reopen FY: owner-only, requires reason; creates audit entry; closing journal is reversed.

### Acceptance
1. After closing, Balance Sheet of the new FY opening equals closing Balance Sheet of the old FY (equality test).
2. Writes to closed FY rejected (`PERIOD_LOCKED`) for non-owners.
3. Retained earnings equals prior net profit + prior retained earnings.

## P7-S4 Backup, restore and scheduler

⚠️ Hosting model decision (blueprint 4.9 #6): Ledgora is multi-tenant SaaS, so backup means **export a business snapshot** the user can store, not a database dump.

### Snapshot format
`.ledgora` file = zip of JSON files per table (scoped to business) + `manifest.json` (app version, schema version, counts, SHA-256 per file) + attachments folder; optional AES-256-GCM encryption with PBKDF2 key from user password.
Existing `transfer.ts` module is the base (export/import); extend with manifest and encryption.

### Wireframe
```text
┌ Backup ─────────────────────────────────────────────────────────────────────────────┐
│ Last backup: 05-11-2026 21:10 (Google Drive)                      [ Back up now ]   │
│ ◉ Local file     [x] Encrypt with password [**********]            [ Download ]     │
│ ◉ Google Drive   Connected: x@gmail.com   [Disconnect]                              │
│ Auto-backup  [Daily ▾] at [21:00]   Keep last [7]   Remind me every [7] days [x]    │
│ ─────────────────────────────────────────────────────────────────────────────────── │
│ Restore  [ Choose backup file… ]  ⚠ Replaces company data. A copy is taken first.   │
│ History  Date │ Size │ Where │ Encrypted │ [Restore] [Delete]                       │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Restore flow
```text
choose file → read manifest → verify hashes → (password if encrypted) → compare schema versions (migrate if older, refuse if newer)
 → preview counts "412 invoices, 48 parties…" → type RESTORE → safety snapshot of current → restore in one tx per table batch → verify (Verify My Data) → done
```

### Acceptance
1. Backup → restore on an empty business reproduces all counts and totals (round-trip test).
2. Wrong password, tampered file and newer schema all produce clear errors, no partial writes.
3. Scheduler runs once per schedule (job key), retention prunes old snapshots.

## P7-S5 Setup My Business checklist

```text
┌ Setup your business ─────────────────────────────────────────── 5 of 8 done ▓▓▓▓▓░░░ ┐
│ ☑ Business name and logo                    [Edit]                                    │
│ ☑ GSTIN and address                         [Edit]                                    │
│ ☐ Add a bank account                        [Add]                                     │
│ ☑ Add your first item                       [Add]                                     │
│ ☑ Add your first party                      [Add]                                     │
│ ☐ Create your first invoice                 [Create]                                  │
│ ☐ Invite your team                          [Invite]                                  │
│ ☐ Set up backup                             [Set up]                                  │
└───────────────────────────────────────────────────────────────────────────────────────┘
```
Each row has a predicate evaluated from data (`hasBank`, `hasInvoice`…) so it ticks itself. The red dot in the top bar clears at 100 %. Dismissible after 5/8.

## P7-S6 Trash and Share with CA

**Trash** ✅: add filter by type, bulk restore, "Empty trash older than 30 days" owner action, restored documents repost to the ledger (P4-S3).
**Share with CA** (role `accountant`): invitation by email, read-only plus reports/exports, optional date range restriction; link expires; audit entries. Reuses team module (`members.ts`) with a new preset role.

### Acceptance
1. CA role cannot create or edit anything (API test over 10 write endpoints).
2. Restoring from Trash reposts ledger entries and respects period lock.

## Phase 7 acceptance
1. Each utility reachable from the Utilities group; wizards use Template D.
2. Tally XML imports into Tally Prime (owner's manual test recorded in `docs/DECISIONS.md`).
3. Close FY on a copy of the demo business passes the equality tests.

### Claude prompt for Phase 7
```text
Implement Phase 7 slices P7-S1…P7-S6. Close FY and Tally export depend on the ledger; refuse to run them when
accounting.ledger is off and show an "Enable accounting" CTA. Write tally.ts and fiscal-close logic as pure functions with
golden tests before touching routes. Never write a destructive restore without a safety snapshot first.
```

---

# PHASE 8: Settings (11 tabs)

**Goal**: replace the 4-tab settings with Vyapar's 11 tabs, every control wired to a real behaviour, auto-saved, and discoverable via Open Anything.
**Prerequisites**: P0 (shell, `SettingRow`, `Tabs`). Behaviour wiring for tabs depends on earlier phases (noted per row).
**Slices**: P8-S1 Settings framework · P8-S2 General · P8-S3 Transaction · P8-S4 Print · P8-S5 Taxes · P8-S6 GST · P8-S7 Transaction Message · P8-S8 Party · P8-S9 Item · P8-S10 Service Reminder · P8-S11 Accounting · P8-S12 Multi Currency · P8-S13 Account Access matrix.

## P8-S1 Settings framework

### Data
Two scopes:
| Scope | Table / place | Examples |
|---|---|---|
| Business | `business_settings(orgId, businessId, key text, value jsonb)` unique `(org, business, key)` | GST registration, invoice options, lock date |
| User | `user_prefs(userId, key, value)` | theme, shortcuts, favourites, recent |
A typed registry in `packages/contracts/src/settings.ts` declares every key once:
```ts
export const SETTINGS = {
  'txn.roundOff':        { type: z.enum(['nearest','up','down','off']), default: 'nearest', tab: 'transaction', section: 'Totals' },
  'txn.allowNegativeStock': { type: z.enum(['allow','warn','block']), default: 'warn', … },
  'gst.enabled':         { type: z.boolean(), default: true, … },
  // …every setting below
} as const;
```
`GET /v1/settings` returns all keys with defaults merged; `PATCH /v1/settings` takes a partial map, validates each key against the registry, rejects unknown keys. Permission `settings.edit`; some keys require `owner` (marked in registry: lock date, accounting enable, GST registration type).
Web hook `useSetting('txn.roundOff')` with optimistic update and rollback on error. Existing settings stored elsewhere (`lib/data/settings.js`) migrate by a one-time mapper; the old reader stays until P11 for rollback safety.

### Wireframe: framework
```text
┌ Settings ────────────────────────────────────────────────────────────────────────────────────┐
│ [🔍 Search settings…]                                                                         │
│ [General][Transaction][Print][Taxes][GST][Txn Message][Party][Item][Service Reminder][Accounting][Multi Currency] │
│ ┌ Section title ────────────────────────────────────────────────────────────────────────────┐ │
│ │ Round off transaction totals            Rounds the final total      [ Nearest ▾ ]          │ │
│ │ Show profit while billing 🔒 owner      Visible only to owners      [ ● ]                  │ │
│ │ Allow negative stock                    Sell more than in stock     ( ) Allow (●) Warn ( ) Block │
│ └────────────────────────────────────────────────────────────────────────────────────────────┘ │
│ Saved ✓ (toast)                                                                               │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```
`SettingRow` props: `label`, `help`, `control`, `ownerOnly`, `requiresFlag`, `badge` ("New", "Beta"). Search indexes label + help text and jumps/scrolls/highlights the row for 2 s.
Destructive toggles (disable GST, enable ledger) open `ConfirmModal` with the consequences listed.

### Acceptance
1. Unknown keys rejected, invalid values rejected with field-level error.
2. Owner-only keys return 403 for non-owners.
3. Settings search finds any row and scrolls to it.
4. Every key in the registry appears on exactly one tab (test iterates registry vs. rendered rows).

## P8-S2 General tab

| Setting | Key | Control | Default | Behaviour / wired to |
|---|---|---|---|---|
| Business name | `biz.name` | text | onboarding | headers, prints |
| Logo | `biz.logo` | file | none | prints (existing `files`) |
| Address, city, state, PIN | `biz.address…` | text | | invoice header, place of supply default |
| Phone, email | `biz.phone`, `biz.email` | text | | prints |
| Business type | `biz.type` | select (Retail, Wholesale, Distributor, Service, Manufacturing, Other) | Retail | seeds Library catalogue, defaults for item type |
| Business category | `biz.category` | select | | analytics only |
| GSTIN | `biz.gstin` | text with checksum | | GST features |
| PAN | `biz.pan` | text | derived | ITR, 27EQ |
| Financial year start month | `fy.startMonth` | select | 4 (April) | FY switcher, period presets |
| Date format | `fmt.date` | select dd-MM-yyyy / dd/MM/yyyy / MM-dd-yyyy | dd-MM-yyyy | display only |
| Currency symbol & decimals | `fmt.currency`, `fmt.decimals` | select, 0–4 | ₹, 2 | `Money` component |
| Quantity decimals | `fmt.qtyDecimals` | 0–4 | 2 | QtyInput, LinesGrid |
| Amount in words language | `fmt.wordsLang` | EN / HI / TA | EN | `tax-engine/words.ts` (extend for HI/TA tables) |
| App language | `ui.lang` | select | EN | i18n catalogue (see P11) |
| Auto-lock timeout | `sec.autoLock` | 1/5/15/30/never | never | web idle lock |
| Backup reminder | `backup.remindDays` | int | 7 | P7-S4 |
| Passcode | user pref | | off | existing security page link |
| Branches / multi-firm | link | | | existing `BranchModal` |

### Wireframe
```text
┌ General ────────────────────────────────────────────────────────────────────────────────┐
│ Business profile                                                                          │
│   Logo [ Upload ]   Business name [ Sri Traders ]   Type [ Retail ▾ ]                      │
│   Address [____________]  City [______]  State [ Tamil Nadu ▾ ]  PIN [______]             │
│   Phone [______]  Email [______]  GSTIN [33AAAA…] ✔  PAN [AAAAA0000A]                      │
│ Regional                                                                                    │
│   FY start [ April ▾ ]  Date format [ dd-MM-yyyy ▾ ]  Currency [ ₹ ▾ ]  Decimals [ 2 ▾ ]  │
│   Amount in words [ English ▾ ]                                                            │
│ Security                                                                                    │
│   Auto-lock [ Never ▾ ]  Backup reminder every [ 7 ] days                                  │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Acceptance
1. Changing FY start month updates period presets without reload.
2. GSTIN change triggers a confirm if invoices exist ("GSTIN appears on 412 invoices").

## P8-S3 Transaction tab

Sections: **Numbering**, **Fields shown**, **Discount & charges**, **Totals**, **Stock**, **Payments**, **Locks**.

| Setting | Key | Control | Default | Wired to / note |
|---|---|---|---|---|
| Number prefix and series per type | `txn.series.*` | table (type, prefix, next no, padding, reset on FY) | existing | `numbering.js` ✅ |
| Cash sale by default | `txn.cashDefault` | switch | off | Add Sale default sale type |
| Billing name different from party name | `txn.billingName` | switch | off | extra field |
| Customer PO details | `txn.poDetails` | switch | off | shows PO fields |
| Transport details | `txn.transport` | switch | off | vehicle, e-way fields |
| E-way bill threshold | `txn.ewayThreshold` | money | 50000 | prompt |
| Additional charges list | `txn.charges[]` | table (name, GST, SAC) | Shipping, Packaging | P2-S3 |
| Discount mode | `txn.discountMode` | line / transaction / both | both | LinesGrid columns |
| Discount unit | `txn.discountUnit` | % / ₹ / both | both | |
| Round-off mode | `txn.roundOff` | nearest/up/down/off | nearest | totals |
| Quick entry mode | `txn.quickEntry` | switch | off | minimal columns |
| Show profit while billing | `txn.showProfit` 🔒 | switch | off | live profit chip in editor, hidden for non-owners |
| Display purchase price on item row | `txn.showPurchasePrice` | switch | off | |
| Allow negative stock | `txn.negativeStock` | allow/warn/block | warn | P2-S4 |
| Auto-deduct stock on challan | `txn.challanStock` | switch | on | ✅ today |
| Barcode scan on billing | `txn.barcodeScan` | switch | off | item search accepts scanner input |
| Default payment terms | `txn.terms.days` | days | 0 | due date |
| Default due-date offset | | | | |
| Allow editing after payment | `txn.editAfterPay` | switch | on | block edit of paid docs when off |
| Freeze transactions before | `txn.lockBefore` 🔒 | date | none | P4-S6 |
| Auto-fill received amount | `txn.autofillReceived` | switch | off | P2-S2 |
| Terms & conditions default | `txn.terms.text` | textarea | | prints |

### Wireframe (excerpt)
```text
┌ Transaction ───────────────────────────────────────────────────────────────────────────┐
│ Numbering                                                                               │
│  Type          │ Prefix   │ Next no │ Padding │ Reset each FY │                           │
│  Tax invoice   │ INV-     │ 13      │ 3       │ [x]           │                           │
│  Quotation     │ QT-      │ 4       │ 3       │ [x]           │                           │
│ Totals & discounts                                                                       │
│  Discount [ Line + transaction ▾ ]  Unit [ % and ₹ ▾ ]  Round off [ Nearest ▾ ]          │
│ Stock                                                                                    │
│  Negative stock ( ) Allow (●) Warn ( ) Block   [x] Auto-deduct on challan                │
│ Locks                                                                                    │
│  Freeze transactions before [ 31-03-2026 ] 🔒 Owner only                                 │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Acceptance
1. Each setting changes behaviour in the corresponding screen (checklist test per key).
2. Series edit validates uniqueness of `(prefix)` per type and prevents lowering `next no` below the highest used (warn).

## P8-S4 Print tab

| Setting | Key | Control | Notes |
|---|---|---|---|
| Template / theme | `print.template` | gallery of 6 | existing `InvoicePreview` |
| Paper size | `print.paper` | A4 / A5 / Thermal 2" / 3" | thermal CSS widths 48mm/72mm |
| Orientation | `print.orientation` | portrait / landscape | |
| Margins | `print.margins` | mm ×4 | |
| Logo / signature / stamp | files | | ✅ |
| Show toggles | `print.show.*` | HSN, UPI QR ✅, bank details ✅, item description, MRP, batch, payment mode, amount in words, party balance, "PAID" stamp, signature | |
| Copies | `print.copies` | Original / Duplicate / Triplicate / Extra | prints stacked pages with label |
| Footer text, terms | | | |
| Regional names | `print.regional` | item name in second language | |
| Thermal options | `print.thermal` | char width, cut, header lines | |
| Cheque print setup 🆕 | `print.cheque` | bank template, x/y offsets, test print | optional |

### Wireframe: live preview split (Template: left controls, right preview)
```text
┌ Print ─────────────────────────────────────────────────────────────────────────────┐
│ ┌ Controls ────────────────────────┐ ┌ Preview (Tax invoice) ──────────────────────┐ │
│ │ Template [ Classic ▾ ]            │ │ ┌ TAX INVOICE ─────────────────────────────┐ │ │
│ │ Paper [ A4 ▾ ] Orientation [ ▾ ]  │ │ │ Logo   Business name      Invoice # INV-12│ │ │
│ │ [x] HSN  [x] UPI QR  [x] Bank     │ │ │ Bill To …                                 │ │ │
│ │ [ ] MRP  [x] Amount in words      │ │ │ # Item HSN Qty Rate GST Amount            │ │ │
│ │ Copies [ Original ▾ ]             │ │ │ …                                         │ │ │
│ │ Footer [__________]               │ │ └──────────────────────────────────────────┘ │ │
│ │ [ Test print ]                    │ │ [Switch sample: Invoice | Challan | Quote]  │ │
│ └───────────────────────────────────┘ └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Acceptance
1. Preview updates < 300 ms per toggle; print output equals preview (visual snapshot for 3 templates).
2. Thermal 3" prints without horizontal overflow.

## P8-S5 Taxes tab

| Setting | Control | Notes |
|---|---|---|
| Tax rate master | table (rate, label, active) | seeded 0, 0.25, 3, 5, 12, 18, 28; custom allowed; `rates.ts` reads from settings |
| Tax groups | table (name = CGST x + SGST x) | display only; GST math remains rate-based |
| Cess master | table (name, % or fixed per unit) | |
| TCS rates | table (section, nature, rate, threshold) | §206C(1H) 0.1%; used by invoices |
| TDS sections | table (section, nature, rate individual, rate other, annual threshold, single-txn threshold) | seeded: 194C, 194J, 194H, 194I(a), 194I(b), 194Q, 194A; feeds Payment Out and Party flags |
| Default tax on new items | select | |
| Price inclusive default | switch | |
| Additional taxes | table | non-GST levies (e.g., local) shown as lines |

Wireframe (TDS sections):
```text
│ TDS sections                                                        [ + Add section ] │
│ Section │ Nature            │ Rate (ind) │ Rate (other) │ Single txn │ Annual threshold │
│ 194C    │ Contractors       │ 1%         │ 2%           │ ₹30,000    │ ₹1,00,000        │
│ 194J    │ Professional fees │ 10%        │ 10%          │ –          │ ₹30,000          │
│ 194Q    │ Purchase of goods │ 0.1%       │ 0.1%         │ –          │ ₹50,00,000       │
```
⚠️ Rates and thresholds change by Finance Act: seed with a `validFrom` and ship updates through a data migration; show "Rates as of FY 2026-27, verify with your CA".

### Acceptance
1. Deactivating a tax rate in use is blocked with the list of items using it.
2. TDS table drives `tdsCalc` (P3-S2) with no hard-coded rates left in code (grep test).

## P8-S6 GST tab

| Setting | Key | Control | Default | Effect |
|---|---|---|---|---|
| Enable GST | `gst.enabled` | switch 🔒 | on | off hides GST columns, GST returns, HSN; confirm dialog |
| GSTIN per branch | link | | | branch settings |
| Registration type | `gst.regType` | Regular / Composition / Unregistered | Regular | Composition: Bill of Supply only, composition rate used |
| Composition rate | `gst.compRate` | % | 1 | GSTR-4 summary (future) |
| Return frequency | `gst.frequency` | Monthly / QRMP | Monthly | due dates, 3B period |
| E-invoice | `gst.einvoice.enabled` + credentials | switch + fields | off | P10 |
| E-way bill | `gst.eway.enabled` | switch | on | threshold |
| Reverse charge | `gst.rcm` | switch | off | shows RCM checkboxes |
| Show place of supply | `gst.pos` | switch | on | |
| HSN/SAC on invoice + digits | `gst.hsnDigits` | 4/6/8 | by turnover (≤ ₹5 cr: 4, above: 6) | validation message |
| ITC default eligibility | `gst.itcDefault` | eligible / ineligible | eligible | P3 |
| Enable TCS | `gst.tcs` | switch | off | invoice TCS field |
| Collector TAN | `gst.tan` | text | | 27EQ |
| Exempt/nil label | `gst.exemptLabel` | text | "Exempt" | prints |

Wireframe:
```text
┌ GST ──────────────────────────────────────────────────────────────────────────────┐
│ [x] Enable GST    Registration [ Regular ▾ ]   Return filing [ Monthly ▾ ]          │
│ GSTIN [33AAAA…] ✔ Tamil Nadu                                                         │
│ [x] E-way bill   Threshold [₹ 50,000]     [ ] E-invoice (configure)                  │
│ [ ] Reverse charge  [x] Show place of supply  HSN digits [ 4 ▾ ]                    │
│ [ ] Enable TCS  Collector TAN [__________]                                          │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Acceptance
1. GST off: no GST column or menu anywhere (screenshot test of 5 pages); GSTR output blocked with a message.
2. Registration type Composition switches invoice default to Bill of Supply and hides tax columns.

## P8-S7 Transaction Message tab

### Data
`message_templates(id, orgId, businessId, event, channel, language, subject, body, active)`; events: `sale`, `payment_in`, `purchase`, `payment_out`, `sale_order`, `quotation`, `reminder`, `cheque_due`. Channels: `whatsapp`, `sms`, `email`.
Variables: `{party}`, `{number}`, `{amount}`, `{balance}`, `{due_date}`, `{business}`, `{link}`, `{date}`, `{items}` (first 3 lines).
Pure `renderTemplate(body, vars)` with escaping and unknown-variable detection (shows a red chip in the editor).

### Wireframe
```text
┌ Transaction Message ──────────────────────────────────────────────────────────────────┐
│ Event [ Sale ▾ ]  Channel [ WhatsApp ▾ ]  Language [ English ▾ ]  [x] Active            │
│ ┌ Message ──────────────────────────────────────┐ ┌ Preview ──────────────────────────┐ │
│ │ Dear {party}, your invoice {number} for        │ │ Dear Ravi Traders, your invoice   │ │
│ │ ₹{amount} is ready. Balance ₹{balance}.        │ │ INV-12 for ₹8,260 is ready.       │ │
│ │ View: {link}   – {business}                    │ │ Balance ₹8,260. View: https://…   │ │
│ └────────────────────────────────────────────────┘ └───────────────────────────────────┘ │
│ Variables: [{party}][{number}][{amount}][{balance}][{due_date}][{business}][{link}]      │
│ [x] Send automatically after save   [ ] Send me a copy        [ Reset to default ]       │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Acceptance
1. Preview identical to rendered message for sample data; unknown variable flagged.
2. WhatsApp text limit (4096) warning; SMS length counter with segment estimate.

## P8-S8 Party tab

| Setting | Key | Default | Wired to |
|---|---|---|---|
| Party grouping | `party.groups` | on | group fields, filters |
| Shipping address | `party.shipping` | on | Add Sale ship-to |
| Credit limit | `party.credit` | off | P2-S4 |
| Credit limit mode | `party.creditMode` | warn | |
| Additional party fields (4) | `party.custom[]` | none | labels in Party modal, optional "print on invoice" |
| Payment reminder | `party.reminder` | off | days before/after; P9 |
| Party-wise item rate | `party.itemRates` | off | P1-S2 |
| TDS/TCS on party | `party.tdsTcs` | off | |
| Default party type | `party.defaultKind` | customer | |
| Opening balance mandatory | `party.openingRequired` | off | |
| Duplicate phone warning | `party.dupPhone` | on | |

Settings off hide the matching fields in the Party modal (keeps data); acceptance: toggling off and on again shows previously saved values.

## P8-S9 Item tab

| Setting | Key | Default | Effect |
|---|---|---|---|
| Item type (product/service) | `item.types` | on | |
| Category | `item.category` | on | |
| HSN/SAC | `item.hsn` | on | |
| Secondary unit | `item.altUnit` | off | P1-S4 |
| Description | `item.description` | off | |
| Image | `item.image` | off | |
| Wholesale price | `item.wholesale` | off | |
| MRP | `item.mrp` | off | |
| Batch tracking + fields | `item.batch`, `item.batchFields[]` (batch no, mfg, exp, model, size) | off | P1-S5 |
| Serial tracking | `item.serial` | off | |
| Stock maintenance | `item.stock` | on | |
| Minimum stock alert | `item.minStock` | on | |
| Item-wise discount | `item.discount` | on | |
| Item-wise tax | `item.tax` | on | |
| Barcode scanning | `item.barcode` | off | |
| Additional item fields (4) | `item.custom[]` | none | |
| Quantity decimals | `fmt.qtyDecimals` | 2 | |
| Default unit | `item.defaultUnit` | PCS | |
| Default GST rate | `item.defaultGst` | 18 | |
| Barcode format | `item.barcodeFormat` | Code128 | P7-S1 |

## P8-S10 Service Reminder tab ⚠️

Semantics inferred (blueprint note). Implement as **recurring service reminders**:
```ts
serviceReminders: { id, name, itemId null, partyId null, intervalDays|intervalMonths, remindBeforeDays, channel[], templateId,
                    autoCreateAfterSale bool, nextDueDate, lastSentAt, active }
```
Flow:
```text
Sale with a service item flagged "reminder" → reminder created for that party with nextDue = sale date + interval
 → daily job: due within remindBefore → send via channels (P9) → mark lastSentAt → set next cycle on service completion or after send per setting
```
Wireframe:
```text
┌ Service Reminder ────────────────────────────────────────────── [ + Add reminder ] ┐
│ Name [ AC annual service ] Linked item [ AC service ▾ ]  Every [ 12 ] months         │
│ Remind [ 7 ] days before  Channels [x] WhatsApp [ ] SMS [x] In-app                  │
│ Template [ Service due ▾ ]  [x] Auto-create after sale                               │
│ Upcoming: Ravi – AC annual service – due 02-12-2026 [Send now] [Done] [Snooze]       │
└──────────────────────────────────────────────────────────────────────────────────────┘
```
**Decision record needed** before building: confirm real Vyapar semantics.

## P8-S11 Accounting tab

| Setting | Key | Control | Notes |
|---|---|---|---|
| Enable accounting ledger | `acct.enabled` 🔒 | switch → opens P4-S4 panel | |
| Chart of accounts | link | table P4-S1 | |
| Opening balances | link | table: parties, banks, cash, stock | |
| Default accounts | `acct.defaults.*` | selects: Sales, Purchase, Round-off, Discount, Bank charges, Interest, Commission | used by `posting.ts` ctx |
| Cash in hand opening | `acct.cashOpening` | money + date | |
| Depreciation | `acct.depreciation` | switch → fixed asset register (later) | optional |
| Stock valuation method | `acct.valuation` | Weighted average / FIFO ⚠️ | FIFO needs batch-level layers; ship weighted average only, show FIFO as "coming soon" |
| Accounting lock date | `acct.lockBefore` 🔒 | date | P4-S6 |
| Auto-post expenses | `acct.autoPostExpense` | switch | |
| Cheque management | `cashbank.cheques` | switch | P5 |
| Loan accounts | `cashbank.loans` | switch | P5 |

## P8-S12 Multi Currency tab ⚠️

| Setting | Control | Notes |
|---|---|---|
| Enable | switch | off by default |
| Base currency | select | INR fixed in v1 |
| Currencies | table: code, symbol, name, active | |
| Exchange rates | table: currency, rate, as-of date; "Add rate"; optional auto-fetch (provider decision) | `exchange_rates(currency, rate, asOf)` |
| Per-party currency | party field | |
| Show both amounts | switch | invoice prints foreign and INR |
| Forex gain/loss account | select | settlement differences |
| Export rules | info | LUT/WPAY/WOPAY ✅ in GSTR-1 6A |

Pure fn `convert(amount, rate)` and `forexDifference({ invoiceRate, settleRate, foreignAmount })`. GST computed on INR value at the invoice-date rate (rule 34 of CGST rules; ⚠️ confirm with a CA). Invoices store `currency`, `rate`, `amountForeign`.

### Acceptance
1. Foreign-currency invoice stores both amounts; settlement posts forex difference.
2. Reports always show INR with a currency filter.

## P8-S13 Account Access matrix

### Wireframe
```text
┌ Account Access ───────────────────────────────────────────────────────────────────────┐
│ Users:  Name │ Role │ Branches │ Status │ Last login │ [Invite user]                    │
│ Role matrix  [ Role: Accountant ▾ ]                                                    │
│ Module        │ View │ Create │ Edit │ Delete │ Export │                                │
│ Parties       │  ☑   │  ☐     │  ☐   │  ☐     │  ☑     │                                │
│ Items         │  ☑   │  ☐     │  ☐   │  ☐     │  ☑     │                                │
│ Sale          │  ☑   │  ☐     │  ☐   │  ☐     │  ☑     │                                │
│ Purchase      │  ☑   │  ☐     │  ☐   │  ☐     │  ☑     │                                │
│ Expense       │  ☑   │  ☐     │  ☐   │  ☐     │  ☑     │                                │
│ Cash & Bank   │  ☑   │  ☐     │  ☐   │  ☐     │  ☑     │                                │
│ Reports       │  ☑   │  –     │  –   │  –     │  ☑     │                                │
│ GST / Tax     │  ☑   │  ☐     │  ☐   │  ☐     │  ☑     │                                │
│ Settings      │  ☐   │  ☐     │  ☐   │  ☐     │  ☐     │                                │
│ Utilities     │  ☐   │  ☐     │  ☐   │  ☐     │  ☐     │                                │
│ Toggles: [ ] Hide purchase price  [ ] Hide profit reports  [ ] Own transactions only   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
Preset roles: Owner (all), Admin, Accountant/CA (read + reports + export), Salesman (own sales), Staff (create sales/parties). Custom roles allowed. The matrix writes to the existing permissions table; permission keys listed in Appendix A.
Row-scoping toggles implemented as API filters (not UI hiding): `ownOnly` → `where created_by = user` or `salesman_id = linked staff`.

### Acceptance
1. Role "Salesman" cannot read purchases or profit reports via direct API.
2. Matrix changes take effect on next request (permission cache invalidated).

## Phase 8 test plan
| Layer | Cases |
|---|---|
| Contracts | registry integrity (each key unique, default valid), PATCH validation (20) |
| API | settings merge, owner-only, search index, audit on change, isolation |
| Web | SettingRow, search jump, toggles hide fields, live print preview |
| Behaviour | one test per behaviour-changing key (~40) |

## Phase 8 acceptance
1. All 11 tabs render, every key wired or marked "Coming soon" with a badge (no dead toggles).
2. Old settings screens removed; deep links `/settings/<tab>` work; legacy links redirect.
3. Settings search works across tabs.

### Claude prompt for Phase 8
```text
Implement Phase 8. Start with the typed registry in packages/contracts/src/settings.ts and a test that every key appears on one tab.
A toggle without behaviour must be hidden or badged "Coming soon", never silently inert. Keep the old settings reader working
until P11 so rollback is possible. Owner-only keys must be enforced in the API, not just hidden in the UI.
```

---

# PHASE 9: Grow your business (reminders, messages, salesman tracking, service reminders)

**Goal**: sell more and collect faster: payment reminders, WhatsApp/SMS/email messaging, salesman performance, and catalog sharing.
**Prerequisites**: P2-S1 (salesman), P8-S7 (templates). Messaging provider decision (blueprint 4.9 #4).
**Flag**: `messaging`.
**Slices**: P9-S1 Messaging core · P9-S2 Payment reminders · P9-S3 Share document · P9-S4 Salesman tracking pages · P9-S5 Service reminders run · P9-S6 Online catalog (optional) · P9-S7 Loyalty and offers (optional, later).

## P9-S1 Messaging core

### Provider abstraction
```ts
interface MessageProvider { channel: 'whatsapp'|'sms'|'email'; send(msg: Outbound): Promise<{ id: string }>; status(id): Promise<Status>; }
```
Implementations behind env config: `whatsappLink` (no API: opens `wa.me` link, works without cost; **default**), `whatsappCloud` (WhatsApp Business API), `sms` (MSG91 or similar), `email` (existing mail module ✅). The default `whatsappLink` provider means the feature works on day one with a click-to-send flow.

### Data
```ts
messages: { id, orgId, businessId, channel, to, templateId, event, refType, refId, body, status: 'queued'|'sent'|'delivered'|'failed'|'opened', error, scheduledAt, sentAt }
```
Queue: DB-backed job table processed by the API worker (poll every 30 s; row lock `FOR UPDATE SKIP LOCKED`); retries with backoff (1, 5, 30 min); idempotency key `(refType, refId, event, channel, scheduledDate)`.

### Wireframe: send dialog (any document)
```text
┌ Share INV-12 ───────────────────────────────────────────────────── [×] ┐
│ To  [ Ravi Traders · +91 98xxxxxx01 ▾ ]                                  │
│ Channel (●) WhatsApp ( ) SMS ( ) Email ( ) Copy link                      │
│ Attach [x] PDF invoice  [ ] Payment link (when enabled)                   │
│ Message [ Dear Ravi Traders, your invoice INV-12 for ₹8,260 … ]  [Edit]   │
│                                        [ Cancel ] [ Send on WhatsApp ]    │
└───────────────────────────────────────────────────────────────────────────┘
```
`whatsappLink` provider: opens `https://wa.me/91XXXXXXXXXX?text=…` with the PDF as a public link (signed, expiring, `GET /s/:token`); marks message `sent` on click (cannot confirm delivery).

### Public document link
`document_links(token, orgId, refType, refId, expiresAt, views)`: read-only HTML/PDF view of an invoice at `/s/:token`; no login; rate limited; revoke from document menu; shows "Pay now" later.

### Acceptance
1. Link expires, revoke works, view count increments; token unguessable (≥ 128 bits).
2. Failed sends retry with backoff and surface in a Messages log.
3. Opt-out: party flag `doNotMessage` respected by all senders.

## P9-S2 Payment reminders

### Rules
Settings (P8-S8): reminders on/off, `daysBefore` (e.g., 3), `onDue` (bool), `daysAfter` list (e.g., 3, 7, 15), channels, quiet hours (default 09:00–20:00), max reminders per invoice (default 5).
Daily job:
```text
for each unpaid invoice with dueDate:
   offset = today − dueDate
   if offset ∈ { −daysBefore, 0 (if onDue), +daysAfter… } and no message sent for that offset
       → enqueue message with template 'reminder'
```
Pure fn `reminderOffsets(settings)` and `shouldRemind(invoice, today, sent[])` tested for edge cases (paid between runs, partial payment, due-date change, weekends).

### Wireframe: reminders list (Template A)
```text
┌ Payment Reminders ───────────────────────────────────────────── [ Settings ⚙ ] ┐
│ [Overdue ▾] [Party ▾] [Days late ▾]    Selected 3: [ Send WhatsApp ] [ Send SMS ] │
│ ☐ │ Party        │ Invoice │ Due      │ Days late │ Pending  │ Last reminder │ ⋮  │
│ ☑ │ Ravi Traders │ INV-12  │ 25-10-26 │ 12        │ ₹8,260   │ 01-11 (WA)    │ ⋮  │
│ ☑ │ Kiran        │ INV-09  │ 15-10-26 │ 22        │ ₹3,740   │ –             │ ⋮  │
│ Total overdue ₹12,000 across 2 parties                                          │
└──────────────────────────────────────────────────────────────────────────────────┘
```
Bulk send respects per-party opt-out, shows a preview of the first message, and a summary "Sent 3, skipped 1 (no phone)".

### Acceptance
1. A paid invoice never receives a reminder (test: pay then run job).
2. Quiet hours respected; messages queue to the next window.
3. Reminders list totals equal Receivable Ageing overdue buckets.

## P9-S3 Share document (WhatsApp / PDF / email)

Add **Share ▾** to every document list row and editor: WhatsApp, Email, SMS, Copy link, Download PDF, Print. Email uses `mail` module with PDF attachment and template per event. Statement sharing from Party Detail and Reports use the same dialog. Pre-fills the party phone/email; warns when missing.

### Acceptance
1. PDF attachment equals the print preview (hash of rendered PDF text in a test).
2. Missing phone/email shows inline "Add phone" mini form that updates the party.

## P9-S4 Salesman tracking pages

### Screens
```text
┌ Salesman ────────────────────────────────────────────────── [ + Add Salesman ] ┐
│ Name   │ Target │ Sales (mo) │ % target │ Collected │ Outstanding │ Commission │
│ Kumar  │ 5.0 L  │ 3.2 L      │ 64% ▓▓▓░ │ 2.1 L     │ 1.1 L       │ ₹6,400     │
└──────────────────────────────────────────────────────────────────────────────────┘
┌ ← Kumar ───────────────────────────────────────────────────────────────────────────┐
│ [ Invoices ][ Collections ][ Parties ][ Targets ][ Visits (mobile) ]                │
│ Month [Nov 2026 ▾]  Sales ₹3.2L  Collected ₹2.1L  Commission ₹6,400  Returns ₹10,000 │
│ Invoice table …                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```
Targets tab: monthly target per salesman with history, achievement bar. Collections tab: payments allocated to that salesman's invoices. Visits (mobile PWA): check-in with geolocation to a party (opt-in, consent text, stored `staff_visits(staffId, partyId, lat, lng, at, note)`); ⚠️ privacy review: location is personal data, show consent and retention (90 days default).
Commission settlement: "Mark commission paid" creates an Expense (`Salesman Commission`) for the month, preventing double payment.

### Acceptance
1. Commission rules tested: on sale vs on collection, with returns.
2. Visits only recorded with consent; deletion after retention window by a job.

## P9-S5 Service reminders run

Daily job for P8-S10 reminders; "Service due" widget on Home; per-party view shows upcoming services; **Done** button creates the next cycle and optionally a draft invoice for the service item.

### Acceptance
1. Interval math across month ends (Jan 31 + 1 month → Feb 28/29) tested.
2. Snooze moves nextDue without altering interval.

## P9-S6 Online catalog (optional, later)

Public read-only catalogue page `/c/:slug` listing items flagged "Show in catalog" with image, price (toggle), stock status; enquiry button opens WhatsApp with the item name. No cart or payments in v1. Owner controls: enable, slug, theme colour, hide prices, contact number. Rate limit and cache (5 min). SEO off by default (`noindex`).

## P9-S7 Loyalty and offers (optional, later)

Out of scope for the parity target; listed in `docs/BACKLOG.md`. Only a design stub: discount coupons per party group with validity, applied in the editor as a transaction discount with an `offerCode` on the invoice.

## Phase 9 test plan
| Layer | Cases |
|---|---|
| tax-engine | reminderOffsets (6), shouldRemind (12), renderTemplate (8), serviceNextDue (8), commission (6) |
| API | queue idempotency, retry, opt-out, public link expiry/revoke, quiet hours, isolation |
| Web | share dialog, reminders bulk send summary, salesman targets bar |
| E2E | overdue invoice → reminder list → send via WhatsApp link → log entry |

## Phase 9 acceptance
1. With `whatsappLink` provider, user can send an invoice and a reminder in two clicks.
2. No message is ever sent to opted-out parties or outside quiet hours.
3. Salesman numbers equal Sale report filtered by salesman.

### Claude prompt for Phase 9
```text
Implement Phase 9 behind the messaging flag. Build the provider interface and the whatsappLink provider first (no external cost),
then the queue. Pure scheduling functions (reminderOffsets, shouldRemind, serviceNextDue) need exhaustive tests before any job
runs. Never send in tests: inject a fake provider. Treat salesman location as sensitive: consent screen and retention job required.
```

---

# PHASE 10: Compliance polish (GST and Income Tax)

**Goal**: close the compliance gaps listed in the blueprint connection map (4.6) so GSTR-1, GSTR-3B, TDS/TCS and the ITR helpers read from the new data correctly.
**Prerequisites**: P3 (ITC flags, RCM, debit notes, payment out), P4 (ledger), P6-S5 (GST report shells).
**Slices**: P10-S1 GSTR-1 Table 11 advances and adjustments · P10-S2 Reverse charge end to end · P10-S3 GSTR-3B Table 4 and 3.1 completion · P10-S4 ITC 180-day rule · P10-S5 TDS/TCS ledger and Form 26Q-style summary · P10-S6 Cash-limit watch (§269ST, §40A(3)) · P10-S7 E-invoice IRN (optional, provider) · P10-S8 Books-based ITR-3 map and advance tax from P&L.
**Hard rule**: every number that changes is shown in a before/after fixture in `apps/web/test/gstReturnTables.test.js`. A CA review is recorded in `docs/DECISIONS.md` before the slice is marked done.

## P10-S1 GSTR-1 Table 11 (advances) and adjustments

### Concept
Advance received before invoice → tax liability arises on receipt (Table 11A). When the invoice is issued later, the advance is adjusted (Table 11B) so tax is not paid twice.

### Data
`payments` rows with `direction='in'` and unallocated amount > 0 (advance). New table:
```ts
advanceReceipts: { id, orgId, paymentId, partyId, receiptDate, amount, taxableValue, rate, pos, cgst, sgst, igst, cess,
                   adjustedAmount default 0, status: 'open'|'partial'|'adjusted' }
```
Created when a Payment In has unallocated remainder **and** the party/item context implies taxable supply (rate chosen by user in the voucher: "Advance for GST rate [18% ▾]", default from Settings, since the item is not yet known). Tax computed inclusive (receipt amount includes GST): `taxable = amount / (1 + rate)`.
Adjustment: when an invoice is allocated against the advance (Payment In allocation to invoice from advance balance), `adjustedAmount` increases.

### Pure functions (`tax-engine/advances.ts`)
- `advanceTax({ amount, rate, pos, bizState })` → head split.
- `table11({ receipts, adjustments, period })` → 11A (new advances in period by POS/rate) and 11B (adjusted in period by POS/rate); outputs per-rate rows.
Tests: advance and invoice in same month (net zero), advance this month, invoice next month, partial adjustment, refund of advance (negative).

### Wireframe: Payment In with advance
```text
│ Amount received* [₹ 11,800]                                                              │
│ Allocated to invoices ₹0    Unallocated ₹11,800 → Advance                               │
│ Advance for GST rate [ 18% ▾ ]   Place of supply [ Tamil Nadu ▾ ]   Tax ₹1,800 (incl.)   │
│ ℹ This advance will be reported in GSTR-1 Table 11 for Nov 2026.                         │
```
GSTR-1 view gets a new section:
```text
┌ Table 11: Advances ───────────────────────────────────────────────────┐
│ 11A(1) Advance received in period                                      │
│ POS │ Rate │ Gross advance │ Taxable │ IGST │ CGST │ SGST │ Cess       │
│ 33  │ 18%  │ 11,800        │ 10,000  │ 0    │ 900  │ 900  │ 0          │
│ 11B(1) Advance adjusted in period                                      │
│ 33  │ 18%  │ 5,900         │ 5,000   │ …                               │
└────────────────────────────────────────────────────────────────────────┘
```

### Acceptance
1. GSTR-1 JSON gains `at` (11A) and `txpd` (11B) arrays only when advances exist; otherwise JSON identical to today.
2. Output tax in 3B 3.1(a) includes advance tax (cross-check test).

## P10-S2 Reverse charge end to end

### Cases supported
| Case | Direction | Treatment |
|---|---|---|
| Purchase from unregistered supplier under notified categories (e.g., GTA, legal services, security) | purchase | RCM checkbox; liability posted; paid in cash ledger; ITC claimable after payment |
| Import of services | purchase | RCM, IGST |
| Sale where recipient liable (e.g., sale to Govt for specified services) | sale | Invoice flagged `reverseCharge`; tax not collected; reported in Table 4B in GSTR-1 |
### Data
`purchases.reverse_charge`, `invoices.reverse_charge` (P3-S1, P2-S7). New in 3B: 3.1(d) inward supplies liable to reverse charge; 4(A)(2)/(3) ITC on RCM (after payment) .
RCM tax payment flow:
```text
Purchase saved (RCM) → liability accrues in "RCM Payable" ledger (Cr), Input GST (Dr, held "pending payment")
 → at month end GSTR-3B 3.1(d) shows tax; user pays via cash ledger (not credit ledger)
 → "Record RCM payment" button creates a payment (Dr RCM Payable, Cr Bank) → Input GST becomes claimable that month (4A(3))
```
### Wireframe: RCM payments panel in GSTR-3B
```text
┌ Reverse charge (RCM) ───────────────────────────────────────────────────────────────┐
│ Bill │ Supplier (unregistered) │ Category │ Taxable │ IGST/CGST/SGST │ Status          │
│ P-17 │ Transport Co            │ GTA      │ 10,000  │ 250 / 250      │ Unpaid [Record payment] │
└──────────────────────────────────────────────────────────────────────────────────────┘
```
### Acceptance
1. RCM unpaid → in 3.1(d), not in ITC; after payment → ITC 4(A)(3) in the payment month.
2. No double counting between RCM liability and normal output tax (fixture).

## P10-S3 GSTR-3B Table 4 and 3.1 completion

| 3B cell | Source | Notes |
|---|---|---|
| 3.1(a) Outward taxable | invoices excluding nil/exempt/zero-rated + advances (net of adjustments) | |
| 3.1(b) Zero rated | exports, SEZ | |
| 3.1(c) Nil rated, exempt | items `tax_category in (exempt, nil_rated)` | |
| 3.1(d) Inward liable to RCM | P10-S2 | |
| 3.1(e) Non-GST outward | `non_gst` items | |
| 3.2 Inter-state to unregistered/composition/UIN | invoices IGST to those | by state |
| 4(A)(1) Import goods | purchases flagged import | |
| 4(A)(3) Inward RCM | after payment | |
| 4(A)(5) All other ITC | eligible purchase tax | uses `itcSplit` |
| 4(B)(1) Rule 38/42/43 and §17(5) | ineligible lines | |
| 4(B)(2) Others (e.g., debit note reversal, 180-day) | P3-S4, P10-S4 | |
| 4(D)(2) Ineligible ITC | derived | |
| 5 Exempt, nil, non-GST **inward** | purchases of exempt/nil/non-GST items; interstate/intrastate split | |
| 6.1 Payment of tax | computed liability less ITC, interest/late fee fields (manual) | |

Wireframe: keep existing GSTR-3B screen, add expandable rows "How is this calculated?" listing source documents.

### Acceptance
1. Each cell has a fixture (22 fixtures) and drill-down to documents.
2. Net liability = output − ITC matches the ledger Duties & Taxes accounts (cross-check).

## P10-S4 ITC 180-day rule

Rule: ITC is reversed if the supplier is not paid within 180 days of invoice date (§16(2), Rule 37); re-claimable after payment.
Pure fn `itcAging(purchases, payments, asOf)` → `{ dueForReversal[], atRisk[] (days 150–180) }`.
UI: Purchases list chip "ITC at risk (12 days left)"; dashboard card; GSTR-3B 4(B)(2) auto-includes reversal with a "Review" list; on payment later, a re-claim line appears in 4(A)(5) with "Re-claimed ITC" label.
```text
┌ ITC at risk ──────────────────────────────────────────────────────────────┐
│ Bill │ Supplier │ Bill date │ Unpaid ₹ │ ITC ₹  │ Days left │ [Pay now]    │
│ P-9  │ Om       │ 10-05-26  │ 12,000   │ 2,160  │ 8         │              │
└────────────────────────────────────────────────────────────────────────────┘
```
Cheque payments count on **clearance** date (P5-S4) — ⚠️ confirm with CA; implement as setting `gst.itc180.useClearanceDate` default on.

### Acceptance
1. Boundary tests at day 179/180/181; partial payment proportional reversal.
2. Re-claim after payment appears in the following return period.

## P10-S5 TDS/TCS ledger and Form 26Q-style summary

### Data
`tds_entries(id, orgId, direction: 'deducted_by_us'|'deducted_by_customer', partyId, section, baseAmount, rate, tdsAmount, date, refType, refId, challanNo null, challanDate null, status: 'accrued'|'deposited')`.
Created from Payment Out (we deduct), Payment In (customer deducts), Purchase (§194Q), Expense (rent/professional).
### Screens
**TDS Payable** (we deducted): grouped by section and deductee, with PAN check (missing PAN → 20% higher rate flag), challan entry (**Mark deposited**: BSR code, challan serial, date, amount) → posts Dr TDS Payable / Cr Bank.
**TDS Receivable** (customers deducted): by customer and FY; matches **Form 26AS** (import 26AS CSV to compare: unmatched rows highlighted); feeds ITR credit.
```text
┌ TDS Payable ──────────────────────────────────────────────────────────────────────────┐
│ Quarter [Q3 FY26-27 ▾] Section [All ▾]                                [Export 26Q CSV] │
│ Deductee │ PAN        │ Section │ Paid amt │ Rate │ TDS    │ Deposited │ Due date      │
│ Om Svc   │ AAAAA0000A │ 194C    │ 50,000   │ 1%   │ 500    │ ☐         │ 07-12-2026    │
│ Landlord │ (missing)  │ 194I(b) │ 25,000   │ 20%  │ 5,000  │ ☐         │ 07-12-2026    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```
Due dates: 7th of next month (30 April for March). Overdue flagged with §201(1A) interest estimate (1% / 1.5% per month; pure fn `tdsInterest`).
### Acceptance
1. Threshold logic: no TDS accrues below section annual thresholds, accrues from the crossing transaction (fixture).
2. 26AS comparison finds missing and mismatched rows.

## P10-S6 Cash-limit watch

| Rule | Check | UI |
|---|---|---|
| §269ST: receipt of ₹2 lakh or more (single day, single transaction, single event) in cash | Σ cash receipts per party per day ≥ 200000 | red chip on Payment In, row in Cash Watch report |
| §269SS/§269T: loans/deposits ≥ ₹20,000 in cash | loan received by cash | warning |
| §40A(3): cash expenditure > ₹10,000 per person per day disallowed | Σ cash payments per payee per day > 10000 | amber chip, report "disallowance estimate" |
| §43B(h): MSME dues beyond 45 days | supplier flagged MSME with unpaid > 45 days | list; party flag `msme` |
Report **Cash watch** `cash-watch`: Date, Party, Type, Amount, Rule, Days, Action. Source ledger vouchers on the cash account with party.

### Acceptance
1. Fixtures for boundary ₹1,99,999 vs ₹2,00,000; same-day aggregation across two receipts.
2. MSME flag only affects reports, never blocks posting.

## P10-S7 E-invoice IRN (optional, provider-dependent)

⚠️ Requires GSP/IRP credentials and turnover threshold check (e-invoice mandatory above ₹5 crore AATO; confirm current threshold with CA).
Flow:
```text
Save B2B tax invoice (e-invoice enabled) → build IRP JSON (INV-1 schema) via tax-engine/einvoice.ts → POST to provider
 → on success store IRN, ack no/date, signed QR → print QR on invoice → lock edits
 → failure: show provider error list, invoice stays "draft-pending"
Cancel: within 24 h via provider API with reason; after that issue credit note
```
Data: `invoices.irn`, `ack_no`, `ack_date`, `signed_qr`, `einvoice_status`. Settings > GST holds credentials (encrypted at rest, never returned by API).
Wireframe: invoice detail shows status chip `IRN generated` with copy button and QR in preview; invoice list gets filter "E-invoice pending".
Acceptance: schema validation of generated JSON against the official sample set; sandbox round trip when credentials are available; feature stays off by default.

## P10-S8 Books-based ITR-3 map and advance tax from P&L

### Screens
`IncomeTax.jsx` (✅ regime calculator, presumptive, advance tax, bank import, summary) gets:
1. **Business income source** toggle: Presumptive (existing) · Books (from ledger P&L).
2. **ITR-3 field map** (read-only table, copyable): P&L items → schedule rows (e.g., Sale → Schedule BP row, Closing stock, Depreciation → Schedule DPM/DOA mapping stub, Balance sheet items → Part A-BS), with warnings "values must be reviewed by your CA".
3. **Advance tax** reads projected net profit = YTD net profit annualised (option) from P&L.
```text
┌ Income Tax ─ [Regime][Presumptive][Books-based ITR-3][Advance tax][Bank import][Summary] ┐
│ Source [ ● Books (ledger)  ○ Presumptive ]        FY 2026-27 up to 06-11-2026           │
│ Net profit (P&L) ₹2,80,000   Projected full year ₹4,60,000 [ Edit ]                     │
│ Schedule BP map:                                                                          │
│  Turnover (net of GST)            ₹12,40,000  ← Sale − returns                          │
│  Purchases                        ₹7,20,000                                              │
│  Closing stock                    ₹1,50,000                                              │
│  Net profit as per P&L            ₹2,80,000                                              │
│ [ Download JSON ] [ Download PDF summary ]    ⚠ Not for direct filing                    │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
Constraint stays: no public ITR submission API, outputs are summaries for upload on incometax.gov.in.
Acceptance: map totals reconcile to P&L and Balance Sheet (cross-check); presumptive path outputs unchanged (golden).

## Phase 10 acceptance
1. All fixtures show before/after; CA review note recorded for S1–S5.
2. GSTR-1 and 3B JSON unchanged for businesses with no advances, RCM or reversal data (golden).
3. Ledger Duties & Taxes balances equal 3B liability − ITC for the demo period.

### Claude prompt for Phase 10
```text
Implement Phase 10 slice by slice. For each GST cell touched, first add a fixture test describing the expected table values,
run it red, implement the pure function in tax-engine, then wire the report. Do not alter unrelated sections. If a rule is
marked ⚠️, stop and ask for the CA decision before coding it. Credentials for e-invoice must never be logged or returned by the API.
```

---

# PHASE 11: Hardening, performance, accessibility, release

**Goal**: make the whole programme shippable: remove the old UI, clean CSS, prove performance, accessibility, security and data integrity, and release safely.
**Slices**: P11-S1 Old UI removal and CSS cleanup · P11-S2 Performance budget · P11-S3 Accessibility audit · P11-S4 Security review · P11-S5 Data integrity and migrations rehearsal · P11-S6 i18n catalogue · P11-S7 Docs and training · P11-S8 Release and rollback plan.

## P11-S1 Old UI removal and CSS cleanup
Steps: flip `ui.vyapar` on for all; keep the old shell one release behind the flag; then delete `old` shell files, unused legacy aliases in `tokens.css`, dead selectors from `index.css` (target < 800 lines global CSS), the `lib/data/settings.js` old reader (after settings migration verified), and legacy redirects older than two releases. Use `knip` or a script to list unused exports; never delete without grep proof.
Acceptance: bundle size not larger than before the programme (budget in S2); no unused CSS reported by a coverage run on the smoke E2E.

## P11-S2 Performance budget

| Metric | Budget | How measured |
|---|---|---|
| Initial JS (gzip) | ≤ 350 KB main, route-split for reports, barcode, loan, settings | `vite build` + size script in CI |
| LCP on Home (mid-range laptop, cached API) | < 2.0 s | Lighthouse CI |
| Table render 1,000 rows | < 150 ms | component benchmark; virtualise above 500 rows |
| Add Sale typing latency with 100 lines | < 50 ms per keystroke | Playwright trace |
| API p95: list endpoints | < 300 ms at 10k docs | k6 script `scripts/load/*.js` |
| API p95: reports | < 2 s at 10k docs, < 8 s at 100k | k6 |
| Backfill | 10k docs < 3 min | timed test |
Work items: add composite indexes from each phase's list (collected in Appendix C), `EXPLAIN` review for the 10 slowest queries, lazy-load heavy libs (xlsx, jsbarcode, charts), memoise `LinesGrid` rows, virtualise `DataTable` when rows > 500.
Acceptance: budgets met on the demo dataset scaled ×50 (script generates it).

## P11-S3 Accessibility audit
Checklist (WCAG 2.2 AA):
| Area | Check |
|---|---|
| Keyboard | every action reachable; no keyboard traps; modals trap and restore focus |
| Focus | visible 2 px ring on all interactive elements |
| Contrast | text ≥ 4.5:1, large text/UI ≥ 3:1 in both themes |
| Forms | labels bound, errors announced (`aria-live="polite"`), required indicated programmatically |
| Tables | `scope`, captions where useful, sortable headers announced |
| Nav | landmarks (`nav`, `main`), `aria-current="page"`, groups `aria-expanded` |
| Motion | respects `prefers-reduced-motion` |
| Targets | 44 px min on touch layouts |
| Language | `lang` attribute follows `ui.lang` |
Tools: axe in Playwright for 20 key pages; manual screen-reader pass (VoiceOver) on Add Sale, Payment In, Party modal, Reports.
Acceptance: zero axe serious/critical violations; manual script signed off.

## P11-S4 Security review
| Topic | Checks |
|---|---|
| Tenant isolation | every new table has RLS and an isolation test (CI script lists tables without a policy → fail) |
| AuthZ | each endpoint has a permission; matrix test calls every write endpoint with each preset role |
| Input | Zod on every body/query; file uploads typed and size-capped; CSV/XLSX import parsed with formula-injection guard (prefix `'` for cells starting with `= + - @` on export) |
| Secrets | e-invoice, messaging, Drive tokens encrypted at rest; never in logs or API responses |
| Public links | tokens ≥ 128 bits, expiry, revoke, rate limit, no PII beyond the document |
| Backups | AES-GCM with PBKDF2 ≥ 310k iterations, authenticated manifest |
| Audit | sensitive actions audited (settings, lock override, restore, role changes, delete) |
| Dependencies | `pnpm audit`, lockfile review, no postinstall surprises |
| Rate limits | login, share links, imports |
Run the repository's `security-review` skill on the combined diff of each phase.
Acceptance: no high findings open; documented exceptions in `SECURITY.md`.

## P11-S5 Data integrity and migration rehearsal
Procedure:
1. Clone production-like data (anonymised) to a staging database.
2. Run all migrations `0008…` in order, time them, record lock durations (avoid long `ALTER` locks: add columns with defaults in a metadata-only way, create indexes `CONCURRENTLY` in separate migrations).
3. Run backfill dry-run and real run; Verify My Data must be clean.
4. Run golden GST fixtures for the three most complex tenants.
5. Rehearse rollback: restore from the pre-migration snapshot; confirm app boots.
Acceptance: rehearsal log committed to `docs/release/<version>-rehearsal.md`.

## P11-S6 i18n catalogue
Move user-visible strings into `apps/web/src/i18n/en.json` (keys by module); wrap with `t()`; add `hi.json` and `ta.json` for navigation, forms, print labels and messages; numbers/dates use `Intl` with `en-IN`. Print templates use per-language label tables (Invoice, Bill To, Qty…). Amount in words per language in `tax-engine/words.ts`.
Acceptance: no string literals in new components (lint rule); switching language changes shell, forms, print preview.

## P11-S7 Docs and training
Update `docs/USER_GUIDE.md` (one section per module with screenshots), `docs/DEVELOPMENT.md` (new commands, flags, jobs), `docs/ACCOUNTING.md` (new), `docs-site` build; in-app **What's new** modal; contextual help (`HelpButton.jsx` ✅) per screen; 8 short walkthrough scripts (first sale, add party, import items, payment in, cheque, report, close FY, backup).

## P11-S8 Release and rollback plan
```text
T-7d  feature freeze, rehearsal on staging (S5), performance run (S2), accessibility (S3), security (S4)
T-3d  enable ui.vyapar for internal accounts; monitor errors
T-0   deploy API (migrations additive, flags off) → deploy web → enable flags in order:
        1 ui.vyapar for new accounts → 2 sale.inlinePayments → 3 accounting.ledger (opt-in per business after backfill check)
        → 4 cashbank → 5 messaging
T+1d  review dashboards: error rate, p95, backfill failures
T+7d  enable ui.vyapar for all
Rollback: flags off per feature; migrations are additive so old code still runs; ledger rows ignored when flag off;
          restore from snapshot only for data-corrupting defects.
```
Versioning: bump minor per phase (1.11 … 1.21), CHANGELOG sections per slice; tag releases.

## Phase 11 acceptance
1. All budgets, audits and rehearsals recorded.
2. Old shell, dead CSS and legacy readers gone, bundle within budget.
3. Release checklist in `docs/RELEASE_CHECKLIST.md` updated and executed once on staging.

### Claude prompt for Phase 11
```text
Implement Phase 11 as a series of small PRs. Do not delete anything without a grep or coverage proof attached to the PR.
Collect index definitions from earlier phases (Appendix C) and add them in one migration using CREATE INDEX CONCURRENTLY.
Produce the rehearsal log before proposing the release plan. Report all numbers; do not claim a budget is met without a measurement.
```

---

# CROSS-PHASE REFERENCE (R1–R13)

Material that several phases share. Claude should read the relevant section before starting any slice that touches it.

## R1. End-to-end journeys (flows)

### R1.1 Sale to cash, with all side effects

```text
User                UI                     API (tx)                         Stock        Ledger (P4)               GST
 │ Save invoice       │                      │                                │            │                         │
 │──────────────────► │ validate (tax-engine)│                                │            │                         │
 │                    │ guards (credit,stock)│                                │            │                         │
 │                    │─────POST /invoices──►│ lock period check              │            │                         │
 │                    │                      │ insert invoice+lines           │            │                         │
 │                    │                      │ stock out ─────────────────────►            │                         │
 │                    │                      │ inline payments rows           │            │                         │
 │                    │                      │ postInvoice() ─────────────────────────────►│ Dr party, Cr sales, GST │
 │                    │                      │ postPayment() ─────────────────────────────►│ Dr bank, Cr party       │
 │                    │                      │ audit                          │            │                         │
 │                    │◄──── 201 invoice ────│                                │            │                         │
 │                    │ toast + preview      │                                │            │ GSTR-1/3B read invoice  │
```

### R1.2 Purchase to payment with ITC and TDS

```text
Add Purchase ──► stock in (landed cost) ──► Dr Purchases, Dr Input GST (eligible), Cr Supplier
      │
      └─► Payment Out (TDS) ──► Dr Supplier, Cr Bank, Cr TDS Payable ──► tds_entries(accrued)
                │
                └─► month end: GSTR-3B 4(A) ITC from purchase; 180-day check; TDS deposit → Dr TDS Payable, Cr Bank
```

### R1.3 Cheque life

```text
Payment In (cheque) ─► cheque OPEN (Dr Cheques in Hand, Cr Party)
      │ Deposit (select bank) ─► DEPOSITED (no balance change)
      │ Cleared ─► Dr Bank, Cr Cheques in Hand  ✔ party already credited
      │ Bounced ─► reverse party credit, optional charges ─► invoice balance reopens
```

### R1.4 Month-end close (accountant)

```text
1 Verify My Data (fix errors)
2 Reconcile bank accounts
3 Review GSTR-1 → export JSON → mark filed (locks month)
4 Review 3B (RCM, ITC risk) → pay → record payment
5 Deposit TDS, record challans
6 Reports: P&L, Balance Sheet, Trial Balance → share with owner
7 Backup
```

### R1.5 First-day onboarding

```text
Sign up → onboarding wizard (name, GSTIN, state) → Home empty state (first sale) → Setup checklist
   → add bank → import items → import parties → first real invoice → invite CA → enable accounting (after 1 week of data or immediately for new books)
```

## R2. State machines

### R2.1 Sales document status

```text
                      ┌────────────┐ convert ┌────────────┐ convert ┌────────────┐
 Quotation  ───────►  │ Sale Order │ ──────► │ Challan    │ ──────► │ Invoice    │
 (open/expired)       │ open/partial/closed  │ open/closed│         │ unpaid/partial/paid │
                      └────────────┘         └────────────┘         └─────┬──────┘
                                                                          │ credit note
                                                                          ▼
                                                                  adjusted / refunded
 Any state ─ cancel ─► cancelled (kept, excluded from totals unless "include cancelled")
 Any state ─ delete ─► Trash (soft) ─ restore ─► previous state
```
Payment status derives from allocations: `unpaid` (0), `partial` (0 < paid < total), `paid` (≥ total), `overdue` is a **display state** (unpaid/partial and due date < today).

### R2.2 Purchase order

```text
open ─► partial ─► received
 └──────────────► cancelled
```

### R2.3 Loan
`active ─► closed` when outstanding principal is 0; closing requires all schedule rows paid or foreclosure payment.

### R2.4 Financial year
`open ─► closed(locked)`; owner may reopen once with reason, which reverses the closing journal.

### R2.5 Import job
`validated ─► committing ─► done | partially_failed | failed`; `importId` ensures resumability.

### R2.6 Message
`queued ─► sent ─► delivered | opened`; `queued ─► failed ─► (retry) queued`.

## R3. Full column lists for key new tables

(Columns beyond `base()`: `id`, `org_id`, `created_at`, `updated_at`, `deleted_at`.)

### `party_groups`
`name text not null`, `parent_id uuid null`.

### `party_addresses`
`party_id uuid not null`, `label text`, `address text`, `city text`, `state text`, `pin text`, `is_default_shipping bool`.

### `party_item_rates`
`party_id`, `item_id`, `rate numeric(14,2)`, `rate_includes_tax bool`; unique `(org_id, party_id, item_id)`.

### `item_categories`
`name`, `parent_id`.

### `item_units`
`item_id`, `unit text`, `factor numeric(14,3)`; unique `(org_id, item_id, unit)`.

### `item_batches`
`item_id`, `batch_no`, `mfg_date date`, `exp_date date`, `model text`, `size text`, `qty_on_hand numeric(14,3)`.

### `item_serials`
`item_id`, `serial_no`, `status text`, `batch_id uuid null`, `sale_line_id uuid null`, `purchase_line_id uuid null`.

### `staff`
`name`, `phone`, `user_id text null`, `commission_pct numeric(5,2)`, `monthly_target numeric(14,2)`, `active bool`.

### `purchase_orders` / `purchase_order_lines`
Orders: `business_id`, `number`, `supplier_id`, `date`, `expected_date`, `status`, `advance numeric`, `totals jsonb`, `data jsonb`.
Lines: `order_id`, `item_id`, `name`, `hsn`, `qty`, `unit`, `rate`, `discount`, `gst_rate`, `received_qty`.

### `purchase_returns` / lines
Returns: `business_id`, `number`, `supplier_id`, `purchase_id null`, `date`, `reason`, `refund_mode`, `totals jsonb`.
Lines: `return_id`, `purchase_line_id null`, `item_id`, `qty`, `rate`, `gst_rate`, `itc_status`.

### `expense_items`
`name`, `sac`, `default_rate`, `gst_rate`, `default_category_id`.

### `accounts`, `ledger_entries`
See P4-S1.

### `transfers`
`business_id`, `from_account_id`, `to_account_id`, `amount`, `date`, `reference`, `fee`, `notes`.

### `cheques`
See P5-S4.

### `loans`, `loan_schedule`, `loan_payments`
See P5-S5.

### `bank_recon`
`account_id`, `entry_id`, `statement_hash`, `cleared_on date`, `reconciled_by`.

### `financial_years`
`business_id`, `label`, `start_date`, `end_date`, `status`, `locked_at`, `locked_by`, `closing_voucher_id null`.

### `business_settings`, `user_prefs`
`business_settings(business_id, key, value jsonb)` unique `(org_id, business_id, key)`; `user_prefs(user_id, key, value jsonb)`.

### `message_templates`, `messages`, `document_links`, `service_reminders`, `staff_visits`
See P8-S7 and P9.

### `advance_receipts`, `tds_entries`
See P10.

### `backups`
`business_id`, `where text`, `size_bytes`, `encrypted bool`, `schema_version`, `counts jsonb`, `storage_key`, `created_by`.

## R4. RLS and migration templates

### R4.1 RLS block (copy exact expression from `0002_rls.sql`)

```sql
ALTER TABLE party_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY party_groups_tenant ON party_groups
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON party_groups TO ledgora_app;
```
For `ledger_entries` grant only `SELECT, INSERT`.

### R4.2 Composite FK template
```sql
ALTER TABLE parties
  ADD COLUMN group_id uuid,
  ADD CONSTRAINT parties_group_fk FOREIGN KEY (org_id, group_id) REFERENCES party_groups (org_id, id);
```

### R4.3 Back-fill pattern (idempotent)
```sql
UPDATE parties SET gst_type = CASE
  WHEN is_sez THEN 'sez'
  WHEN gstin IS NOT NULL AND gstin <> '' THEN 'registered_regular'
  ELSE 'unregistered' END
WHERE gst_type IS NULL OR gst_type = '';
```

### R4.4 Isolation test template
```ts
it('org B cannot read org A party group', async () => {
  const a = await asOrg('A'); const b = await asOrg('B');
  const g = await a.post('/v1/party-groups', { name: 'Retail' });
  expect((await b.get(`/v1/party-groups/${g.id}`)).status).toBe(404);
  expect((await b.get('/v1/party-groups')).body.data).toHaveLength(0);
});
```

## R5. Sample payloads

### R5.1 Create invoice with inline payments and a charge
```json
POST /v1/invoices
{
  "type": "tax-invoice",
  "businessId": "5b1c…",
  "partyId": "e3a7…",
  "date": "2026-11-06",
  "dueDate": "2026-12-06",
  "placeOfSupply": "Tamil Nadu",
  "salesmanId": "b9d2…",
  "lines": [
    { "itemId": "7f10…", "name": "Pen Blue", "hsn": "9608", "qty": 10, "unit": "PCS",
      "rate": 10, "discountPct": 0, "gstRate": 18 }
  ],
  "charges": [ { "name": "Shipping", "amount": 100, "gstRate": 18, "hsn": "9965" } ],
  "tcsPct": 0,
  "roundOff": true,
  "payments": [
    { "mode": "cash", "amount": 100 },
    { "mode": "upi", "accountId": "a11e…", "amount": 100, "reference": "3249…" }
  ],
  "terms": "Goods once sold will not be taken back."
}
```
Response (excerpt):
```json
{ "id": "…", "number": "INV-26-27/013", "totals": { "taxable": 200, "cgst": 18, "sgst": 18, "total": 236 },
  "paymentStatus": "partial", "received": 200, "balance": 36 }
```

### R5.2 Payment Out with TDS
```json
POST /v1/payments
{ "direction": "out", "partyId": "…", "date": "2026-11-06", "mode": "bank", "accountId": "…",
  "amount": 4455, "discount": 0, "tds": { "section": "194C", "amount": 45 },
  "allocations": [ { "purchaseId": "…", "amount": 4500 } ], "reference": "NEFT…" }
```

### R5.3 Error example
```json
422 { "error": { "code": "OVER_ALLOCATED", "message": "Received exceeds total by ₹40.00",
        "fields": { "payments": "Received exceeds total by ₹40.00" } } }
```

### R5.4 Report response
```json
GET /v1/reports/day-book?from=2026-11-06&to=2026-11-06
{ "rows": [ { "date": "2026-11-06", "party": "Ravi Traders", "type": "Sale", "ref": "INV-12",
              "refType": "invoice", "refId": "…", "total": 8260, "moneyIn": 0, "moneyOut": 0 } ],
  "totals": { "total": 8260, "moneyIn": 5000, "moneyOut": 4455 },
  "meta": { "generatedAt": "2026-11-06T16:10:00Z", "truncated": false,
            "opening": { "cash": 48300, "bank": 235100 }, "closing": { "cash": 53300, "bank": 235100 } } }
```

### R5.5 Import validate response
```json
POST /v1/import/items/validate
{ "rows": [
   { "index": 2, "status": "error", "errors": [ { "field": "unit", "message": "Unit 'XYZ' not found" } ] },
   { "index": 3, "status": "duplicate", "match": { "id": "…", "by": "code" } },
   { "index": 4, "status": "ok" } ],
  "summary": { "ok": 480, "error": 12, "duplicate": 8 } }
```

## R6. Seed data for demos and tests

Create `packages/db/src/seed-demo.ts` (not run in production). Contents per demo business "Sri Traders", Tamil Nadu, GSTIN valid test number, FY 2026-27:

| Entity | Count | Notes |
|---|---|---|
| Party groups | 4 | Retail, Wholesale, Vendors, Government |
| Parties | 40 | 28 customers, 10 suppliers, 2 both; 5 with credit limits; 3 SEZ/overseas; 2 composition |
| Item categories | 6 | |
| Items | 60 | 50 goods (some with batches, 5 with serials, 4 exempt/nil), 10 services |
| Invoices | 200 | mix intra/inter-state, 5 with charges, 5 with TCS, 15 credit notes |
| Purchases | 80 | 10 RCM, 8 ineligible ITC, 6 with TDS §194Q |
| Payments in | 120 | 20 cheques (4 bounced), 10 with TDS, 8 advances |
| Payments out | 50 | 12 with TDS |
| Expenses | 60 | 8 categories |
| Other income | 10 | |
| Bank accounts | 2 | + cash |
| Loans | 1 | 12-month term loan |
| Staff | 3 | |
| Transfers | 6 | |
Deterministic (seeded RNG) so fixtures stay stable. A script prints the expected key figures (total sale, receivable, payable, closing stock, net profit) and tests assert them.

## R7. Per-slice tracker

Copy into the PR description or keep in this file; tick as slices merge.

### Phase 0
- [x] P0-S1 Design tokens (2026-11-08)
- [x] P0-S2 Shell, navigation, Open Anything (2026-11-08)
- [x] P0-S3 Component library (DataTable, FilterBar, Fields, Modal, Tabs, Stepper, LinesGrid, LivePreview, ReportShell, gallery) (2026-11-08)

### Phase 1
- [ ] P1-S1 Party groups
- [ ] P1-S2 Party fields and addresses
- [ ] P1-S3 Parties list and detail
- [ ] P1-S4 Item categories and units
- [ ] P1-S5 Item fields and tracking
- [ ] P1-S6 Items list and drawer
- [ ] P1-S7 Import wizards
- [ ] P1-S8 Stock adjust and bulk update

### Phase 2
- [ ] P2-S1 Salesman master
- [ ] P2-S2 Inline payments
- [ ] P2-S3 Additional charges
- [ ] P2-S4 Credit and cash-limit guards
- [ ] P2-S5 Payment In upgrade
- [ ] P2-S6 Sale return and sale order upgrades
- [ ] P2-S7 Single-page editor with live preview

### Phase 3
- [ ] P3-S1 Purchase bill upgrades
- [ ] P3-S2 Payment Out
- [ ] P3-S3 Purchase Order
- [ ] P3-S4 Purchase Return / Debit Note
- [ ] P3-S5 Expenses upgrade
- [ ] P3-S6 Other income

### Phase 4
- [ ] P4-S1 Chart of accounts
- [ ] P4-S2 Posting engine
- [ ] P4-S3 Posting wiring
- [ ] P4-S4 Backfill
- [ ] P4-S5 Verify My Data
- [ ] P4-S6 FY and period lock
- [ ] P4-S7 Ledger viewer and journal

### Phase 5
- [ ] P5-S1 Bank accounts
- [ ] P5-S2 Cash in hand
- [ ] P5-S3 Transfers
- [ ] P5-S4 Cheques
- [ ] P5-S5 Loans
- [ ] P5-S6 Bank reconciliation
- [ ] P5-S7 Dashboard widgets

### Phase 6
- [ ] P6-S1 Engine and hub
- [ ] P6-S2 Transaction reports
- [ ] P6-S3 Party reports
- [ ] P6-S4 Item and stock reports
- [ ] P6-S5 GST reports
- [ ] P6-S6 Expense, bank, order, loan reports
- [ ] P6-S7 Financial statements
- [ ] P6-S8 Exports, favourites, scheduling

### Phase 7
- [ ] P7-S1 Barcode generator
- [ ] P7-S2 Export to Tally
- [ ] P7-S3 Close financial year
- [ ] P7-S4 Backup and restore
- [ ] P7-S5 Setup checklist
- [ ] P7-S6 Trash and CA sharing

### Phase 8
- [ ] P8-S1 Framework
- [ ] P8-S2 General
- [ ] P8-S3 Transaction
- [ ] P8-S4 Print
- [ ] P8-S5 Taxes
- [ ] P8-S6 GST
- [ ] P8-S7 Transaction message
- [ ] P8-S8 Party
- [ ] P8-S9 Item
- [ ] P8-S10 Service reminder
- [ ] P8-S11 Accounting
- [ ] P8-S12 Multi currency
- [ ] P8-S13 Account access

### Phase 9
- [ ] P9-S1 Messaging core
- [ ] P9-S2 Payment reminders
- [ ] P9-S3 Share document
- [ ] P9-S4 Salesman tracking
- [ ] P9-S5 Service reminders run
- [ ] P9-S6 Online catalog (optional)
- [ ] P9-S7 Loyalty (optional)

### Phase 10
- [ ] P10-S1 Table 11 advances
- [ ] P10-S2 Reverse charge
- [ ] P10-S3 GSTR-3B completion
- [ ] P10-S4 ITC 180-day
- [ ] P10-S5 TDS/TCS ledger
- [ ] P10-S6 Cash-limit watch
- [ ] P10-S7 E-invoice (optional)
- [ ] P10-S8 ITR-3 map and advance tax from P&L

### Phase 11
- [ ] P11-S1 Old UI removal
- [ ] P11-S2 Performance
- [ ] P11-S3 Accessibility
- [ ] P11-S4 Security
- [ ] P11-S5 Migration rehearsal
- [ ] P11-S6 i18n
- [ ] P11-S7 Docs and training
- [ ] P11-S8 Release

## R8. Additional wireframes (screens referenced above but not yet drawn)

### R8.1 Home with ledger and cash & bank on

```text
┌ Home ─────────────────────────────────────────────────────────────────────────────────────────┐
│ [This Month ▾]                                    [+ Add Sale] [+ Add Purchase] [+ Add Expense] │
│ ┌ To Collect ──────┐ ┌ To Pay ─────────┐ ┌ Cash + Bank ────┐ ┌ Sales (month) ───────────────┐  │
│ │ ₹1,24,000 ↑      │ │ ₹56,200 ↓       │ │ ₹3,44,400       │ │ ₹4,80,000  ▂▃▅▇▆             │  │
│ │ 6 overdue        │ │ 2 due this week │ │ Cash ₹48,300    │ │ vs last month +12%           │  │
│ └──────────────────┘ └─────────────────┘ └─────────────────┘ └──────────────────────────────┘  │
│ ┌ Sales vs Purchase (12 months) ───────────────┐ ┌ Top parties ───────────────────────────┐   │
│ │ bar chart                                    │ │ 1 Ravi Traders ₹1.2L ▓▓▓▓▓             │   │
│ └──────────────────────────────────────────────┘ └────────────────────────────────────────┘   │
│ ┌ Compliance ───────────────────────────────────────────────────────────────────────────────┐ │
│ │ GSTR-1 due 11-Nov [Prepare] · GSTR-3B due 20-Nov [Prepare] · TDS deposit 07-Dec · Advance tax 15-Dec │
│ └───────────────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌ Low stock (5) ┐ ┌ Cheques due (2) ┐ ┌ Reminders (7) ┐ ┌ ITC at risk (1) ┐ ┌ Loan EMI 05-Dec ┐ │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```
Each widget is a self-contained component with its own query and permission check; widgets for disabled features do not render.

### R8.2 Account ledger

```text
┌ ← Rent (5101)                                         Balance ₹25,000 Dr        [Export ▾] ┐
│ Period [This FY ▾]  [x] Include reversals                                                    │
│ Date  │ Voucher │ Ref        │ Narration              │ Debit    │ Credit │ Balance       │
│ 01-11 │ V-0452  │ EXP-012    │ Office rent Nov        │ 25,000   │        │ 25,000 Dr     │
│ 01-11 │ V-0452  │ EXP-012    │ Input CGST             │  –       │        │               │
│ Totals                                                  │ 25,000   │ 0      │               │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### R8.3 Verify My Data detail drawer

```text
┌ Payments over-allocated (2) ───────────────────────────────────── [×] ┐
│ Payment │ Party │ Amount │ Allocated │ Excess │ Action                  │
│ RCT-4   │ Ravi  │ 5,000  │ 5,300     │ 300    │ [Trim allocation]       │
│ PAY-2   │ Om    │ 2,000  │ 2,500     │ 500    │ [Trim allocation]       │
│ [ Fix all ]                                                [ Close ]   │
└─────────────────────────────────────────────────────────────────────────┘
```

### R8.4 Trial balance

```text
┌ Trial Balance ─────────────────────────────────────── As of [06-11-2026] [Print][PDF][Excel] ┐
│ Group             │ Account                │ Debit        │ Credit       │                      │
│ Cash              │ Cash in Hand           │ 48,300.00    │              │                      │
│ Bank              │ HDFC Current           │ 2,40,100.00  │              │                      │
│ Receivables       │ Accounts Receivable ▸  │ 1,24,000.00  │              │ (expand: parties)    │
│ Payables          │ Accounts Payable ▸     │              │ 56,200.00    │                      │
│ Duties & taxes    │ Output CGST            │              │ 21,000.00    │                      │
│ Sales             │ Sales                  │              │ 12,40,000.00 │                      │
│ TOTAL                                       │ 17,62,400.00 │ 17,62,400.00 │ ✔ Balanced           │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### R8.5 Expense Category report drill

```text
┌ Expense Category ─────────────────────────────────────────────────────────────────┐
│ Period [This FY ▾]                                                                 │
│ Category      │ Amount     │ Share │ ▓▓▓▓▓▓▓▓░░                                     │
│ Rent          │ 1,50,000   │ 42%   │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓             │
│ Salaries      │ 1,20,000   │ 34%   │                                                │
│ Electricity   │ 40,000     │ 11%   │                                                │
│ Click a row → Expense report filtered by that category                              │
└────────────────────────────────────────────────────────────────────────────────────┘
```

### R8.6 Mobile layout notes (existing PWA stays)
Below 1024 px the existing off-canvas drawer and card lists remain. New screens must provide a stacked layout: filter bar collapses to a **Filters** button opening a bottom sheet, tables become cards (title line, amount right, status chip, ⋮ menu), forms are single column, ActionBar sticks to the bottom with a safe-area inset, LinesGrid becomes an accordion of line cards.

```text
┌ Invoices ──────────────┐   ┌ Add Sale ─────────────┐
│ [🔍][Filters (2)] [+]   │   │ Party*  [Ravi ▾]      │
│ ┌ INV-12 · Ravi ──────┐ │   │ ▾ Item 1  Pen Blue    │
│ │ ₹8,260  ● Unpaid   ⋮│ │   │   Qty [10] Rate [10]  │
│ └─────────────────────┘ │   │ [+ Add item]          │
│ ┌ INV-11 · Kiran ─────┐ │   │ Total ₹118            │
│ │ ₹3,740  ● Paid     ⋮│ │   │ [ Save ]              │
│ └─────────────────────┘ │   └───────────────────────┘
└─────────────────────────┘
```

## R9. Coding checklists for common pitfalls

| Pitfall | Do this |
|---|---|
| Using floating point for money sums | Use `r2()` from `tax-engine/money.ts`; sum in paise (integers) when adding many rows |
| Rounding GST per line vs per invoice | Follow existing `totals.ts`; do not change; add tests when touching |
| Timezones on dates | Store dates as `date`, not timestamps; format with the business locale; `Asia/Kolkata` for "today" decisions |
| N+1 queries in lists | Join or batch with `inArray`; add test with query counter |
| Unbounded exports | Stream with cursor; cap synchronous responses at 1,000 rows |
| Optimistic UI without rollback | TanStack Query `onError` restores previous cache |
| Permission only in UI | Always also in API; test with a restricted role token |
| Mutating applied migrations | Add a new numbered migration |
| Deleting ledger rows | Never; reverse and repost |
| Silent catch blocks | Log with context (`orgId`, `refId`) and surface a user-visible message |
| Large React re-renders in LinesGrid | Memoise row components, key by stable ids, avoid inline object props |
| Hard-coded GST rates/TDS rates | Read from settings tables; seed with validity dates |
| Forgetting soft-deleted rows in queries | Use the shared helper that adds `deleted_at is null`; test with a deleted record |
| Cross-tenant joins | Always join on `(org_id, id)` composite keys |
| Printing differences from preview | Render preview and print from the same component and CSS |

---

## R10. More wireframes and field tables (screens not drawn earlier)

### R10.1 Party-wise item rates modal (P1-S2)

```text
┌ Item rates for Ravi Traders ─────────────────────────────────────────────── [×] ┐
│ [🔍 Add item…                                    ]   [ Import from last invoice ] │
│ Item        │ Default price │ Party rate      │ Incl. tax │                       │
│ Pen Blue    │ ₹10.00        │ [₹ 9.50    ]    │ [ ]       │ ✕                     │
│ Notebook A4 │ ₹45.00        │ [₹ 42.00   ]    │ [ ]       │ ✕                     │
│ Showing 2 items                                           [ Cancel ] [  Save  ]   │
└───────────────────────────────────────────────────────────────────────────────────┘
```
Rule: when a line is added for this party, rate = party rate if present, else item sale price (wholesale price when qty ≥ wholesale min qty and item wholesale is enabled). Precedence: **party rate > wholesale (qty-based) > item price**. Pure fn `resolveRate({ item, party, qty })`, tests for each branch.

### R10.2 Credit Note editor (P2-S6)

```text
┌ Credit Note  CN-004                                            [⚙]  [ Preview ◀▶ ] ┐
│ Party* [Ravi Traders ▾]   Against invoice [INV-12 ▾]   Date [06-11-2026]            │
│ Reason* [Sales return ▾]   (Sales return · Post-sale discount · Deficiency · Correction · Others) │
│ ┌ Items from invoice ─────────────────────────────────────────────────────────────┐ │
│ │ ☑ Pen Blue  Sold 10  Returned 0  Return qty [2]  Rate 10  GST 18%  Amount 23.60  │ │
│ └──────────────────────────────────────────────────────────────────────────────────┘ │
│ [x] Restock returned items     Refund (●) Adjust balance ( ) Cash ( ) Bank [Account ▾] │
│ Taxable ₹20 · CGST ₹1.80 · SGST ₹1.80 · TOTAL ₹23.60                                  │
│ Notes […]                                              [ Cancel ] [ Save & New ] [ Save ] │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
Fields: Party\*, Against invoice (optional), Date, Reason\*, lines (qty ≤ returnable), Restock, Refund mode and account, Notes. Credit notes without an invoice are allowed for post-sale discounts: lines then use manual amounts and a mandatory reason.

### R10.3 Sale Order editor (P2-S6)

```text
┌ Sale Order ORD-007                                              Status ● Open ┐
│ Party* […]  Order date [06-11-26]  Expected delivery [15-11-26]  PO no [____]  │
│ Items grid (as Add Sale)                                                       │
│ Advance received [₹ 2,000]  Mode [UPI ▾]  Account [HDFC ▾]                     │
│ Totals …                                                                       │
│ [ Cancel order ]                          [ Save & New ] [ Save ] [ Convert ▾ ]│
│ Convert ▾  → Invoice · Delivery Challan                                         │
└────────────────────────────────────────────────────────────────────────────────┘
```

### R10.4 Purchase list (P3-S1)

```text
┌ Purchase Bills ──────────────────────────────────────────────────── [ + Add Purchase ] ┐
│ [This Month ▾][Supplier ▾][Status ▾][ITC ▾]  [🔍 Search bill no]          [Export ▾]    │
│ ┌ Total ₹2,40,000 ┐ ┌ Paid ₹1,60,000 ┐ ┌ Unpaid ₹80,000 ┐ ┌ ITC claimable ₹21,600 ┐     │
│ Date │ Our ref │ Bill no │ Supplier │ Total │ Paid │ Balance │ ITC │ Status │ ⋮         │
│ 05-11│ PUR-004 │ OM-221  │ Om       │ 4,500 │ 0    │ 4,500   │ ✔   │ Unpaid │ ⋮         │
│ 01-11│ PUR-003 │ TC-18   │ Transport│ 10,500│ 0    │ 10,500  │ RCM │ Unpaid │ ⋮         │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
Row ⋮: View, Edit, Duplicate, Pay (opens Payment Out prefilled), Return (debit note), Print, Delete.

### R10.5 Expense list (P3-S5)

```text
┌ Expenses ───────────────────────────────────────────────── [ + Add Expense ] [Categories] ┐
│ [This Month ▾][Category ▾][Payee ▾]  Category chips: Rent ₹25,000 · Salary ₹40,000 · …    │
│ Date │ No │ Category │ Payee │ Amount │ GST │ Mode │ ⋮                                     │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### R10.6 Payment reminder settings (P8-S8 / P9-S2)

```text
┌ Payment reminders ─────────────────────────────────────────────────────────────┐
│ [x] Send automatic reminders                                                    │
│ Before due date  [ 3 ] days   [x] On due date   After due date [ 3 ] [ 7 ] [ 15 ] days │
│ Channels [x] WhatsApp [ ] SMS [x] Email     Quiet hours [ 09:00 ] – [ 20:00 ]   │
│ Max reminders per invoice [ 5 ]   Template [ Reminder ▾ ] [Edit]                │
│ Skip parties flagged "do not message" ☑                                          │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### R10.7 Roles preset table

| Preset | Sidebar visible | Special rules |
|---|---|---|
| Owner | everything | can lock periods, close FY, restore, enable ledger |
| Admin | everything except Close FY, Restore, Enable accounting | cannot change owner-only settings |
| Accountant / CA | Home, Parties, Items, Sale, Purchase, Cash & Bank, Reports, Taxes, Utilities (Verify, Tally) | read-only except journals; no Settings |
| Salesman | Home, Parties (own), Items (no purchase price), Sale (own), Payment In (own) | no reports except own Sale and Party Statement |
| Staff | Home, Parties, Items, Sale, Purchase (create) | no delete, no reports |

### R10.8 Add Salesman modal fields

| Field | Type | Req | Rule |
|---|---|---|---|
| Name | text | ✔ | unique among active staff |
| Phone | text | | 10 digits |
| Linked user | select | | invites if no login yet |
| Commission | number + basis radio (on sale / on collection) | | 0–100 % |
| Monthly target | money | | ≥ 0 |
| Active | switch | | |

### R10.9 Add Loan form validations

| Field | Rule |
|---|---|
| Principal | > 0 |
| Rate | 0–60 % |
| Tenure | 1–360 months |
| EMI | editable; warning when differing from computed by > ₹1 |
| First EMI date | ≥ loan received date |
| Received in | required account |
| Processing fee | ≥ 0, posts Bank Charges |

### R10.10 Add Cheque validations

| Field | Rule |
|---|---|
| Cheque number | 6 digits (warn if not), unique per party and direction |
| Amount | > 0, ≤ pending balance of linked documents (warn if more) |
| Cheque date | within 3 months back to 6 months ahead (warn otherwise) |
| Bank account | required for deposit |
| Reminder days | 0–30 |

## R11. UI state matrix (every screen must implement these)

| Screen | Loading | Empty | Error | No permission | Offline | Locked period | Flag off |
|---|---|---|---|---|---|---|---|
| Parties list | skeleton rows | "No parties yet" + Add / Import | retry card | hidden from nav | cached list read-only banner | n/a | n/a |
| Party detail | header skeleton | tabs show empty text | retry | 403 page | cached | n/a | n/a |
| Items list | skeleton | "No items yet" + Add / Import | retry | hidden | cached | n/a | n/a |
| Sale lists | skeleton | "No invoices yet" + Add Sale | retry | hidden | cached | row lock icon | n/a |
| Add Sale | form skeleton | n/a | save error toast + inline | 403 page | save disabled with banner | 🔒 banner, Save disabled | inline payments hidden |
| Payment In/Out | skeleton | "No pending documents" in grid | retry | hidden | disabled | 🔒 | n/a |
| Cheques | skeleton | "No cheques" | retry | hidden | cached | n/a | route hidden |
| Bank accounts | card skeletons | "Add your first bank account" | retry | hidden | cached | n/a | route hidden |
| Loans | skeleton | "No loans" | retry | hidden | cached | n/a | route hidden |
| Reports hub | none | n/a | retry | hidden items | cached list | n/a | ledger-only reports hidden/disabled with hint |
| Report page | table skeleton | "No data for this period" + Change period | retry + "Report too large, narrow filters" | 403 | banner | n/a | "Enable accounting" CTA |
| Settings | row skeleton | n/a | retry | read-only rows | read-only | n/a | tab hidden when its feature is off |
| Verify My Data | check list skeleton | "All good" state | retry | hidden | disabled | n/a | n/a |
| Backup | skeleton | "No backups yet" | retry | hidden | disabled | n/a | n/a |

Offline behaviour (PWA exists): reads served from the query cache with an "Offline, showing saved data" banner; writes are **not** queued in this programme (financial writes need server validation); the Save button is disabled with an explanation.

## R12. Copy deck: toasts, confirmations, empty states

### Success toasts
| Event | Text |
|---|---|
| Party saved | "Party added" / "Party updated" |
| Invoice saved | "Invoice {number} saved" with **View** action |
| Payment saved | "Payment {number} recorded" |
| Import done | "{created} created, {updated} updated, {skipped} skipped" |
| Backup done | "Backup saved ({size})" |
| Settings changed | "Saved" |
| Message sent | "Sent to {party}" |

### Confirmations
| Action | Title | Body | Buttons |
|---|---|---|---|
| Delete party | "Delete {name}?" | "It will move to Trash. Documents keep the party name." | Cancel / Delete |
| Delete invoice | "Delete invoice {number}?" | "Stock and balances will be restored. You can restore it from Trash." | Cancel / Delete |
| Disable GST | "Turn off GST?" | "GST columns and returns will be hidden. Existing data is kept." | Cancel / Turn off |
| Enable ledger | "Enable accounting?" | "We will post {n} documents. This takes about {min} minutes. You can keep working." | Cancel / Enable |
| Close FY | "Close financial year {fy}?" | "Edits to this year will be locked. Type {fy} to confirm." | Cancel / Close |
| Restore backup | "Restore this backup?" | "Replaces current company data. A copy is taken first. Type RESTORE." | Cancel / Restore |
| Override lock | "This period is locked" | "Enter a reason. The owner is notified." | Cancel / Override |
| Cheque bounced | "Mark cheque {no} as bounced?" | "{party}'s balance will reopen by {amount}." | Cancel / Mark bounced |
| Bulk update | "Update {n} items?" | "You can undo for 30 seconds." | Cancel / Update |

### Empty states
| Screen | Headline | Sub text | Primary | Secondary |
|---|---|---|---|---|
| Parties | "No parties yet" | "Add customers and suppliers to bill them and track balances." | Add Party | Import from Excel |
| Items | "No items yet" | "Add products and services to use them in bills." | Add Item | Import items |
| Invoices | "No invoices yet" | "Create your first sale in under a minute." | Add Sale | – |
| Cheques | "No cheques" | "Cheques taken or issued appear here." | Add Cheque | – |
| Bank accounts | "Add your first bank account" | "Track deposits, withdrawals and balances." | Add Bank Account | – |
| Reports | "No data for this period" | "Try a different period or filters." | Change period | – |
| Reminders | "Nothing overdue" | "You are all caught up." | – | Reminder settings |
| Trash | "Trash is empty" | "Deleted items stay here for 30 days." | – | – |

### Validation messages
| Rule | Text |
|---|---|
| required | "{label} is required" |
| gstin | "Enter a valid 15-character GSTIN" |
| pan | "Enter a valid PAN, for example ABCDE1234F" |
| ifsc | "Enter a valid IFSC, for example HDFC0000123" |
| phone | "Enter a 10-digit mobile number" |
| amount | "Enter an amount greater than 0" |
| over-allocation | "Amount exceeds the pending balance by ₹{x}" |
| date-lock | "Date falls in a locked period" |
| duplicate | "{label} already exists" |

## R13. Keyboard map per screen

| Screen | Keys |
|---|---|
| Global | `⌘/Ctrl+F` open anything · `?` shortcuts · `Alt+B` sidebar |
| Lists | `/` focus search · `N` new (when no input focused) · `↑/↓` move row focus · `Enter` open · `Space` select · `Delete` delete selected (confirm) |
| Add Sale / Purchase | `⌘/Ctrl+S` save · `⌘/Ctrl+Shift+S` save & new · `⌘/Ctrl+P` print · `Alt+I` add item row · `Alt+C` add charge · `Alt+P` add payment row · `Ctrl+Backspace` delete row |
| LinesGrid | `Tab/Shift+Tab` move cell · `Enter` next row/add row at end · `↑/↓` same column · `F2` edit cell · `Esc` cancel edit |
| Payment vouchers | `Alt+A` auto-allocate · `⌘/Ctrl+S` save |
| Modals | `Esc` close · `Enter` submit when focus is in a single-line field |
| Reports | `⌘/Ctrl+E` export menu · `⌘/Ctrl+P` print · `R` refresh |
| Barcode field | scanner ends with `Enter`; paste of multi-line codes adds rows |
Conflicts: `⌘/Ctrl+F` overrides browser find only on app pages; inside tables a second press falls back to the browser find (documented in Shortcuts help).

---

# APPENDICES

## Appendix A: Permission keys

Add to `packages/contracts/src/permissions.ts`. Pattern `<module>.<action>`. Default role grants in the table (O = Owner, A = Admin, C = Accountant/CA, S = Salesman, T = Staff; ✔ granted, ○ own records only, – none).

| Key | O | A | C | S | T | Notes |
|---|---|---|---|---|---|---|
| `parties.view` | ✔ | ✔ | ✔ | ○ | ✔ | salesman: parties with own invoices or assigned |
| `parties.create` | ✔ | ✔ | – | ✔ | ✔ | |
| `parties.edit` | ✔ | ✔ | – | – | ✔ | |
| `parties.delete` | ✔ | ✔ | – | – | – | soft delete |
| `parties.export` | ✔ | ✔ | ✔ | – | – | |
| `items.view` | ✔ | ✔ | ✔ | ✔ | ✔ | purchase price hidden when `items.hidePurchasePrice` |
| `items.create` | ✔ | ✔ | – | – | ✔ | |
| `items.edit` | ✔ | ✔ | – | – | – | |
| `items.delete` | ✔ | ✔ | – | – | – | |
| `items.adjustStock` | ✔ | ✔ | – | – | – | |
| `items.bulkUpdate` | ✔ | ✔ | – | – | – | |
| `items.import` | ✔ | ✔ | – | – | – | |
| `sales.view` | ✔ | ✔ | ✔ | ○ | ✔ | |
| `sales.create` | ✔ | ✔ | – | ✔ | ✔ | |
| `sales.edit` | ✔ | ✔ | – | ○ | – | |
| `sales.delete` | ✔ | ✔ | – | – | – | |
| `sales.overrideLimits` | ✔ | – | – | – | – | credit limit, negative stock |
| `payments.view` | ✔ | ✔ | ✔ | ○ | ✔ | |
| `payments.create` | ✔ | ✔ | – | ✔ | ✔ | |
| `payments.edit` / `delete` | ✔ | ✔ | – | – | – | |
| `purchases.view` | ✔ | ✔ | ✔ | – | ✔ | |
| `purchases.create` / `edit` | ✔ | ✔ | – | – | ✔ | |
| `purchases.delete` | ✔ | ✔ | – | – | – | |
| `expenses.view` / `create` | ✔ | ✔ | ✔(view) | – | ✔ | |
| `expenses.edit` / `delete` | ✔ | ✔ | – | – | – | |
| `income.view` / `create` / `edit` / `delete` | ✔ | ✔ | view | – | – | other income |
| `cashbank.view` | ✔ | ✔ | ✔ | – | – | |
| `cashbank.create` / `edit` | ✔ | ✔ | – | – | – | accounts, transfers, adjustments |
| `cashbank.delete` | ✔ | – | – | – | – | |
| `cheques.view` / `create` / `edit` | ✔ | ✔ | view | – | – | |
| `loans.view` / `create` / `edit` | ✔ | ✔ | view | – | – | |
| `reports.view` | ✔ | ✔ | ✔ | limited | – | salesman: sale, party statement for own parties |
| `reports.profit` | ✔ | ✔ | ✔ | – | – | P&L, bill-wise profit, item-wise P&L |
| `reports.export` | ✔ | ✔ | ✔ | – | – | |
| `gst.view` | ✔ | ✔ | ✔ | – | – | |
| `gst.file` | ✔ | ✔ | ✔ | – | – | mark filed |
| `tax.view` (income tax) | ✔ | ✔ | ✔ | – | – | |
| `accounting.view` | ✔ | ✔ | ✔ | – | – | ledger, trial balance |
| `accounting.journal` | ✔ | – | ✔ | – | – | |
| `accounting.enable` | ✔ | – | – | – | – | backfill |
| `utilities.verify` | ✔ | ✔ | ✔ | – | – | |
| `utilities.tally` | ✔ | ✔ | ✔ | – | – | |
| `utilities.closeFy` | ✔ | – | – | – | – | owner only |
| `utilities.barcode` | ✔ | ✔ | – | – | ✔ | |
| `backup.run` / `backup.restore` | ✔ | run | – | – | – | restore owner only |
| `staff.view` / `create` / `edit` / `delete` | ✔ | ✔ | view | – | – | salesmen |
| `settings.view` | ✔ | ✔ | ✔ | – | – | |
| `settings.edit` | ✔ | ✔ | – | – | – | owner-only keys enforced separately |
| `messages.send` | ✔ | ✔ | – | ✔ | ✔ | |
| `messages.templates` | ✔ | ✔ | – | – | – | |
| `team.manage` | ✔ | ✔ | – | – | – | existing |
| `audit.view` | ✔ | ✔ | ✔ | – | – | |

Rule: every route registration declares exactly one permission; CI test fails if any route is missing it.

## Appendix B: API endpoint catalogue

All paths under `/v1`. "Perm" uses Appendix A. Lists use cursor pagination.

### Masters
| Method | Path | Perm | Phase |
|---|---|---|---|
| GET/POST | `/party-groups` | parties.view / create | P1 |
| PATCH/DELETE | `/party-groups/:id` | parties.edit / delete | P1 |
| GET/POST | `/parties/:id/addresses` | parties.view / edit | P1 |
| PATCH/DELETE | `/parties/:id/addresses/:addrId` | parties.edit | P1 |
| GET/PUT | `/parties/:id/item-rates` | parties.view / edit | P1 |
| GET | `/parties/:id/summary` | parties.view | P1 |
| GET | `/parties/:id/transactions` | parties.view | P1 |
| GET/POST | `/item-categories` | items.view / create | P1 |
| PATCH/DELETE | `/item-categories/:id` | items.edit / delete | P1 |
| GET/PUT | `/items/:id/units` | items.view / edit | P1 |
| GET/POST | `/items/:id/batches` | items.view / edit | P1 |
| GET/POST | `/items/:id/serials` | items.view / edit | P1 |
| POST | `/items/:id/adjust-stock` | items.adjustStock | P1 |
| POST | `/items/bulk-update/preview` and `/commit` | items.bulkUpdate | P1 |
| POST | `/import/items/validate` and `/commit` | items.import | P1 |
| POST | `/import/parties/validate` and `/commit` | parties.create | P1 |
| GET | `/import/templates/:kind.xlsx` | items.import | P1 |

### Sales and purchases
| Method | Path | Perm | Phase |
|---|---|---|---|
| GET/POST/PATCH/DELETE | `/staff[/:id]` | staff.* | P2 |
| GET | `/staff/:id/performance` | staff.view | P2 |
| POST | `/invoices` (extended: `payments[]`, `charges[]`, `salesmanId`) | sales.create | P2 |
| POST | `/invoices/:id/convert` | sales.create | existing |
| POST | `/invoices/:id/credit-note` | sales.create | P2 |
| POST | `/payments` (direction in/out, allocations, tds, discount) | payments.create | P2/P3 |
| PATCH/DELETE | `/payments/:id` | payments.edit / delete | P2 |
| GET | `/parties/:id/pending-documents?direction=` | payments.view | P2 |
| GET/POST/PATCH/DELETE | `/purchases[/:id]` (extended) | purchases.* | P3 |
| GET/POST/PATCH/DELETE | `/purchase-orders[/:id]` | purchases.* | P3 |
| POST | `/purchase-orders/:id/convert` | purchases.create | P3 |
| GET/POST/PATCH/DELETE | `/purchase-returns[/:id]` | purchases.* | P3 |
| GET/POST/PATCH/DELETE | `/expense-items[/:id]` | expenses.* | P3 |
| GET/POST/PATCH/DELETE | `/expenses[/:id]` (extended) | expenses.* | P3 |
| GET/POST/PATCH/DELETE | `/other-income[/:id]` | income.* | P3 |

### Accounting and cash & bank
| Method | Path | Perm | Phase |
|---|---|---|---|
| GET/POST/PATCH | `/accounts[/:id]` | accounting.view / journal | P4 |
| GET | `/accounts/:id/ledger` | accounting.view | P4 |
| POST | `/journals` | accounting.journal | P4 |
| POST | `/accounting/enable/check` and `/enable` | accounting.enable | P4 |
| GET | `/verify` | utilities.verify | P4 |
| POST | `/verify/:checkId/fix` | utilities.verify | P4 |
| GET/POST/PATCH | `/financial-years[/:id]` | settings.edit | P4 |
| POST | `/financial-years/:id/lock` / `unlock` | utilities.closeFy | P4 |
| GET/POST/PATCH/DELETE | `/bank-accounts[/:id]` | cashbank.* | P5 |
| GET | `/bank-accounts/:id/transactions` | cashbank.view | P5 |
| GET | `/cash/transactions` | cashbank.view | P5 |
| POST | `/cash/adjust` / `/cash/count` | cashbank.edit | P5 |
| POST | `/transfers` / PATCH/DELETE `/transfers/:id` | cashbank.edit | P5 |
| GET/POST/PATCH | `/cheques[/:id]` | cheques.* | P5 |
| POST | `/cheques/:id/deposit` `/clear` `/bounce` `/cancel` | cheques.edit | P5 |
| GET/POST/PATCH | `/loans[/:id]` | loans.* | P5 |
| POST | `/loans/:id/payments` `/increase` | loans.edit | P5 |
| GET | `/loans/:id/schedule` | loans.view | P5 |
| POST | `/bank-recon/parse` `/match` `/finish` | cashbank.edit | P5 |
| GET | `/cashbank/summary` | cashbank.view | P5 |

### Reports and compliance
| Method | Path | Perm | Phase |
|---|---|---|---|
| GET | `/reports/:id` | reports.view (+ reports.profit) | P6 |
| GET | `/reports/:id/export.csv` | reports.export | P6 |
| GET/POST/DELETE | `/report-views` | reports.view | P6 |
| GET/POST | `/report-schedules` | reports.export | P6 |
| GET | `/gst/advances` | gst.view | P10 |
| POST | `/gst/rcm/:purchaseId/pay` | gst.file | P10 |
| GET | `/gst/itc-risk` | gst.view | P10 |
| GET/POST/PATCH | `/tds-entries[/:id]` | tax.view | P10 |
| POST | `/tds-entries/:id/deposit` | gst.file | P10 |
| POST | `/einvoice/:invoiceId/generate` / `cancel` | sales.edit | P10 |

### Utilities, settings, growth
| Method | Path | Perm | Phase |
|---|---|---|---|
| GET/POST | `/barcodes/generate` | utilities.barcode | P7 |
| POST | `/export/tally/preview` and `/download` | utilities.tally | P7 |
| POST | `/fy/close/preview` and `/run` | utilities.closeFy | P7 |
| GET/POST | `/backups` ; POST `/backups/restore` | backup.* | P7 |
| GET/PATCH | `/settings` | settings.view / edit | P8 |
| GET/PUT | `/message-templates` | messages.templates | P8 |
| GET/POST/PATCH | `/service-reminders[/:id]` | settings.edit | P8/P9 |
| GET/PUT | `/currencies` `/exchange-rates` | settings.edit | P8 |
| GET/PUT | `/roles/:id/matrix` | team.manage | P8 |
| POST | `/messages/send` ; GET `/messages` | messages.send | P9 |
| POST/DELETE | `/documents/:id/share-link` | messages.send | P9 |
| GET | `/s/:token` (public) | none, rate limited | P9 |
| GET | `/reminders/overdue` ; POST `/reminders/send` | messages.send | P9 |
| GET/POST | `/staff/:id/visits` | staff.edit | P9 |

## Appendix C: Migration map and indexes

Numbers continue from `0007`. Always generate with `pnpm db:generate`, then hand-append RLS and non-Drizzle objects.

| Migration | Phase | Contents |
|---|---|---|
| `0008_masters_parties.sql` | P1-S1/S2 | `party_groups`, `party_addresses`, `party_item_rates`; new `parties` columns; `party_balances` view; RLS |
| `0009_masters_items.sql` | P1-S4/S5 | `item_categories`, `item_units`, `item_batches`, `item_serials`; new `items` columns; `stock_movements.batch_id/serial_id`; RLS |
| `0010_sale_enhancements.sql` | P2 | `staff`; `invoices.salesman_id`; `payments` new columns; `payment_allocations.purchase_id` |
| `0011_purchase_side.sql` | P3 | `purchase_orders(+lines)`, `purchase_returns(+lines)`, `expense_items`, new columns on `purchases`, `purchase_lines`, `expenses`, `expense_categories`; income kind |
| `0012_ledger.sql` | P4-S1 | `accounts`, `ledger_entries`, balance trigger, append-only policy |
| `0013_financial_years.sql` | P4-S6 | `financial_years`; business lock columns |
| `0014_cashbank.sql` | P5 | bank account columns, `transfers`, `cheques`, `loans`, `loan_schedule`, `loan_payments`, `bank_recon` |
| `0015_reports_support.sql` | P6 | `report_views`, `report_schedules`, user prefs favourites; supporting views/indexes |
| `0016_settings.sql` | P8 | `business_settings`, `user_prefs`, `message_templates`, `service_reminders`, `currencies`, `exchange_rates`, `tds_sections` |
| `0017_messaging.sql` | P9 | `messages`, `document_links`, `staff_visits` |
| `0018_compliance.sql` | P10 | `advance_receipts`, `tds_entries`, e-invoice columns |
| `0019_backups.sql` | P7-S4 | `backups` history |
| `0020_indexes_concurrent.sql` | P11 | `CREATE INDEX CONCURRENTLY` for items below |

(Order may swap 0015–0019 depending on build order; keep numbers unique and ascending.)

### Indexes to create
| Table | Index | Serves |
|---|---|---|
| `invoices` | `(org_id, business_id, date desc)` partial `where deleted_at is null` | all sale lists/reports |
| `invoices` | `(org_id, party_id, date)` | party statement |
| `invoices` | `(org_id, salesman_id, date)` | salesman reports |
| `payments` | `(org_id, party_id, date)`, `(org_id, direction, date)` | statements, day book |
| `payment_allocations` | `(org_id, invoice_id)`, `(org_id, purchase_id)` | outstanding |
| `purchases` | `(org_id, business_id, date desc)`, `(org_id, supplier_id, bill_no)` | lists, duplicate check |
| `stock_movements` | `(org_id, item_id, date)` | stock reports, costing |
| `ledger_entries` | see P4-S1 + `(org_id, business_id, txn_date)` | day book, trial balance |
| `cheques` | `(org_id, status, cheque_date)` | due list |
| `loan_schedule` | `(org_id, loan_id, due_date)` | schedule |
| `parties` | `(org_id, group_id)`, trigram on `name` | filters, search |
| `items` | `(org_id, category_id)`, unique `(org_id, barcode)` where not null, trigram on `name` | filters, scanning |
| `messages` | `(org_id, status, scheduled_at)` | queue |
| `tds_entries` | `(org_id, section, date)` | 26Q |

Every new tenant table: `ALTER TABLE … ENABLE ROW LEVEL SECURITY; CREATE POLICY … USING (org_id = current_setting('app.org_id')::uuid)` (copy the exact expression from `0002_rls.sql`).

## Appendix D: Error catalogue

| Code | HTTP | When | User message |
|---|---|---|---|
| `VALIDATION` | 422 | schema or business-rule violation (with `fields`) | Field-level text |
| `NOT_FOUND` | 404 | missing or other tenant's record | "Not found" |
| `FORBIDDEN` | 403 | missing permission | "You do not have permission to do this" |
| `CONFLICT` | 409 | duplicate or in-use | "Already exists" / "In use by n records" |
| `PERIOD_LOCKED` | 409 | date in locked FY, before freeze date, or GST filed month | "This period is locked. Ask the owner to unlock it." |
| `OVER_ALLOCATED` | 422 | allocations or payments exceed totals | "Amount exceeds the pending balance by ₹x" |
| `NEGATIVE_STOCK` | 409 | stock would go below zero in block mode | "Only n units in stock" |
| `CREDIT_LIMIT` | 409 | credit block mode | "Credit limit exceeded by ₹x" |
| `LEDGER_IMBALANCE` | 500 | posting not balanced (bug) | "Could not post accounting entries" + alert |
| `LEDGER_DISABLED` | 409 | ledger-only feature while flag off | "Enable accounting to use this" |
| `IMPORT_FAILED` | 422 | row errors on commit (with `failed[]`) | "n rows failed" |
| `PROVIDER_ERROR` | 502 | messaging/e-invoice provider failed | provider message |
| `RATE_LIMITED` | 429 | too many requests | "Try again in a minute" |

## Appendix E: Test matrix (summary)

| Phase | tax-engine tests | contract tests | API tests | web tests | E2E |
|---|---|---|---|---|---|
| P0 | – | – | – | DataTable, Combobox, MoneyInput, DateInput, LinesGrid, Modal | shell navigation |
| P1 | importValidate, toBaseQty, creditCheck | party, item refinements | groups, addresses, import, barcode uniqueness | ImportWizard, ItemModal | create → import → adjust |
| P2 | totals+charges, allocateReceipt, cashLimit, commission, returnableQty | invoice payments | inline payments tx, guards, salesman scope | PaymentBlock | cash sale, credit sale, order → invoice |
| P3 | itcSplit, tdsCalc, landed cost | purchase, PO, return | PO convert, debit note, TDS | ITC select, PO convert | PO → bill → pay → return |
| P4 | posting (500 random), voucher balance | account, journal | repost, backfill, verify, lock | LedgerTable | enable ledger, trial balance |
| P5 | emi, schedule, cheque machine, recon | bank, cheque, loan | transitions + postings | Account detail, Loan form | cheque to clear, EMI |
| P6 | cost, valuation, P&L, balance sheet | report params | per report + cross-checks | ReportShell | open 10 reports |
| P7 | tally, fiscal close, backup crypto | – | Tally, close, restore | Wizards | backup → restore |
| P8 | renderTemplate | settings registry | settings PATCH, owner-only | SettingRow, search | toggle behaviour |
| P9 | reminders, service due | message | queue, links, quiet hours | Share dialog | reminder flow |
| P10 | advances, itcAging, tdsInterest, 3B cells | – | 3B/1 fixtures | GST screens | month-end |
| P11 | – | – | isolation sweep, RLS audit | axe | full smoke |

Smoke E2E (single script, run on every PR touching the web app): signup → add party → add item → add sale with payment → payment in → Day Book shows both → export GSTR-1.

## Appendix F: Use-case catalogue (cross-phase)

Format: **ID · Actor · Goal · Steps · Expected result · Phase**. Use as acceptance scripts and QA cases.

### Setup
| ID | Actor | Goal | Steps | Expected | Phase |
|---|---|---|---|---|---|
| UC-001 | New owner | First sale in under 60 s | Sign up → Home empty state → enter customer, add sample item, amount, received → Create | Invoice 01 saved, balance shown, Setup checklist ticks "first invoice" | P0/P2 |
| UC-002 | Owner | Import 500 items from Excel | Items → Import → Excel → upload → map → fix errors → import | 500 items, error report for failures | P1 |
| UC-003 | Owner | Add bank account with opening balance | Cash & Bank → Add → fill → Save | Balance shown, opening entry in ledger | P5 |
| UC-004 | Owner | Enable accounting | Settings > Accounting → Run check → Enable | Ledger populated, trial balance balanced | P4 |
| UC-005 | Owner | Invite accountant | Settings > Account Access → Invite → role Accountant | CA sees reports, cannot edit | P8 |

### Selling
| ID | Actor | Goal | Steps | Expected | Phase |
|---|---|---|---|---|---|
| UC-101 | Cashier | Cash sale | Add Sale → Cash → add items → Save | Paid invoice, cash balance up, stock down | P2 |
| UC-102 | Salesperson | Credit sale with partial UPI payment | Add party → items → payment row UPI ₹500 | Status partial, bank up ₹500, party balance remainder | P2 |
| UC-103 | Owner | Sale beyond credit limit (warn) | Save | Dialog; Save anyway; audit row | P2 |
| UC-104 | Owner | Credit limit block | Save | Refused, `CREDIT_LIMIT` | P2 |
| UC-105 | Salesperson | Quote → order → partial invoice | Create quote → convert → convert 60 of 100 | Order partial, invoice created | P2 |
| UC-106 | Owner | Credit note with refund by bank | Invoice → Credit note → restock → refund Bank | Stock up, party balance down, bank down | P2 |
| UC-107 | Cashier | Sale with shipping charge at 5% | Add charge | Taxable and GST split include charge | P2 |
| UC-108 | Owner | Export sale to SEZ with LUT | Party gst_type SEZ → invoice | IGST zero-rated, GSTR-1 6B | P1/P10 |
| UC-109 | Owner | Customer pays by cheque | Payment In cheque | Open cheque, bank unchanged | P5 |
| UC-110 | Owner | Customer deducts TDS | Payment In with TDS | Receivable settled, TDS receivable up | P2/P10 |
| UC-111 | Owner | Advance received before invoice | Payment In unallocated, advance rate 18% | Table 11A row; adjusted when invoiced | P10 |
| UC-112 | Cashier | Scan barcode to add line | Focus item field, scan | Row added with price | P1/P8 |
| UC-113 | Owner | Print on thermal 3" | Print settings | Fits width | P8 |
| UC-114 | Owner | Share invoice by WhatsApp | Share → WhatsApp | wa.me opens with link | P9 |

### Buying
| ID | Actor | Goal | Steps | Expected | Phase |
|---|---|---|---|---|---|
| UC-201 | Owner | Record purchase with ITC | Add Purchase | Stock up, payable up, ITC in 3B | P3 |
| UC-202 | Owner | Ineligible ITC line | Set ITC flag | GST added to cost, no ITC | P3 |
| UC-203 | Owner | PO then partial receipt | PO → Convert qty | Statuses update | P3 |
| UC-204 | Owner | Pay supplier with TDS 194C | Payment Out | TDS payable accrues | P3/P10 |
| UC-205 | Owner | Return goods | Debit note | Stock down, payable down, ITC reversed | P3 |
| UC-206 | Owner | RCM purchase | Check RCM | 3.1(d) shows tax; ITC after payment | P10 |
| UC-207 | Owner | Duplicate bill number | Save | Warning with link | P3 |
| UC-208 | Owner | Supplier unpaid 170 days | Open dashboard | ITC at risk card | P10 |

### Money
| ID | Actor | Goal | Steps | Expected | Phase |
|---|---|---|---|---|---|
| UC-301 | Owner | Move cash to bank | Transfer | Both balances adjust | P5 |
| UC-302 | Owner | Cheque bounces | Cheque → Bounced with charges | Invoice reopens, charges posted | P5 |
| UC-303 | Owner | Take a loan | Add loan | Bank up, schedule built | P5 |
| UC-304 | Owner | Pay EMI | Loan → Make payment | Principal and interest posted | P5 |
| UC-305 | Owner | Reconcile bank | Upload statement → match → finish | Rows marked reconciled | P5 |
| UC-306 | Owner | Day-end cash count shortage | Count ₹100 less | Over/short adjustment posted | P5 |
| UC-307 | Owner | Cash receipt ≥ ₹2 lakh | Payment In cash | §269ST banner, report row | P10 |

### Reporting and filing
| ID | Actor | Goal | Steps | Expected | Phase |
|---|---|---|---|---|---|
| UC-401 | Accountant | File GSTR-1 | GST Returns → Oct → review → JSON | Totals equal Sale with GST | P6/P10 |
| UC-402 | Accountant | File GSTR-3B | Review cells, RCM, reversals | Net payable equals ledger | P10 |
| UC-403 | Owner | Customer statement on WhatsApp | Party → Statement → Share | PDF link sent | P6/P9 |
| UC-404 | Owner | Who owes me money | Ageing report | Buckets, total = To Collect | P6 |
| UC-405 | Owner | Profit per bill | Bill wise profit | Profit and % per invoice | P6 |
| UC-406 | Accountant | Trial balance | Report | Dr = Cr | P6 |
| UC-407 | Accountant | Balance sheet | Report | Assets = Liabilities | P6 |
| UC-408 | Owner | Low stock list | Report | Items under min stock | P6 |
| UC-409 | Accountant | Form 27EQ CSV | Report Q2 | CSV, PAN-missing flagged | P6/P10 |
| UC-410 | Owner | Advance tax from P&L | Income Tax → Advance tax | Projected profit used | P10 |

### Utilities and admin
| ID | Actor | Goal | Steps | Expected | Phase |
|---|---|---|---|---|---|
| UC-501 | Owner | Print barcode labels | Utilities → Barcode → items → Print | Sheet aligned | P7 |
| UC-502 | Accountant | Export to Tally | Period, mapping, download | Master+Voucher XML | P7 |
| UC-503 | Owner | Close FY | Wizard | Opening balances carried, FY locked | P7 |
| UC-504 | Owner | Backup and restore | Backup now → restore on empty | Same totals | P7 |
| UC-505 | Owner | Verify data | Run | Issues with fix buttons | P4 |
| UC-506 | Owner | Lock past period | Freeze before date | Edits rejected | P4/P8 |
| UC-507 | Owner | Restore from Trash | Trash → Restore | Document returns, ledger reposted | P7 |
| UC-508 | Owner | Switch language to Tamil | Settings > General | UI, print labels | P11 |

### Roles and security
| ID | Actor | Goal | Steps | Expected | Phase |
|---|---|---|---|---|---|
| UC-601 | Salesman | See only own invoices | Login | List filtered, no purchase price | P2/P8 |
| UC-602 | CA | Read-only access | Try create | 403 / hidden | P7/P8 |
| UC-603 | Staff | Hidden profit | Open reports | Profit reports absent | P8 |
| UC-604 | Owner | Override lock with reason | Edit locked doc | Allowed, audit row | P4 |
| UC-605 | Attacker | Read other org's party | GET by id | 404 | all |

## Appendix G: Screen inventory

| # | Screen | Route | Template | Phase | Permission |
|---|---|---|---|---|---|
| 1 | Home (+ first sale) | `/` | custom | P0/P2 | any |
| 2 | Parties | `/parties` | A | P1 | parties.view |
| 3 | Party detail | `/parties/:id` | F | P1 | parties.view |
| 4 | Party groups | modal | G | P1 | parties.view |
| 5 | Items | `/products` | A | P1 | items.view |
| 6 | Item drawer | `?item=` | G | P1 | items.view |
| 7 | Categories / Units | `/products/categories`, `/units` | A | P1 | items.view |
| 8 | Import Items / Parties | `/utilities/import-*` | D | P1 | items.import |
| 9 | Sale lists (6) | `/sales/*` | A | existing | sales.view |
| 10 | Add Sale / documents | `/invoices/new` | B | P2 | sales.create |
| 11 | Payment In | `/sales/payment-in` | B | P2 | payments.view |
| 12 | Salesman | `/grow/salesman` | A/F | P2/P9 | staff.view |
| 13 | Purchase bills | `/purchases` | A | P3 | purchases.view |
| 14 | Add Purchase | `/purchases/new` | B | P3 | purchases.create |
| 15 | Payment Out | `/purchases/payment-out` | A/B | P3 | payments.view |
| 16 | Purchase orders | `/purchases/orders` | A/B | P3 | purchases.view |
| 17 | Purchase returns | `/purchases/returns` | A/B | P3 | purchases.view |
| 18 | Expenses | `/expenses` | A/B | P3 | expenses.view |
| 19 | Other income | `/other-income` | A/B | P3 | income.view |
| 20 | Chart of accounts | `/settings/accounting` | custom | P4 | accounting.view |
| 21 | Account ledger | `/accounting/ledger/:id` | F | P4 | accounting.view |
| 22 | Journal voucher | `/accounting/journal/new` | B | P4 | accounting.journal |
| 23 | Verify my data | `/utilities/verify` | custom | P4 | utilities.verify |
| 24 | Bank accounts | `/cash-bank/accounts` | A | P5 | cashbank.view |
| 25 | Bank account detail | `/cash-bank/accounts/:id` | F | P5 | cashbank.view |
| 26 | Cash in hand | `/cash-bank/cash` | F | P5 | cashbank.view |
| 27 | Cheques | `/cash-bank/cheques` | A | P5 | cheques.view |
| 28 | Loans / detail | `/cash-bank/loans[/:id]` | A/F | P5 | loans.view |
| 29 | Bank reconciliation | `/cash-bank/accounts/:id/reconcile` | custom | P5 | cashbank.edit |
| 30 | Reports hub | `/reports` | custom | P6 | reports.view |
| 31 | Report (45+) | `/reports/:id` | C | P6 | reports.view |
| 32 | GST returns | `/gst-returns/*` | C chrome | existing/P10 | gst.view |
| 33 | TDS / TCS | `/tds-tcs` | C | P10 | tax.view |
| 34 | Income tax | `/income-tax` | tabs | existing/P10 | tax.view |
| 35 | Barcode generator | `/utilities/barcode` | split | P7 | utilities.barcode |
| 36 | Export to Tally | `/utilities/tally` | D | P7 | utilities.tally |
| 37 | Close FY | `/utilities/close-fy` | D | P7 | utilities.closeFy |
| 38 | Backup | `/backup` | custom | P7 | backup.run |
| 39 | Setup My Business | `/setup` | custom | P7 | any |
| 40 | Trash | `/trash` | A | existing | owner/admin |
| 41 | Settings (11 tabs) | `/settings/:tab` | E | P8 | settings.view |
| 42 | Account Access | `/settings/team` | E | P8 | team.manage |
| 43 | Payment reminders | `/grow/reminders` | A | P9 | messages.send |
| 44 | Messages log | `/grow/messages` | A | P9 | messages.send |
| 45 | Service reminders | `/grow/service` | A | P9 | settings.view |
| 46 | Plans & pricing | `/plans` | custom | P0 | any |
| 47 | Component gallery | `/dev/ui` | dev only | P0 | dev |

## Appendix H: Cross-cutting field dictionary

| Concept | Canonical name | Type | Format / rule |
|---|---|---|---|
| Money | `*_amount`, totals | numeric(14,2) | non-negative unless a signed balance |
| Rate / price | `rate`, `price` | numeric(14,3) | per unit |
| Quantity | `qty` | numeric(14,3) | UI decimals per setting |
| Percent | `*_pct`, `gst_rate` | numeric(5,2) | 0–100 |
| Date | `date`, `*_date` | date | ISO in API |
| Timestamp | `*_at` | timestamptz | UTC |
| GSTIN | `gstin` | text 15 | uppercase, checksum |
| PAN | `pan` | text 10 | `[A-Z]{5}[0-9]{4}[A-Z]` |
| IFSC | `ifsc` | text 11 | `[A-Z]{4}0[A-Z0-9]{6}` |
| PIN | `pin` | text 6 | digits |
| Phone | `phone` | text | digits, country code optional |
| State | `state` | text | name from `states.ts`; GST code derived |
| HSN/SAC | `hsn`, `sac` | text 4/6/8 | digits |
| FY | `fy` | text | `YYYY-YY` |
| Number series | `number` | text | prefix + padded counter |
| Status | `status` | text enum | lowercase snake case |
| Soft delete | `deleted_at` | timestamptz | null = live |

## Appendix I: Glossary

| Term | Meaning |
|---|---|
| ITC | Input Tax Credit: GST paid on purchases that can be set off against output GST |
| RCM | Reverse Charge Mechanism: recipient pays the tax instead of the supplier |
| POS | Place of Supply: decides CGST+SGST vs IGST |
| HSN / SAC | Classification codes for goods / services |
| GSTR-1 | Monthly/quarterly return of outward supplies |
| GSTR-3B | Summary return with tax payment |
| GSTR-2B | Auto-drafted ITC statement from supplier filings |
| TCS / TDS | Tax collected / deducted at source |
| 27EQ / 26Q | Quarterly TCS / TDS returns |
| §269ST | Bar on cash receipts of ₹2 lakh or more |
| §40A(3) | Disallowance of large cash expenditure |
| §194Q | TDS on purchase of goods above ₹50 lakh |
| e-way bill | Document for moving goods above ₹50,000 |
| IRN | Invoice Reference Number from the e-invoice portal |
| LUT | Letter of Undertaking for zero-rated exports |
| Composition scheme | Simplified GST scheme with a flat rate, no ITC |
| Party | A customer or supplier (or both) |
| Voucher | One balanced group of ledger entries |
| Reversal | A counter entry that cancels an earlier ledger entry |
| Control account | One ledger account (receivables/payables) with sub-ledgers per party |
| FEFO | First expired, first out (batch picking) |
| QRMP | Quarterly return, monthly payment scheme |

## Appendix J: QA checklists

### Per-screen checklist
- [ ] Title, breadcrumb and primary action correct
- [ ] Empty state, loading skeleton, error with retry, permission-denied
- [ ] All fields: label, required marker, validation message, keyboard order
- [ ] Numbers right-aligned, Indian grouping, negatives per convention
- [ ] Row actions filtered by permission
- [ ] Export menu works (PDF, Excel, Print, Share)
- [ ] Dark mode legible, contrast ok
- [ ] Narrow layout (1100 px, then phone) usable
- [ ] Unsaved-change guard on forms
- [ ] Deep link opens the right state; back button behaves
- [ ] No console errors; no layout shift on load

### Per-phase regression checklist
- [ ] GSTR-1 and 3B JSON golden files for three tenants unchanged (or diffs explained)
- [ ] Party balances equal Party Statement closing for 20 sample parties
- [ ] Stock value equal across Items list, Stock Summary and (if ledger on) Balance Sheet
- [ ] Trial balance balanced (if ledger on)
- [ ] Old invoices open and print identically
- [ ] Import, export, backup, restore round-trip works
- [ ] Permissions matrix test green
- [ ] Isolation test green for every new table
- [ ] Performance budget checks for lists and reports

### Manual exploratory scripts (15 minutes each)
1. **Month in the life**: 20 sales, 8 purchases, 6 receipts, 4 payments, 3 expenses, a cheque, a loan EMI, then run GSTR-1, 3B, P&L, Balance Sheet and compare to a hand tally.
2. **Edge dates**: documents on 31-03 and 01-04, FY switch, lock date edits.
3. **Rounding**: 100 random invoices with discounts and charges, sum of taxes equals sum per rate in GST Rate Report.
4. **Role switch**: log in as each preset role and walk the sidebar.
5. **Bad data**: import file with wrong units, duplicate codes, huge numbers, emoji names.

## Appendix K: Prompt library for Claude sessions

### Kick-off (any slice)
```text
Read docs/VYAPAR_IMPLEMENTATION_PHASES.md, Part A and the section for slice <ID>. Also read the neighbouring existing file I name
below and match its style. Produce a plan listing files to create or edit, tests to write first and the acceptance checks you will run.
Wait for my "go" before editing. Existing example to mirror: <path>.
```

### Implement
```text
Implement slice <ID> following the slice recipe (tax-engine → contracts → db → api → web data → screen → docs).
Write tests first for pure logic. Run: pnpm lint && pnpm typecheck && pnpm test && pnpm format:check.
Show me the diff summary and the acceptance checklist with each item ticked or explained. Do not commit.
```

### Review
```text
Review the working tree for slice <ID> against its acceptance list and the Definition of done (A.6).
List: missing tests, missing permission checks, tables without RLS, any GST output drift, any hard-coded rate, any UI state not handled.
Be concrete: file:line and the failing scenario.
```

### Debug a number mismatch
```text
Report X total differs from report Y by ₹<n> for period <p>. Find the cause by querying both sources, list the documents that
differ, and propose the smallest fix. Add a regression fixture before fixing.
```

### Migration rehearsal
```text
Apply migrations to a fresh database, then to a copy of the seeded database. Report timing per statement, any long lock, and the
Verify My Data result. Do not modify applied migrations; add a new one if needed.
```

## Appendix L: Decision register template (`docs/DECISIONS.md`)

| ID | Decision | Options | Chosen | Owner | Date | Affects |
|---|---|---|---|---|---|---|
| D-01 | Palette | Vyapar navy+red / Ledgora green | **Vyapar layout and navy sidebar, Ledgora green kept as the primary button colour** (your last commit moved the brand to green on purpose; tokens keep `data-brand="vyapar"` as a one-line switch) | Owner | 2026-11-06 | P0 |
| D-02 | Component library | hand-built / Radix | **Hand-built, no new dependency** (Phase 0 default; see `docs/DECISIONS.md`, awaiting owner sign-off) | Claude | 2026-11-08 | P0 |
| D-03 | Editor layout | single page / stepper default | _pending_ | | | P2 |
| D-04 | Form 27EQ in scope | yes / no | **Yes, shipped as Beta** (you listed it; CSV only, no filing; CA review before the Beta tag is removed) | Owner | 2026-11-06 | P6, P10 |
| D-05 | Barcode library | bundled starter / licensed dataset | _pending_ | | | P1 |
| D-06 | Accounting depth | ledger-lite / full double entry | **Ledger-lite plus optional manual journal** (the ledger table already supports full double entry later, so nothing is thrown away) | Owner | 2026-11-06 | P4 |
| D-07 | Messaging provider | wa.me link / WhatsApp Cloud / SMS vendor | **`wa.me` link now (free, no approval); email via existing mail module; WhatsApp Cloud and SMS vendor revisited after launch** | Owner | 2026-11-06 | P9 |
| D-08 | Credit limit semantics | warn / block default | _pending_ | | | P1, P2 |
| D-09 | Service reminder semantics | recurring service / other | _pending_ | | | P8, P9 |
| D-10 | Backup hosting | snapshot export / server snapshots | _pending_ | | | P7 |
| D-11 | Stock valuation | weighted average only / FIFO | _pending_ | | | P4, P6, P8 |
| D-12 | ITC 180-day date basis | bill-payment date / cheque clearance | _pending_ | | | P10 |
| D-13 | E-invoice provider | none now / GSP name | _pending_ | | | P10 |
| D-14 | Multi-currency GST rate basis | invoice-date rate / other | _pending_ | | | P8 |
| D-15 | Salesman location tracking | include / exclude | _pending_ | | | P9 |

## Appendix M: Effort and staffing view

| Phase | Backend (wk) | Frontend (wk) | QA (wk) | Notes |
|---|---|---|---|---|
| P0 | 0 | 3 | 0.5 | components are the critical path |
| P1 | 1 | 2 | 0.5 | |
| P2 | 1 | 1.5 | 0.5 | totals changes need golden tests |
| P3 | 1.5 | 1.5 | 0.5 | |
| P4 | 3 | 1 | 1 | highest risk; keep tight review |
| P5 | 1.5 | 1.5 | 0.5 | |
| P6 | 2 | 2 | 1 | many reports, cross-check suite |
| P7 | 1 | 1 | 0.5 | Tally manual test |
| P8 | 0.5 | 1.5 | 0.5 | |
| P9 | 1.5 | 1.5 | 0.5 | provider dependent |
| P10 | 2 | 1 | 1 | CA reviews |
| P11 | 1 | 1 | 1 | |
| **Total** | **16** | **18.5** | **8.5** | with two developers ≈ 20 calendar weeks |

## Appendix N: What to cut if time is short

Order of removal, from least to most damaging: Online catalog (P9-S6) → Loyalty (P9-S7) → e-invoice (P10-S7) → Multi-currency (P8-S12) → Service reminders (P8-S10, P9-S5) → Bank reconciliation (P5-S6) → Salesman visits (P9-S4) → ITR-3 map (P10-S8) → Barcode import from library (P1-S7). Never cut: P0 components, P4 ledger, tests, RLS, permission checks.

---

*End of guide. Update the slice checkboxes and the decision register as work lands. Keep this file and `VYAPAR_PARITY_BLUEPRINT.md` in sync: if a screen's fields change, change both.*
