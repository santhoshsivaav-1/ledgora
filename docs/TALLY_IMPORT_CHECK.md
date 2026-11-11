# Tally Prime import check (owner, before release)

Ledgora writes Tally Prime import XML (`packages/tax-engine/src/tally.ts`). The tests prove the files are well-formed, every
voucher balances to zero and the output matches reviewed golden files. They can not prove **Tally accepts them**: only
importing into Tally can. This takes about 15 minutes. Use a **copy** of a company, never live books.

## 1. Make the sample files

```bash
node packages/tax-engine/scripts/tally-sample.ts ./tally-sample "My Test Company"
```

The company name must be the name of the Tally company you will import into. The sample has two sales (one inside the
state, one between states), a purchase, a receipt and an expense, with GST.

(You can also use the real thing: Utilities › Export to Tally on a business with the ledger on.)

## 2. Import, masters first

In Tally Prime: **Import › Masters** → `Master.xml`, then **Import › Vouchers** → `Voucher.xml`.
Before the voucher import, the ledger names in Ledgora (Step 3 of the export screen) must exist or be created by the masters.

## 3. Check and record

| Check | Expected | Result |
|---|---|---|
| Masters import reports no errors; the import log shows 0 exceptions | ✔ | |
| Sundry Debtors has Test Customer TN and KL; Sundry Creditors has Test Supplier | ✔ | |
| Output CGST / SGST / IGST, Input CGST / SGST and Round Off exist under Duties & Taxes / expenses | ✔ | |
| Stock item "Sample Item" exists, unit PCS, HSN 3401 | ✔ | |
| Vouchers import: 5 created, 0 errors | ✔ | |
| INV/2025-26/0001: total ₹236, CGST 18 + SGST 18 | ✔ | |
| INV/2025-26/0002: total ₹1,050, IGST 50 | ✔ | |
| Day Book totals equal Ledgora's report for the same dates | ✔ | |
| Trial Balance in Tally balances | ✔ | |
| GST reports (GSTR-1 summary) show the two sales with the right place of supply | ✔ | |

If an import fails, Tally's `tallyimport.log` (in the Tally folder) says why. Send it with the XML file and fix `tally.ts`
against it (the golden files in `packages/tax-engine/test/golden` are rewritten with
`UPDATE_GOLDEN=1 npx vitest run test/tally.test.js`; read the diff before committing).

## 4. Record the result

Add a note under "Phase 7" in `docs/DECISIONS.md`: Tally Prime version, date, what you imported, and anything that needed
a change. Until that note exists the export is **unverified against Tally**.
