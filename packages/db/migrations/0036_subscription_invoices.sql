-- Phase 1 (sell it): GST invoices for what customers pay for Ledgora, plan changes, and the trial-mail record.
ALTER TABLE "subscriptions" ADD COLUMN "replaces_subscription_id" text;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "notices" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
CREATE TABLE "subscription_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"plan" text NOT NULL,
	"interval" text NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"provider_payment_id" text NOT NULL,
	"taxable" numeric(14, 2) NOT NULL,
	"cgst" numeric(14, 2) DEFAULT 0 NOT NULL,
	"sgst" numeric(14, 2) DEFAULT 0 NOT NULL,
	"igst" numeric(14, 2) DEFAULT 0 NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"buyer" jsonb NOT NULL,
	"seller" jsonb NOT NULL,
	CONSTRAINT "subscription_invoices_payment" UNIQUE("provider_payment_id"),
	CONSTRAINT "subscription_invoices_number" UNIQUE("number")
);
--> statement-breakpoint
CREATE INDEX "subscription_invoices_org" ON "subscription_invoices" USING btree ("org_id","issued_at");
--> statement-breakpoint
ALTER TABLE "subscription_invoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "subscription_invoices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "subscription_invoices" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
-- The trial-mail scheduler lists subscriptions across organizations, read-only, then works inside each tenant.
CREATE POLICY "scheduler_read" ON "subscriptions" FOR SELECT USING (current_setting('app.scheduler', true) = 'on');
--> statement-breakpoint
CREATE SEQUENCE "subscription_invoice_seq";
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "subscription_invoice_seq" TO app_user;
