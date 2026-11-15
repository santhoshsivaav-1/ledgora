CREATE TABLE "filing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"pack_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_id" text DEFAULT '' NOT NULL,
	"actor_name" text DEFAULT '' NOT NULL,
	"actor_role" text DEFAULT '' NOT NULL,
	"from_status" text,
	"to_status" text,
	"body" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "filing_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"quarterly" boolean DEFAULT false NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acknowledged" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"itc2b" jsonb,
	"prepared_by" text DEFAULT '' NOT NULL,
	"review_requested_at" timestamp with time zone,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"approved_sha256" text,
	"arn" text,
	"filed_on" date,
	"filed_by" text,
	"ack_file_id" uuid,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "filing_events" ADD CONSTRAINT "filing_events_pack_id_filing_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."filing_packs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filing_events" ADD CONSTRAINT "filing_events_org_id_business_id_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."businesses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filing_packs" ADD CONSTRAINT "filing_packs_org_id_business_id_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."businesses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "filing_events_pack" ON "filing_events" USING btree ("org_id","pack_id","created_at");--> statement-breakpoint
CREATE INDEX "filing_packs_business_period" ON "filing_packs" USING btree ("org_id","business_id","period_to");--> statement-breakpoint
CREATE INDEX "filing_packs_status" ON "filing_packs" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "filing_packs_current" ON "filing_packs" USING btree ("org_id","business_id","kind","period") WHERE "filing_packs"."superseded_at" is null and "filing_packs"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "filing_packs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "filing_packs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "filing_packs" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "business_scope" ON "filing_packs" AS RESTRICTIVE USING (app_business_ok("business_id"));
--> statement-breakpoint
ALTER TABLE "filing_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "filing_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "filing_events" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "business_scope" ON "filing_events" AS RESTRICTIVE USING (app_business_ok("business_id"));
--> statement-breakpoint
ALTER TABLE "filing_packs" ADD CONSTRAINT "filing_packs_kind" CHECK ("kind" IN ('gstr1', 'gstr3b', 'ims'));
--> statement-breakpoint
ALTER TABLE "filing_packs" ADD CONSTRAINT "filing_packs_status_check" CHECK ("status" IN ('draft', 'ready', 'in_review', 'changes_requested', 'approved', 'filed'));
--> statement-breakpoint
ALTER TABLE "filing_packs" ADD CONSTRAINT "filing_packs_period_check" CHECK ("period" ~ '^(0[1-9]|1[0-2])[0-9]{4}$' AND "period_from" <= "period_to" AND "version" >= 1);
--> statement-breakpoint
-- A filed pack always carries the date it was filed; an approval always carries the hash it approved.
ALTER TABLE "filing_packs" ADD CONSTRAINT "filing_packs_filed_check" CHECK (("status" <> 'filed' OR "filed_on" IS NOT NULL) AND ("status" <> 'approved' OR "approved_sha256" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "filing_events" ADD CONSTRAINT "filing_events_kind" CHECK ("kind" IN ('comment', 'status'));
