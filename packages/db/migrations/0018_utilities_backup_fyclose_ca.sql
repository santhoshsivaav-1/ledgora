CREATE TABLE "backup_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"frequency" text DEFAULT 'off' NOT NULL,
	"hour" integer DEFAULT 21 NOT NULL,
	"keep_last" integer DEFAULT 7 NOT NULL,
	"remind" boolean DEFAULT true NOT NULL,
	"remind_days" integer DEFAULT 7 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_slot" text,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"kind" text NOT NULL,
	"file_id" uuid,
	"file_name" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"encrypted" boolean DEFAULT false NOT NULL,
	"schema_version" integer NOT NULL,
	"sha256" text NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fy_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"year_id" uuid NOT NULL,
	"method" text NOT NULL,
	"new_prefix" text DEFAULT '' NOT NULL,
	"net_profit" numeric(14, 2) DEFAULT 0 NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"closed_by" text DEFAULT '' NOT NULL,
	"reopened_at" timestamp with time zone,
	"reopened_by" text,
	"reopen_reason" text
);
--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "data_from" date;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "data_to" date;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "data_from" date;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "data_to" date;--> statement-breakpoint
ALTER TABLE "fy_closes" ADD CONSTRAINT "fy_closes_org_id_business_id_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."businesses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fy_closes" ADD CONSTRAINT "fy_closes_year_id_financial_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."financial_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "backup_settings_org" ON "backup_settings" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "backups_org_created" ON "backups" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "fy_closes_year" ON "fy_closes" USING btree ("org_id","year_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fy_closes_open_year" ON "fy_closes" USING btree ("org_id","year_id") WHERE "fy_closes"."reopened_at" is null and "fy_closes"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "backups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "backups" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "backups" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "backup_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "backup_settings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "backup_settings" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "fy_closes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fy_closes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fy_closes" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
-- The backup scheduler lists the organizations whose backup may be due, read-only, then runs each in its own tenant.
--> statement-breakpoint
CREATE POLICY "scheduler_read" ON "backup_settings" FOR SELECT USING (current_setting('app.scheduler', true) = 'on');
--> statement-breakpoint
ALTER TABLE "backup_settings" ADD CONSTRAINT "backup_settings_frequency" CHECK ("frequency" IN ('off', 'daily', 'weekly'));
--> statement-breakpoint
ALTER TABLE "backup_settings" ADD CONSTRAINT "backup_settings_ranges" CHECK ("hour" BETWEEN 0 AND 23 AND "keep_last" BETWEEN 1 AND 60 AND "remind_days" BETWEEN 1 AND 90);
--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_kind" CHECK ("kind" IN ('manual', 'auto', 'safety'));
--> statement-breakpoint
ALTER TABLE "fy_closes" ADD CONSTRAINT "fy_closes_method" CHECK ("method" IN ('prefix', 'new-year'));
