ALTER TABLE "parties" ADD COLUMN "msme" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "msme_agreed_days" integer;;--> statement-breakpoint
-- P10-S6: the MSMED Act caps the agreed period at 45 days.
ALTER TABLE "parties" ADD CONSTRAINT "parties_msme_agreed_days_check" CHECK ("msme_agreed_days" IS NULL OR "msme_agreed_days" BETWEEN 1 AND 45);
