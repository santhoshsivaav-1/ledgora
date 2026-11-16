# Feature roadmap and research — November 2026

Every feature Ledgora still needs to be the billing-and-compliance app a small business can run without paying a CA
for routine work, and that a CA would recommend to clients: what it is, what the law or the market requires, what
competitors do, how we build it, and when it is done. Researched 15 Nov 2026 (sources at the end; vendor claims and
single-source facts are marked). Supersedes the roadmap in [COMPETITOR_GAPS.md](./COMPETITOR_GAPS.md) (April 2026).

**How to read it.** The work is split into eight phases, **R1–R8**, ordered by value and dependency. Each feature has:
*Why* (law or market), *Research* (what we found), *Build* (engine, data, API, screens), *Done when* (acceptance) and
an effort estimate: **S** days, **M** 1–3 weeks, **L** 1–2 months, **XL** more (one developer with Claude). The
file-ready phases 2–6 of [FILE_READY_PLAN.md](./FILE_READY_PLAN.md) map onto R1–R4. Facts that change each year
(rates, thresholds, form versions) are re-checked when the phase starts.

## Progress

**R1 is complete.** Everything below is built, tested and in the app.

| Item | Status | Where |
|---|---|---|
| X1 Server-side builders | **Done.** The GSTR-1 and GSTR-3B tables and JSON moved from the browser screen into the engine. A golden test holds the engine to the files the screen downloaded before the move (a real browser, real documents), and the rewired screen was re-captured and is byte-identical. The server builds the same files | `packages/tax-engine/src/gstReturnsModel.js`, `POST /v1/filing-packs/build/gst`, `test/gstReturnsGolden.test.js` |
| R1.1 GSTR-1A | **Done.** Compares today's GSTR-1 with the filed one, only inside the 1A window; 3B is then checked against the amended figures | `filingR1.ts`, `POST …/build/gstr1a` |
| R1.2 GSTR-9 | **Done (worksheet).** Tables 4, 5, 6A, 7, 8, 9, 17 from the year's filed returns; missing months are errors | `buildGstr9`, `POST …/build/gstr9` |
| R1.3 GSTR-9C | **Done (worksheet).** The year's books against GSTR-9 with the person's adjustments; unreconciled turnover, tax and ITC listed | `filingR1b.ts`, `POST …/build/gstr9c` |
| R1.4 CMP-08 and GSTR-4 | **Done.** CMP-08 at the composition rate; GSTR-4 from the year's filed CMP-08s and purchases | `POST …/build/cmp08`, `…/build/gstr4` |
| R1.5 Edit log | **Done.** Database triggers on 29 book tables, append-only, impossible to change or switch off; screen and auditor CSV | migration `0030`, Utilities › Edit Log |
| R1.6 Pre-filing checks | **Done.** E-invoice coverage (above ₹5 crore; 30-day window at ₹10 crore), GSTR-3B against the portal's locked 3.1(a), late fee estimate on every overdue return, 18% interest helper | `einvoiceChecks`, `comparePortal3b`, `gstLateFee`, `gstInterest` |

**Still needs a real upload (X3), so these are labelled worksheets, not portal files:** GSTR-9, GSTR-9C, GSTR-4, CMP-08 and
GSTR-1A. The portal's offline tools take their own formats; a worksheet is what the person types in until one real
upload of each is photographed into `docs/acceptance/`. GSTR-1 and GSTR-3B keep their JSON upload.

Tests: `tax-engine/test/{filing,filingR1,filingR1b,gstReturnsGolden}.test.js`, `api/test/{filing,editLog}.test.ts`,
browser `web/scripts/filing-e2e.mjs` (21 checks), golden capture `web/scripts/gst-golden-capture.mjs`.

**Next: R2** (income tax from the books): year-versioned rules for the 2025 Act, AIS/TIS import, ITR-4 JSON, advance tax
and challans, ITR-3.

## 1. Where Ledgora stands

Checked in the code, not from the README.

| Area | Has today |
|---|---|
| Sales | Invoices, quotations, orders, challans, proforma, credit notes, POS, recurring, inline payments, charges, credit- and cash-limit guards, salesmen, payment and service reminders (wa.me + e-mail), online catalog, offer codes, loyalty |
| Purchase | Bills, payment out, purchase orders, returns / debit notes, expenses, other income, ITC 180-day rule, reverse charge |
| Items | Categories, units, batch and serial, secondary units, wholesale and party-wise rates, barcodes, bulk update, OCR of bill lines |
| Books | Double-entry ledger, chart of accounts, journals, trial balance, P&L, balance sheet, Verify My Data, close FY, period lock, audit log |
| Cash & bank | Bank accounts, cash, transfers, cheques, loans, statement import and reconciliation |
| GST | GSTR-1 and 3B JSON, 2B reconciliation, HSN/SAC, e-invoice INV-1 JSON (offline), e-way bill JSON, Table 11 advances, cess, UTGST, SEZ, composition maths |
| File-ready returns | Filing packs with server checks and SHA-256, IMS action list, Return Register, CA review and approval, free CA seat, CA Dashboard, ARN record and month lock |
| Income tax | Old/new regime, 234B/C, surcharge relief, ITR-4 field map, books-based ITR-3 map, 26AS matching, TDS/TCS on sales |
| Platform | Multi-tenant SaaS with row-level security, editable roles, multi-business, plans and trial, scheduled and Drive backups, Tally export, Hindi and Tamil, PWA, desktop app, offline local edition |

**Confirmed absent:** manufacturing/BOM, godowns, payroll, job work, branches, payment links for customers, e-commerce
sync, WhatsApp Business API, AIS import, fixed-asset register, Schedule III, TDS deductor returns, GSTR-1A, GSTR-9/9C.

## 2. GSTR-3B JSON upload: still accepted

GSTN's *GSTR-3B Offline Utility* manual (updated 22-12-2025): validate → generate JSON → GSTR-3B tile → **Prepare
Offline** → upload; re-uploadable until submission, each upload replacing the last. Tally documents the same route.
Still to prove on a real GSTIN: the `version` our builder writes (`GST3.0.4`) and how uploaded values meet the tables
the portal locks from GSTR-1/1A and 2B/IMS (see X3).

## 3. Phase overview

| Phase | Goal | Features | Effort | Needs |
|---|---|---|---|---|
| **R1** | Finish GST and make the books audit-proof | X1 server-side builders, GSTR-1A, GSTR-9, GSTR-9C, CMP-08/GSTR-4, Companies Act edit log, more pre-filing checks | ~8 weeks | — |
| **R2** | Income tax from the books | Year-versioned rules (2025 Act), AIS/TIS import, ITR-4 JSON, advance tax and challans, ITR-3 JSON | ~10 weeks | R1 (X2), R4 for ITR-3 |
| **R3** | TDS deductor and payroll | Deductees and sections, challans and interest, quarterly statements (Form 140 etc.) with FVU, certificate data, payroll lite, PF/ESI/PT files | ~10 weeks | R1 (X2) |
| **R4** | Year-end statements | Fixed-asset register and depreciation, Schedule III statements, tax-audit pre-fill for the CA | ~8 weeks | R1 (edit log) |
| **R5** | Get paid and talk to customers | Payment links with automatic receipts, WhatsApp Business API, customer statement portal, scheduled reminders | ~6 weeks | — |
| **R6** | Grow through CAs | Document requests, compliance calendar beyond GST, bulk CA actions, CA firm tasks, CA-led client onboarding | ~8 weeks | R1 (X1) |
| **R7** | Stock depth | Godowns and transfers, reorder suggestions, price lists, BOM and manufacturing, job work and ITC-04, FIFO | ~12 weeks | — |
| **R8** | Platform and reach | Native mobile apps, more languages, import from Tally/Vyapar/myBillBook, bank feeds, e-commerce, branches, optional direct-filing add-on | ongoing | — |

R5 and R7 do not depend on the compliance phases and can run in parallel with them if a second person is available.
Suggested calendar for one developer: R1 Dec–Jan, R2 Feb–Apr (ITR season starts April), R3 May–Jun, R4 Jul–Aug
(audit season), R6 Sep–Oct, R5 Nov, R7 and R8 after.

## 4. Cross-cutting work (do first or alongside)

**X1 — Move the GST return builders to the server.** *Why:* GSTR-1 and 3B JSON are built in the browser
(`GSTReturns.jsx`) from workspace documents, so the server can only re-check a file, not rebuild it. GSTR-9, bulk
actions for CAs and scheduled packs all need the builder on the server. *Build:* move the builders into
`packages/tax-engine` as pure functions over plain bill/purchase objects; the web and the API both call them; golden
tests freeze today's output byte for byte before the move. *Done when:* the browser button and `POST
/v1/filing-packs/build` produce identical files for the golden fixtures. **M**

**X2 — Schema registry and yearly update.** *Why:* portal formats change every year (ITR schemas per assessment year,
TDS file formats per FVU version, GSTR-9 tool versions). *Build:* `packages/tax-engine/schemas/<form>/<year-or-version>/`
holding the official JSON schema or file-format spec, an AJV validator, and a yearly checklist in `RELEASE_CHECKLIST.md`
(download new schemas, run golden tests, update the version shown to users). **S**

**X3 — Real-portal acceptance.** *Why:* there is no public sandbox for return uploads; only the real portal proves a
file. *Build:* for each pack kind, one upload on a real GSTIN/PAN/TAN (a willing pilot business or our own),
screenshots and the portal's response kept in `docs/acceptance/`; a kind stays "Beta" until it has one. **S per form**

**X4 — One data store.** *Why:* sales screens keep workspace documents while the API has typed tables; every report
and return has to read both. *Build:* finish moving screens to the typed API (the Vyapar-parity programme's direction)
before R4, so statements read one ledger. **L** (already in progress)

**X5 — Security and privacy.** DPDP Act consent and deletion, VAPT before payment links (R5) and bank feeds (R8),
secrets only in the server's vault.

## 5. Phases in detail

### R1 — Finish GST and make the books audit-proof

**R1.1 GSTR-1A (amendments before 3B)** — **S/M**
- *Why:* optional return, opens after GSTR-1 for the period is filed (from the later of the GSTR-1 due date or its filing
  date) and closes the moment GSTR-3B for that period is filed. It adds, amends or deletes the same period's records,
  and the change flows into 3B liability (which is locked from GSTR-1/1A). Reintroduced from the July 2024 period.
  Later corrections go through the regular GSTR-1 amendment tables (time limit: 30 November of the next FY or the
  annual return, whichever is earlier).
- *Research:* sources disagree on the exact opening day for QRMP filers (11th vs 13th); confirm on the portal.
- *Build:* engine `diffGstr1(filed, current)` → added / amended / deleted rows per table; pack kind `gstr1a` built from
  the filed GSTR-1 pack and today's books; the register shows the 1A window (open, closed by 3B); worksheet in the
  portal's table order (and JSON if the offline tool accepts 1A, to verify).
- *Done when:* a bill added, changed or cancelled after GSTR-1 appears correctly in the 1A pack; no 1A pack can be made
  once the period's 3B is recorded as filed.

**R1.2 GSTR-9 annual return** — **L**
- *Why:* every regular taxpayer above the yearly exemption limit files it (due 31 December; check the turnover
  exemption each year). It is the main reason small businesses still pay a CA.
- *Research:* the GSTR-9 offline tool is Excel; Tables 4–18 can be prepared offline and a JSON generated for upload;
  the tool needs the portal's own JSON imported first, and error JSON from the portal can be re-opened in it. Businesses
  with more than 500 HSN rows must use the offline route. Table 8A auto-fills from 2B for FY 2025-26 (one checklist
  source; verify).
- *Build:* pack kind `gstr9`; engine builds Tables 4–7 (outward, ITC claimed, reversals) from the year's filed 3B and
  GSTR-1 packs plus books, 8A from imported 2B data, 9 (tax paid) from 3B, 10–14 (next-year amendments) from 1A/notes,
  17–18 HSN from bills; a difference sheet (books vs returns) for the person to explain; JSON in the tool's format,
  validated by X2.
- *Done when:* for a test year the tables tie to the 12 3Bs and GSTR-1s; X3 upload passes.

**R1.3 GSTR-9C reconciliation statement** — **M**
- *Why:* above the turnover limit (₹5 crore, check yearly); self-certified since FY 2020-21.
- *Research:* prepared only in the 9C offline utility; the JSON is signed with DSC there and uploaded; any change means
  regenerating and re-uploading.
- *Build:* reconciliation of turnover (books P&L → GSTR-9), tax and ITC, with reasons; export in the utility's import
  layout. Uses the P&L now, Schedule III figures after R4.
- *Done when:* every difference line has an amount and a reason; the utility imports our file.

**R1.4 Composition returns: CMP-08 and GSTR-4** — **S**
- *Why:* composition dealers pay quarterly (CMP-08, 18th after the quarter) and file GSTR-4 yearly (30 April);
  `gstDue.ts` already knows the dates and `compositionTax()` the amount.
- *Build:* pack kinds `cmp08`, `gstr4`; worksheet/JSON; register rows already exist.
- *Done when:* a composition business sees, prepares and records both.

**R1.5 Companies Act audit trail (edit log)** — **M**
- *Why:* the proviso to Rule 3(1), Companies (Accounts) Rules 2014 requires companies' accounting software to record
  an audit trail of every transaction, an edit log of every change with its date, and the trail can not be disabled;
  in force for financial years from 1 April 2023. Auditors report on it under Rule 11(g). Tally sells its "edit log" on
  this.
- *Research:* our `audit_log` records many actions, but writes made by triggers-free code paths and the workspace
  document screens are not guaranteed to be logged with before/after, and nothing stops a privileged role deleting rows.
- *Build:* database triggers on every book table (invoices, lines, purchases, payments, journals, ledger entries,
  workspace documents) writing old and new row images to an append-only `edit_log`; `app_user` has INSERT only (no
  UPDATE/DELETE), no setting can switch it off; per-voucher "Edit history" panel; an auditor export (CSV, date range);
  retention at least 8 years (the books' retention period).
- *Done when:* a test edits and deletes every kind of record and finds one log row each; a test proves the app role can
  not alter or delete log rows.

**R1.6 More pre-filing checks** — **S each**
- e-invoice threshold crossed (₹5 crore AATO) and the 30-day IRP reporting window for larger taxpayers (verify the
  current limit) as warnings on the GSTR-1 pack;
- 3B Table 4 versus the portal's system-computed figures when the person imports them;
- supplier GSTIN cancelled or not filing (needs a GSTIN search source; manual list until a GSP exists).

### R2 — Income tax from the books

**R2.1 Year-versioned rules for the Income-tax Act, 2025** — **M**
- *Why:* the 2025 Act is in force from 1 April 2026. Returns for AY 2026-27 (FY 2025-26) still use the 1961 Act's forms
  and sections; Tax Year 2026-27 onward uses the new Act (renumbered sections; reported renames: Form 16 → 130, 26AS →
  168, 3CA/3CB/3CD → Form 26, 26Q → Form 140).
- *Build:* `tax-engine/src/itr/rules/<year>.ts` (slabs, rebates, surcharge, deductions, presumptive rates, forms) chosen
  by year; a section map old → new used in labels and reports; the existing engine becomes the AY 2026-27 pack.
- *Done when:* the same income computed under both years gives each year's correct tax in golden tests.

**R2.2 AIS / TIS import and match** — **M**
- *Why:* mismatches between AIS and the return are the commonest notice trigger.
- *Research:* AIS JSON is downloaded from the compliance portal and opened in the official AIS Utility with a password
  (16 or 18 characters per conflicting guides); TIS can be downloaded as PDF, JSON or CSV. Feedback is given on the
  portal (or saved offline) and updates TIS, which pre-fills the ITR.
- *Build:* import TIS CSV/JSON first (no password step), AIS JSON when a sample confirms the format; match categories
  (GST turnover, interest, TDS/TCS, purchase/sale of securities, rent) against books; a "feedback to give" list.
- *Done when:* a real TIS file imports and every category shows books vs AIS with differences. Needs a sample file.

**R2.3 ITR-4 (Sugam) JSON** — **M**
- *Why:* presumptive income (44AD/44ADA/44AE) businesses and professionals; most of our users.
- *Build:* pack kind `itr4`, built from the books and the computation; validated against the year's official JSON schema
  (X2); upload via e-filing → File ITR → upload JSON → e-verify (Aadhaar OTP). Register rows for ITR with due dates.
- *Done when:* the schema validates; X3 upload on a real PAN succeeds.

**R2.4 Advance tax and tax challans** — **S/M**
- *Why:* instalments of 15/45/75/100% by 15 Jun/Sep/Dec/Mar (one instalment by 15 Mar for presumptive cases); misses cost
  234B/C interest.
- *Build:* projection from books (exists: `projectAnnualProfit`), instalment due list in the register, challan details to
  pay on e-Pay Tax (tax head, minor head advance/self-assessment), record BSR, challan number and date; paid challans
  feed 234B/C and the ITR's tax-paid schedule.
- *Done when:* recorded challans reduce interest and appear in the ITR pack.

**R2.5 ITR-3 JSON** — **L** (after R4)
- *Build:* Part A P&L and balance sheet from Schedule III data, depreciation schedule from R4, presumptive vs normal
  computation; same pipeline as ITR-4.

### R3 — TDS deductor and payroll

**R3.1 Deductees, sections and thresholds** — **M**
- *Why:* a business that pays rent, contractors, professionals or buys goods above limits must deduct (194C, 194J, 194I,
  194H, 194Q…), with higher rates for missing or inoperative PAN.
- *Build:* deductee master (PAN status, lower-deduction certificate), section table by year (X2), deduction on purchase
  bills and payments with threshold tracking per deductee per year, TDS payable ledger (the receivable side exists).

**R3.2 Challans, interest and late fee** — **S**
- Deposit by the 7th of the next month (30 April for March); interest for late deduction and late payment; 234E late fee
  for late statements. Engine pieces exist in `compliance.ts`.

**R3.3 Quarterly statements (24Q/26Q/27Q/27EQ; Forms 138/140/… from TY 2026-27)** — **L**
- *Research:* Protean now ships two tracks: RPU 6.0 with FVU 9.x for statements up to FY 2025-26, and RPU 1.2 with FVU
  1.1 (July 2026) for TY 2026-27 onward, with renamed forms (the e-filing guide calls 26Q "Form 140"). The FVU file is
  zipped and uploaded with the TAN login; the FVU version must match the one shown on the portal's form screen.
  TallyPrime 7.1 already ships e-TDS/e-TCS "as per Income Tax Act 2025".
- *Build:* writers for the statement text format per FVU version (X2); the desktop app runs the user's FVU (Java) locally
  and returns the `.fvu` and Form 27A; register rows per quarter with due dates.
- *Done when:* our file passes FVU for both tracks; X3 upload on a real TAN.

**R3.4 Certificate data** — **S**
- Certificates (Form 16/16A, renamed under the new Act) are downloaded from TRACES only; we give the deductee-wise data
  and reconcile the TRACES download against our ledger.

**R3.5 Payroll lite and statutory files** — **L**
- *Why:* myBillBook sells attendance and payroll to the same small businesses (vendor claim); salary TDS feeds 24Q.
- *Build:* employees, attendance, salary structure, payslips, advances; PF (employer and employee shares, wage ceiling),
  ESI (contribution rates and wage ceiling), state professional tax; EPFO ECR text file and ESIC contribution upload;
  salary TDS with the regime choice. Check the Labour Codes' wage definition when the phase starts.
- *Done when:* a month's payroll produces payslips, an ECR file EPFO accepts and correct 24Q data.

### R4 — Year-end statements

**R4.1 Fixed-asset register and depreciation** — **M**
- *Why:* depreciation is now a manual journal; ITR-3, Schedule III and tax audit all need asset schedules.
- *Build:* assets with class, cost, put-to-use date; Income-tax Act WDV blocks (half rate when used under 180 days in the
  year) and Companies Act Schedule II useful lives (SLM or WDV); disposals and block adjustments; automatic yearly
  posting; both schedules exported.
- *Done when:* golden tests for a block with additions before and after the 180-day mark and a sale.

**R4.2 Schedule III financial statements** — **M**
- *Why:* companies must present them; banks ask every borrower; TallyPrime 7.1 added them.
- *Build:* map the chart of accounts to Division I heads; balance sheet and P&L with previous-year figures; key notes
  (PPE from R4.1, trade receivables and payables ageing with MSME dues, borrowings); Excel and PDF.

**R4.3 Tax-audit pre-fill for the CA** — **M**
- *Why:* tax audit (44AB; Form 3CA/3CB-3CD, Form 26 under the new Act) is signed by the CA with DSC and UDIN from the
  CA's own e-filing login, then accepted by the taxpayer.
- *Build:* working paper of the clauses the books can answer (turnover, 40A(3) cash payments, 43B(h) MSME dues, TDS
  defaults, loans 269SS/T, depreciation, GST registrations) from existing Cash Watch and R3/R4 data; JSON for the
  utility where the schema allows; the CA reviews it in a pack like any return.

### R5 — Get paid and talk to customers

**R5.1 Payment links and UPI with automatic receipts** — **M**
- *Why:* Zoho, Vyapar and myBillBook let customers pay from the invoice; receipts then post themselves.
- *Research/constraint:* collecting money for merchants needs an RBI payment-aggregator licence, so each business
  connects **its own** gateway account (Razorpay or Cashfree keys/OAuth); we never hold funds.
- *Build:* "Pay now" link on invoices, statements and reminders; webhook (signature-checked) creates the receipt and
  allocates it; fees booked as an expense; idempotent replays.
- *Done when:* a test-mode payment marks the invoice paid without a click.

**R5.2 WhatsApp Business API** — **M**
- *Research:* Meta charges per delivered template message; reported India rates in 2026 are about ₹0.86 for marketing
  and about ₹0.115 for utility, with utility templates reportedly charged even inside the 24-hour window from 1 October
  2026 (third-party sources; check Meta's rate card). Today we use wa.me links (D-07).
- *Build:* the business connects its own WhatsApp Business Account (embedded sign-up); approved templates for invoice,
  reminder and receipt; delivery and read status into the message log; opt-out honoured. Revisit D-07.

**R5.3 Customer statement portal** — **M**
- Extend public document links to a signed party page: statement, open invoices, download, pay (R5.1).

**R5.4 Scheduled reminders** — **S**
- Rules such as "3 days before due, on due date, every 7 days after" per party group, sent by e-mail or WhatsApp.

### R6 — Grow through CAs

**R6.1 Document requests** — **M**
- *Why:* chasing purchase bills and bank statements is most of a CA's month; Zoho Practice (Client Request) and Suvit
  (WhatsApp chat) sell this; AuditFlow ERP built it.
- *Build:* request templates per return (GST month, ITR, audit), items the client uploads from the app or a link,
  statuses requested / uploaded / accepted / rejected, versions, reminders; the uploads attach to the pack.

**R6.2 Compliance calendar beyond GST** — **M**
- TDS deposits and statements, advance tax, ITR, tax audit, ROC (AOC-4, MGT-7/7A, DIR-3 KYC, MSME-1), PF/ESI, ITC-04,
  by entity type; due dates as data (X2), each row a pack or a simple "done" record; feeds the register and the CA
  Dashboard.

**R6.3 Bulk actions on the CA Dashboard** — **M** (needs X1)
- Prepare GSTR-1/3B packs for selected clients from their books, status export, filters by due date and status.

**R6.4 CA firm workspace** — **L**
- The CA's own organization: staff, assignment of clients and returns, review queue, tasks (AuditFlow's Kanban), fee
  invoices to clients.

**R6.5 CA-led onboarding** — **S**
- A CA creates a client organization and invites the owner (the reverse of today's invite), so a CA can bring many
  clients onto the app.

### R7 — Stock depth

| Feature | Why | Build | Effort |
|---|---|---|---|
| **Godowns and transfers** | Traders with more than one location; Busy, Tally, Vyapar have it | Location on every stock line, transfer voucher, location-wise stock and valuation, e-way bill for transfers between GSTINs | L |
| **Reorder and purchase suggestions** | Low-stock alerts exist; suggestions save time | Reorder level and quantity per item and location, "make a purchase order" from the list | S |
| **Price lists** | Distributors with schemes | Named lists by party group and date range on top of party-wise rates | S |
| **BOM and manufacturing** | Busy's main pitch to manufacturers (multi-level BOM, consumption, scrap) | BOM per item, manufacturing journal consuming components and producing goods at cost, scrap and by-products, production report | L |
| **Job work and ITC-04** | Goods sent to job workers; ITC-04 is half-yearly above ₹5 crore AATO (due 25 Oct, 25 Apr) and yearly up to ₹5 crore (25 Apr) | Job-work challans out and in, pending by job worker, ITC-04 pack | M |
| **FIFO valuation** | Asked by auditors in some trades; D-11 chose weighted average | Lot layers per receipt, valuation switch per business | M |

### R8 — Platform and reach

| Feature | Notes | Effort |
|---|---|---|
| **Native Android and iOS apps** | Vyapar and myBillBook are mobile-first. Fastest route: wrap the existing React app (Capacitor) with native printing, camera barcode and share sheet; full native later | XL |
| **More languages** | Telugu, Marathi, Gujarati, Bengali, Kannada, Malayalam; the i18n catalogue and its coverage test exist | S each |
| **Import from Tally, Vyapar, myBillBook** | The switching path; Tally XML/JSON masters and vouchers, Vyapar backup, myBillBook Excel | M each |
| **Bank feeds** | TallyPrime 7 Connected Banking; Account Aggregator streams statements with consent. Becoming an FIU directly is costly (one vendor estimates ₹5–25 lakh and 5–10 months, its own figure); go through a licensed technology provider. Statement import and reconciliation already exist | L |
| **E-commerce sync** | Shopify, WooCommerce, marketplace settlement reports | L |
| **Branches and consolidation** | Several GSTINs under one company, consolidated reports | L |
| **Direct filing add-on** | GSP/ERI routes for those who want OTP-only filing; licensing steps in the earlier analysis | XL, paid tier |

## 6. Positioning after the roadmap

| | Vyapar | myBillBook | Busy | TallyPrime | Zoho Books | **Ledgora** |
|---|---|---|---|---|---|---|
| Free tier | Mobile basics | Trial | – | – | Small turnover | Yes, plus offline local edition |
| File-ready GST with checks | JSON export | e-invoice via GSP (vendor) | Yes | Connected GST | Yes | **Yes, checked and versioned; 9/9C in R1** |
| CA reviews in the app | – | – | – | Separate products | Accountant seat | **Free CA seat, CA Dashboard; document requests in R6** |
| ITR from the books | – | – | – | – | – | **R2** |
| TDS returns | – | – | Yes | Yes (7.1) | Partial | **R3** |
| Manufacturing / godowns | Basic | Basic | Strong | Strong | Add-on | **R7** |
| Native mobile | Yes | Yes | Partial | Partial | Yes | **R8** |

## Sources

GST
- GSTN, [GSTR-3B Offline Utility manual](https://tutorial.gst.gov.in/downloads/gstr3bofflineutility.pdf) (updated 22-12-2025); Tally, [upload GSTR-3B JSON](https://help.tallysolutions.com/upload-json-file-gstr-3b/)
- GSTR-1A: [ClearTax](https://cleartax.in/s/gstr-1a), [Zoho](https://www.zoho.com/in/books/gst/how-to-file-gstr-1a.html), [Octa GST](https://octagst.com/blog/gstr1a-overview), [Razorpay](https://razorpay.com/learn/gstr-1a/), [TheMunim (amendment time limit)](https://themunim.com/blog/how-to-amend-gstr-1-and-time-limit/)
- GSTR-9/9C: [Taxilla guide](https://www.taxilla.com/gstr-9-9c-filing-guide), [ClearTax 9C offline utility](https://cleartax.in/s/gstr-9c-offline-utility), [Petpooja FY 2025-26 checklist](https://blog.petpooja.com/templates-checklist/gstr-9-annual-return-checklist/), [Taxscan FY 2024-25 changes](https://www.taxscan.in/top-stories/key-changes-in-gstr-9-and-gstr-9c-for-fy-2024-25-everything-you-should-know-1437208)
- ITC-04: [GST portal manual](https://tutorial.gst.gov.in/userguide/inputtaxcredit/Manual_itc04.htm), [Oxyzo](https://www.oxyzo.in/blogs/itc-04-filing-process-benefit-exemption-and-penalties), [Patron Accounting](https://www.patronaccounting.com/blog/itc-04-job-work-gst-guide)

Companies Act audit trail
- [TaxGuru: Rule 3(1) and Rule 11(g) practitioners' guide](https://taxguru.in/company-law/audit-trail-compliance-rule-3-1-rule-11-practitioners-guide.html), [SetIndiaBiz](https://www.setindiabiz.com/blog/audit-trail-compliance-accounting-software-mca-guidelines), [Tally: edit log features](https://tallysolutions.com/accounting/5-features-to-look-in-audit-trail-edit-log-accounting-software)

Income tax and TDS
- Income-tax Act 2025 in force: [TaxGuru](https://taxguru.in/income-tax/income-tax-act-2025-force-1st-april-2026.html); new forms: [CA Rajput](https://carajput.com/blog/new-income-tax-forms-under-new-income-tax-act-2025-india/)
- AIS: [Income Tax Department](https://www.incometaxindia.gov.in/en/annual-information-statement), [offline steps](https://www.incometaxindia.gov.in/w/steps-to-access-ais-information-offline), [TaxGuru AIS utility guide](https://taxguru.in/income-tax/annual-information-statement-ais-user-guide-ais-utility.html)
- e-TDS: [Protean preparation procedure](https://tinpan.proteantech.in/downloads/e-tds/eTDS-download-regular.html), [RPU/FVU 1.2 key features](https://abcaus.in/wp-content/uploads/2026/08/Key%20Features%20_RPU%20and%20FVU%20version%201.2.pdf), [e-filing Form 140 guide](https://www.incometax.gov.in/iec/foportal/newformpage/forms/form140-um), [ClearTax RPU versions](https://cleartax.in/s/download-tds-rpu-latest-version)

Competitors
- Tally: [7.0 release notes](https://help.tallysolutions.com/release-notes-tallyprime-7-0), [7.1 what's new](https://tallysolutions.com/tallyprime-7-1-whats-new/), [7.1 release notes](https://help.tallysolutions.com/release-notes-tallyprime-7-1/)
- Zoho: [IMS](https://zstatic.zohostatic.com/in/books/accounting-software-features/invoice-management-system), [IMS integration news](https://zstatic.zohostatic.com/news/zoho-finance-and-operations-suite-grows-in-india.html), accountant seat: [Patron Accounting](https://www.patronaccounting.com/blog/zoho-books-pricing-india-2026), [Stitchflow](https://www.stitchflow.com/user-management/zoho-books/manual)
- myBillBook (vendor): [e-invoicing](https://mybillbook.in/e-invoicing-software), [feature press release](https://bsppd.business-standard.com/content/press-releases-ani/10-powerful-features-introduced-on-mybillbook-to-boost-business-activities-for-smbs-123051900010_1.html)
- Busy (vendor): [manufacturing](https://busy.in/accounting-software/manufacturing/), [enterprise](https://busy.in/enterprise/); Vyapar (vendor): [comparison](https://vyaparapp.in/comparison-with-other-apps)
- CA tools: [Zoho Practice client requests (AccountingWEB)](https://www.accountingweb.co.uk/node/225861), [Suvit](https://www.suvit.io/post/gst-reconciliation-software-for-ca)

Payments, messaging, banking
- WhatsApp pricing: [Meta developer docs](https://developers.facebook.com/docs/whatsapp/pricing), [Free Press Journal (India rates)](https://www.freepressjournal.in/tech/how-much-does-india-have-to-pay-for-whatsapp-messages-from-october-1), [AiSensy (2026 update)](https://m.aisensy.com/blog/whatsapp-per-message-pricing-update-effective-january-1-2026/)
- Account Aggregator: [Department of Financial Services](https://financialservices.gov.in/beta/en/account-aggregator-framework), [Sahamati](https://sahamati.org.in/?p=2412), [eCorpIT 2026 integration notes (vendor estimate)](https://ecorpit.com/account-aggregator-integration-fintech-builders-2026/)
