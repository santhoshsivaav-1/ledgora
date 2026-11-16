-- R2.5: the ITR-3 pack kind (an income-tax return, so like ITR-4 it covers a financial year and needs no GSTIN).
ALTER TABLE "filing_packs" DROP CONSTRAINT "filing_packs_kind";
--> statement-breakpoint
ALTER TABLE "filing_packs" ADD CONSTRAINT "filing_packs_kind" CHECK ("kind" IN ('gstr1', 'gstr3b', 'ims', 'gstr1a', 'gstr9', 'cmp08', 'gstr4', 'gstr9c', 'itr4', 'itr3'));
