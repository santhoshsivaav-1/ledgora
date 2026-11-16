-- R1 of docs/FEATURE_GAPS_2026-11.md: GSTR-4 (composition, annual) and GSTR-9C packs.
ALTER TABLE "filing_packs" DROP CONSTRAINT "filing_packs_kind";
--> statement-breakpoint
ALTER TABLE "filing_packs" ADD CONSTRAINT "filing_packs_kind" CHECK ("kind" IN ('gstr1', 'gstr3b', 'ims', 'gstr1a', 'gstr9', 'cmp08', 'gstr4', 'gstr9c'));
