-- Phase 2: a filing pack uploaded to the GST portal through a GST service provider keeps the provider's reference and last status.
ALTER TABLE "filing_packs" ADD COLUMN "gsp_reference" text;
--> statement-breakpoint
ALTER TABLE "filing_packs" ADD COLUMN "gsp_status" text;
--> statement-breakpoint
ALTER TABLE "filing_packs" ADD COLUMN "gsp_checked_at" timestamp with time zone;
