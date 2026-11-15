# File-ready returns

The app prepares every return in the portal's own upload format, checks it, lets a CA review and approve it, and
keeps the record once a person has uploaded it on the portal. **The app never files anything.** Uploading, OTP and DSC
stay with the business or its CA on gst.gov.in / incometax.gov.in. No GSP, ERI or eSign licence is needed.

A return is **100% file-ready** when:

1. it is in the portal's format (JSON, text or Excel, as the portal takes it);
2. it passes the checks the app knows for that form and year;
3. it has been compared with what the portal already holds (GSTR-1 against 3B, 3B ITC against 2B/IMS; later AIS, 26AS);
4. every warning is fixed or acknowledged by a person;
5. (optional) a CA approved it, and the approval is tied to the file's SHA-256, so any later change voids it.

## Status

| Phase | Scope | Status |
|---|---|---|
| **1** | Filing-pack engine, GSTR-1, GSTR-3B, IMS action list, Return Register, CA review and approval, CA Dashboard | **Built** (this document) |
| 2 | GSTR-9 / 9C (offline-tool JSON), CMP-08, GSTR-4, GSTR-1A worksheet | Planned |
| 3 | Year-versioned income-tax rule packs, AIS/TIS import, ITR-4 then ITR-3 JSON checked against the official schema, Challan 281 | Planned |
| 4 | TDS deductor: deductees, challans, 24Q/26Q/27Q text file for Protean's FVU, local FVU runner in the desktop app | Planned |
| 5 | Fixed-asset register and depreciation, Schedule III statements, Form 3CD pre-fill for the CA | Planned |
| 6 | Payroll ECR / ESIC files, ROC data pack (AOC-4, MGT-7, LLP-8/11) | Planned |

Each later phase adds a `kind` to the same pack engine, so review, approval, the register and the CA's practice view
work for it without new screens.

## Flow of one return

```
GST Returns screen ──"Save filing pack"──▶ POST /v1/filing-packs
                                              │ server re-runs the checks, hashes the file
                                              ▼
                               draft (errors, or warnings not accepted)
                                              │ fix in the books and save again (new version),
                                              │ or accept the warnings
                                              ▼
                                            ready ───────────────────────────────┐
                                              │ Send for review (any plan)        │ never reviewed:
                                              ▼                                   │ record straight away
                                          in_review ◀──── submit again ───┐       │
                                       ┌──────┴──────┐                     │       │
                                   approve      request changes ──▶ changes_requested
                                       ▼                                           │
                                   approved ──── Record as filed (ARN, date, ack) ─┴──▶ filed
                                                                                         │ locks the months
                                                                     Reopen (owner/admin, reason) ◀┘
```

Rules the server enforces, whatever the screen shows:

- Saving the **same file** again keeps the version and any approval. A **different file** becomes a new version and
  retires the old one. A filed return can not be replaced; reopen it first. Corrections to a filed GST return belong
  in GSTR-1A or the next period.
- Once a return has gone to review, **every later version needs an approval** before it is recorded as filed.
- The person who **prepared** a version can not approve it or send it back (four eyes). Either side may prepare:
  the business prepares and the CA approves, or the CA prepares and the owner (or an admin) approves.
- An approval is for one SHA-256. Recording as filed checks the approved hash still matches.
- A GST ARN must be 15 characters, start `AA` and carry the business's state code. The filing date can't be in the
  future or before the period ends. IMS has no ARN; it is recorded as done.
- Recording GSTR-1 or GSTR-3B as filed adds its months to Settings › Transaction › filed months, the lock the save
  guards already read. Reopening removes them, unless another filed return still covers the month.
- Every move is written to the pack's timeline and to the audit log in the same transaction.

## What each return produces

| Return | File in the pack | Checks | Upload on the portal |
|---|---|---|---|
| GSTR-1 | GSTN offline-tool JSON (same builder as the "JSON Export" button) | GSTIN and period, version present, customer GSTIN checksum (not your own), invoice and note numbers (16 chars, `A-Z 0-9 / -`, no duplicates), dates in period, GST rates, IGST vs CGST/SGST by place of supply (SEZ always IGST), tax ≈ rate × value, empty HSN table, nil period | Returns › GSTR-1 › Prepare offline › Upload, then file with EVC/DSC |
| GSTR-3B | GSTR-3B JSON | Sections present, amounts numeric and not negative (net ITC may be), CGST = SGST, 3.1 liability against the saved GSTR-1 of the period by head, ITC claimed against GSTR-2B (when imported) | Check against the portal's auto-filled values, file with OTP/DSC |
| IMS actions | The accept / reject / pending list built from the 2B reconciliation | Each pending row is a warning to decide | Apply the same actions in IMS, recompute 2B |

## Screens

| Screen | Address | Who sees it | What it does |
|---|---|---|---|
| GST Returns (existing) | `/gst-returns/gstr1`, `/gstr3b`, `/gstr2b` | `filing:prepare` for the buttons | **Save filing pack** on GSTR-1 and 3B, **IMS action list** on 2B, **Return Register** link in the header |
| Return Register | `/filing` | `filing:read` | Every GST return of the FY with due date, status, ARN, overdue; Open or Prepare. Months before the business joined the app are listed as "Before you started", never overdue |
| Filing pack | `/filing/:id` | `filing:read` | Readiness checklist, download, send to CA, approve / send back, record as filed (ARN, date, acknowledgement PDF), reopen, accept warnings, portal steps, timeline and comments, versions, the file itself, SHA-256 |
| CA Dashboard | `/ca` (old `/practice` redirects) | anyone who is the CA of at least one client organization | Every client: returns waiting for the CA's review, returns the CA prepared that wait for the client, returns to file (approved) or fix (sent back), overdue returns; filter and search; **Open** switches the session into the client |

Both menus (new and classic) carry **Return Register**; **CA Dashboard** appears only for someone who is a CA in a
client organization, whichever organization is open (D-27). The register can be told which month to start tracking
from ("Track from", default the month before the business joined), so returns filed elsewhere are not overdue (D-26).

## The CA login

A CA is an ordinary user who is a **member of each client's organization** with the role **CA (review and approve)**.

1. The business invites the CA (Settings › Team, role CA, optionally limited to some businesses and to a date window).
2. The CA signs up or signs in with their own account and accepts the invitation.
3. The CA's **CA Dashboard** lists every client where they can approve, across organizations. The query runs in each
   client's tenant under row-level security, with the CA's business limits and date window.
4. **Open** (or **Review** on a waiting return) switches the session to that client. From then on the CA sees that
   client's data with their CA permissions, exactly like any member.
5. Whoever may approve is e-mailed when a return is sent for review: the CA when the business prepared it, the
   owner and admins when the CA prepared it.
6. **The CA seat is free on every plan** and does not count toward the plan's user limit (as Zoho Books' accountant
   seat). Turning a CA into any other role needs a free user seat (D-25).

## Roles and permissions

New permissions: `filing:read`, `filing:prepare`, `filing:approve`, `filing:record`. Any of the last three brings
`filing:read` with it.

| Role | read | prepare (save, accept warnings, send to CA) | approve / send back | record filed | reopen |
|---|---|---|---|---|---|
| Owner | ✓ | ✓ | ✓ (not their own pack) | ✓ | ✓ |
| Admin | ✓ | ✓ | ✓ (not their own pack) | ✓ | ✓ |
| Accountant | ✓ | ✓ | – | ✓ | – |
| **CA (review and approve)** | ✓ | ✓ | ✓ (not their own pack) | ✓ | – |
| Viewer | ✓ | – | – | – | – |
| Salesman, Biller, Stock keeper | – | – | – | – | – |

Owners can change these on Account Access like any other permission. An organization that had **already customised
the CA role** keeps its saved list, which lacks the new permissions until the owner ticks them.

Tenant isolation: both tables have `tenant_isolation` and `business_scope` row-level security. A member limited to some
businesses never sees another business's packs. A member with a date window (Share with CA) sees only returns whose
period ends inside it; anything else answers 404, downloads included.

## Plans

Everything in this document is on **every plan, Free included**: packs, checks, CA review and approval, the register,
the CA Dashboard. The CA seat never counts as a user. Reads are never gated.

## API

All under `/v1`, documented in `/v1/docs` in development.

| Method | Path | Permission | |
|---|---|---|---|
| GET | `/filing-packs?businessId&kind&status&fy` | filing:read | live packs, no file |
| GET | `/filing-packs/:id` | filing:read | file, issues, timeline, versions |
| GET | `/filing-packs/:id/download` | filing:read | the file; `X-Content-SHA256` header |
| POST | `/filing-packs` | filing:prepare | save (new version or unchanged) |
| POST | `/filing-packs/:id/acknowledge` | filing:prepare | accept warnings |
| POST | `/filing-packs/:id/submit-review` | filing:prepare | to the reviewer |
| POST | `/filing-packs/:id/approve` | filing:approve | approve this SHA-256 (not your own) |
| POST | `/filing-packs/:id/request-changes` | filing:approve | back, with a note |
| POST | `/filing-packs/:id/comments` | filing:read | comment |
| POST | `/filing-packs/:id/record-filed` | filing:record | ARN, date, acknowledgement file |
| POST | `/filing-packs/:id/reopen` | filing:record, owner/admin | undo a wrong record, with a reason |
| GET | `/filing-calendar?businessId&fy` | filing:read | the year's GST returns with status |
| PUT | `/filing-calendar/track-from` | filing:prepare | first month checked for overdue (null resets) |
| GET | `/practice/clients` | signed in | the CA Dashboard data |

## Code

| Part | Where |
|---|---|
| Checks, readiness, status rules, IMS, ARN, canonical JSON | `packages/tax-engine/src/filing.ts` |
| Request schemas, permissions, plan feature | `packages/contracts/src/filing.ts`, `permissions.ts`, `plans.ts` |
| Tables `filing_packs`, `filing_events` | `packages/db/src/schema/filing.ts`, migration `0029_filing_packs.sql` |
| Routes | `apps/api/src/modules/filing.ts` |
| Screens | `apps/web/src/features/filing/`, buttons in `features/gst-returns/` |
| Tests | `packages/tax-engine/test/filing.test.js`, `apps/api/test/filing.test.ts`, browser: `apps/web/scripts/filing-e2e.mjs` |

## Known limits of Phase 1

- **GSTR-3B upload: confirmed accepted.** GSTN's GSTR-3B Offline Utility manual (updated 22-12-2025) documents
  *Prepare Offline → upload JSON*, re-uploadable until submission. Still to prove with a real GSTIN: the `version`
  string the builder writes, and how uploaded values meet the tables the portal now locks from GSTR-1/1A and 2B/IMS
  (the pack screen tells the person the portal's locked figures win). See [FEATURE_GAPS_2026-11.md](./FEATURE_GAPS_2026-11.md).
- **GSTR-1A** is not prepared yet (Phase 2).
- The checks are the rules the app knows, not the portal's full validator. A pack can pass here and still be rejected
  by the portal; the error then goes into a new version.
- The IMS list is built from the 2B the person imported; actions are applied on the portal by hand.
- Returns other than GST (TDS, advance tax, ITR, ROC) are not in the register yet (Phases 3–6).
