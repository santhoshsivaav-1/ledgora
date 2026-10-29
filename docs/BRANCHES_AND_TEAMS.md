# Branches & organizations — the user-side flow

One account can belong to many **organizations**, and one organization can have many
**branches** (businesses — each its own GSTIN, address and invoice series).

## Where it lives in the code

| Piece | File |
|---|---|
| Sign-in screens | `apps/web/src/components/auth/` (LoginScreen, AuthGate) |
| Org auto-created at sign-up (+ first business, trial) | `apps/api/src/modules/onboarding/service.ts`, hooked in `apps/api/src/auth/auth.ts` |
| Request scoping to one organization (`x-org-id` / session) | `apps/api/src/middleware/org.ts` |
| Branch list & CRUD | `apps/api/src/modules/businesses.ts` (`/v1/businesses`) |
| Tenant isolation (Postgres RLS on `org_id`) | `packages/db/src/tenant.ts`, `packages/db/migrations/0002_rls.sql` |
| Member ↔ branch limits (RLS `business_ids`) | `packages/db/src/schema/auth.ts` (`memberBusinesses`), `apps/api/src/modules/members.ts` |
| Web branch switcher, Add-branch modal, org switcher | `apps/web/src/App.jsx`, `apps/web/src/components/BranchModal.jsx`, `apps/web/src/services/session.js` |

## What the user does

1. **Sign up** → an organization ("Name's Business"), an owner membership, the first
   branch and a 14-day trial are created automatically; the first-run form fills the
   branch's details (GSTIN decides CGST/SGST vs IGST).
2. **Add a branch** → sidebar switcher → "Add branch…" (Owner/Admin, checked against
   the `business:write` permission), or Settings → Business Profiles → Organization
   branches → "Add branch". Name + GSTIN (state auto-picks) + address; created on the
   account server so the whole team sees it, then switched into immediately.
3. **Switch branch** → the top of the sidebar lists saved profiles first and
   server-only branches below (marked "not set up here"); picking one either loads the
   branch's local profile (logo, payment accounts, numbering) or seeds a new one from
   the server copy. Every screen keys on the active business, so invoices, numbering
   and reports follow the switch.
4. **Switch organization** → people invited into other workspaces get a dropdown in
   the sidebar account bar; picking one moves the session (active org drives which
   branches and team everybody sees).
5. **Team members** → Owners/Admins invite via Settings → Team (existing Team screen).
   Invitations can limit a member to some branches; that list is enforced by
   row-level security, so a limited member's switcher only ever shows their branches.
6. **No account / server offline** → the legacy "Business Profiles" switcher keeps
   working exactly as before; the branch UI simply does not appear.
