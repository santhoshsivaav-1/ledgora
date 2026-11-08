# Vyapar-Parity Blueprint for Ledgora (GST Billing)

> Status: **Planning document**, written 2026-11-06 against app version 1.10.80 plus the unreleased sales-flow work.
> Scope: every Vyapar feature you listed, what Ledgora already has, what is new, every screen as a desktop wireframe, every field, and how each feature feeds GST and Income Tax.

**How to read this file**

| Part | Contents |
|---|---|
| 1 | Research summary, gap matrix (existing / partial / new), app architecture, navigation |
| 2 | Core screens: Parties, Items, Sales, Purchases, Payments, Expenses, Orders, Returns |
| 3 | Cash & Bank, Cheques, Loans, then all Reports |
| 4 | Utilities, Settings, GST + Income Tax connection map, data model additions, build roadmap |
| 5 | **Complete UI restructure**: design tokens, layout grid, component library, page templates, new navigation/routes, module-by-module rebuild plan, migration strategy |

Legend: ✅ exists in the codebase · 🟡 partial (exists, needs extending) · 🆕 new · ⚠️ unverified Vyapar detail.

---

# PART 1: Research, Gap Matrix, Architecture

## 1.1 Research summary (Vyapar)

Sources: Vyapar's own [feature list](https://vyaparapp.in/blog/vyapar-app-complete-feature-list-all-about-your-favorite-billing-software/), [transaction reports guide](https://vyaparapp.in/guides/how-to-check-transaction-reports-in-vyapar-app), [GST compliance guide](https://vyaparapp.in/guides/how-to-manage-gst-compliance-and-taxation-in-vyapar-app), [Tally export guide](https://vyaparapp.in/guides/how-to-import-and-export-vyapar-app-data-into-tally), [FAQ](https://vyaparapp.in/faq), plus your three desktop screenshots.

What the research and screenshots established:

1. **Desktop left menu (from your screenshot)**: `Open Anything (CMD+F)` search, Home, Parties▾, Items(+), Sale▾, Purchase & Expense▾, Grow Your Business▾, Cash & Bank▾, Reports, Sync/Share & Backup▾, Utilities▾, Settings, Plans & Pricing, and a company switcher ("My Company") at the bottom. Older Vyapar versions used a flatter menu (Dashboard, Reports, Sale, Purchase, Expense, Other Income, Cash & Bank, Settings, Backup, Utilities).
2. **Import Items screen (screenshot)**: three methods: *Import from Barcode* (recommended, scans against a library of 100M+ standard barcodes), *Import from Excel*, *Import from Vyapar Library* (catalog of common items). A red Continue button sits bottom-right.
3. **First-sale onboarding (screenshot)**: a split screen. Left: Invoice Number (auto, `01`), Invoice Date, Customer Name\*, "Add Sample Item", Invoice Amount\*, Received, live Balance, "Create Your First Invoice". Right: a live blurred sample Tax Invoice preview (Bill To, Invoice Details, item table with GST column, Amount in Words, Sub Total, SGST@9%, CGST@9%, Total, Balance Due).
4. **Reports**: Vyapar advertises 35+ reports: transaction, party, item, GST, expense, bank, discount, loan, sale/purchase order reports. Bill-wise profit, party-wise P&L and item-wise P&L all exist.
5. **Close Financial Year** lives under Utilities. Two modes: *change prefix* (e.g. `2026-27/`, numbering restarts) or *start fresh* (previous closing balances become party opening balances).
6. **Export to Tally** lives under Utilities: pick date range and data types (Sales, Sales Returns, Purchases, Purchase Returns, Cancelled Sales); output is a "Master" and a "Voucher" file.
7. **Reminders** are SMS/WhatsApp, configurable before / on / after the due date.

⚠️ **Unverified, decide before building**: Form 27EQ (TCS return) did not show up in any Vyapar source I could reach. You listed it, so this blueprint includes it as a Ledgora report, but I could not confirm Vyapar ships it. Likewise "Service Reminders", "Party settings (credit limit)", and true multi-currency are mentioned only thinly. Where detail was thin, this document specifies a sensible design rather than copying Vyapar. Verify against the live Vyapar desktop app before final sign-off.

## 1.2 What Ledgora has today (from the code)

| Area | State | Where |
|---|---|---|
| Stack | pnpm monorepo: `apps/web` (React + Vite PWA), `apps/api` (Node, Better-Auth, RLS multi-tenant), `packages/db` (Drizzle + Postgres), `packages/tax-engine`, `packages/contracts` | repo root |
| Auth, teams, 2FA, device mgmt, org/branch switcher, roles & permissions | ✅ | `apps/api/src/auth`, `features/settings/team`, `security` |
| Dashboard with analytics | ✅ | `features/dashboard/AnalyticsDashboard.jsx` |
| Sales flow: Quotation → Sales Order → Delivery Challan → Tax Invoice / Bill of Supply / Composition → Credit Note, Proforma | ✅ | `features/sales`, `features/invoices` |
| Receipts (payment in) with allocation to invoices | ✅ | `features/payments/ReceiptVoucher.jsx`, `payments`, `payment_allocations` |
| Recurring invoices | ✅ | `features/recurring` |
| Clients (customers + suppliers in one `parties` table) | 🟡 | `features/parties`, `parties` |
| Items / Products with HSN, unit, stock movements, bulk edit, stock report | 🟡 | `features/items`, `items`, `stock_movements` |
| Purchases (bills) with lines, ITC, optional OCR (flag-off) | 🟡 | `features/purchases` |
| Expenses with categories | 🟡 | `features/expenses`, `expense_categories` |
| Reports: P&L, Ageing, Party outstanding, Client-wise, Product-wise, Stock | 🟡 | `features/reports/ReportsView.jsx` |
| GST Returns: GSTR-1, GSTR-3B, GSTR-2B reconciliation, TDS/TCS report, Filing guide, Filed/pending markers | ✅ | `features/gst-returns` |
| Income Tax: regime calculator (old vs new), §44AD/ADA/AE presumptive, advance tax with §234B/C, bank-statement import, ITR-4 summary PDF | ✅ | `features/income-tax`, `packages/tax-engine/src/itr.ts` |
| E-Way Bill JSON export | ✅ | `tax-engine/src/eway.ts` |
| Bank accounts for printing on invoices (not a ledger) | 🟡 | `payment_accounts` |
| Print settings, invoice templates, number series, UPI QR | ✅ | `features/print`, `settings/numbering` |
| Bulk CSV import/export, XLSX export, Trash, Google Drive backup | ✅ | `features/import-export`, `modules/trash.ts`, `transfer.ts` |
| Settings (4 tabs: Business, Invoices & print, Features & stock, Data) | 🟡 | `features/settings` |
| Command palette (CMD+K), shortcuts help | ✅ | `app/CommandPalette.jsx` |
| Plans / entitlements | 🟡 | `features/billing/useEntitlements.ts`, `subscriptions` |

**The structural gap**: Ledgora records *documents* (invoices, purchases, expenses, receipts) but has **no accounts ledger**. There are no cash/bank balances, no cheques, no loans, no day book, no trial balance or balance sheet. Everything in "Cash & Bank", the financial reports and the accounting settings needs one new foundation: a **double-entry-lite ledger** (section 4.4). Build that first; most new reports become queries over it.

## 1.3 Gap matrix: every feature you listed

### Transactions & masters

| # | Vyapar feature | Ledgora status | Work |
|---|---|---|---|
| 1 | Add Party | 🟡 clients exist | Party groups, credit limit, shipping addresses, multiple contacts, party-wise rate list, opening balance with To-Collect/To-Pay, party-wise TDS/TCS flags |
| 2 | Add Items | 🟡 | Item category, item type (product/service), SAC, MRP, wholesale price, min stock, location, batch/serial, barcode, item image, alternate units + conversion, opening stock with date |
| 3 | Sales (invoice, estimate, order, challan, return) | ✅ | Add: payment-in at time of sale, multiple payment modes per invoice, salesman field, shipping/additional charges, round-off setting |
| 4 | Purchase bills | 🟡 | Add: payment-out at time of bill, additional charges, purchase-side RCM, ITC eligibility flag, bill attachment |
| 5 | Payment Out | 🆕 | New voucher screen mirroring Receipt, allocating to purchase bills |
| 6 | Expense (+ Other Income) | 🟡 | Expense items, payment mode/bank, GST on expense, category report; Other Income is new |
| 7 | Purchase Order | 🆕 | Convertible to Purchase Bill; mirror of Sales Order |
| 8 | Purchase Return / Debit Note | 🆕 | Reduces stock and ITC; GSTR-3B 4(A)/4(B) and GSTR-1 CDNR impact |
| 9 | Cash & Bank: Bank Accounts | 🟡 | `payment_accounts` becomes a real ledger account with opening balance, transactions, statement |
| 10 | Cash in Hand | 🆕 | System cash account, adjust cash |
| 11 | Cheques | 🆕 | Received/issued cheque register, status (open, deposited, cleared, bounced), reminders |
| 12 | Loan Accounts | 🆕 | Loan master, EMI/interest, processing fee, repayment, loan statement |
| 13 | Bank-to-bank transfer, adjust bank balance | 🆕 | Ledger entries |

### Reports

| Group | Reports | Status |
|---|---|---|
| Transaction | Sale, Purchase, Day Book, All Transactions, Profit & Loss, Bill Wise Profit, Cash Flow, Trial Balance, Balance Sheet | P&L ✅ (extend); rest 🆕 |
| Party | Party Statement, Party-wise P&L, All Parties, Party Report by Item, Sale/Purchase by Party, Sale/Purchase by Party Group | Outstanding ✅; rest 🆕 |
| GST | GSTR-1, GSTR-2 (purchase register / 2B), GSTR-3B, GST Rate Report, HSN summary, SAC report, Form 27EQ, Sale/Purchase with GST | GSTR-1/3B/2B ✅; HSN partial; SAC, 27EQ, GST Rate 🆕 |
| Income tax | ITR summary, advance tax, TDS receivable/payable | ✅ ITR; TDS ledger 🆕 |
| Item / Stock | Stock Summary, Item Report by Party, Item-wise P&L, Item Category-wise P&L, Low Stock Summary, Stock Detail, Item Detail, Sale/Purchase by Item Category, Stock Summary by Item Category, Item-wise Discount | Stock summary ✅; rest 🆕 |
| Bank | Bank Statement, Discount Report | 🆕 |
| Expense | Expense, Expense Category, Expense Item | 🆕 |
| Orders | Sale Order, Sale Order Item | 🆕 |
| Loan | Loan Statement | 🆕 |

### Utilities & settings

| Feature | Status |
|---|---|
| Backup (local file + Google Drive) | 🟡 Drive exists; add local encrypted file, auto-backup schedule, restore |
| Import Items (barcode / Excel / library) | 🟡 CSV exists; add the 3-method chooser |
| Import Parties | 🟡 CSV exists; add Excel template + preview |
| Update Items in Bulk | ✅ `ProductBulkEdit` (extend fields) |
| Export Items | ✅ |
| Barcode Generator | 🆕 |
| Setup My Business | 🟡 `SetupWizard` exists; add checklist hub |
| Account Access (users, roles, who-sees-what) | ✅ team + permissions; add per-feature matrix UI |
| Track Your Salesman | 🆕 |
| Export to Tally | 🆕 (roadmap item #10 in COMPETITOR_GAPS) |
| Verify My Data | 🆕 |
| Close Financial Year | 🆕 |
| Settings: General, Transaction, Print, Taxes, GST, Transaction Message, Party, Item, Service Reminder, Accounting, Multi Currency | 🟡 4 tabs today → 11 tabs |

## 1.4 Information architecture and navigation

Ledgora's current sidebar is Sell / Stock and buying / Reports and tax with 9 entries. Move to a Vyapar-style grouped sidebar. Existing route ids are kept so bookmarks and the router (`app/router.tsx`) keep working.

```text
┌─────────────────────────┐
│ [Open Anything  ⌘F]     │   ← CommandPalette (exists, rename placeholder)
│ 🏠 Home                 │   /                   (AnalyticsDashboard)
│ 👥 Parties           ▾  │   /parties, /parties/groups, /parties/import
│ 🛍 Items            (+) │   /products  (+ opens Add Item)
│ 🧾 Sale              ▾  │   Overview · Quotation · Sale Order · Challan ·
│                         │   Invoice · Proforma · Payment In · Sale Return ·
│                         │   Recurring
│ 🛒 Purchase & Expense▾  │   Purchase Bills · Payment Out · Purchase Order ·
│                         │   Purchase Return/Debit Note · Expenses · Other Income
│ 📈 Grow Your Business▾  │   Salesman tracking · Reminders · Online catalog link ·
│                         │   Share on WhatsApp  (see 4.x)
│ 🏦 Cash & Bank       ▾  │   Bank Accounts · Cash in Hand · Cheques ·
│                         │   Loan Accounts · Transfers
│ 📊 Reports              │   /reports  (hub, 8 groups)
│ 🔄 Sync, Share & Backup▾│   Backup · Restore · Auto-backup · Share data
│ 🛠 Utilities         ▾  │   Import Items · Import Parties · Bulk Update ·
│                         │   Export Items · Barcode · Verify Data ·
│                         │   Export to Tally · Close Financial Year · Trash
│ ⚖ Taxes             ▾  │   GST Returns · Income Tax · TDS/TCS   ← Ledgora addition
│ ⚙ Settings              │   11 tabs
│ ★ Plans & Pricing       │
│ ───────────────────     │
│ [ My Company        ›]  │   business/branch switcher (exists)
└─────────────────────────┘
```

Differences from Vyapar, on purpose:

- **Taxes group** stays as its own top-level group. GST Returns and Income Tax are Ledgora's strengths; Vyapar buries GST under Reports.
- The first-run "Make your first sale" split screen (screenshot 3) becomes the **Home empty state** for a business with zero invoices.

### Global desktop shell

```text
┌──────────┬───────────────────────────────────────────────────────────────────────┐
│ Sidebar  │ ● Enter Business Name  (breadcrumb/title)    [FY 2026-27 ▾] 🔔 👤     │
│ 240px    ├───────────────────────────────────────────────────────────────────────┤
│          │  Page header:  Title                         [Secondary] [ + Primary ] │
│          ├───────────────────────────────────────────────────────────────────────┤
│          │  Filters bar:  [Period ▾][Party ▾][Search…]                [Export ▾] │
│          │  ┌─────────────────────────────────────────────────────────────────┐   │
│          │  │ Content (table / form / split preview)                          │   │
│          │  └─────────────────────────────────────────────────────────────────┘   │
│          ├───────────────────────────────────────────────────────────────────────┤
│          │  Sticky footer (forms only):                         [Cancel] [ Save ] │
└──────────┴───────────────────────────────────────────────────────────────────────┘
```

Shell rules: sidebar collapses to icons (exists: auto-hide); every list has the same filter bar and an Export menu (PDF / Excel / Print / Share) reusing `features/import-export`; every form has a sticky footer with **Save**, **Save & New**; `Ctrl/⌘+S` saves, `Ctrl/⌘+F` opens "Open Anything" search.

### Global conventions used by all screens below

- **Money**: `numeric(14,2)` (`money()` in `schema/common.ts`), INR default; amounts right-aligned.
- **Dates**: `dd-MM-yyyy` display, ISO storage. Financial year switcher in the top bar (Apr–Mar).
- **Status chips**: Paid (green), Partial (amber), Unpaid (red), Cancelled (grey), Overdue (red outline).
- **Row actions** (⋮): View, Edit, Duplicate, Print, Share (WhatsApp/Email), Convert, Cancel, Delete (to Trash).
- **Permissions**: each screen maps to a permission key in `packages/contracts/src/permissions.ts` (`<module>.view|create|edit|delete|export`).
- **Every transaction** writes: a document row, stock movements (if it touches stock), and, after the ledger lands, ledger entries (section 4.4).

---

# PART 2: Core Screens (Desktop Wireframes, Fields, GST / Income Tax Links)

Each screen lists: **Status → Wireframe → Fields → Behaviour → GST link → Income Tax link**.

## 2.1 Home (Dashboard + first-sale onboarding)

**Status**: ✅ `AnalyticsDashboard` exists. 🆕 first-sale empty state (screenshot 3).

```text
┌ Home ──────────────────────────────────────────────────────────────────────────────┐
│ [This Month ▾]                                   [+ Add Sale] [+ Add Purchase] [+ Expense] │
│ ┌ To Collect ────┐ ┌ To Pay ────────┐ ┌ Cash + Bank ───┐ ┌ This month sale ─┐ │
│ │ ₹ 1,24,000 ↑   │ │ ₹ 56,200       │ │ ₹ 3,10,400     │ │ ₹ 4,80,000  ▂▃▅▇ │ │
│ └────────────────┘ └────────────────┘ └────────────────┘ └──────────────────┘ │
│ ┌ Sales vs Purchase (bar, 12 mo) ──────────────┐ ┌ Top parties ──────────────┐ │
│ └──────────────────────────────────────────────┘ └───────────────────────────┘ │
│ ┌ Compliance ───────────────────────────────────────────────────────────────┐ │
│ │ GSTR-1 due 11-Nov [Prepare]   GSTR-3B due 20-Nov [Prepare]   Advance tax 15-Dec │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│ ┌ Low stock (5) ───────┐ ┌ Cheques due (2) ─────┐ ┌ Payment reminders (7) ───┐ │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**Empty state (no sale yet)**, from screenshot 3:

```text
┌ Enter details to make your first Sale 🚀 ─────────────┬ 1Cr+ businesses… ──────────┐
│ First sale is made in less than a minute              │  ┌ TAX INVOICE (live preview)┐│
│ ◉ Invoice Details        ◉ Bill To                    │  │ Bill To      Invoice #1   ││
│   Invoice Number: 01       Customer Name* [__________]│  │ # Item  Qty Price GST Amt ││
│   Invoice Date: 06-11-2026                            │  │ …                         ││
│ [ + Add Sample Item ]  (dashed drop target)           │  │ Sub Total / SGST@9% /     ││
│ ◉ Invoice Calculation                                 │  │ CGST@9% / Total / Balance ││
│   Invoice Amount* [₹ 0.00]   Received [₹ 0.00]        │  └───────────────────────────┘│
│   Balance                              ₹ 0.00         │                              │
│            [ Create Your First Invoice ]              │                              │
└───────────────────────────────────────────────────────┴──────────────────────────────┘
```

| Field | Type | Rule |
|---|---|---|
| Invoice Number | auto | from `number_series`, read-only here |
| Invoice Date | date | default today |
| Customer Name\* | autocomplete / create inline | creates a Party |
| Add Sample Item | button | inserts a demo item "Sample Item ₹1000 @18%" |
| Invoice Amount\* | money | computed from items, editable if no items |
| Received | money | creates Payment In if > 0 |
| Balance | computed | amount − received |

GST link: first invoice reads business GSTIN/state from onboarding. If the GSTIN is missing, show a non-blocking banner "Add GSTIN to issue Tax Invoices".

## 2.2 Parties

### 2.2.1 Parties list (customers and suppliers)

**Status**: 🟡 (`ClientsView`). Rename to Parties, add groups, balances, filters.

```text
┌ Parties ───────────────────────────────────────────────────────────────────────────┐
│ [Search party / phone / GSTIN…]  [Group ▾] [Type: All|Customer|Supplier ▾] [Import] [+ Add Party] │
│ ┌ Summary ─ To Collect ₹1,24,000 ↑ ──── To Pay ₹56,200 ↓ ──── Total parties 48 ─┐ │
│ ├────┬────────────────┬──────────┬─────────────┬──────────┬───────────┬──────────┤ │
│ │ ☐  │ Party name     │ Group    │ Phone       │ GSTIN    │ Balance   │ ⋮        │ │
│ │ ☐  │ Ravi Traders   │ Retail   │ 98xxxxxx01  │ 33AAAA…  │ ₹12,000 ↑ │ ⋮        │ │
│ │ ☐  │ Om Supplies    │ Vendors  │ 99xxxxxx22  │ 29BBBB…  │ ₹4,500 ↓  │ ⋮        │ │
│ └────┴────────────────┴──────────┴─────────────┴──────────┴───────────┴──────────┘ │
│ Selected (2): [Send reminder] [Change group] [Delete]                               │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Row click opens the **Party Detail** (2.2.3).

### 2.2.2 Add / Edit Party (modal, 3 tabs)

```text
┌ Add Party ───────────────────────────────────────────────────────── [×] ┐
│ [ Party Details ] [ GST & Address ] [ Credit & Other ]                  │
│ ─────────────────────────────────────────────────────────────────────── │
│ Party Name*  [_______________]    Party Type* (●Customer ○Supplier ○Both)│
│ Phone  [__________]  Email [______________]  Contact person [_________] │
│ Party Group [Retail ▾ +]          Opening Balance [₹ 0.00] (○To Collect ○To Pay) │
│ As-of date [06-11-2026]                                                 │
│ ─────────────────────────────────────────────────────────────────────── │
│ GSTIN [__________] [Get Details ⟳]   GST Type [Registered Regular ▾]    │
│ PAN [________]   State* [Tamil Nadu ▾]  (Place of supply)               │
│ Billing address [____________]  City [____] PIN [______]                 │
│ [☑ Shipping address same]  Shipping address(es) [+ Add another]          │
│ ─────────────────────────────────────────────────────────────────────── │
│ Credit limit [₹ ___] (○ No limit ○ Warn ○ Block)   Payment terms [30 days ▾] │
│ Party-wise item rates [Manage]   TDS applicable [☐] section [194Q ▾]    │
│ TCS applicable [☐]   Additional fields (up to 4 custom): [____][____]   │
│ Notes [____________]                                                    │
│                                         [Cancel]  [Save & New] [ Save ] │
└─────────────────────────────────────────────────────────────────────────┘
```

| Field | Type | Validation / source |
|---|---|---|
| Party Name\* | text | unique per business (case-insensitive) |
| Party Type | enum | maps to `parties.kind` customer / supplier / both |
| Phone, Email, Contact person | text | phone 10-digit IN; email RFC |
| Party Group | FK `party_groups` 🆕 | free list, create inline |
| Opening Balance + direction + as-of date | money, enum, date | stored in `parties.opening_balance` (signed: + to collect, − to pay) 🟡 |
| GSTIN | text 15 | checksum via `tax-engine/gstin.ts` ✅; auto-fills state from first 2 digits |
| GST Type | enum | Registered Regular / Composition / Unregistered / Consumer / SEZ / Overseas. Today `is_sez` is a boolean 🟡, widen to enum `gst_type` |
| PAN | text 10 | derived from GSTIN chars 3–12 when present |
| State\* | enum | drives CGST+SGST vs IGST (place of supply) ✅ |
| Billing / Shipping addresses | text, 1..n | 🆕 `party_addresses` table |
| Credit limit + mode | money, enum | checked on save of invoice |
| Payment terms | days | default due date |
| Party-wise item rates | grid | 🆕 `party_item_rates` |
| TDS / TCS flags + section | bool, enum | feed TDS/TCS report and Form 27EQ |
| Custom fields | 4× text | `extra` jsonb ✅ |

GST link: GST Type + State decide tax split, GSTR-1 section (B2B / B2CL / B2CS / EXP / SEZ), and whether the party appears in GSTR-2B reconciliation.
Income Tax link: opening balances and party balances feed the Balance Sheet; TDS flag marks receipts as TDS-deducted for §26AS reconciliation.

### 2.2.3 Party Detail (statement view)

```text
┌ ← Ravi Traders  [Retail]        📞 98xxxxxx01   GSTIN 33AAAA0000A1Z5      [Edit] [⋮] │
│ ┌ Balance ─────────┐ ┌ Credit limit ┐ ┌ Last txn ┐   [+ Sale] [+ Payment In] [Remind]│
│ │ ₹12,000 To Collect│ │ ₹50,000      │ │ 02-11-26 │                                  │
│ ├ Transactions ┬ Profitability ┬ Ledger ┬ Details ───────────────────────────────────│
│ │ Type    │ Number │ Date     │ Total  │ Balance │ Status │                          │
│ │ Sale    │ INV-12 │ 02-11-26 │ 8,260  │ 8,260   │ Unpaid │                          │
│ │ Pmt In  │ RCT-4  │ 30-10-26 │ 5,000  │ —       │        │                          │
│ └────────────────────────────────────────────────────────────────────────────────  │
│ [Download statement PDF] [Share on WhatsApp]                                        │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Profitability tab = Party-wise P&L (report 3.x). Ledger tab = Party Statement.

### 2.2.4 Party Groups, Import Parties

- **Party Groups** (modal list): Name\*, parent group (optional). Used by "Sale/Purchase by Party Group".
- **Import Parties** (utility): 3-step wizard. *Download template* → *Upload .xlsx/.csv* → *Preview with errors (row, column, reason)* → *Import*. Fields: Name\*, Phone, Email, GSTIN, State, Address, City, PIN, Opening Balance, Balance type, Group, Credit limit, Party type. Duplicates by name or GSTIN: Skip / Update / Create anyway. ✅ CSV engine exists in `BulkCsvImport.jsx`; add xlsx parsing and template.

## 2.3 Items

### 2.3.1 Items list

**Status**: 🟡 `InventoryView`.

```text
┌ Items ─────────────────────────────────────────────────────────────────────────────┐
│ [Search…] [Category ▾] [Stock: All|Low|Out ▾] [Type: Product|Service]  [Import ▾] [+ Add Item] │
│ ┌ Stock value ₹4,12,000 ┐ ┌ Low stock 5 ┐ ┌ Items 132 ┐                           │
│ ├ Item        │ Code │ Category │ Sale ₹ │ Purchase ₹ │ Stock │ Value ₹ │ ⋮ ───────│
│ │ Pen Blue    │ P01  │ Stationery│ 10    │ 6          │ 120   │ 720     │          │
│ │ Web Design  │ S01  │ Services │ 5,000  │ —          │ —     │ —       │          │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Item detail side-drawer: transactions of that item (sale / purchase / adjust), stock-over-time, party-wise rates.

### 2.3.2 Add / Edit Item (modal, 3 tabs)

```text
┌ Add Item ─────────────────────────────────────────── (●Product ○Service) [×] ┐
│ [ Basic ] [ Pricing & Tax ] [ Stock & Other ]                                  │
│ Item Name* [__________]   Item Code/SKU [____] [Generate barcode ▮▮▮]         │
│ Category [Stationery ▾ +]   Unit* [PCS ▾]  [+ Alternate unit]  1 BOX = [12] PCS│
│ HSN/SAC [____] [🔍 Search HSN]   Description [_______________]   Image [Upload]│
│ ─────────────────────────────────────────────────────────────────────────────── │
│ Sale price [₹ ___] (○ with tax ○ without tax)   Discount [__ %|₹]              │
│ Wholesale price [₹ __] Min qty [__]     MRP [₹ __]                              │
│ Purchase price [₹ ___] (○ with tax ○ without tax)                               │
│ GST rate* [18% ▾]   Cess [__ %]   Tax-exempt [☐] Nil-rated [☐] Non-GST [☐]      │
│ ─────────────────────────────────────────────────────────────────────────────── │
│ Opening stock [___]  At price [₹ __]  As-of [date]   Location [____]            │
│ Minimum stock to maintain [___]  (low-stock alert)   Track stock [☑]             │
│ Batch no. / Mfg / Exp [☐ track]   Serial numbers [☐ track]                       │
│                                            [Cancel] [Save & New] [ Save ]        │
└────────────────────────────────────────────────────────────────────────────────┘
```

| Field | Type | DB / note |
|---|---|---|
| Name\*, SKU, HSN, Unit, prices, tax %, cess %, track stock | ✅ | existing `items` columns |
| Item type | enum product/service | 🆕; service hides stock section and uses **SAC** |
| Category | FK `item_categories` | 🆕 (needed by 5 reports) |
| Alternate unit + conversion | 🆕 `item_units` | 1 BOX = 12 PCS |
| MRP, wholesale price, min qty | money | 🆕 |
| Price includes tax toggles | bool ×2 | 🆕 per item default |
| Tax category | enum taxable/exempt/nil/non-GST | 🆕; drives GSTR-1 Table 8 and 3B 3.1(c)/(e) |
| Opening stock | via `stock_movements(reason='opening')` ✅ | |
| Min stock | qty | 🆕 low-stock report |
| Batch / expiry / serial | 🆕 `item_batches`, `item_serials` | optional per item |
| Barcode | text | 🆕 generated/printed by Barcode Generator |

GST link: HSN/SAC + GST rate + tax category flow to every invoice line, GSTR-1 HSN summary (Table 12), SAC report, and ITC eligibility on purchase.
Income Tax link: stock valuation (closing stock) enters P&L and Balance Sheet; item cost drives Item-wise P&L and §44AD "books not maintained" thresholds.

### 2.3.3 Other item screens

- **Import Items** (screenshot 2): the method chooser. Three cards: **Import From Barcode** (Recommended; camera/scanner; needs a barcode-to-product library, so integrate a third-party GTIN dataset or fall back to manual), **Import From Excel**, **Import From Library** (starter catalog by business type, shipped as JSON). Bottom bar: **Continue**. 🟡 only Excel/CSV exists. The barcode and library cards are 🆕.
- **Update Items in Bulk** ✅ extend columns: price, tax, HSN, category, min stock, unit; preview diff; apply.
- **Export Items** ✅ XLSX/CSV, with a "stock as-of date" option.
- **Categories** modal: Name\*, parent.
- **Units** modal: Name\*, short code\*, conversions (`units` table ✅).
- **Stock Adjust** modal: Item\*, Add/Reduce, Qty\*, At price, Date, Remarks → writes `stock_movements(reason='adjustment')` ✅.

## 2.4 Sale menu

Existing route ids kept: `sales`, `sales-quotes`, `sales-orders`, `sales-challans`, `sales-invoices`, `sales-proforma`, `sales-credit`, `receipts`, `recurring`.

### 2.4.1 Sales list pages (all document types share one layout)

**Status**: ✅

```text
┌ Invoices ─────────────────────────────────────────────────────────────────────────┐
│ [This Month ▾] [Party ▾] [Status ▾] [Payment mode ▾] [Search…]   [Export ▾] [+ Add Sale] │
│ ┌ Total ₹4,80,000 ┐ ┌ Paid ₹3,10,000 ┐ ┌ Unpaid ₹1,70,000 ┐                          │
│ ├ Date │ Invoice# │ Party │ Txn type │ Payment type │ Amount │ Balance │ Status │ ⋮ ─│
└───────────────────────────────────────────────────────────────────────────────────┘
```

Row ⋮ → View/Print, Edit, Duplicate, **Receive payment**, **Convert to** (per `salesFlow.js`), Create Credit Note, Generate E-Way Bill, Cancel, Delete.

### 2.4.2 Add Sale: invoice editor

**Status**: ✅ `InvoiceEditorPage` (Customer → Details → Items → Terms). 🆕 listed additions.

```text
┌ Add Sale  [Tax Invoice ▾]        (○Credit ●Cash)                  [⚙ Invoice settings] ┐
│ ┌ Bill To ───────────────────────┐  ┌ Invoice Details ───────────────────────────┐   │
│ │ Party* [Ravi Traders ▾ +]      │  │ Invoice No [INV-26-27/001]  Date [06-11-26]│   │
│ │ Phone  [98xxxxxx01]            │  │ Due date [06-12-26] (terms 30d)            │   │
│ │ Billing [____________]         │  │ Place of supply* [Tamil Nadu ▾]            │   │
│ │ Ship to [Same ▾]               │  │ PO no/date [____] E-way bill no [____]     │   │
│ │ Balance: ₹12,000 To Collect    │  │ Salesman [Kumar ▾] 🆕  Reverse charge [☐]  │   │
│ └────────────────────────────────┘  └────────────────────────────────────────────┘   │
│ ┌ Items ─────────────────────────────────────────────────────────────────────────┐   │
│ │ # │ Item (scan/search) │HSN│ Qty │Unit│ Price/unit │ Disc %│ Disc ₹│ GST % │ Amount│ ✕│
│ │ 1 │ Pen Blue           │…  │ 10  │PCS │ 10.00      │ 0     │ 0     │ 18    │ 118   │  │
│ │ [+ Add row]   Total qty 10                     Total disc 0     Total tax 18 │ 118 │   │
│ └────────────────────────────────────────────────────────────────────────────────┘   │
│ ┌ Additional charges ─────┐ ┌ Totals ─────────────────────────────────────────────┐   │
│ │ Shipping [₹ __] GST[18%]│ │ Sub total                                  ₹ 100.00 │   │
│ │ Packaging [₹ __]        │ │ Discount [__ %|₹]                          ₹   0.00 │   │
│ │ [+ Add charge]          │ │ CGST@9%  ₹9.00   SGST@9%  ₹9.00  (or IGST)          │   │
│ │ TCS [__%] Round off [☑] │ │ Round off                                  ₹   0.00 │   │
│ └─────────────────────────┘ │ TOTAL                                      ₹ 118.00 │   │
│  Payment: Mode [Cash ▾] Account [Cash in hand ▾] Received [₹ 118]   Balance ₹0.00   │   │
│  [+ Add payment mode]  Reference/Cheque no [____]                                   │   │
│  Terms & notes [____]  Attach [📎]  Signature ☑   Description [___]                  │   │
│            [Share ▾] [Print ▾]  [Save & New]  [ Save ]    ← live preview pane toggle │   │
└────────────────────────────────────────────────────────────────────────────────────┘
```

| Field | Type | Rule / source |
|---|---|---|
| Party\* | FK | required for credit sale; optional for cash sale ("Cash Sale" walk-in) |
| Invoice type | enum | ✅ `INVOICE_TYPES` (tax-invoice, bill-of-supply, composition, quotation, sales-order, delivery-challan, proforma, credit-note) |
| Number, date, due date | ✅ | `number_series`; due = date + party terms |
| Place of supply\* | state | decides CGST/SGST vs IGST ✅ |
| PO no/date, E-way bill no, vehicle no | text | ✅ partly |
| Salesman | FK `staff` 🆕 | Track Your Salesman |
| Reverse charge | bool | ✅ planned (COMPETITOR_GAPS #2) |
| Line: item, HSN, qty, unit, rate, discount % and ₹, tax %, cess, batch/serial | ✅ | `invoice_lines`; add batch/serial 🆕 |
| Additional charges (named, with own GST %) | 🆕 `data.charges[]` | feeds GST as a taxable supply at the rate given |
| TCS %, round-off | ✅ | TCS on sale §206C(1H) |
| Payments: multiple rows (mode, account, amount, ref) | 🟡 | 🆕: today receipts are separate; create `payments` rows inline with the invoice |
| Terms, notes, attachments, signature, description | ✅ / 🆕 attachments | `files` table ✅ |
| Transaction-level discount | ✅ | `DiscountControls` |

Behaviour: totals via `tax-engine/totals.ts` ✅; saving a tax invoice reduces stock (unless service) and posts ledger entries (Dr Party/Cash/Bank, Cr Sales, Cr Output GST). Credit limit check runs on save. E-way bill prompt when value > ₹50,000.

GST link: GSTR-1 (B2B/B2CL/B2CS/CDNR/EXP/Nil), HSN summary, 3B 3.1, e-way bill JSON ✅, e-invoice IRN (roadmap).
Income Tax link: net of GST = business turnover for §44AD / ITR; payment mode "cash" counts toward §269ST (₹2 lakh cash) warning 🆕.

### 2.4.3 Payment In

**Status**: ✅ `ReceiptVoucher`, extend with bank/cheque.

```text
┌ Payment In ──────────────────────────────────────────────────────────┐
│ Party* [Ravi Traders ▾]    Receipt No [RCT-004]   Date [06-11-2026]  │
│ Payment type [Cash ▾ | UPI | Bank | Cheque | Card]  Account [HDFC ▾] │
│ Reference [______]  Cheque date [____] (cheque only)                 │
│ Received [₹ 5,000]   Discount [₹ 0]   TDS deducted [₹ 0] 🆕          │
│ ┌ Link to invoices ─────────────────────────────────────────────┐    │
│ │ ☑ INV-12  02-11-26  Total 8,260  Pending 8,260  Settle [5,000]│    │
│ │ [Auto-allocate oldest first]            Unallocated: ₹ 0       │    │
│ └───────────────────────────────────────────────────────────────┘    │
│ Notes [____]  Attach [📎]                     [Cancel]  [ Save ]     │
└──────────────────────────────────────────────────────────────────────┘
```

Fields: Party\*, receipt no, date, mode, account, reference, cheque date, amount\*, discount, **TDS deducted** (🆕, reduces receivable, posts TDS Receivable asset), allocations ✅ (`payment_allocations`), notes, attachment. Unallocated stays as party advance ✅.
GST link: advance receipt on goods/services needs GSTR-1 Table 11 (advances) 🆕. Income Tax link: TDS deducted accumulates into the TDS Receivable ledger to claim in ITR / §26AS.

### 2.4.4 Sale Return / Credit Note, Delivery Challan, Quotation, Sale Order, Proforma

✅ All exist via the same editor. Additions:
- **Credit Note**: Against Invoice ✅, return reason enum (Sales return, Post-sale discount, Deficiency, Correction, Others), restocking toggle, refund mode (adjust balance / cash / bank). Appears in GSTR-1 CDNR/CDNUR.
- **Sale Order**: Advance received, Expected delivery, status (Open, Partially invoiced, Closed, Cancelled) 🆕 → feeds **Sale Order Report**.
- **Quotation**: validity, convert ✅.
- **Challan**: stock out on save ✅, invoice conversion ✅.

### 2.4.5 Recurring ✅
Unchanged; add "Auto-send WhatsApp/email" (roadmap #11).

## 2.5 Purchase & Expense menu

### 2.5.1 Purchase Bills

**Status**: 🟡 `PurchaseBills.jsx`.

```text
┌ Add Purchase ───────────────────────────────────────────────────────────────────┐
│ Supplier* [Om Supplies ▾ +]  Bill No* [____] Bill date [__] Our ref [PUR-001]   │
│ Place of supply [__ ▾]  Due date [__]  Reverse charge [☐]  Original bill [📎]    │
│ Items: # │ Item │ HSN │ Qty │ Unit │ Rate │ Disc │ GST % │ ITC [Eligible ▾] │ Amount │
│ Additional charges [+]   TDS §194Q [☐] __%   Round off [☑]                        │
│ Totals: Taxable · CGST · SGST · IGST · Cess · Round · TOTAL                       │
│ Payment: Mode [Cash ▾] Account [___] Paid [₹ ___]  Balance ₹ ___                  │
│                                    [Save & New] [ Save ]                          │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Fields beyond existing: ITC eligibility per line (Eligible / Ineligible §17(5) / Capital goods / Blocked) 🆕, reverse charge, TDS §194Q, payment rows 🆕, bill scan (OCR, flag `billScan` off until server job lands).
Behaviour: saving adds stock (`reason='purchase'` ✅), posts ledger (Dr Purchases, Dr Input GST, Cr Supplier/Cash/Bank).
GST link: ITC in GSTR-3B Table 4, GSTR-2B reconciliation ✅ (match on supplier GSTIN + bill no + amount), RCM liability 3.1(d). Income Tax link: purchases are deductible cost; TDS §194Q on purchases above ₹50 lakh to a supplier.

### 2.5.2 Payment Out 🆕

Mirror of Payment In 2.4.3 with Supplier, allocation to purchase bills, **TDS deducted by us** (§194C/194J/194Q, posts TDS Payable), mode and account. Table `payments` gets `direction` ('in' | 'out'); `payment_allocations` gains `purchase_id`.

### 2.5.3 Purchase Order 🆕

Same layout as Add Purchase, without stock/GST impact. Extra fields: PO No, Expected delivery, Status (Open / Partially received / Received / Cancelled), Advance paid. Row action **Convert to Purchase Bill** (carries lines; status → Closed). Table: reuse `invoices` pattern with a new `purchase_orders` + lines pair (or `purchases.doc_type`).

### 2.5.4 Purchase Return / Debit Note 🆕

```text
┌ Debit Note / Purchase Return ───────────────────────────────────────────────────┐
│ Supplier* [__]  Return No [DN-001]  Date [__]  Against bill [Om-221 ▾]           │
│ Reason [Purchase return ▾ | Rate difference | Quality | Other]                   │
│ Items (picked from the bill, qty ≤ billed) …  Totals …  Refund: [Adjust ▾ | Cash | Bank] │
│                                                         [Cancel] [ Save ]        │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Behaviour: stock out (`reason='purchase_return'`), reduces supplier payable. GST link: reverses ITC in GSTR-3B 4(B)(2) / reported in GSTR-1 as supplier-side CDN is the supplier's job, ours is the ITC reversal. Income Tax link: reduces purchase cost.

### 2.5.5 Expenses and Other Income

**Status**: 🟡 `ExpenseTracker.jsx`.

```text
┌ Add Expense ────────────────────────────────────────────────────────────────────┐
│ Expense No [EXP-001] Date [__]   Category* [Rent ▾ +]   Party/Payee [optional ▾]  │
│ Items: # │ Expense item │ Qty │ Rate │ GST % │ Amount      (or single amount)     │
│ Total [₹ ___]  GST paid [₹ __] (ITC eligible ☑)  Payment: [Cash ▾] account [__]   │
│ Description [_____]  Attach receipt [📎]                       [ Save ]           │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Fields: number, date, category\*, payee, item rows (🆕 `expense_items`: name, HSN/SAC, default rate, GST), amount, GST, ITC flag, payment mode/account, description, attachment. **Other Income** is the same screen with *Income category* (Interest, Commission, Rent received, Misc) and *Income item*; posts Cr Other Income.
GST link: expense GST with ITC flag → GSTR-3B 4(A). Income Tax link: category → deductible business expense; Other Income → "Income from other sources" in ITR; bank interest detection already in the bank-statement importer ✅.

---

# PART 3: Cash & Bank, Cheques, Loans, Reports

## 3.1 Cash & Bank

### 3.1.1 Bank Accounts

**Status**: 🟡 `payment_accounts` exists only as print details. Promote it to a ledger account.

```text
┌ Bank Accounts ───────────────────────────────────────────────── [+ Add Bank Account] ┐
│ ┌──────────────┬──────────────┬────────────┬────────────┬───────────────────────┐    │
│ │ Account name │ Bank / A/c   │ Balance    │ Last txn   │ Default for invoices  │    │
│ │ HDFC Current │ HDFC ••4521  │ ₹2,40,100  │ 05-11-26   │ ●                     │    │
│ └──────────────┴──────────────┴────────────┴────────────┴───────────────────────┘    │
│ Row click → Bank Account Detail (transactions list, Statement, Deposit, Withdraw,   │
│             Transfer, Adjust balance)                                               │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**Add Bank Account modal**

| Field | Type | Note |
|---|---|---|
| Account display name\* | text | ✅ `label` |
| Opening balance, as-of date | money, date | 🆕 posts opening ledger entry |
| Bank name, Account holder, Account no., IFSC, SWIFT, Account type, UPI id | text | ✅ existing columns |
| Print on invoices | bool | 🆕 (today implicit via `isDefault`) |
| Print UPI QR | bool | ✅ |
| Active | bool | ✅ |

**Account detail screen**: transactions (date, description, party, type, in, out, running balance); buttons **Deposit**, **Withdraw**, **Bank to Bank Transfer**, **Adjust Balance**, **Statement** (3.x report).

**Bank-to-Bank / Cash↔Bank Transfer modal**: From\*, To\* (any bank or Cash in Hand), Amount\*, Date, Reference, Notes. Posts two ledger entries, no P&L effect.
**Adjust Bank Balance modal**: Increase/Reduce, Amount, Date, Remarks → posts to "Bank adjustment" (appears in Cash Flow).
**Reconciliation** (bonus 🆕): upload bank statement CSV (parser already exists for income tax: `parseBankStatement` ✅), match to ledger entries, tick cleared.

GST link: none directly; UPI/bank receipts are the evidence for place/time of supply on advances. Income Tax link: Bank interest, bank charges and statement import ✅ feed ITR; bank balances feed Balance Sheet.

### 3.1.2 Cash in Hand

```text
┌ Cash in Hand ──────────────────────────────── Balance ₹48,300 ─ [Adjust Cash] ┐
│ Date │ Description │ Party │ Type │ Cash in │ Cash out │ Running balance       │
└────────────────────────────────────────────────────────────────────────────────┘
```

A system ledger account (cannot be deleted). **Adjust Cash modal**: Add/Reduce, Amount, Date, Remarks. Warning chip when a day's cash receipts from one party exceed ₹2,00,000 (§269ST). Day-end cash count 🆕: Counted [₹], difference posts an adjustment.

### 3.1.3 Cheques 🆕

```text
┌ Cheques ──────────────────────────────────────────────────────────────────────────┐
│ [Received | Issued] [Status: Open ▾] [Date range ▾]                  [+ Add Cheque] │
│ Cheque no │ Party │ Bank/Account │ Amount │ Cheque date │ Status │ Action ────────│
│ 000123    │ Ravi  │ HDFC         │ 8,000  │ 10-11-26    │ Open   │ [Deposit][⋮]   │
└────────────────────────────────────────────────────────────────────────────────────┘
```

| Field | Type |
|---|---|
| Direction | received / issued |
| Party\* | FK |
| Cheque number\* | text |
| Amount\* | money |
| Cheque date\*, post-dated flag | date, derived |
| Bank account (deposit-to / drawn-from) | FK |
| Linked document(s) | invoice/purchase ids via allocation |
| Status | enum: Open → Deposited → Cleared / Bounced / Cancelled |
| Bounce charges | money (posts expense) |
| Reminder days | int |

Behaviour: a cheque taken in Payment In with mode *Cheque* creates an **Open** cheque and *does not* raise bank balance until Deposited → Cleared. A **bounced** cheque reopens the invoice balance and posts bank charges. Dashboard shows "Cheques due in 3 days".
GST / IT link: none directly; delays in clearance matter for ITC timing (payment within 180 days rule §16(2) for supplier payments, so show cheque age on supplier bills 🆕).

### 3.1.4 Loan Accounts 🆕

```text
┌ Loan Accounts ───────────────────────────────────────────────── [+ Add Loan] ┐
│ Lender │ Type │ Principal │ Rate │ Tenure │ EMI │ Outstanding │ Next due │ ⋮   │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Add Loan modal**: Account name\*, Lender, Loan type (Term/Overdraft/Personal/Vehicle/Other), Principal\*, Received in (bank/cash)\*, Interest rate % p.a.\*, Interest type (Reducing / Flat), Tenure (months), EMI (computed, editable), First EMI date, Processing fee, Loan received date, Description.
**Loan detail**: schedule table (due date, EMI, principal part, interest part, balance, status) + buttons **Make Payment** (EMI or part-payment: Principal, Interest, Charges, From account, Date), **Increase Loan** (additional disbursal), **Statement**.
Ledger: Dr Bank, Cr Loan liability on disbursal; EMI: Dr Loan liability (principal), Dr Interest expense, Cr Bank.
Income Tax link: interest paid is a deductible business expense; if the loan is personal housing/education, surface it for §24(b)/§80E in the Regime Calculator deductions ✅.

## 3.2 Reports

### 3.2.1 Reports hub (replaces the 6-button tab strip)

**Status**: 🟡 `ReportsView.jsx` currently switches between P&L, Ageing, Party, Clients, Products, Stock with a button row. Replace with a hub and one route per report (`/reports/:id`), and keep the existing six as first entries.

```text
┌ Reports ──────────────────────────────────────────  [🔍 Search reports…] [★ Favorites] ┐
│ ▸ Transaction            ▸ Party               ▸ GST                ▸ Item / Stock       │
│   Sale                     Party Statement       GSTR-1                Stock Summary      │
│   Purchase                 Party-wise P&L        GSTR-2 / 2B recon     Stock Detail       │
│   Day Book                 All Parties           GSTR-3B               Item Detail        │
│   All Transactions         Party Report by Item  GST Rate Report       Low Stock Summary  │
│   Profit & Loss            Sale/Purchase by Party HSN Summary          Item Report by Party│
│   Bill Wise Profit         Sale/Purchase by       SAC Report           Item-wise P&L      │
│   Cash Flow                  Party Group          Form 27EQ            Item Category P&L  │
│   Trial Balance                                  TDS / TCS Report      Sale/Purchase by   │
│   Balance Sheet                                  Sale/Purchase w/ GST    Item Category    │
│ ▸ Income Tax             ▸ Expense             ▸ Bank / Discount     Stock Summary by     │
│   ITR Summary              Expense                Bank Statement       Item Category      │
│   Advance Tax              Expense Category       Discount Report    Item-wise Discount   │
│   TDS Receivable           Expense Item         ▸ Orders / Loan                          │
│                                                   Sale Order · Sale Order Item           │
│                                                   Loan Statement                          │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2.2 Common report layout (applies to every report below)

```text
┌ <Report name> ───────────────────────────────────────────── [★] [Print] [PDF] [Excel] [Share] ┐
│ Period [01-04-26 → 06-11-26 ▾ (This FY)]  Party [All ▾]  Item [All ▾]  <report filters…>        │
│ [☐ Show columns ▾]   [Group by ▾]                                              [ Apply ]        │
│ ┌ Summary chips ─────────────────────────────────────────────────────────────────────────────┐ │
│ ├ Table (sortable, sticky header, totals row) ───────────────────────────────────────────────┤ │
│ └────────────────────────────────────────────────────────────────────────────────────────────┘ │
│ Click any row → opens the source document.  Footer: "Generated 06-11-2026 by …  Verify data ⟳" │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Shared filters: period presets (Today, This Week/Month/Quarter/FY, Last …, Custom), business/branch, **include cancelled** toggle, **include non-GST** toggle. Exports reuse `TableExport.jsx`, `xlsx.js`, `share.js` ✅.

### 3.2.3 Report specifications

Columns shown are the defaults; users can toggle more. "Src" = data source. "✅/🟡/🆕" as before.

#### Transaction reports

| Report | Status | Extra filters | Columns / content | GST / IT note |
|---|---|---|---|---|
| **Sale** | 🆕 | Party, Txn type (Invoice, Return, Challan, Order…), payment status | Date, Invoice#, Party, Txn type, Payment type, Total, Received, Balance, Taxable, Tax | Basis of GSTR-1 totals |
| **Purchase** | 🆕 | Supplier, type | Date, Bill#, Supplier, Total, Paid, Balance, Taxable, ITC | Basis of ITC |
| **Day Book** | 🆕 | Single date or range | Date, Party, Txn type, Ref no., Total, Money in, Money out; totals; **opening/closing cash** | Audit view |
| **All Transactions** | 🆕 | Txn type multi-select, party | Date, Ref#, Party, Type, Payment type, Total, Balance | |
| **Profit & Loss** | 🟡 | Party, Branch | Sale, Sale return, Other income, Purchase, Purchase return, Direct expenses (+stock opening/closing), **Gross profit**, Indirect expenses, Loan interest, Depreciation, **Net profit**; toggle "with/without tax" | Net profit = starting point for ITR-3/4 and §44AD comparison ✅ |
| **Bill Wise Profit** | 🆕 | Party, date | Date, Invoice#, Party, Sale amt, **Cost (items at purchase price)**, Additional charges, Discount, **Profit**, Profit % | cost = weighted-avg purchase cost |
| **Cash Flow** | 🆕 | Period | Opening cash+bank; Cash in by type (sale, payment-in, other income, loan received); Cash out by type (purchase, payment-out, expenses, loan repay); closing | |
| **Trial Balance** | 🆕 | As-of date | Account group, Account, Debit, Credit; totals must match | needs ledger (4.4) |
| **Balance Sheet** | 🆕 | As-of date | Assets (Cash, Bank, Receivables, Stock, Input GST, TDS receivable, Fixed assets) / Liabilities (Payables, Output GST, TDS payable, Loans) / Equity (Capital, Net profit) | Required for ITR-3 and bank loans |

#### Party reports

| Report | Status | Columns / content |
|---|---|---|
| **Party Statement** | 🟡 (outstanding exists) | Party picker; Date, Txn type, Ref#, Payment type, Debit, Credit, Running balance; opening and closing; **Share/Print as a statement** |
| **Party-wise Profit & Loss** | 🆕 | Party, Phone, Total sale, **Profit/Loss**; row opens party's bill-wise profit |
| **All Parties** | 🆕 | Party, Email, Phone, Group, Address, To-Collect, To-Pay, Credit limit; filter by group/balance type |
| **Party Report by Item** | 🆕 | Party, Item, Sale qty, Sale amt, Purchase qty, Purchase amt |
| **Sale/Purchase by Party** | 🆕 | Party, Sale amount, Purchase amount (toggle) |
| **Sale/Purchase by Party Group** | 🆕 | Group, Sale amount, Purchase amount |
| **Receivable Ageing** | ✅ | existing Ageing tab (0–30, 31–60, 61–90, 90+) |

#### GST reports

| Report | Status | Content |
|---|---|---|
| **GSTR-1** | ✅ | B2B, B2CL, B2CS, CDNR/CDNUR, EXP, Nil/Exempt, HSN (Table 12), Advances (Table 11 🆕); JSON + CSV + filing tick ✅ |
| **GSTR-2 / 2B reconciliation** | ✅ | Purchase register + 2B match ✅ |
| **GSTR-3B** | ✅ | 3.1 (a–e), 4 ITC, 5 exempt, 6 payment; add RCM 3.1(d) detail, ITC reversal 4(B) 🟡 |
| **GST Rate Report** | 🆕 | Rate slab (0/5/12/18/28/Cess), Taxable value, CGST, SGST, IGST, Cess; split sale vs purchase |
| **HSN Summary** | 🟡 | HSN, Description, UQC, Qty, Taxable, Tax by head, Rate |
| **SAC Report** | 🆕 | Same as HSN but for services (items of type service): SAC, Description, Qty, Taxable, Tax, Rate |
| **Sale/Purchase with GST** | 🆕 | Invoice-wise register: GSTIN, POS, Rate, Taxable, CGST, SGST, IGST, Cess, Total |
| **Form 27EQ** (TCS return) | 🆕 ⚠️ | Quarter, Collector TAN, Collectee PAN/name, Nature (§206C), Amount received, TCS collected, Date, Challan (BSR, date, serial). Output: CSV/FVU-ready text for the TIN-NSDL utility. Source: invoices with TCS ✅ (`totals.tcsAmount`) |
| **TDS / TCS Report** | ✅ | Existing `TdsPage`; add deductee-wise Form 26Q-style summary for §194C/J/Q |

#### Item / Stock reports

| Report | Status | Columns |
|---|---|---|
| **Stock Summary** | ✅ | Item, Sale price, Purchase price, Stock qty, Stock value; toggle "as-of date", "hide zero" |
| **Stock Detail** | 🆕 | Item picker + date range: Opening qty, Qty in, Qty out, Closing qty, Value |
| **Item Detail** | 🆕 | Per-item ledger: Date, Txn, Party, Qty in/out, Price, Running stock |
| **Low Stock Summary** | 🆕 | Item, Min stock, Current stock, Shortfall (uses `min stock`) |
| **Item Report by Party** | 🆕 | Item, Party, Sale qty/amt, Purchase qty/amt |
| **Item-wise Profit & Loss** | 🆕 | Item, Sale qty, Sale amt, Purchase amt (cost), Closing stock value, **Profit** |
| **Item Category-wise P&L** | 🆕 | Category rollup of above |
| **Sale/Purchase Report by Item Category** | 🆕 | Category, Qty, Amount (toggle sale/purchase) |
| **Stock Summary by Item Category** | 🆕 | Category, Qty, Value |
| **Item-wise Discount** | 🆕 | Item, Qty sold, Sale amt, Discount amt, Discount % |
| **Product-wise / Client-wise** | ✅ | keep existing tabs, link from hub |

#### Bank, Discount, Expense, Orders, Loan

| Report | Status | Content |
|---|---|---|
| **Bank Statement** | 🆕 | Account picker; Date, Description, Ref, Withdrawal, Deposit, Balance. Needs ledger |
| **Discount Report** | 🆕 | Party, Sale discount, Purchase discount, Payment discount given/received |
| **Expense** | 🆕 | Category, Amount, (with GST) ; detail by date |
| **Expense Category** | 🆕 | Category, Total; drill to expenses |
| **Expense Item** | 🆕 | Item, Qty, Amount |
| **Sale Order** | 🆕 | Order#, Party, Date, Due, Status, Total, Advance |
| **Sale Order Item** | 🆕 | Item, Ordered qty, Delivered/Invoiced qty, Pending qty, Amount |
| **Loan Statement** | 🆕 | Loan picker; Date, Type (Disbursal / EMI / Interest / Charges), Principal, Interest, Balance |

#### Income Tax reports (Ledgora-specific, ✅ largely built)

`IncomeTax.jsx` tabs map into the hub: Regime Calculator, Presumptive §44AD/ADA/AE, Advance Tax (§234B/C), Bank Statement Import, ITR Summary (ITR-4 PDF). New: **TDS Receivable ledger** (from Payment In TDS field), **Cash transaction watch** (§269ST/§40A(3) flags), and **Books-based P&L → ITR-3 field map** once the ledger exists.

## 3.3 Report-implementation plan (how to build 40+ reports without 40 screens)

1. One `ReportShell` component (filters, summary chips, table, export) driven by a **report definition**: `{ id, title, group, filters[], columns[], query }`.
2. One API route `GET /v1/reports/:id?from&to&party&item&…` returning `{ summary, rows, totals }`, implemented as SQL views over `invoices`, `invoice_lines`, `purchases`, `purchase_lines`, `expenses`, `payments`, `stock_movements`, and (after 4.4) `ledger_entries`.
3. Pure aggregation helpers in `packages/tax-engine` (already holds `outstanding.ts`, `stock.ts`) so they are unit-tested like the rest.
4. Reports hub lists definitions; adding a report = adding a definition.

---

# PART 4: Utilities, Settings, Tax Connection Map, Data Model, Roadmap

## 4.1 Sync, Share & Backup

**Backup / Restore screen** (🟡: Google Drive PDF backup + export exist)

```text
┌ Backup ──────────────────────────────────────────────────────────────────────────┐
│ Last backup: 05-11-2026 21:10  (Drive)    [ Back up now ]                        │
│ ◉ Local file   [Choose folder…]  [☑ Encrypt with password]  [Download .ledgora]  │
│ ◉ Google Drive [Connected: x@gmail.com] [Disconnect]                             │
│ Auto-backup: [Daily ▾] at [21:00]  Keep last [7] backups   Remind me [☑] every [7] days │
│ ─────────────────────────────────────────────────────────────────────────────────│
│ Restore: [Choose backup file…]  ⚠ Replaces current company data. A copy is taken first. │
│ Backup history: Date │ Size │ Where │ [Restore] [Delete]                          │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Fields: destination, encryption password, schedule, retention, reminder. Share data (🆕): share a read-only export to the CA (see Account Access, CA role).

## 4.2 Utilities (one screen per item)

| Utility | Status | Screen / fields | Notes |
|---|---|---|---|
| **Import Items** | 🟡 | Method chooser (screenshot 2): Barcode (Recommended) / Excel / Vyapar-style Library → Continue. Excel path: template → upload → column mapping → preview errors → import | See 2.3.3 |
| **Import Parties** | 🟡 | See 2.2.4 | |
| **Update Items in Bulk** | ✅ | grid of selected items, choose fields, set/increase/decrease, preview diff | extend fields |
| **Export Items** | ✅ | filters, columns, XLSX/CSV | |
| **Barcode Generator** 🆕 | | Items multi-select, **Label size** (A4 65-up, 50×25 mm roll…), Barcode type (Code128 / EAN-13 / QR), Copies per item [= stock qty ☐], Show price/name/MRP toggles, **preview**, Print / PDF | use `jsbarcode`; items without code get an auto code saved back |
| **Verify My Data** 🆕 | | Runs integrity checks and lists issues with **Fix** buttons: negative stock; invoices whose total ≠ lines; payments over-allocated; invoice numbers with gaps/duplicates; parties with GSTIN checksum errors; items without HSN where GST > 0; ledger imbalance (Dr ≠ Cr); orphaned stock movements | pure functions in tax-engine, exposed at `GET /v1/verify`; export result |
| **Export to Tally** 🆕 | | Date range; data types (☑ Sales, ☑ Sales Return, ☑ Purchases, ☑ Purchase Return, ☑ Cancelled); Ledger name mapping (Sales ledger, Output CGST…, Party group = Sundry Debtors/Creditors); Output: **Master XML** + **Voucher XML** (Tally import format) | matches Vyapar's Master+Voucher output; roadmap #10 |
| **Close Financial Year** 🆕 | | Step 1 backup check; Step 2 choose **Change prefix** (e.g. `2026-27/`, restart at 1) or **Start fresh** (closing balances become opening balances, stock carried forward at closing value); Step 3 type the FY to confirm; Step 4 summary | locks previous FY edits unless unlocked by owner |
| **Trash** | ✅ | restore / delete forever | |
| **Open anything / Search** | ✅ | CommandPalette | |

### Close Financial Year wireframe

```text
┌ Close Financial Year ─────────────────────────────────────────────────────────┐
│ Closing: FY 2025-26 (01-04-2025 → 31-03-2026)           ① Backup ② Method ③ Confirm │
│ ○ Change prefix only   New prefix [2026-27/]  numbering restarts at 1            │
│ ● Start new year       Carry forward: [☑ party balances] [☑ stock] [☑ bank/cash] [☑ loans] │
│ Lock closed year   [☑]    Allow edits by: [Owner only ▾]                           │
│ ⚠ This cannot be undone without restoring a backup.                              │
│                                   [Cancel]  [ Close FY 2025-26 ]                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## 4.3 Grow Your Business, Account Access, Setup

### Setup My Business (🟡 `SetupWizard`)
A checklist page with progress: ☑ Business name/logo · ☐ GSTIN & address · ☐ Bank account · ☐ Add first item · ☐ Add first party · ☐ Create first invoice · ☐ Invite team · ☐ Set backup. Each row deep-links to its screen; the wizard auto-ticks as data appears.

### Account Access ✅ (`TeamPage`, permissions) extend
Users table (name, role, branches, status, last login) + **Role matrix**: rows = modules (Parties, Items, Sale, Purchase, Expense, Cash & Bank, Reports, GST, Settings, Utilities), columns = View/Create/Edit/Delete/Export. Preset roles: Owner, Admin, Accountant/CA (read-only + reports + exports), Salesman (own sales only), Staff. Toggles: **hide purchase price**, **hide profit reports**, **restrict to own transactions**.

### Track Your Salesman 🆕

```text
┌ Salesman ────────────────────────────────────────────── [+ Add Salesman] ┐
│ Name │ Phone │ Target (month) │ Sales this month │ Collected │ Commission │
│ ─ Detail: invoices by salesman, collections, outstanding, visit/check-in map (mobile) │
└─────────────────────────────────────────────────────────────────────────┘
```
Fields: Name\*, Phone, Linked user, Commission % or slab, Monthly target. Invoice gets a **Salesman** field (2.4.2). Reports: sales by salesman, collection efficiency. Commission is an expense for Income Tax.

### Grow Your Business menu (what it contains)
- **Payment reminders**: list of overdue invoices, bulk **WhatsApp / SMS / email** with template (variables `{party}`, `{amount}`, `{due_date}`, `{link}`).
- **Online store / catalog link** 🆕 (optional, later): public read-only catalog page.
- **Share invoice** via WhatsApp/PDF link; **Payment link** (Razorpay, roadmap #9).
- **Loyalty/discount offers** (later).

## 4.4 Accounting foundation (prerequisite for most new reports)

Introduce a **ledger** so Cash & Bank, Trial Balance, Balance Sheet, Bank Statement and Day Book are correct by construction.

```text
accounts         (id, org_id, business_id, code, name, group, kind[asset|liability|income|expense|equity],
                  system bool, party_id?, bank_account_id?, loan_id?)
ledger_entries   (id, org_id, business_id, txn_date, account_id, debit, credit,
                  ref_type, ref_id, narration, fy)
```

Posting rules (each document type has a posting function in `packages/tax-engine/src/posting.ts`):

| Transaction | Debit | Credit |
|---|---|---|
| Sale (credit) | Party | Sales, Output CGST/SGST/IGST/Cess, Additional charges |
| Sale (cash/bank part) | Cash/Bank | Party |
| Payment In | Cash/Bank, TDS Receivable | Party |
| Purchase | Purchases, Input GST | Supplier |
| Payment Out | Supplier | Cash/Bank, TDS Payable |
| Sale Return / Credit Note | Sales Return, Output GST | Party |
| Purchase Return / Debit Note | Supplier | Purchase Return, Input GST |
| Expense | Expense account, Input GST | Cash/Bank/Payee |
| Other income | Cash/Bank | Other Income |
| Transfer | To account | From account |
| Loan disbursal / EMI | Bank / Loan + Interest | Loan / Bank |
| Cheque cleared | Bank | Cheques-in-hand |
| Stock | Closing stock valuation computed at report time (weighted average) | |

Migration strategy: add tables with RLS like existing ones (`0002_rls.sql` pattern), then a **one-time backfill** job that replays every existing invoice, purchase, expense and receipt through the posting functions. `Verify My Data` checks Dr = Cr afterwards.

## 4.5 Settings: 11 tabs

**Status**: 🟡. Today `SETTINGS_TABS` = Business, Invoices & print, Features & stock, Data. Replace with the 11 Vyapar tabs below, keeping existing sections inside the right tab.

```text
┌ Settings ─────────────────────────────────────────────────────────────────────────┐
│ [General][Transaction][Print][Taxes][GST][Txn Message][Party][Item][Service Reminder][Accounting][Multi Currency] │
│ ┌ section title ───────────────────────────────────────────────────────────────┐ │
│ │ Setting label                                  Help text           [toggle / input] │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
│ Changes save automatically with a toast; destructive ones ask confirmation.        │
└────────────────────────────────────────────────────────────────────────────────────┘
```

| Tab | Settings (field: type, default) | Status |
|---|---|---|
| **General** | Business name, logo, address, phone, email, **business type** (Retail, Wholesale, Service, Manufacturing…), business category, GSTIN, PAN, state, **Financial year start month** (Apr), date format, **currency symbol & decimals**, amount-in-words language (EN/HI/TA…), app language, Auto-lock timeout, Backup reminder, Enable passcode, Multi-firm/branches (✅ `BranchModal`), Profiles ✅ | ✅ business/region exists |
| **Transaction** | Transaction header: **Invoice/Bill number prefix, series per type** ✅; Cash sale by default ☐; **Billing name**; Customer PO details ☐; **Additional charges** ☐ (name, GST %, HSN); **Discount**: per-line / transaction-level, in % or ₹; Round-off ☑ (nearest/up/down); Quick entry ☐; **Show profit while billing** ☐; Freeze transactions before [date]; **Allow editing after payment** ☑; Default payment terms; Default **due date** days; **Stock**: allow negative stock ☐ (warn/block), **Auto-deduct on challan** ☑; Transport details (vehicle, e-way) ☐; E-way bill threshold; **Barcode scan on billing** ☐; Display purchase price on item row ☐ | 🟡 |
| **Print** | Theme/template ✅ (`PrintSettings`, `InvoicePreview`), paper size (A4/A5/Thermal 2"/3"), orientation, margins, company info toggles, logo/sign/stamp ✅, **show**: HSN, UPI QR ✅, bank details ✅, item description, MRP, batch, payment mode, amount in words, signature, party balance, "Paid" stamp; copies (Original/Duplicate/Triplicate), terms text ✅, footer, **regional language** names, thermal printer options (char width, cut), **cheque print** setup 🆕 | ✅ mostly |
| **Taxes** | Tax rates master (0, 0.25, 3, 5, 12, 18, 28 + custom, ✅ `rates.ts`), **tax groups** (e.g. GST 18 = CGST 9 + SGST 9), **additional taxes**, Cess master, **TCS rates**, **TDS sections** (194C, 194J, 194Q…, rate, threshold) 🆕, default tax on new items, Price-inclusive default ☐ | 🟡 |
| **GST** | **Enable GST** ☑ (hides all GST UI when off ✅ region toggle), GSTIN(s) per branch, **Registration type** (Regular / Composition / Unregistered), **Composition rate**, Return filing frequency (Monthly/QRMP), E-invoice enable + API credentials (roadmap), E-way bill enable + threshold, **Reverse charge** ☐, **Place of supply on invoice** ☑, **HSN/SAC on invoice** ☑ + digits required (4/6/8 by turnover), Composite/exempt handling, ITC default eligibility, Tax-exempt items label, **Enable TCS** ☐ | ✅ partially, consolidate |
| **Transaction Message** | WhatsApp/SMS/email templates per event (Sale, Payment In, Purchase, Order, Reminder) with variables `{party} {number} {amount} {balance} {due_date} {business} {link}`; send **automatically** ☐; copy me ☐; message language; preview | 🆕 |
| **Party** | Party grouping ☑, **Shipping address** ☑, **Credit limit** ☑ (warn/block), Additional party fields (4, label+type), Print party fields, **Payment reminder** ☑ with days before/after, Party-wise item rate ☑, **TDS/TCS on party** ☑, Default party type, Opening balance mandatory ☐ | 🆕 (credit limit design ⚠️ unverified in Vyapar) |
| **Item** | Item type (Product/Service) ☑, **Category** ☑, **HSN/SAC** ☑, Unit + secondary unit ☑ + conversion, **Item description** ☑, Item image ☑, **Wholesale price** ☑, **MRP** ☑, **Batch tracking** ☑ (fields: batch no., mfg, exp, model, size), **Serial tracking** ☑, **Stock maintenance** ☑, **Min stock alert** ☑, Item-wise discount ☑, Item-wise tax ☑, **Barcode scanning** ☑, Additional item fields (4), Quantity decimals (0–4), Default unit, Default GST | 🟡 |
| **Service Reminder** | Reminder categories for service businesses (AMC, vehicle service, subscriptions): **Reminder name**, Item/service linked, **Interval** (days/months), Remind **before** [n] days, Channel (WhatsApp/SMS/email/in-app), message template, auto-create reminder after sale ☑ | 🆕 ⚠️ semantics inferred; Vyapar documents only a "Service Reminders" label |
| **Accounting** | **Enable accounting/ledger mode** ☑, Chart of accounts (view/add groups), **Opening balances**, Default accounts (Sales, Purchase, Round-off, Discount, Bank charges, Interest), **Cash-in-hand opening**, Depreciation ☐ (fixed asset register, rate by IT Act block), Stock valuation method (Weighted average/FIFO), Accounting **lock date**, Auto-post expenses ☑, Cheque management ☑, Loan accounts ☑ | 🆕 |
| **Multi Currency** | **Enable** ☐, Base currency (INR), Currencies list: code, symbol, **exchange rate** (manual + as-of, optional auto), Per-party currency, Show both amounts on invoice, **Forex gain/loss account**, Export rules (LUT/WPAY/WOPAY ✅ in GSTR-1 table 6A) | 🟡 currency field exists on invoices ✅; rate master, forex gain/loss 🆕 ⚠️ |

GST + Income Tax implications of settings: **GST tab** gates GSTR exports and the Taxes group; **Accounting tab** decides whether Balance Sheet/Trial Balance exist; **Transaction freeze date** and **Close FY** protect filed periods (GST returns already filed ✅ marker should auto-lock that month's invoices from edit unless owner overrides).

## 4.6 GST and Income Tax connection map

How each feature feeds compliance. ✅ = already wired in Ledgora.

| Feature | GSTR-1 | GSTR-3B | GSTR-2B recon | HSN/SAC | E-way / E-invoice | TDS/TCS | Income Tax (ITR) |
|---|---|---|---|---|---|---|---|
| Party (GSTIN, state, type) | B2B vs B2C split ✅ | POS ✅ | supplier match ✅ | n/a | recipient details ✅ | TDS/TCS flags 🆕 | party balances → Balance Sheet |
| Item (HSN/SAC, rate) | Table 12 ✅ | tax values ✅ | n/a | ✅ | item list ✅ | n/a | stock valuation, COGS |
| Tax Invoice / Bill of Supply | 4A/5/7/8 ✅ | 3.1(a)/(c) ✅ | n/a | ✅ | ✅ JSON | TCS §206C(1H) ✅ | turnover (§44AD / books) ✅ |
| Credit Note | CDNR/CDNUR ✅ | reduces 3.1 ✅ | n/a | ✅ | n/a | n/a | reduces turnover ✅ |
| Quotation/Order/Challan/Proforma | excluded ✅ | excluded ✅ | n/a | n/a | challan transport | n/a | excluded ✅ |
| Payment In | Table 11 advances 🆕 | 3.1 timing | n/a | n/a | n/a | TDS receivable 🆕 | §269ST cash check 🆕, bank credit match ✅ |
| Purchase Bill | n/a | 4(A) ITC ✅, 3.1(d) RCM | ✅ reconcile | ✅ (purchase HSN) | n/a | §194Q 🆕 | cost of goods |
| Purchase Return / Debit Note | n/a | 4(B)(2) reversal 🆕 | CDN match 🆕 | n/a | n/a | n/a | reduces cost |
| Payment Out | n/a | 180-day ITC rule 🆕 | n/a | n/a | n/a | TDS payable 🆕 (→ Form 26Q data) | §40A(3) cash > ₹10k check 🆕 |
| Expense | n/a | 4(A) if ITC ✅ | ✅ | SAC | n/a | TDS on rent/professional 🆕 | deductible expense ✅ |
| Other Income | n/a | exempt supplies 5 if any | n/a | n/a | n/a | n/a | "other sources" ✅ interest |
| Bank / Cash / Cheque | n/a | n/a | n/a | n/a | n/a | n/a | statement import ✅, balance sheet 🆕 |
| Loan | n/a | n/a | n/a | n/a | n/a | n/a | interest deduction, §24/§80E mapping 🆕 |
| Reports (GST group) | exports ✅ | exports ✅ | ✅ | HSN ✅ / SAC 🆕 | n/a | 27EQ 🆕, TDS/TCS ✅ | ITR summary ✅ |
| Close FY | resets series | n/a | n/a | n/a | n/a | n/a | carries balances, freezes year |
| Export to Tally | voucher XML incl. GST ledgers | | | | | | CA hand-off |
| Verify My Data | catches GSTIN/HSN/total errors before filing | | | | | | |

**Income Tax pathway** (extends existing `IncomeTax.jsx`): Books-based users get P&L + Balance Sheet from the ledger → ITR-3 field map; presumptive users (§44AD/ADA) keep the existing calculator and ITR-4 summary ✅. Both paths use the same turnover figure from sales (net of GST, TCS, credit notes ✅ `billTurnover`). Advance tax schedule ✅ should read **net profit from the P&L report** instead of manual entry once the ledger exists. Reminder: there is no public ITR submission API; the output remains a summary/JSON the user uploads on incometax.gov.in (see `docs/TAX_HELPER_PLAN.md`).

## 4.7 Data model additions (summary)

| Table | Purpose | Key columns |
|---|---|---|
| `party_groups` | grouping | id, name, parent_id |
| `party_addresses` | shipping | party_id, label, address, state, pin |
| `party_item_rates` | party-wise price | party_id, item_id, rate |
| `item_categories` | category | id, name, parent_id |
| `item_units` | alt units | item_id, unit, factor |
| `item_batches`, `item_serials` | tracking | item_id, batch_no, mfg, exp, qty / serial_no, status |
| `purchase_orders` (+lines) | PO | number, supplier, status, expected_date, advance |
| `purchase_returns` (+lines) | debit notes | against_purchase_id, reason, refund_mode |
| `payments` (alter) | payment out | + `direction`, `account_id`, `tds_amount`, `cheque_id` |
| `payment_allocations` (alter) | | + `purchase_id` |
| `accounts`, `ledger_entries` | ledger | see 4.4 |
| `bank_accounts` (evolve `payment_accounts`) | bank ledger | + opening_balance, opening_date, account_id |
| `cheques` | cheque register | direction, party_id, number, amount, date, status, bank_account_id |
| `loans`, `loan_schedule`, `loan_payments` | loans | principal, rate, tenure, emi, lender; due_date, principal_part, interest_part |
| `expense_items` | expense items | name, hsn, rate, gst |
| `other_income` (or `expenses.kind`) | income | category, amount |
| `staff` | salesman | name, user_id?, commission, target |
| `financial_years` | FY control | label, start, end, closed_at, locked |
| `reminders`, `message_templates` | messaging | event, channel, body, schedule |
| `currencies`, `exchange_rates` | multi-currency | code, rate, as_of |
| `tds_sections` | master | section, rate, threshold, nature |
| `backups` | history | id, where, size, created_at, encrypted |

All tables follow the existing pattern: `base()` columns (org_id, id, timestamps, soft delete), composite FK to `(org_id, …)`, RLS policy, and a Zod contract in `packages/contracts`.

## 4.8 Build roadmap (recommended order)

| Phase | Deliverables | Why this order |
|---|---|---|
| **1. Shell & masters** (2–3 wk) | New sidebar + routes; Party groups/addresses/credit limit; Item category/type/SAC/min stock/alt units; Import Parties/Items wizards; Settings reorganised into 11 tabs (UI only, wired to existing fields) | Low risk, visible, unblocks reports that need categories/groups |
| **2. Purchase side** (2–3 wk) | Payment Out, Purchase Order, Purchase Return/Debit Note, Other Income, expense items, ITC flags | Completes the document set; feeds GSTR-3B 4(B) |
| **3. Ledger foundation** (3–4 wk) | `accounts`, `ledger_entries`, posting functions, backfill, Verify My Data (basic) | Everything in Phase 4 depends on it |
| **4. Cash & Bank** (2–3 wk) | Bank accounts ledger, Cash in Hand, transfers, adjustments, Cheques, Loans | Needs Phase 3 |
| **5. Reports** (3–4 wk) | ReportShell + definitions: transaction, party, item, expense, bank, order, loan, then GST extras (SAC, GST Rate, 27EQ, TDS) | Mostly queries once data exists |
| **6. Utilities** (2 wk) | Barcode generator, Bulk update extension, Export to Tally, Close FY, backup scheduler + encryption, salesman tracking | |
| **7. Messaging & growth** (2 wk) | Transaction messages, reminders, WhatsApp share, service reminders, multi-currency rates | Needs provider decisions |
| **8. Compliance polish** | Table 11 advances, RCM, e-invoice IRN, direct GSTN JSON, ITR-3 map | Aligns with COMPETITOR_GAPS roadmap |

Each phase: contracts → migration + RLS → API module (`apps/api/src/modules`) → data layer (`apps/web/src/lib/data`) → feature screen → vitest tests (`tax-engine` first) → docs/USER_GUIDE and CHANGELOG entry.

## 4.9 Open questions to confirm before building

1. **Form 27EQ**: confirm you want it (Vyapar sources did not list it). It requires the collector's TAN and BSR challan details, which the app does not store.
2. **Barcode import from a 100M+ barcode library** is a licensed dataset; the Vyapar-style Library card could ship as a bundled starter catalogue instead. Decide.
3. **Accounting depth**: "ledger-lite" (this plan) vs. full double-entry with manual journal vouchers and fixed-asset depreciation.
4. **Messaging provider** for WhatsApp/SMS (WhatsApp Business API, MSG91, etc.): costs and approval time.
5. **Credit limit mode** (warn vs block) and **Service Reminder** semantics were inferred; verify against the live Vyapar desktop app.
6. **Hosting model for backups**: server-side snapshots (Postgres) vs user-downloaded files, since Ledgora is now multi-tenant SaaS rather than local-first.


---

# PART 5: Complete UI Restructure (Vyapar-style alignment, every module)

This part is the **front-end rebuild spec**. Parts 2–4 say *what* each screen contains; Part 5 says *how the whole UI is laid out, styled and re-built*, module by module, and which existing files change.

## 5.1 Starting point (from the code)

| Today | Fact |
|---|---|
| Shell | `App.jsx` (1,335 lines) owns state and builds `navItems`; `app/Sidebar.jsx`, `TopBar.jsx`, `AppShell.jsx` draw it |
| Routing | `app/router.tsx` `VIEW_ROUTES` (flat list of ~27 ids → paths) |
| Styling | One 3,518-line `src/index.css` + `styles/tokens.css` (105 lines of CSS variables) + `analytics.css`, `auth.css`. No Tailwind, no component library |
| Theme | Green primary `#16a34a`, light bg `#f6f8f6`, dark mode `#0f172a` (recent commit "primary brand accent colors from blue to green") |
| Libraries | React 19, react-router 8, TanStack Query, lucide-react |
| Screens | Many are big single files that mix data, layout and CSS classes (`ReportsView`, `SettingsView`, `GSTReturns`) |

**Decision needed (listed in 5.12)**: Vyapar's look is a very dark navy sidebar, white content, **red** primary buttons, **blue** selection/links, **green** for positive amounts. Your last commit moved the brand to green. This plan keeps Ledgora's tokens in one file so either palette is one edit; the default below follows Vyapar's screenshots.

## 5.2 Visual language (read from your screenshots)

| Element | Vyapar desktop observation | Ledgora token (new) |
|---|---|---|
| Sidebar bg | near-black navy | `--sidebar-bg: #14152a` |
| Sidebar item | white text 15px, icon 20px, 44px row; active row = lighter navy pill `#262a52` with 8px radius | `--sidebar-active: #262a52` |
| Sidebar search | rounded pill "Open Anything (CMD+F)" at top | `--sidebar-search-bg: #262a52` |
| Page bg | very light grey | `--bg: #f4f5f9` |
| Surface | white cards, 1px `#e3e6ee` border, 8px radius | `--surface`, `--border` |
| Top bar | light grey strip with a red dot + editable **business name** ("● Enter Business Name"), customer-support phone/link above it | `--topbar-bg: #f7f8fb` |
| Page title bar | white strip under top bar, 24px semi-bold title | |
| Primary button | **red pill**, white text, bottom-right on wizards | `--cta: #e8294c`, hover `#d01f40` |
| Secondary / links | blue `#2563eb`; selected radio/card border blue | `--link: #2563eb` |
| Positive / negative | green `#16a34a` / red `#dc2626` (balances, To Collect / To Pay) | `--pos`, `--neg` |
| Info tinted panels | pale green `#e8f6ef` (Balance box), pale cream for promos | `--tint-pos`, `--tint-warn` |
| Typography | Roboto-like sans; page title 24/32, section title 18/24 semi-bold, body 14/20, label 13 muted | `--font: "Roboto", system-ui` |
| Radius / shadow | 8px cards, 12px modals, pill buttons, soft shadow on floating panels | `--r-sm 6px --r-md 8px --r-lg 12px` |
| Spacing scale | 4 / 8 / 12 / 16 / 24 / 32 px | `--s-1…--s-8` |
| Illustrations | rounded tinted circles with a flat icon on option cards | `<OptionCard>` |

Dark mode is kept (exists today): derive from the same tokens with `[data-theme="dark"]`.

### Token file (replace contents of `styles/tokens.css`, keep variable names that existing CSS already uses as aliases so nothing breaks at once)

```css
:root {
  /* brand */ --cta:#e8294c; --cta-hover:#d01f40; --link:#2563eb;
  /* legacy aliases (existing index.css uses these) */
  --primary: var(--cta); --primary-hover: var(--cta-hover);
  /* surfaces */ --bg:#f4f5f9; --surface:#fff; --surface-2:#f7f8fb; --border:#e3e6ee;
  --text:#1f2437; --text-muted:#6b7280;
  /* sidebar */ --sidebar-bg:#14152a; --sidebar-fg:#fff; --sidebar-active:#262a52;
  /* status */ --pos:#16a34a; --neg:#dc2626; --warn:#d97706; --info:#2563eb;
  --tint-pos:#e8f6ef; --tint-neg:#fdecec; --tint-warn:#fff4e5;
  /* shape */ --r-sm:6px; --r-md:8px; --r-lg:12px; --shadow-1:0 1px 2px rgba(20,21,42,.06);
}
```

## 5.3 Layout system (desktop, ≥1280px)

```text
 x: 0        240                                                       100%
    ┌─────────┬──────────────────────────────────────────────────────────┐
 y0 │         │ SUPPORT STRIP (optional, 28px): Customer support ☎ · live chat │
    │ SIDEBAR ├──────────────────────────────────────────────────────────┤
    │ 240px   │ TOP BAR 56px: ● [Business name]            [FY ▾] 🔔 ⚙ 👤 │
    │ fixed   ├──────────────────────────────────────────────────────────┤
    │ scroll  │ PAGE TITLE BAR 64px: <Title> · breadcrumb      [actions] │
    │ inside  ├──────────────────────────────────────────────────────────┤
    │         │ CONTENT: padding 24px, max-width none (tables) / 1100px  │
    │         │ (forms/settings), cards on --surface                      │
    │         ├──────────────────────────────────────────────────────────┤
    │ promo   │ STICKY ACTION BAR 64px (forms & wizards only):           │
    │ card    │                                        [Back] [ Continue ]│
    │ company │                                                          │
    └─────────┴──────────────────────────────────────────────────────────┘
```

Rules

1. **Sidebar 240px**, collapsible to a 64px icon rail (the existing auto-hide toggle ✅ stays). Bottom block: optional plan/upgrade card, then **company switcher** (`My Company ›`) opening the business/branch menu that `Sidebar.jsx` already has.
2. **Groups with chevrons** (▾) expand inline; Items has a **+** quick-add. One group open at a time is *not* enforced; open state persists (pattern already in `NavParent`).
3. **Top bar** shows the business name as inline-editable text with a red dot until the business profile is complete (clicking opens Setup My Business).
4. **Page title bar** is the only place with the primary action button (top-right). Wizards and forms put it in the **sticky action bar** (bottom-right, red pill).
5. **Three page templates** cover ~90% of screens (5.5): *List page*, *Form page*, *Report page*; plus *Wizard*, *Settings*, *Detail* and *Modal*.
6. Content widths: tables full width; forms/settings capped at 1100px centred; wizards at 1000px centred.
7. Breakpoints: ≥1280 full; 1024–1279 sidebar auto-collapses to rail; <1024 existing phone layout (off-canvas drawer) stays as is.

## 5.4 Component library (build once in `apps/web/src/components/ui/`)

| Component | Purpose | Replaces / uses |
|---|---|---|
| `AppShell`, `Sidebar`, `NavGroup`, `NavItem`, `CompanySwitcher`, `OpenAnything` | new shell | `app/*` (rewrite internals, keep props) |
| `TopBar` (`BusinessNameField`, `FYSwitcher`) | | `app/TopBar.jsx` |
| `PageHeader` (title, breadcrumb, actions) | every page | `components/ui/PageHeader.jsx` (extend) |
| `ActionBar` | sticky bottom Save/Continue | new |
| `DataTable` (sortable, sticky head, row select, column picker, totals row, row ⋮ menu, empty/loading/error) | all lists & reports | replaces ad-hoc tables in `InvoiceTable`, `ClientsView`, `ReportsView` |
| `FilterBar` (period, party, status, search, export) | lists & reports | new |
| `SummaryChips` (To Collect / To Pay / Total) | list headers | new |
| `Field`, `TextInput`, `MoneyInput`, `DateInput`, `Select`, `Combobox`(party/item picker with "+ Add new"), `PhoneInput`, `GstinInput`, `StateSelect`, `Switch`, `RadioCards`, `Checkbox` | forms | normalise; `PartyPicker` becomes `Combobox` |
| `OptionCard` | big selectable cards (Import method, Party type) | new, from screenshot 2 |
| `Modal`, `Drawer`, `ConfirmModal` ✅, `Toast` ✅ | | keep API |
| `Tabs`, `Stepper`, `Badge/StatusChip`, `EmptyState` (illustration + CTA), `PromoCard`, `Kbd` | | `States.jsx` extends |
| `ExportMenu` (PDF / Excel / Print / Share) | all lists & reports | wraps `TableExport`, `xlsx`, `share` ✅ |
| `LinesGrid` | invoice/purchase/order item entry | evolve `LineItemsGrid` ✅ |
| `LivePreview` | right-hand document preview | evolve `InvoicePreview` ✅ |
| `ReportShell` | report template (3.2.2) | new |
| `SettingRow`, `SettingsSection` | settings pages | new |

Standards for every component: keyboard operable, visible focus ring, 44px min row height for nav and table rows 44px (compact toggle 36px), labels above inputs (13px muted), required marked with a red `*` (as in "Customer Name\*"), inline errors under the field, loading skeletons not spinners, numbers right-aligned with tabular figures, negative/positive colouring only on balance columns.

## 5.5 Page templates

### A. List page (Parties, Items, Sale lists, Purchase lists, Expenses, Cheques, Loans, Bank accounts)

```text
┌ TITLE BAR:  Invoices                                              [ + Add Sale ] ┐
├ FILTER BAR: [This Month ▾] [Party ▾] [Status ▾] [🔍 Search…]          [ Export ▾ ] ┤
├ SUMMARY:    ┌ Total ₹4,80,000 ┐ ┌ Paid ₹3,10,000 ┐ ┌ Unpaid ₹1,70,000 ┐        ┤
├ DATA TABLE ─────────────────────────────────────────────────────────────────────┤
│ ☐ │ Date ▲ │ No. │ Party │ Type │ Amount │ Balance │ Status │ ⋮                   │
│ …                                                                                 │
├ FOOTER: 1–50 of 312   ‹ 1 2 3 ›   Rows [50 ▾]                                     ┤
└──────────────────────────────────────────────────────────────────────────────────┘
Empty state: illustration + "No invoices yet" + [ + Add Sale ] + "Import from Excel"
```

### B. Form page (Add Sale, Add Purchase, Payment In/Out, Expense, Orders, Returns)

Two columns ≥1280: **left = form (flex 1)**, **right = LivePreview (420px, collapsible)** as in screenshot 3; sticky ActionBar `[Save & New] [Save]` with `[Share ▾] [Print ▾]` on the left side of it.

### C. Report page: `ReportShell` (3.2.2). Filters strip on top, summary chips, table, sticky totals row, Export menu in title bar.

### D. Wizard (Import Items / Import Parties / Close FY / Setup My Business / Backup restore)

Centered title ("Select Import Method"), `OptionCard`s in a 2-up row, an "OR" divider, a full-width radio card below, **Continue** red pill bottom-right, **Back** text button bottom-left; `Stepper` at top for multi-step.

### E. Settings page: left sub-nav is replaced by a **top tab strip** (11 tabs, 4.5) with sections as white cards; each `SettingRow` = label + help text left, control right; auto-save with toast.

### F. Detail page (Party detail, Item detail, Bank account, Loan): header card (name, key figures, actions) + `Tabs` + `DataTable`.

### G. Modal / Drawer: quick-add Party, Item, Category, Transfer, Adjust cash, Add bank account (modal 640px, sections via `Tabs`); item/party peek (drawer 480px right).

## 5.6 Sidebar structure and routes (final)

Replace `VIEW_ROUTES` with a grouped definition; one source drives sidebar, breadcrumbs, command palette and titles.

```ts
// app/navigation.ts
export const NAV: NavGroup[] = [
  { id:'home', label:'Home', icon:Home, path:'/' },
  { id:'parties', label:'Parties', icon:Users, children:[
      { id:'parties', label:'All Parties', path:'/parties' },
      { id:'party-groups', label:'Party Groups', path:'/parties/groups' } ]},
  { id:'items', label:'Items', icon:ShoppingBag, quickAdd:'/products/new', children:[
      { id:'items', label:'All Items', path:'/products' },
      { id:'item-categories', label:'Categories', path:'/products/categories' },
      { id:'item-units', label:'Units', path:'/products/units' } ]},
  { id:'sale', label:'Sale', icon:Receipt, children:[ /* Overview, Quotation, Sale Order, Delivery Challan,
      Invoices, Proforma, Payment In, Sale Return, Recurring — existing ids kept */ ]},
  { id:'purchase', label:'Purchase & Expense', icon:ShoppingCart, children:[
      /* Purchase Bills, Payment Out, Purchase Order, Purchase Return/Debit Note, Expenses, Other Income */ ]},
  { id:'grow', label:'Grow Your Business', icon:TrendingUp, children:[
      /* Payment Reminders, Salesman Tracking, Share / WhatsApp, Online Catalog (later) */ ]},
  { id:'cashbank', label:'Cash & Bank', icon:Landmark, children:[
      /* Bank Accounts, Cash in Hand, Cheques, Loan Accounts */ ]},
  { id:'reports', label:'Reports', icon:BarChart3, path:'/reports' },
  { id:'taxes', label:'Taxes', icon:Calculator, children:[ /* GST Returns, Income Tax, TDS/TCS */ ]},
  { id:'sync', label:'Sync, Share & Backup', icon:RefreshCw, children:[ /* Backup, Restore, Auto-backup, Share with CA */ ]},
  { id:'utilities', label:'Utilities', icon:Wrench, children:[ /* Import Items, Import Parties, Bulk Update,
      Export Items, Barcode Generator, Verify My Data, Export to Tally, Close Financial Year, Trash */ ]},
  { id:'settings', label:'Settings', icon:Settings, path:'/settings/general' },
  { id:'plans', label:'Plans & Pricing', icon:Award, path:'/plans' },
];
```

Existing paths are kept as redirects (`/clients → /parties`, `/expenses`, `/receipts → /sales/payment-in`) so bookmarks and the PWA cache do not break; `legacyViewRedirect` in `router.tsx` already supports this pattern.

Full route table (new routes in **bold**):

| Path | Page | Template |
|---|---|---|
| `/` | Home (dashboard + first-sale empty state) | custom |
| `/parties`, **`/parties/new`**, `/parties/:id`, **`/parties/groups`** | Parties | A, G, F |
| `/products`, **`/products/new`**, `/products/:id`, **`/products/categories`**, **`/products/units`** | Items | A, G, F |
| `/sales`, `/sales/quotations`, `/sales/orders`, `/sales/challans`, `/sales/invoices`, `/sales/proforma`, `/sales/credit-notes`, `/invoices/new`, `/invoices/:id` | Sale | custom, A, B |
| **`/sales/payment-in`**, `/receipts` | Payment In | A, B |
| `/purchases`, **`/purchases/new`**, **`/purchases/orders`**, **`/purchases/returns`**, **`/purchases/payment-out`** | Purchase | A, B |
| `/expenses`, **`/expenses/new`**, **`/other-income`** | Expense / Income | A, B |
| **`/cash-bank/accounts`**, **`/cash-bank/accounts/:id`**, **`/cash-bank/cash`**, **`/cash-bank/cheques`**, **`/cash-bank/loans`**, **`/cash-bank/loans/:id`** | Cash & Bank | A, F, G |
| `/reports`, **`/reports/:id`** | Reports | hub, C |
| `/gst-returns/*`, `/income-tax`, **`/tds-tcs`** | Taxes | existing + C |
| **`/backup`**, **`/utilities/import-items`**, **`/utilities/import-parties`**, **`/utilities/bulk-update`**, **`/utilities/export-items`**, **`/utilities/barcode`**, **`/utilities/verify`**, **`/utilities/tally`**, **`/utilities/close-fy`**, `/trash` | Utilities | D, A |
| **`/grow/reminders`**, **`/grow/salesman`** | Grow | A, F |
| `/settings/:tab` (`general`, `transaction`, `print`, `taxes`, `gst`, `messages`, `party`, `item`, `service-reminder`, `accounting`, `multi-currency`), `/settings/team`, `/settings/security` | Settings | E |
| `/plans` | Plans & pricing | custom |

"Open Anything (⌘F)": extend `CommandPalette` so it searches **screens, parties, items, invoices (by number), reports and settings**, with recent items and the shortcut shown inside the pill.

## 5.7 Module-by-module UI restructure

For each module: **layout → what the user sees → components → files**. Field lists are in Parts 2–4.

| # | Module | New layout & behaviour | Existing files → action |
|---|---|---|---|
| 1 | **Shell** | Dark 240px sidebar, light top bar with editable business name, page title bar, sticky action bar, promo/company block | `app/Sidebar.jsx`, `TopBar.jsx`, `AppShell.jsx` → rewrite; `App.jsx` → extract `navItems` to `app/navigation.ts`, extract state hooks to `app/useAppState.ts`, target <400 lines |
| 2 | **Home** | KPI cards (To Collect, To Pay, Cash+Bank, Sales), charts, compliance due-dates strip, quick-add buttons; empty state = first-sale split screen | `dashboard/AnalyticsDashboard.jsx` restyle; **new** `home/FirstSaleScreen.jsx` |
| 3 | **Parties** | Template A with To Collect/To Pay chips, group filter, bulk actions; Add Party = modal with 3 tabs; detail = template F with Transactions / Profitability / Ledger / Details | `parties/ClientsView.jsx`, `ClientModal.jsx`, `PartyOutstandingReport.jsx` → rename to `PartiesView`, `PartyModal`, `PartyDetail`; **new** `PartyGroups.jsx` |
| 4 | **Items** | Template A with stock value / low stock chips, category filter, type filter; Add Item modal 3 tabs; drawer for item peek | `items/InventoryView.jsx`, `ProductBulkEdit.jsx`, `StockReport.jsx`; **new** `ItemModal`, `Categories`, `Units`, `StockAdjustModal` |
| 5 | **Sale lists** (6 types) | Template A, identical columns, per-type title/blurb from `salesFlow.js` ✅; flow tracker kept as a thin strip under the title | `sales/SalesOverview.jsx`, `invoices/list/*` → restyle; `DocFlowTracker.jsx` keep |
| 6 | **Add Sale / any sales doc** | Template B: left form (Bill To + Details in two cards, Items grid, charges + totals, payment row), right **LivePreview**; ActionBar `[Share][Print][Save & New][Save]`; the "Next/Back stepper" becomes optional ("Show all steps" is the default) | `invoices/editor/*` → restyle `InvoiceEditorPage`, `LineItemsGrid`→`LinesGrid`, `PartyPicker`→`Combobox`; keep `useInvoiceTotals`, `useInvoiceDraft` hooks untouched |
| 7 | **Payment In / Out** | Template B (single column + allocation table); right preview optional | `payments/ReceiptVoucher.jsx` → generalise to `PaymentVoucher` with `direction` |
| 8 | **Purchase Bills / PO / Return** | Template A + Template B sharing `LinesGrid` | `purchases/PurchaseBills.jsx` split into `PurchaseList` + `PurchaseEditor`; **new** `PurchaseOrders`, `PurchaseReturns`; `BillOCR.jsx` stays behind flag |
| 9 | **Expenses / Other Income** | Template A with category chips; Add = Template B (compact) | `expenses/ExpenseTracker.jsx` split into list + editor; **new** `OtherIncome` |
| 10 | **Cash & Bank** | Bank accounts as cards **and** table toggle; account detail = template F with Deposit / Withdraw / Transfer / Adjust buttons; Cash in Hand = single ledger page; Cheques = tabbed list (Received / Issued) with status chips; Loans = list + schedule detail | **all new** `features/cash-bank/*` |
| 11 | **Reports** | Hub page of grouped link lists with search + favourites (3.2.1); each report = Template C | `reports/ReportsView.jsx` → becomes hub; its six tabs become `reports/definitions/*.js` entries; **new** `ReportShell` |
| 12 | **GST Returns** | Keep tab content (GSTR-1/3B/2B/TDS/Guide) but wrap in Template C chrome: period selector in the title bar, filing status chips (Filed/Pending) as `StatusChip`, Export menu | `gst-returns/*` restyle only (no logic change) |
| 13 | **Income Tax** | Same: Template with `Tabs`; summary cards on top; calculators stay as cards | `income-tax/IncomeTax.jsx` (split the 5 tabs into files: `RegimeCalculator`, `Presumptive`, `AdvanceTax`, `BankImport`, `Summary`) |
| 14 | **Utilities** | Wizards (Template D) for imports/Tally/Close FY; Barcode generator = split form + preview; Verify My Data = checklist list with Fix buttons | `import-export/*` reuse; **new** `utilities/*` |
| 15 | **Sync, Share & Backup** | One page with two destination cards + schedule + history table | **new** `backup/BackupPage.jsx`; reuse Drive code |
| 16 | **Grow Your Business** | Reminders list (Template A with bulk send), Salesman list + detail (F) | **new** `grow/*` |
| 17 | **Settings** | 11-tab strip, `SettingRow`s, auto-save | `settings/SettingsLayout.jsx`, `SettingsView.jsx` (split by tab into `settings/tabs/*.jsx`), `tabs.js` → new tab list; Team/Security pages kept as extra tabs under "Account Access" |
| 18 | **Print** | Settings > Print becomes live-preview split (left controls, right `InvoicePreview`) | `print/*` restyle |
| 19 | **Auth / Onboarding** | Centered card on light bg, red CTA; Setup checklist after signup | `auth/*`, `onboarding/*` restyle |
| 20 | **Plans & Pricing** | Plan cards grid, "Get Premium" promo card in sidebar | `billing/useEntitlements.ts` ✅ + **new** `PlansPage` |

## 5.8 Screen-level alignment details (selected screens, matching the screenshots)

**Import Items (screenshot 2)** exact structure

```text
TITLE BAR: Import Items
CONTENT (white card, centered 1000px):
   Select Import Method            (24px bold, centered)
   ┌─────────────────────────┐   ┌─────────────────────────┐
   │ ◉crown     [RECOMMENDED] ○│   │                        ○│     OptionCard ×2, 480×410,
   │   (tinted circle + icon)│   │   (tinted circle + icon)│     radio top-right, badge pill green
   │  Import From Barcode    │   │  Import From Excel      │
   │  helper text (muted)    │   │  helper text            │
   └─────────────────────────┘   └─────────────────────────┘
                         ────────── OR ──────────
   ┌─────────────────────────────────────────────────────────┐  full-width RadioCard, blue 2px
   │ Import From Library                                   ◉ │  border when selected
   │ Import items from the library's database                 │
   └─────────────────────────────────────────────────────────┘
ACTION BAR (sticky, right):                         [ Continue ]  ← red pill, disabled until chosen
```

**First sale (screenshot 3)**: left card 760px (sections with blue circular section icons: Invoice Details, Bill To, Invoice Calculation; dashed "Add Sample Item" drop-zone; pale-green Balance box; disabled-looking red pill "Create Your First Invoice" until Customer + Amount valid), right panel 520px on a slightly tinted background with the sample invoice preview and a "sample" ribbon. Hides the sidebar-expanded promo.

**Sidebar (screenshot 1)**: 15px labels, 20px line icons (lucide equivalents: Home, Users, ShoppingBag, Receipt, ShoppingCart, TrendingUp, Landmark, BarChart3, RefreshCw, Wrench, Settings, Award); chevron ▾ right-aligned; "+" for Items; red notification dot on Parties icon (e.g. overdue payments to chase); active = navy pill.

## 5.9 Interaction and state rules

- **Keyboard**: `⌘/Ctrl+F` open anything; `⌘/Ctrl+S` save; `⌘/Ctrl+Shift+S` save & new; `Alt+N` new (context aware: Add Sale on Sale pages, Add Party on Parties); `Esc` closes modal; `Enter` in last item row adds a row; arrow keys in `LinesGrid`; `⌘/Ctrl+P` print. Update `ShortcutsHelp.jsx`.
- **Empty states**: every list has illustration, one sentence and the primary action; imports are offered as the secondary action.
- **Loading**: skeleton rows for tables, shimmer for cards. **Error**: `States.jsx` error block with Retry (exists).
- **Permissions**: nav items and action buttons hidden via `<Can>` ✅ and `can()`; Salesman role sees only Sale, Parties (own) and Items (no purchase price).
- **Unsaved changes**: forms warn on navigation (the draft hook already stores drafts ✅).
- **Responsive**: ≥1280 as drawn; below that, preview pane collapses behind a "Preview" button, tables scroll horizontally with sticky first column.
- **Accessibility**: WCAG AA contrast (white on `#14152a` and on `#e8294c` both pass for text ≥ 14px bold), focus-visible ring `2px --link`, ARIA for nav groups (`aria-expanded` already used), table headers with `scope`.
- **i18n**: strings moved to a message catalogue before adding Hindi/Tamil (needed by Print/Messages settings).

## 5.10 Migration strategy (no big-bang rewrite)

1. **Flag**: `VITE_NEW_UI` / per-user preference `ui.vyapar` (the `featureFlags.js` pattern ✅). Old shell and new shell co-exist until Phase U6.
2. **Tokens first (U0, 2–3 days)**: replace `tokens.css` values, add aliases. Existing screens instantly pick up the new palette.
3. **Shell (U1, 1 wk)**: new Sidebar/TopBar/AppShell/navigation.ts + routes + Open Anything. All current screens render inside it unchanged.
4. **Component library (U2, 1–2 wk)**: `DataTable`, `FilterBar`, `Field*`, `Modal`, `ActionBar`, `OptionCard`, `Stepper`, `EmptyState`, `ReportShell`, with Vitest + a simple `/dev/ui` gallery route.
5. **Module restyle (U3–U5, 4–6 wk)** in this order, each shippable alone: (a) Parties + Items, (b) Sale lists + Add Sale + Payment In, (c) Purchases + Expenses, (d) Reports hub (+ existing six reports), (e) GST Returns + Income Tax wrappers, (f) Settings tabs, (g) Auth/Onboarding/Home.
6. **New-feature screens** from Parts 2–4 are built directly on the new components (Cash & Bank, Utilities, Grow), never in the old style.
7. **CSS cleanup (U6)**: delete dead selectors from `index.css` (3.5k lines) as modules move; goal <800 lines of global CSS, the rest in component-scoped CSS modules. Remove the old shell and the flag.
8. **Regression safety**: keep the existing tests (`salesFlow`, `tax`, `gstReturnTables`, `analytics`, `csv`), add component tests for `DataTable`, `LinesGrid`, `Combobox`, and Playwright smoke tests per module: create party → create item → create invoice → receive payment → open reports → export GSTR-1.

Estimated UI effort: U0–U2 ≈ 3 weeks, U3–U5 ≈ 5 weeks, U6 ≈ 1 week, **≈ 9 weeks** for one front-end developer, overlapping with API work in Phases 2–6 of 4.8.

## 5.11 Updated overall sequence (UI + features)

| Step | UI work | Feature work (from 4.8) |
|---|---|---|
| 1 | U0 tokens, U1 shell, U2 components | none (pure front-end) |
| 2 | Parties, Items restyle + new modals | Phase 1 masters (groups, categories, SAC, min stock) |
| 3 | Sale lists, Add Sale, Payment In | payment rows inline, salesman field |
| 4 | Purchase/Expense restyle | Phase 2 purchase side |
| 5 | Reports hub + ReportShell | Phase 3 ledger → Phase 5 reports |
| 6 | Cash & Bank screens (new) | Phase 4 |
| 7 | Settings 11 tabs, Utilities, Backup, Grow | Phases 6–7 |
| 8 | GST/Income Tax wrappers, Home, Auth, CSS cleanup | Phase 8 |

## 5.12 Decisions needed for the UI

1. **Palette**: follow Vyapar (navy + red CTA + blue links) as specified, or keep Ledgora's green brand with the Vyapar *layout* only? Tokens make both a one-line change; pick the default.
2. **Naming**: "Clients" → "Parties", "Products" → "Items" everywhere (docs, API, DB names stay as is).
3. **Stepper vs single long invoice form**: Vyapar uses one page; Ledgora just shipped a step-by-step creator. This plan makes the single page the default and keeps the stepper as an option.
4. **Live preview pane on Add Sale**: on by default (as in the Vyapar first-sale screen) or toggled off to give the grid more room.
5. **Component library**: hand-built on current CSS (plan above, no new dependency) or adopt Radix/shadcn primitives for Modal/Select/Combobox accessibility (adds dependencies, saves time).

---

*Sources: Vyapar [feature list](https://vyaparapp.in/blog/vyapar-app-complete-feature-list-all-about-your-favorite-billing-software/), [transaction reports guide](https://vyaparapp.in/guides/how-to-check-transaction-reports-in-vyapar-app), [GST guide](https://vyaparapp.in/guides/how-to-manage-gst-compliance-and-taxation-in-vyapar-app), [Tally export guide](https://vyaparapp.in/guides/how-to-import-and-export-vyapar-app-data-into-tally), [FAQ](https://vyaparapp.in/faq), [P&L reports video](https://vyaparapp.in/videos/profit-and-loss-reports); the three Vyapar desktop screenshots supplied; and the Ledgora repository at commit `e49739f` (docs/COMPETITOR_GAPS.md, docs/TAX_HELPER_PLAN.md, `apps/web/src/features/*`, `packages/db/src/schema/*`, `packages/tax-engine/src/*`).*
